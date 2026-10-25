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
import { issueQuiz, gradeQuiz } from '../lib/quiz-grade.js'
import { generateQuizPdfs, validateTraineeInfo } from '../lib/quiz-record.js'
import type { QuizFieldRow } from '../lib/quiz-record.js'
import { traineePhotoUpload } from '../lib/trainee-photo.js'

export const portalRouter = Router()

/** Lỗi chung cho mọi trường hợp token không dùng được — không tiết lộ lý do cụ thể. */
const BAD_TOKEN = 'Đường dẫn không hợp lệ hoặc đã hết hiệu lực. Liên hệ cán bộ ATVSLĐ để lấy link mới.'

export const hashToken = (raw: string) =>
  crypto.createHash('sha256').update(raw).digest('hex')

/**
 * Giới hạn theo IP cho toàn cổng công khai, chống dò token.
 * App đặt 'trust proxy' = 1 (index.ts) nên req.ip là IP thật của client sau nginx.
 * Chặn theo từng token thì đã có max_uses trong DB.
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
  /** Chỉ có với purpose='quiz' — CHECK trong DB bảo đảm không null khi là link thi. */
  course_id: string | null
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
            t.site_id, t.course_id, t.expires_at, t.max_uses, t.used_count,
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
  // ── Pha H6: link thi tại hiện trường ──
  // Phát đề ngay trong lần GET này, KHÔNG consume: học viên mở link xem rồi đóng lại
  // không được tính một lượt. Một lượt chỉ bị trừ lúc nộp bài.
  let quiz: unknown = null
  if (t.purpose === 'quiz' && t.course_id) quiz = await issueQuizForToken(t.course_id)

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
    quiz,
  })
})

/**
 * Đề thi cho một link QR: thông tin khóa, trường cần khai và câu hỏi đã rút/xáo.
 *
 * KHÔNG trả `correct_index` — client chỉ nhận text và options. `seed` trả về để client
 * gửi lại khi nộp; nhờ đó server dựng lại đúng phép xáo lúc chấm mà không cần lưu
 * trạng thái nào giữa GET và POST (xem quiz-grade.ts).
 */
async function issueQuizForToken(courseId: string) {
  const c = await query<{
    id: string; title: string; description: string | null; video_url: string | null
    duration: string | null; summary: string | null; pass_score: number
    questions_per_attempt: number | null; randomize_options: boolean
    validity_months: number | null; max_attempts: number
  }>(
    `SELECT id, title, description, video_url, duration, summary, pass_score,
            questions_per_attempt, randomize_options, validity_months, max_attempts
     FROM courses WHERE id = $1`,
    [courseId],
  )
  const course = c.rows[0]
  if (!course) return null

  const all = await query<{ id: number; text: string; options: string[] }>(
    'SELECT id, text, options FROM questions WHERE course_id = $1 ORDER BY sort_order, id',
    [courseId],
  )
  if (all.rows.length === 0) return null

  const issued = issueQuiz(
    {
      questions_per_attempt: course.questions_per_attempt,
      randomize_options: course.randomize_options,
      pass_score: course.pass_score,
    },
    all.rows,
  )

  const fields = await query(
    'SELECT field_key, label, type, options, required, purpose FROM quiz_fields ORDER BY sort_order, id',
  )

  return {
    course: {
      id: course.id, title: course.title, description: course.description,
      video_url: course.video_url, duration: course.duration, summary: course.summary,
      pass_score: course.pass_score, max_attempts: course.max_attempts,
    },
    fields: fields.rows,
    questions: issued.questions,
    questionIds: issued.questionIds,
    seed: issued.seed,
  }
}

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

// ═══════════════ Pha H6: thi qua link QR ═══════════════
// Ảnh học viên. ignoreUses vì endpoint này chạy TRƯỚC khi nộp bài: nếu kiểm max_uses
// thì link max_uses=1 upload ảnh xong là hết lượt, không nộp được bài nữa.
portalRouter.post('/:token/quiz/photo', traineePhotoUpload.single('file'), async (req, res) => {
  const t = await loadToken(String(req.params.token), 'quiz', { ignoreUses: true })
  if (!t) return res.status(403).json({ error: BAD_TOKEN })
  if (!req.file)
    return res.status(400).json({ error: 'Vui lòng chọn ảnh PNG, JPG hoặc WEBP (tối đa 4MB).' })
  res.status(201).json({ stored_name: req.file.filename })
})

