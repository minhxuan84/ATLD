/**
 * Cổng khai báo công khai có token (Pha D).
 *
 * KHÔNG có requireAuth: nhà thầu không có tài khoản trong hệ thống. Thay vào đó mỗi
 * link là một token gắn sẵn nhà thầu/hợp đồng, có hạn dùng và số lần dùng.
 *
 * Nguyên tắc bảo mật của file này:
 * - Token lưu trong DB dạng SHA-256, không lưu bản thô: rò DB thì link cũ vẫn vô dụng.
 * - Bản khai vào hàng chờ hse_worker_submissions, KHÔNG ghi thẳng hse_workers. Hồ sơ
 *   NLĐ dẫn tới quyền vào nhà máy nên phải có cán bộ duyệt — đây là biên giới tin cậy.
 * - Token sai và token hết hạn trả về cùng một lỗi, không phân biệt cho người dò.
 * - Không trả danh sách NLĐ hiện có hay thông tin nội bộ nào ngoài tên nhà thầu/hợp
 *   đồng chính token đó gắn.
 */
import { Router } from 'express'
import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import rateLimit from 'express-rate-limit'
import { query } from '../db.js'
import { clientIp, upload, UPLOAD_DIR } from '../lib/hse-core.js'
import { escapeText, sanitizeFileName, ALLOWED_EXT } from '../util.js'

export const portalRouter = Router()

/** Lỗi chung cho mọi trường hợp token không dùng được — không tiết lộ lý do cụ thể. */
const BAD_TOKEN = 'Đường dẫn không hợp lệ hoặc đã hết hiệu lực. Liên hệ cán bộ ATVSLĐ để lấy link mới.'

export const hashToken = (raw: string) =>
  crypto.createHash('sha256').update(raw).digest('hex')

/**
 * Giới hạn theo IP cho toàn cổng công khai, chống dò token.
 * Lưu ý: app chưa đặt 'trust proxy', nên sau nginx mọi request mang IP của proxy và
 * hạn mức này thành hạn mức chung. Vẫn giữ vì nó chặn được dò token ở mức tổng,
 * còn chặn theo từng token thì đã có max_uses trong DB.
 */
const portalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.' },
})
portalRouter.use(portalLimiter)

interface TokenRow {
  id: number
  purpose: string
  label: string | null
  contractor_id: number | null
  contract_id: number | null
  finding_id: number | null
  site_id: number | null
  expires_at: string
  max_uses: number | null
  used_count: number
  contractor_name: string | null
  contract_no: string | null
  site_name: string | null
}

/**
 * Tra token thô → bản ghi còn hiệu lực, hoặc null.
 *
 * Tra bằng hash nên so sánh diễn ra trên khoá UNIQUE đã index; không cần
 * timingSafeEqual vì không có bước so chuỗi bí mật nào trong tiến trình này —
 * giá trị tra cứu đã là digest của thứ người gửi đưa lên.
 */