portalRouter.post('/:token/quiz', async (req, res) => {
  const t = await loadToken(String(req.params.token), 'quiz')
  if (!t || !t.course_id) return res.status(403).json({ error: BAD_TOKEN })
  const courseId = t.course_id

  const answers = req.body?.answers as Record<string, number> | undefined
  if (!answers || typeof answers !== 'object')
    return res.status(400).json({ error: 'Thiếu bài làm.' })
  const questionIds = Array.isArray(req.body?.questionIds)
    ? (req.body.questionIds as unknown[]).map(Number).filter(Number.isInteger)
    : []

  const courseRes = await query<{
    pass_score: number; title: string; validity_months: number | null
    max_attempts: number; randomize_options: boolean
  }>(
    `SELECT pass_score, title, validity_months, max_attempts, randomize_options
     FROM courses WHERE id = $1`,
    [courseId],
  )
  const course = courseRes.rows[0]
  if (!course) return res.status(403).json({ error: BAD_TOKEN })

  const fieldRows = await query<QuizFieldRow>(
    'SELECT field_key, label, type, options, required, purpose FROM quiz_fields ORDER BY sort_order, id',
  )
  const checked = validateTraineeInfo(
    fieldRows.rows, (req.body?.traineeInfo ?? {}) as Record<string, unknown>)
  if ('error' in checked) return res.status(400).json({ error: checked.error })
  const traineeInfo = checked.info

  // Tên trên chứng nhận PHẢI khai: đường này không có tài khoản nên không có gì rơi về
  // như courses.ts (req.user.fullName). Thiếu dấu purpose='full_name' trong cấu hình
  // quiz_fields là lỗi cấu hình, báo rõ cho người đào tạo sửa chứ không cấp chứng nhận
  // không tên.
  const nameField = fieldRows.rows.find((f) => f.purpose === 'full_name')
  const traineeName = nameField ? (traineeInfo[nameField.field_key] ?? '') : ''
  if (!traineeName)
    return res.status(400).json({
      error: 'Biểu mẫu chưa có trường họ tên (vai trò "Họ và tên") nên chưa cấp được '
        + 'chứng nhận. Liên hệ cán bộ đào tạo.',
    })

  // ── Giới hạn số lần thi ──
  // Đếm theo trainee_key (CCCD đã băm) để mỗi học viên có hạn riêng dù dùng chung link.
  // Hệ quả cần biết: KHÔNG có trường purpose='id_number' thì trainee_key null, không
  // đếm theo người được nữa — giới hạn rơi về max_uses của token, tức là đếm theo link.
  const idField = fieldRows.rows.find((f) => f.purpose === 'id_number')
  const idNumber = idField ? traineeInfo[idField.field_key] : null
  const traineeKey = idNumber
    ? crypto.createHash('sha256').update(idNumber.trim().toLowerCase(), 'utf8').digest('hex')
    : null
  const maxAttempts = Number(course.max_attempts ?? 0)
  let used = 0
  if (traineeKey && maxAttempts > 0) {
    const r = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM atld.quiz_attempts
       WHERE trainee_key = $1 AND course_id = $2 AND submitted_at IS NOT NULL`,
      [traineeKey, courseId],
    )
    used = Number(r.rows[0]?.n ?? 0)
    // Chặn TRƯỚC khi chấm: chấm rồi mới chặn thì vẫn lộ kết quả và vẫn ghi attempt.
    if (used >= maxAttempts)
      return res.status(403).json({
        error: `Đã hết số lần làm bài cho phép (${maxAttempts} lần). `
          + 'Liên hệ cán bộ đào tạo để được xem xét.',
        attempts_used: used, max_attempts: maxAttempts,
      })
  }

  const qres = await query<{ id: number; correct_index: number; options: string[] }>(
    questionIds.length > 0
      ? 'SELECT id, correct_index, options FROM questions WHERE course_id = $1 AND id = ANY($2::int[])'
      : 'SELECT id, correct_index, options FROM questions WHERE course_id = $1',
    questionIds.length > 0 ? [courseId, questionIds] : [courseId],
  )
  if (qres.rows.length === 0) return res.status(400).json({ error: 'Khóa học chưa có câu hỏi.' })

  // Trừ lượt dùng của link NGAY TRƯỚC khi ghi bài: trừ sau thì hai request song song
  // cùng vượt được max_uses.
  if (!(await consume(t.id))) return res.status(403).json({ error: BAD_TOKEN })

  const graded = gradeQuiz({
    randomizeOptions: Boolean(course.randomize_options),
    passScore: course.pass_score,
    seed: typeof req.body?.seed === 'string' ? req.body.seed : null,
    answers,
    questions: qres.rows.map((q) => ({
      id: q.id, correct_index: q.correct_index, option_count: q.options.length,
    })),
  })
  const { score, passScore, passed } = graded
  const certId = passed
    ? `ATLD-${courseId.toUpperCase()}-${Date.now().toString().slice(-6)}` : null
  const expiresAt = passed && course.validity_months
    ? new Date(Date.now() + course.validity_months * 30.44 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10)
    : null

  // user_id null, portal_token_id có giá trị — CHECK quiz_attempts_owner_chk thỏa.
  // KHÔNG ghi `progress`: bảng đó UNIQUE (user_id, course_id) và NOT NULL user_id.
  const attemptKey = crypto.randomBytes(32).toString('hex')
  const attemptRes = await query<{ id: number }>(
    `INSERT INTO atld.quiz_attempts (user_id, portal_token_id, course_id, question_ids,
       answers, score, passed, trainee_info, trainee_key, download_key, submitted_at)
     VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, now()) RETURNING id`,
    [t.id, courseId, JSON.stringify(questionIds),
     JSON.stringify(graded.normalizedAnswers),
     score, passed, JSON.stringify(traineeInfo), traineeKey, attemptKey],
  )
  const attemptId = attemptRes.rows[0]!.id

  // Cùng quy tắc với courses.ts: purpose='photo' trước, không có thì trường ảnh đầu tiên.
  const photoField = fieldRows.rows.find((f) => f.purpose === 'photo')
    ?? fieldRows.rows.find((f) => f.type === 'image')
  const photoStoredName = photoField ? (traineeInfo[photoField.field_key] ?? null) : null

  let downloadKey: string | null = null
  if (passed) {
    downloadKey = crypto.randomBytes(32).toString('hex')
    await query(
      `INSERT INTO atld.quiz_certificates
        (cert_id, course_id, attempt_id, portal_token_id, trainee_name, trainee_info,
         photo_stored_name, score, passed, issued_at, expires_at, download_key, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true, now(), $9,$10,'portal')`,
      [certId, courseId, attemptId, t.id, traineeName, JSON.stringify(traineeInfo),
       photoStoredName, score, expiresAt, downloadKey],
    )
  }

  const pdfs = await generateQuizPdfs({
    attemptId, certId, courseId, courseTitle: course.title,
    traineeName, traineeInfo,
    fieldLabels: Object.fromEntries(fieldRows.rows.map((f) => [f.field_key, f.label])),
    photoFieldKey: photoField?.field_key ?? null,
    photoStoredName,
    score, passed, passScore, expiresAt,
    questionIds,
    answers: graded.normalizedAnswers,
  })

  res.json({
    score, passed, passScore,
    attempts_used: traineeKey && maxAttempts > 0 ? used + 1 : null,
    max_attempts: maxAttempts,
    attempt_pdf: pdfs.detailPdf ? `/api/courses/attempts/${attemptId}/pdf?k=${attemptKey}` : null,
    certificate: passed
      ? {
          certId, traineeName, courseTitle: course.title, score, expiresAt,
          pdf_url: pdfs.certPdf
            ? `/api/courses/certificates/${encodeURIComponent(certId!)}/pdf?k=${downloadKey}`
            : null,
        }
      : null,
  })
})