async function loadToken(
  raw: string,
  purpose?: string,
  /**
   * Bỏ qua điều kiện max_uses. Chỉ dùng cho các endpoint đính kèm (tệp hồ sơ, ảnh)
   * chạy SAU khi endpoint chính đã consume một lượt: nếu vẫn kiểm max_uses thì link
   * max_uses=1 gửi xong bản khai là mọi tệp kèm theo đều 403, nhà thầu không nộp
   * được hồ sơ. Những endpoint đó vẫn kiểm quyền thật — bản khai / phiếu phải thuộc
   * đúng token này — nên nới ở đây không mở thêm cửa nào.
   */
  opts?: { ignoreUses?: boolean },
): Promise<TokenRow | null> {
  // Token sinh bằng base64url 32 byte → 43 ký tự. Chặn sớm chuỗi dài/lạ.
  if (!raw || raw.length > 128 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null
  const r = await query<TokenRow>(
    `SELECT t.id, t.purpose, t.label, t.contractor_id, t.contract_id, t.finding_id,
            t.site_id, t.expires_at, t.max_uses, t.used_count,
            ct.name AS contractor_name, c.contract_no, b.name AS site_name
     FROM atld.hse_portal_tokens t
     LEFT JOIN atld.hse_contractors ct ON ct.id = t.contractor_id
     LEFT JOIN atld.hse_contracts c ON c.id = t.contract_id
     LEFT JOIN atld.branches b ON b.id = t.site_id
     WHERE t.token_hash = $1
       AND t.revoked_at IS NULL
       AND t.expires_at > now()
       AND ($2::boolean OR t.max_uses IS NULL OR t.used_count < t.max_uses)`,
    [hashToken(raw), opts?.ignoreUses === true],
  )
  const t = r.rows[0]
  if (!t) return null
  if (purpose && t.purpose !== purpose) return null
  return t
}

/** Đếm một lần dùng. Điều kiện used_count lặp lại để hai request song song không vượt hạn. */
async function consume(tokenId: number): Promise<boolean> {
  const r = await query(
    `UPDATE atld.hse_portal_tokens SET used_count = used_count + 1
     WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()
       AND (max_uses IS NULL OR used_count < max_uses)
     RETURNING id`,
    [tokenId],
  )
  return r.rows.length > 0
}

// ═══════════════ Thông tin form ═══════════════
// Chỉ trả những gì cần để dựng form: mục đích, nhà thầu/hợp đồng token gắn, hạn dùng.
portalRouter.get('/:token', async (req, res) => {
  const t = await loadToken(String(req.params.token))
  if (!t) return res.status(403).json({ error: BAD_TOKEN })

  // Form khai báo NLĐ cần biết những loại hồ sơ bắt buộc để nhà thầu nộp đúng.
  let docTypes: unknown[] = []
  if (t.purpose === 'worker_declare') {
    const d = await query(
      `SELECT id, name, is_mandatory FROM atld.hse_doc_types
       WHERE scope = 'worker' AND is_active = true
       ORDER BY is_mandatory DESC, sort_order, name`)
    docTypes = d.rows
  }
  // Phản hồi khắc phục cần nội dung phát hiện và yêu cầu — không trả gì thêm.
  let finding: unknown = null
  if (t.purpose === 'capa_response' && t.finding_id) {
    const f = await query(
      `SELECT finding_no, description, area, capa_requirement, capa_due_at, risk_level, status
       FROM atld.hse_findings WHERE id = $1`, [t.finding_id])
    finding = f.rows[0] ?? null
  }
  res.json({
    purpose: t.purpose,
    label: t.label,
    contractor_name: t.contractor_name,
    contract_no: t.contract_no,
    site_name: t.site_name,
    expires_at: t.expires_at,
    remaining_uses: t.max_uses === null ? null : t.max_uses - t.used_count,
    docTypes,
    finding,
  })
})

// ═══════════════ Khai báo NLĐ → hàng chờ ═══════════════
portalRouter.post('/:token/worker', async (req, res) => {
  const t = await loadToken(String(req.params.token), 'worker_declare')
  if (!t) return res.status(403).json({ error: BAD_TOKEN })
  const b = req.body ?? {}
  const fullName = escapeText(String(b.full_name ?? '').trim())
  if (!fullName) return res.status(400).json({ error: 'Phải nhập họ tên người lao động.' })
  const idNumber = escapeText(String(b.id_number ?? '').trim())
  if (!idNumber) return res.status(400).json({ error: 'Phải nhập số CCCD / hộ chiếu.' })

  // Payload giữ dạng JSONB, chỉ nhận đúng các khoá biết trước — không spread req.body
  // để nhà thầu không chèn được khoá lạ vào bản khai.
  const payload = {
    full_name: fullName,
    id_number: idNumber,
    birth_date: b.birth_date ? String(b.birth_date).slice(0, 10) : null,
    gender: ['male', 'female', 'other'].includes(String(b.gender)) ? String(b.gender) : null,
    job_title: escapeText(String(b.job_title ?? '').trim()) || null,
    phone: escapeText(String(b.phone ?? '').trim()) || null,
    email: escapeText(String(b.email ?? '').trim()) || null,
    address: escapeText(String(b.address ?? '').trim()) || null,
    blood_type: escapeText(String(b.blood_type ?? '').trim()) || null,
    emergency_contact: escapeText(String(b.emergency_contact ?? '').trim()) || null,
    emergency_phone: escapeText(String(b.emergency_phone ?? '').trim()) || null,
    note: escapeText(String(b.note ?? '').trim()) || null,
  }
  if (!(await consume(t.id))) return res.status(403).json({ error: BAD_TOKEN })
  const r = await query<{ id: number }>(
    `INSERT INTO atld.hse_worker_submissions (token_id, payload, submitted_ip)
     VALUES ($1,$2::jsonb,$3) RETURNING id`,
    [t.id, JSON.stringify(payload), clientIp(req)],
  )
  res.status(201).json({
    id: r.rows[0]!.id,
    message: 'Đã nhận bản khai. Cán bộ ATVSLĐ sẽ kiểm tra và phản hồi. '
      + 'Người lao động chưa được vào nhà máy cho tới khi hồ sơ được duyệt.',
  })
})

// File kèm bản khai — nộp sau khi đã có id bản khai.
portalRouter.post('/:token/worker/:submissionId/file', upload.single('file'), async (req, res) => {
  const stored = req.file ? path.join(UPLOAD_DIR, req.file.filename) : null
  const drop = () => { stored && fs.existsSync(stored) && fs.unlinkSync(stored) }

  const t = await loadToken(String(req.params.token), 'worker_declare', { ignoreUses: true })
  if (!t) { drop(); return res.status(403).json({ error: BAD_TOKEN }) }
  // multer đã bỏ file sai định dạng (req.file undefined) nên gộp hai lý do vào một
  // thông điệp — xem ghi chú ở endpoint ảnh bên dưới.
  if (!req.file)
    return res.status(400).json({
      error: `Chưa chọn tệp, hoặc tệp không đúng định dạng. Chỉ nhận: ${ALLOWED_EXT.join(', ')}.`,
    })
  const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '')
  if (!ALLOWED_EXT.includes(ext)) {
    drop()
    return res.status(400).json({ error: `Chỉ nhận tệp: ${ALLOWED_EXT.join(', ')}.` })
  }
  // Bản khai phải thuộc đúng token này, nếu không nhà thầu A gắn được file vào bản
  // khai của nhà thầu B.
  const sub = await query<{ id: number }>(
    `SELECT id FROM atld.hse_worker_submissions
     WHERE id = $1 AND token_id = $2 AND status = 'pending'`,
    [Number(req.params.submissionId), t.id])
  if (!sub.rows[0]) { drop(); return res.status(403).json({ error: BAD_TOKEN }) }

  // Loại hồ sơ phải thuộc scope 'worker'. Nhà thầu gửi id tuỳ ý được, và khi duyệt
  // thì file này thành hse_worker_docs với đúng doc_type đó — nhận id scope khác sẽ
  // làm engine xét điều kiện tính nhầm là đã đủ hồ sơ của một mục không phải của NLĐ.
  let docTypeId: number | null = null
  if (req.body?.doc_type_id) {
    const dt = await query<{ id: number }>(
      `SELECT id FROM atld.hse_doc_types
       WHERE id = $1 AND scope = 'worker' AND is_active = true`,
      [Number(req.body.doc_type_id)])
    if (!dt.rows[0]) {
      drop()
      return res.status(400).json({ error: 'Loại hồ sơ không hợp lệ.' })
    }
    docTypeId = dt.rows[0].id
  }

  const r = await query<{ id: number }>(
    `INSERT INTO atld.hse_submission_files (submission_id, doc_type_id, file_name, stored_name)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [sub.rows[0].id, docTypeId,
     sanitizeFileName(req.file.originalname), req.file.filename],
  )
  res.status(201).json({ id: r.rows[0]!.id, file_name: sanitizeFileName(req.file.originalname) })
})

// ═══════════════ Báo điều kiện không an toàn ═══════════════
portalRouter.post('/:token/finding', async (req, res) => {
  const t = await loadToken(String(req.params.token), 'field_report')
  if (!t) return res.status(403).json({ error: BAD_TOKEN })
  const b = req.body ?? {}
  const description = escapeText(String(b.description ?? '').trim())
  if (!description) return res.status(400).json({ error: 'Phải mô tả nội dung phát hiện.' })

  if (!(await consume(t.id))) return res.status(403).json({ error: BAD_TOKEN })
  // Vào thẳng hse_findings với source='field_report', trạng thái 'new' — cán bộ đánh
  // giá ở bước 2 mới xác định rủi ro. Không cho người ngoài tự đặt mức rủi ro.
  const seq = await query<{ n: string }>(`SELECT nextval('atld.hse_finding_no_seq')::text AS n`)
  const findingNo = `PH-${new Date().getFullYear()}-${String(seq.rows[0]!.n).padStart(5, '0')}`
  const r = await query<{ id: number }>(
    `INSERT INTO atld.hse_findings
       (finding_no, source, finding_type, site_id, area, contractor_id, contract_id,
        description, reporter_name, detected_at, status, portal_token_id)
     VALUES ($1,'field_report',$2,$3,$4,$5,$6,$7,$8, now(), 'new', $9)
     RETURNING id`,
    [findingNo,
     ['unsafe_condition', 'unsafe_act', 'near_miss'].includes(String(b.finding_type))
       ? String(b.finding_type) : 'unsafe_condition',
     t.site_id, escapeText(String(b.area ?? '').trim()) || null,
     t.contractor_id, t.contract_id, description,
     escapeText(String(b.reporter_name ?? '').trim()) || null, t.id],
  )
  res.status(201).json({
    id: r.rows[0]!.id, finding_no: findingNo,
    message: 'Đã nhận thông tin. Cán bộ ATVSLĐ sẽ đánh giá và xử lý.',
  })
})

portalRouter.post('/:token/finding/:findingId/photo', upload.single('file'), async (req, res) => {
  const stored = req.file ? path.join(UPLOAD_DIR, req.file.filename) : null
  const drop = () => { stored && fs.existsSync(stored) && fs.unlinkSync(stored) }

  const t = await loadToken(String(req.params.token), undefined, { ignoreUses: true })
  if (!t || !['field_report', 'capa_response'].includes(t.purpose)) {
    drop()
    return res.status(403).json({ error: BAD_TOKEN })
  }
  // fileFilter của multer đã loại phần mở rộng ngoài ALLOWED_EXT bằng cách bỏ file
  // (req.file undefined), nên không phân biệt được "chưa chọn" và "sai định dạng" ở
  // đây. Thông điệp phải nói cả hai, nếu không người gửi ảnh .webp/.heic từ điện
  // thoại sẽ tưởng mình chưa bấm chọn ảnh.
  if (!req.file)
    return res.status(400).json({
      error: 'Chưa chọn ảnh, hoặc ảnh không đúng định dạng. Chỉ nhận png, jpg, jpeg.',
    })
  const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '')
  if (!['png', 'jpg', 'jpeg'].includes(ext)) {
    drop()
    return res.status(400).json({ error: 'Chỉ nhận ảnh png, jpg, jpeg.' })
  }
  const findingId = Number(req.params.findingId)
  // field_report: chỉ gắn vào phiếu do CHÍNH token này tạo (portal_token_id). Không
  // đối chiếu theo contractor_id: token không gắn nhà thầu sẽ khớp mọi phiếu
  // field_report của nhà máy.
  // capa_response: chỉ gắn vào đúng phiếu token trỏ tới.
  const f = await query<{ id: number }>(
    t.purpose === 'capa_response'
      ? `SELECT id FROM atld.hse_findings WHERE id = $1 AND id = $2`
      : `SELECT id FROM atld.hse_findings WHERE id = $1 AND portal_token_id = $2`,
    [findingId, t.purpose === 'capa_response' ? t.finding_id : t.id])
  if (!f.rows[0]) { drop(); return res.status(403).json({ error: BAD_TOKEN }) }

  const r = await query<{ id: number }>(
    `INSERT INTO atld.hse_finding_photos (finding_id, phase, file_name, stored_name, caption)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [findingId, t.purpose === 'capa_response' ? 'capa' : 'detect',
     sanitizeFileName(req.file.originalname), req.file.filename,
     escapeText(String(req.body?.caption ?? ''))],
  )
  res.status(201).json({ id: r.rows[0]!.id })
})

// ═══════════════ Phản hồi khắc phục ═══════════════
portalRouter.post('/:token/capa', async (req, res) => {
  const t = await loadToken(String(req.params.token), 'capa_response')
  if (!t || !t.finding_id) return res.status(403).json({ error: BAD_TOKEN })
  const action = escapeText(String(req.body?.capa_action ?? '').trim())
  if (!action) return res.status(400).json({ error: 'Phải ghi nội dung đã khắc phục.' })

  // Chỉ nhận khi phiếu đang ở bước giao khắc phục. Nhà thầu báo xong → chuyển sang
  // 'capa_done' để cán bộ xác minh; KHÔNG tự chuyển sang 'verified'.
  const cur = await query<{ status: string }>(
    `SELECT status FROM atld.hse_findings WHERE id = $1`, [t.finding_id])
  if (!cur.rows[0]) return res.status(403).json({ error: BAD_TOKEN })
  if (cur.rows[0].status !== 'capa_assigned')
    return res.status(400).json({
      error: 'Phiếu này hiện không ở bước chờ khắc phục. Liên hệ cán bộ ATVSLĐ.',
    })

  if (!(await consume(t.id))) return res.status(403).json({ error: BAD_TOKEN })
  await query(
    `UPDATE atld.hse_findings
     SET capa_action = $1, root_cause = $2, preventive_action = $3,
         capa_done_at = now(), status = 'capa_done', updated_at = now()
     WHERE id = $4`,
    [action,
     escapeText(String(req.body?.root_cause ?? '').trim()) || null,
     escapeText(String(req.body?.preventive_action ?? '').trim()) || null,
     t.finding_id],
  )
  res.json({
    ok: true, finding_id: t.finding_id,
    message: 'Đã nhận phản hồi khắc phục. Cán bộ ATVSLĐ sẽ xác minh tại hiện trường.',
  })
})
