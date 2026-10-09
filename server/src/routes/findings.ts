/**
 * Phiếu phát hiện + vòng CAPA (Pha C) — quy trình kiểm tra định kỳ 8 bước.
 *
 * Tách khỏi hse.ts (đã >2800 dòng). Bảng tạo trong IIFE migration của hse.ts theo
 * đúng quy ước sẵn có của dự án (bảng jsa_* cũng tạo ở đó).
 *
 * Khác hse_dossiers — nơi status chỉ là whitelist chuyển tự do: ở đây chuyển trạng
 * thái bị cưỡng chế theo máy trạng thái, nhảy bước là 400.
 */
import { Router } from 'express'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { query } from '../db.js'
import { requireAuth, requireHse, siteScope, type AuthUser } from '../auth.js'
import { audit, clientIp, upload, UPLOAD_DIR, syncWorkerAccess } from '../lib/hse-core.js'
import { escapeText, sanitizeFileName } from '../util.js'
import { hashToken } from './portal.js'

export const findingsRouter = Router()

// Ghi nhận / đánh giá / giao / xác minh: cán bộ kiểm tra.
const canInspect = [requireAuth, requireHse('inspect', 'approve')]
// Đình chỉ và duyệt làm tiếp: chỉ cấp phê duyệt.
const canApprove = [requireAuth, requireHse('approve')]

/** Hạn khắc phục theo mức rủi ro: cao 24h, thấp 72h. */
const CAPA_HOURS: Record<string, number> = { high: 24, low: 72 }

/**
 * Máy trạng thái. Chỉ những chuyển tiếp liệt kê ở đây được phép.
 * `verifying → capa_assigned` là nhánh trả về khi xác minh chưa đạt (return_count++).
 * `assessed → closed` là nhánh đóng luôn khi kết luận không vi phạm.
 */
const FLOW: Record<string, string[]> = {
  new: ['assessed', 'cancelled'],
  assessed: ['suspended', 'capa_assigned', 'closed', 'cancelled'],
  suspended: ['capa_assigned', 'cancelled'],
  capa_assigned: ['capa_done', 'cancelled'],
  capa_done: ['verifying', 'cancelled'],
  verifying: ['verified', 'capa_assigned', 'cancelled'],
  verified: ['resume_approved', 'closed', 'cancelled'],
  resume_approved: ['closed', 'cancelled'],
  closed: [],
  cancelled: [],
}

interface FindingRow {
  id: number
  status: string
  risk_level: string | null
  site_id: number | null
  worker_id: number | null
  contract_id: number | null
  suspension_id: number | null
  responsible_person: number | null
  capa_due_at: string | null
  return_count: number
}

/**
 * Đọc phiếu trong phạm vi site của user, hoặc null.
 * Site suy trực tiếp từ finding.site_id, và từ hợp đồng khi phiếu chỉ gắn hợp đồng.
 */
async function findingInScope(id: number, user: AuthUser): Promise<FindingRow | null> {
  const { all, siteId } = siteScope(user)
  const r = await query<FindingRow>(
    `SELECT f.id, f.status, f.risk_level, f.site_id, f.worker_id, f.contract_id,
            f.suspension_id, f.responsible_person, f.capa_due_at, f.return_count
     FROM atld.hse_findings f
     LEFT JOIN atld.hse_contracts c ON c.id = f.contract_id
     WHERE f.id = $1 AND ($2::boolean OR f.site_id = $3 OR c.site_id = $3)`,
    [id, all, siteId],
  )
  return r.rows[0] ?? null
}

/** Kiểm tra chuyển trạng thái, trả thông báo lỗi nếu không hợp lệ. */
function flowError(from: string, to: string): string | null {
  if (!FLOW[from]) return `Trạng thái hiện tại không hợp lệ: ${from}.`
  if (!FLOW[from].includes(to))
    return `Không thể chuyển phiếu từ "${from}" sang "${to}". Phải đi tuần tự theo quy trình.`
  return null
}

// ═══════════════ B1 — GHI NHẬN ═══════════════
findingsRouter.get('/', requireAuth, async (req, res) => {
  const { all, siteId } = siteScope(req.user!)
  const status = req.query.status ? String(req.query.status) : null
  const contractId = req.query.contractId ? Number(req.query.contractId) : null
  const riskLevel = req.query.riskLevel ? String(req.query.riskLevel) : null
  // overdue=1: phiếu quá hạn khắc phục mà chưa khắc phục xong.
  const overdue = req.query.overdue === '1'
  const r = await query(
    `SELECT f.*,
            ct.name AS contractor_name,
            c.contract_no, c.title AS contract_title,
            wt.name AS work_type_name,
            w.full_name AS worker_name, w.id_number AS worker_id_number,
            b.name AS site_name,
            au.full_name AS assessed_by_name,
            ru.full_name AS responsible_person_name,
            vu.full_name AS verified_by_name,
            cu.full_name AS created_by_name,
            s.status AS suspension_status,
            (SELECT count(*)::int FROM atld.hse_finding_photos p WHERE p.finding_id = f.id) AS photo_count
     FROM atld.hse_findings f
     LEFT JOIN atld.hse_contractors ct ON ct.id = f.contractor_id
     LEFT JOIN atld.hse_contracts c ON c.id = f.contract_id
     LEFT JOIN atld.jsa_work_types wt ON wt.id = f.work_type_id
     LEFT JOIN atld.hse_workers w ON w.id = f.worker_id
     LEFT JOIN atld.branches b ON b.id = f.site_id
     LEFT JOIN atld.users au ON au.id = f.assessed_by
     LEFT JOIN atld.users ru ON ru.id = f.responsible_person
     LEFT JOIN atld.users vu ON vu.id = f.verified_by
     LEFT JOIN atld.users cu ON cu.id = f.created_by
     LEFT JOIN atld.hse_suspensions s ON s.id = f.suspension_id
     WHERE ($1::boolean OR f.site_id = $2 OR c.site_id = $2)
       AND ($3::text IS NULL OR f.status = $3)
       AND ($4::int IS NULL OR f.contract_id = $4)
       AND ($5::text IS NULL OR f.risk_level = $5)
       AND ($6::boolean = false OR (f.capa_due_at < now()
            AND f.status IN ('capa_assigned','suspended','assessed')))
     ORDER BY f.detected_at DESC`,
    [all, siteId, status, contractId, riskLevel, overdue],
  )
  res.json({ findings: r.rows })
})

/**
 * Danh sách người có thể nhận trách nhiệm khắc phục.
 * Không dùng /admin/users vì endpoint đó đòi quyền 'nguoi-dung' — cán bộ chỉ có
 * 'an-toan:inspect' sẽ bị 403 và không giao việc được cho ai.
 * PHẢI khai báo trước '/:id', nếu không '/assignees' sẽ khớp vào '/:id' thành NaN.
 */
findingsRouter.get('/assignees', ...canInspect, async (req, res) => {
  const { all, siteId } = siteScope(req.user!)
  const r = await query(
    `SELECT id, full_name, username FROM atld.users
     WHERE role IN ('officer', 'admin')
       AND ($1::boolean OR site_id = $2 OR site_id IS NULL)
     ORDER BY full_name`,
    [all, siteId],
  )
  res.json({ users: r.rows })
})

findingsRouter.get('/:id', requireAuth, async (req, res) => {
  const f = await findingInScope(Number(req.params.id), req.user!)
  if (!f) return res.status(404).json({ error: 'Không tìm thấy phiếu phát hiện.' })
  const full = await query(
    `SELECT f.*, ct.name AS contractor_name, c.contract_no, wt.name AS work_type_name,
            w.full_name AS worker_name, b.name AS site_name,
            ru.full_name AS responsible_person_name, vu.full_name AS verified_by_name
     FROM atld.hse_findings f
     LEFT JOIN atld.hse_contractors ct ON ct.id = f.contractor_id
     LEFT JOIN atld.hse_contracts c ON c.id = f.contract_id
     LEFT JOIN atld.jsa_work_types wt ON wt.id = f.work_type_id
     LEFT JOIN atld.hse_workers w ON w.id = f.worker_id
     LEFT JOIN atld.branches b ON b.id = f.site_id
     LEFT JOIN atld.users ru ON ru.id = f.responsible_person
     LEFT JOIN atld.users vu ON vu.id = f.verified_by
     WHERE f.id = $1`,
    [f.id],
  )
  const photos = await query(
    `SELECT id, phase, file_name, caption, uploaded_at
     FROM atld.hse_finding_photos WHERE finding_id = $1 ORDER BY uploaded_at`,
    [f.id],
  )
  res.json({ finding: full.rows[0], photos: photos.rows })
})

findingsRouter.post('/', ...canInspect, async (req, res) => {
  const b = req.body ?? {}
  const description = escapeText(String(b.description ?? '').trim())
  if (!description) return res.status(400).json({ error: 'Phải mô tả nội dung phát hiện.' })
  const source = ['periodic', 'adhoc', 'field_report'].includes(String(b.source))
    ? String(b.source) : 'periodic'
  const findingType = ['unsafe_condition', 'unsafe_act', 'near_miss'].includes(String(b.finding_type))
    ? String(b.finding_type) : 'unsafe_condition'
  const checkPeriod = ['week', 'month', 'quarter'].includes(String(b.check_period))
    ? String(b.check_period) : null

  // Officer bị ghim vào site mình phụ trách; admin chọn site trên form.
  const { all, siteId } = siteScope(req.user!)
  const reqSite = b.site_id ? Number(b.site_id) : null
  const site = all ? reqSite : siteId
  if (!site) return res.status(400).json({ error: 'Phải chọn nhà máy / chi nhánh.' })

  const contractId = b.contract_id ? Number(b.contract_id) : null
  if (contractId) {
    const c = await query<{ id: number }>(
      `SELECT id FROM atld.hse_contracts WHERE id = $1 AND ($2::boolean OR site_id = $3)`,
      [contractId, all, siteId])
    if (!c.rows[0]) return res.status(404).json({ error: 'Không tìm thấy hợp đồng.' })
  }
  const workerId = b.worker_id ? Number(b.worker_id) : null
  if (workerId) {
    const w = await query<{ id: number }>(
      `SELECT w.id FROM atld.hse_workers w
       WHERE w.id = $1 AND ($2::boolean OR w.site_id = $3 OR EXISTS (
         SELECT 1 FROM atld.hse_contract_workers cw
         JOIN atld.hse_contracts c ON c.id = cw.contract_id
         WHERE cw.worker_id = w.id AND c.site_id = $3))`,
      [workerId, all, siteId])
    if (!w.rows[0]) return res.status(404).json({ error: 'Không tìm thấy người lao động.' })
  }

  // Số phiếu: PH-yyyy-<seq>. Sequence tránh đua khi hai cán bộ ghi cùng lúc.
  const seq = await query<{ n: string }>(`SELECT nextval('atld.hse_finding_no_seq')::text AS n`)
  const findingNo = `PH-${new Date().getFullYear()}-${String(seq.rows[0]!.n).padStart(5, '0')}`

  const r = await query<{ id: number }>(
    `INSERT INTO atld.hse_findings
       (finding_no, source, finding_type, check_period, site_id, area, contractor_id,
        contract_id, work_type_id, worker_id, inspection_id, description, reporter_name,
        detected_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
             COALESCE($14::timestamptz, now()), $15)
     RETURNING id`,
    [findingNo, source, findingType, checkPeriod, site,
     escapeText(String(b.area ?? '').trim()) || null,
     b.contractor_id ? Number(b.contractor_id) : null,
     contractId, b.work_type_id ? Number(b.work_type_id) : null, workerId,
     b.inspection_id ? Number(b.inspection_id) : null, description,
     escapeText(String(b.reporter_name ?? '').trim()) || null,
     b.detected_at ? String(b.detected_at) : null, req.user!.id],
  )
  await audit(req.user!, 'FINDING_CREATE', 'finding', r.rows[0]!.id, null,
    { findingNo, source, findingType, site }, clientIp(req))
  res.status(201).json({ id: r.rows[0]!.id, finding_no: findingNo })
})

// ═══════════════ B2 — ĐÁNH GIÁ ═══════════════
findingsRouter.patch('/:id/assess', ...canInspect, async (req, res) => {
  const f = await findingInScope(Number(req.params.id), req.user!)
  if (!f) return res.status(404).json({ error: 'Không tìm thấy phiếu phát hiện.' })
  const b = req.body ?? {}
  const riskLevel = String(b.risk_level ?? '')
  if (!['high', 'low'].includes(riskLevel))
    return res.status(400).json({ error: 'Mức rủi ro phải là "high" hoặc "low".' })
  const err = flowError(f.status, 'assessed')
  if (err) return res.status(400).json({ error: err })

  await query(
    `UPDATE atld.hse_findings
     SET risk_level = $1, affects_worker = $2, accident_risk = $3, has_injury = $4,
         assess_basis = $5, assessed_by = $6, assessed_at = now(),
         status = 'assessed', updated_at = now()
     WHERE id = $7`,
    [riskLevel, b.affects_worker === true, b.accident_risk ? String(b.accident_risk) : null,
     b.has_injury === true, escapeText(String(b.assess_basis ?? '').trim()) || null,
     req.user!.id, f.id],
  )
  await audit(req.user!, 'FINDING_ASSESS', 'finding', f.id, { status: f.status },
    { status: 'assessed', riskLevel }, clientIp(req))
  res.json({ ok: true, status: 'assessed', risk_level: riskLevel })
})

// ═══════════════ B3 — ĐÌNH CHỈ (dùng lại Pha B) ═══════════════
findingsRouter.post('/:id/suspend', ...canApprove, async (req, res) => {
  const f = await findingInScope(Number(req.params.id), req.user!)
  if (!f) return res.status(404).json({ error: 'Không tìm thấy phiếu phát hiện.' })
  const b = req.body ?? {}
  const reason = escapeText(String(b.reason ?? '').trim())
  if (!reason) return res.status(400).json({ error: 'Phải nêu lý do đình chỉ.' })
  const err = flowError(f.status, 'suspended')
  if (err) return res.status(400).json({ error: err })
  if (f.suspension_id)
    return res.status(400).json({ error: 'Phiếu này đã có lệnh đình chỉ.' })

  // Phạm vi: cá nhân nếu lỗi do NLĐ cụ thể, ngược lại cả hợp đồng.
  const targetScope = b.target_scope === 'worker' ? 'worker' : 'contract'
  const workerId = targetScope === 'worker' ? (b.worker_id ? Number(b.worker_id) : f.worker_id) : null
  const contractId = f.contract_id
  if (targetScope === 'worker' && !workerId)
    return res.status(400).json({ error: 'Đình chỉ cá nhân cần người lao động; phiếu chưa gắn ai.' })
  if (targetScope === 'contract' && !contractId)
    return res.status(400).json({ error: 'Đình chỉ cả nhà thầu cần hợp đồng; phiếu chưa gắn hợp đồng.' })

  const s = await query<{ id: number }>(
    `INSERT INTO atld.hse_suspensions
       (contract_id, worker_id, target_scope, issued_by, reason, scope)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [contractId, workerId, targetScope, req.user!.id, reason,
     escapeText(String(b.scope ?? '').trim())
       || (targetScope === 'worker' ? 'Cá nhân người lao động' : 'Toàn bộ hợp đồng')],
  )
  // Chặn cổng tức thì. syncWorkerAccess đọc lại lệnh vừa ghi nên tự ra 'suspended'.
  const targets = targetScope === 'worker'
    ? [workerId!]
    : (await query<{ worker_id: number }>(
        `SELECT worker_id FROM atld.hse_contract_workers WHERE contract_id = $1`,
        [contractId])).rows.map((x) => x.worker_id)
  for (const id of targets) await syncWorkerAccess(id)

  await query(
    `UPDATE atld.hse_findings SET suspension_id = $1, status = 'suspended', updated_at = now()
     WHERE id = $2`,
    [s.rows[0]!.id, f.id],
  )
  await audit(req.user!, 'FINDING_SUSPEND', 'finding', f.id, { status: f.status },
    { status: 'suspended', suspensionId: s.rows[0]!.id, targetScope, affected: targets.length },
    clientIp(req))
  res.status(201).json({ suspension_id: s.rows[0]!.id, affected: targets.length, status: 'suspended' })
})

// ═══════════════ B4 — GIAO KHẮC PHỤC ═══════════════
findingsRouter.patch('/:id/assign', ...canInspect, async (req, res) => {
  const f = await findingInScope(Number(req.params.id), req.user!)
  if (!f) return res.status(404).json({ error: 'Không tìm thấy phiếu phát hiện.' })
  const b = req.body ?? {}
  const requirement = escapeText(String(b.capa_requirement ?? '').trim())
  if (!requirement) return res.status(400).json({ error: 'Phải nêu yêu cầu khắc phục.' })
  const err = flowError(f.status, 'capa_assigned')
  if (err) return res.status(400).json({ error: err })
  if (!f.risk_level)
    return res.status(400).json({ error: 'Phải đánh giá mức rủi ro trước khi giao khắc phục.' })

  const responsible = b.responsible_person ? Number(b.responsible_person) : null
  if (responsible) {
    const u = await query<{ id: number }>(`SELECT id FROM atld.users WHERE id = $1`, [responsible])
    if (!u.rows[0]) return res.status(404).json({ error: 'Không tìm thấy người chịu trách nhiệm.' })
  }
  // Hạn mặc định theo mức rủi ro (cao 24h, thấp 72h); cho phép đặt tay nếu cần.
  const hours = CAPA_HOURS[f.risk_level] ?? 72
  const dueAt = b.capa_due_at ? new Date(String(b.capa_due_at)) : new Date(Date.now() + hours * 3600_000)
  if (Number.isNaN(dueAt.getTime()))
    return res.status(400).json({ error: 'Hạn khắc phục không hợp lệ.' })

  // Trả về từ bước xác minh → đếm số lần trả, để báo cáo biết phiếu bị làm lại mấy lượt.
  const isReturn = f.status === 'verifying'
  await query(
    `UPDATE atld.hse_findings
     SET capa_requirement = $1, responsible_org = $2, responsible_person = $3,
         capa_due_at = $4, assigned_by = $5, assigned_at = now(),
         return_count = return_count + $6, status = 'capa_assigned', updated_at = now()
     WHERE id = $7`,
    [requirement, escapeText(String(b.responsible_org ?? '').trim()) || null, responsible,
     dueAt.toISOString(), req.user!.id, isReturn ? 1 : 0, f.id],
  )
  await audit(req.user!, isReturn ? 'FINDING_CAPA_RETURN' : 'FINDING_ASSIGN', 'finding', f.id,
    { status: f.status }, { status: 'capa_assigned', responsible, dueAt: dueAt.toISOString() },
    clientIp(req))
  res.json({ ok: true, status: 'capa_assigned', capa_due_at: dueAt.toISOString() })
})

// ═══════════════ B5 — KHẮC PHỤC ═══════════════
findingsRouter.patch('/:id/capa', ...canInspect, async (req, res) => {
  const f = await findingInScope(Number(req.params.id), req.user!)
  if (!f) return res.status(404).json({ error: 'Không tìm thấy phiếu phát hiện.' })
  const b = req.body ?? {}
  const action = escapeText(String(b.capa_action ?? '').trim())
  if (!action) return res.status(400).json({ error: 'Phải ghi nội dung đã khắc phục.' })
  const err = flowError(f.status, 'capa_done')
  if (err) return res.status(400).json({ error: err })

  await query(
    `UPDATE atld.hse_findings
     SET capa_action = $1, root_cause = $2, preventive_action = $3,
         capa_done_at = now(), capa_done_by = $4, status = 'capa_done', updated_at = now()
     WHERE id = $5`,
    [action, escapeText(String(b.root_cause ?? '').trim()) || null,
     escapeText(String(b.preventive_action ?? '').trim()) || null, req.user!.id, f.id],
  )
  await audit(req.user!, 'FINDING_CAPA_DONE', 'finding', f.id, { status: f.status },
    { status: 'capa_done' }, clientIp(req))
  res.json({ ok: true, status: 'capa_done' })
})

// ═══════════════ B6 — XÁC MINH ═══════════════
findingsRouter.patch('/:id/verify', ...canInspect, async (req, res) => {
  const f = await findingInScope(Number(req.params.id), req.user!)
  if (!f) return res.status(404).json({ error: 'Không tìm thấy phiếu phát hiện.' })
  const b = req.body ?? {}
  const result = String(b.verify_result ?? '')
  if (!['pass', 'fail'].includes(result))
    return res.status(400).json({ error: 'Kết quả xác minh phải là "pass" hoặc "fail".' })
  // 'verifying' là trạng thái trung gian; vào đây từ capa_done rồi đi tiếp ngay.
  const err = flowError(f.status, 'verifying')
  if (err) return res.status(400).json({ error: err })
  // Người khắc phục không tự xác minh mình (bước 6). DB cũng có CHECK chặn.
  if (f.responsible_person && f.responsible_person === req.user!.id)
    return res.status(403).json({
      error: 'Người chịu trách nhiệm khắc phục không được tự xác minh. Cần người khác xác minh.',
    })

  if (result === 'fail') {
    // Chưa đạt → trả về giao lại khắc phục, đếm thêm một lượt.
    await query(
      `UPDATE atld.hse_findings
       SET verify_result = 'fail', verified_by = $1, verified_at = now(), verify_note = $2,
           return_count = return_count + 1, status = 'capa_assigned', updated_at = now()
       WHERE id = $3`,
      [req.user!.id, escapeText(String(b.verify_note ?? '').trim()) || null, f.id],
    )
    await audit(req.user!, 'FINDING_VERIFY_FAIL', 'finding', f.id, { status: f.status },
      { status: 'capa_assigned', verifyResult: 'fail' }, clientIp(req))
    return res.json({ ok: true, status: 'capa_assigned', verify_result: 'fail' })
  }

  await query(
    `UPDATE atld.hse_findings
     SET verify_result = 'pass', verified_by = $1, verified_at = now(), verify_note = $2,
         status = 'verified', updated_at = now()
     WHERE id = $3`,
    [req.user!.id, escapeText(String(b.verify_note ?? '').trim()) || null, f.id],
  )
  await audit(req.user!, 'FINDING_VERIFY_PASS', 'finding', f.id, { status: f.status },
    { status: 'verified', verifyResult: 'pass' }, clientIp(req))
  res.json({ ok: true, status: 'verified', verify_result: 'pass' })
})

// ═══════════════ B7 — DUYỆT LÀM TIẾP ═══════════════
findingsRouter.patch('/:id/resume', ...canApprove, async (req, res) => {
  const f = await findingInScope(Number(req.params.id), req.user!)
  if (!f) return res.status(404).json({ error: 'Không tìm thấy phiếu phát hiện.' })
  const b = req.body ?? {}
  const decision = String(b.resume_decision ?? '')
  if (!['approved', 'rejected'].includes(decision))
    return res.status(400).json({ error: 'Quyết định phải là "approved" hoặc "rejected".' })
  const err = flowError(f.status, 'resume_approved')
  if (err) return res.status(400).json({ error: err })

  if (decision === 'rejected') {
    // Không cho làm tiếp → quay lại giao khắc phục thêm.
    await query(
      `UPDATE atld.hse_findings
       SET resume_decision = 'rejected', resume_by = $1, resume_at = now(),
           status = 'capa_assigned', return_count = return_count + 1, updated_at = now()
       WHERE id = $2`,
      [req.user!.id, f.id],
    )
    await audit(req.user!, 'FINDING_RESUME_REJECT', 'finding', f.id, { status: f.status },
      { status: 'capa_assigned', decision }, clientIp(req))
    return res.json({ ok: true, status: 'capa_assigned', resume_decision: 'rejected' })
  }

  // Duyệt làm tiếp → gỡ lệnh đình chỉ nếu phiếu có.
  let lifted = 0
  if (f.suspension_id) {
    const s = await query<{ contract_id: number | null; worker_id: number | null; target_scope: string; status: string }>(
      `SELECT contract_id, worker_id, target_scope, status
       FROM atld.hse_suspensions WHERE id = $1`, [f.suspension_id])
    if (s.rows[0] && s.rows[0].status === 'issued') {
      await query(
        `UPDATE atld.hse_suspensions
         SET status = 'lifted', lifted_by = $1, lifted_at = now(), lift_note = $2, updated_at = now()
         WHERE id = $3`,
        [req.user!.id, `Duyệt làm tiếp theo phiếu phát hiện #${f.id}`, f.suspension_id],
      )
      // syncWorkerAccess giữ 'suspended' nếu NLĐ còn vướng lệnh đình chỉ khác.
      const workers = s.rows[0].target_scope === 'worker' && s.rows[0].worker_id
        ? [s.rows[0].worker_id]
        : (await query<{ worker_id: number }>(
            `SELECT worker_id FROM atld.hse_contract_workers WHERE contract_id = $1`,
            [s.rows[0].contract_id])).rows.map((x) => x.worker_id)
      for (const wid of workers) await syncWorkerAccess(wid)
      lifted = workers.length
    }
  }
  await query(
    `UPDATE atld.hse_findings
     SET resume_decision = 'approved', resume_by = $1, resume_at = now(),
         status = 'resume_approved', updated_at = now()
     WHERE id = $2`,
    [req.user!.id, f.id],
  )
  await audit(req.user!, 'FINDING_RESUME_APPROVE', 'finding', f.id, { status: f.status },
    { status: 'resume_approved', liftedWorkers: lifted }, clientIp(req))
  res.json({ ok: true, status: 'resume_approved', restored: lifted })
})

// ═══════════════ B8 — ĐÓNG PHIẾU ═══════════════
findingsRouter.patch('/:id/close', ...canApprove, async (req, res) => {
  const f = await findingInScope(Number(req.params.id), req.user!)
  if (!f) return res.status(404).json({ error: 'Không tìm thấy phiếu phát hiện.' })
  const err = flowError(f.status, 'closed')
  if (err) return res.status(400).json({ error: err })
  // Rủi ro cao có đình chỉ thì phải qua bước duyệt làm tiếp trước khi đóng.
  if (f.suspension_id && f.status !== 'resume_approved')
    return res.status(400).json({ error: 'Phiếu có lệnh đình chỉ phải được duyệt làm tiếp trước khi đóng.' })

  // Đúng hạn hay không: so hạn khắc phục với lúc thực sự khắc phục xong.
  const onTime = await query<{ on_time: boolean | null }>(
    `SELECT CASE WHEN capa_due_at IS NULL OR capa_done_at IS NULL THEN NULL
                 ELSE capa_done_at <= capa_due_at END AS on_time
     FROM atld.hse_findings WHERE id = $1`, [f.id])
  await query(
    `UPDATE atld.hse_findings
     SET status = 'closed', closed_at = now(), closed_by = $1, closed_on_time = $2,
         updated_at = now()
     WHERE id = $3`,
    [req.user!.id, onTime.rows[0]?.on_time ?? null, f.id],
  )
  await audit(req.user!, 'FINDING_CLOSE', 'finding', f.id, { status: f.status },
    { status: 'closed', onTime: onTime.rows[0]?.on_time ?? null }, clientIp(req))
  res.json({ ok: true, status: 'closed', closed_on_time: onTime.rows[0]?.on_time ?? null })
})

// Huỷ phiếu (ghi nhận sai, trùng) — không xoá để giữ dấu vết.
findingsRouter.patch('/:id/cancel', ...canApprove, async (req, res) => {
  const f = await findingInScope(Number(req.params.id), req.user!)
  if (!f) return res.status(404).json({ error: 'Không tìm thấy phiếu phát hiện.' })
  const reason = escapeText(String(req.body?.reason ?? '').trim())
  if (!reason) return res.status(400).json({ error: 'Phải nêu lý do huỷ phiếu.' })
  const err = flowError(f.status, 'cancelled')
  if (err) return res.status(400).json({ error: err })
  await query(
    `UPDATE atld.hse_findings
     SET status = 'cancelled', verify_note = $1, updated_at = now() WHERE id = $2`,
    [reason, f.id])
  await audit(req.user!, 'FINDING_CANCEL', 'finding', f.id, { status: f.status },
    { status: 'cancelled', reason }, clientIp(req))
  res.json({ ok: true, status: 'cancelled' })
})

// ═══════════════ Pha D — QUẢN TRỊ LINK CÔNG KHAI ═══════════════
// Đặt ở đây vì findings.ts đã có canInspect/canApprove và cùng vòng nghiệp vụ;
// phần công khai không cần auth nằm riêng ở routes/portal.ts.

/** Hạn mặc định của link: 14 ngày. */
const TOKEN_DAYS_DEFAULT = 14

findingsRouter.get('/portal-tokens/list', ...canInspect, async (req, res) => {
  const { all, siteId } = siteScope(req.user!)
  const r = await query(
    `SELECT t.id, t.purpose, t.label, t.contractor_id, t.contract_id, t.finding_id,
            t.site_id, t.expires_at, t.max_uses, t.used_count, t.revoked_at, t.created_at,
            ct.name AS contractor_name, c.contract_no, f.finding_no,
            cu.full_name AS created_by_name,
            (SELECT count(*)::int FROM atld.hse_worker_submissions s
             WHERE s.token_id = t.id AND s.status = 'pending') AS pending_count
     FROM atld.hse_portal_tokens t
     LEFT JOIN atld.hse_contractors ct ON ct.id = t.contractor_id
     LEFT JOIN atld.hse_contracts c ON c.id = t.contract_id
     LEFT JOIN atld.hse_findings f ON f.id = t.finding_id
     LEFT JOIN atld.users cu ON cu.id = t.created_by
     WHERE ($1::boolean OR t.site_id = $2 OR c.site_id = $2)
     ORDER BY t.created_at DESC`,
    [all, siteId],
  )
  res.json({ tokens: r.rows })
})

findingsRouter.post('/portal-tokens', ...canInspect, async (req, res) => {
  const b = req.body ?? {}
  const purpose = String(b.purpose ?? '')
  if (!['worker_declare', 'field_report', 'capa_response'].includes(purpose))
    return res.status(400).json({ error: 'Mục đích link không hợp lệ.' })

  const { all, siteId } = siteScope(req.user!)
  const contractId = b.contract_id ? Number(b.contract_id) : null
  let site = all ? (b.site_id ? Number(b.site_id) : null) : siteId
  if (contractId) {
    const c = await query<{ id: number; site_id: number | null; contractor_id: number }>(
      `SELECT id, site_id, contractor_id FROM atld.hse_contracts
       WHERE id = $1 AND ($2::boolean OR site_id = $3)`, [contractId, all, siteId])
    if (!c.rows[0]) return res.status(404).json({ error: 'Không tìm thấy hợp đồng.' })
    site = site ?? c.rows[0].site_id
  }
  const findingId = b.finding_id ? Number(b.finding_id) : null
  if (purpose === 'capa_response') {
    if (!findingId)
      return res.status(400).json({ error: 'Link phản hồi khắc phục cần phiếu phát hiện.' })
    if (!(await findingInScope(findingId, req.user!)))
      return res.status(404).json({ error: 'Không tìm thấy phiếu phát hiện.' })
  }
  // Khai báo NLĐ buộc gắn nhà thầu: hse_workers.contractor_id là NOT NULL nên bản
  // khai không gắn nhà thầu sẽ không duyệt được thành hồ sơ NLĐ.
  const contractorId = b.contractor_id ? Number(b.contractor_id) : null
  if (purpose === 'worker_declare' && !contractorId)
    return res.status(400).json({ error: 'Link khai báo NLĐ phải gắn nhà thầu.' })
  if (contractorId) {
    const ct = await query<{ id: number }>(
      `SELECT id FROM atld.hse_contractors WHERE id = $1`, [contractorId])
    if (!ct.rows[0]) return res.status(404).json({ error: 'Không tìm thấy nhà thầu.' })
  }
  if (!site) return res.status(400).json({ error: 'Phải chọn nhà máy / chi nhánh.' })

  const days = Math.min(Math.max(Number(b.days) || TOKEN_DAYS_DEFAULT, 1), 180)
  const maxUses = b.max_uses === null || b.max_uses === undefined || b.max_uses === ''
    ? null : Math.min(Math.max(Number(b.max_uses), 1), 10000)

  // 32 byte ngẫu nhiên, không dùng randomUUID: đây là bí mật truy cập nên cần
  // entropy cao hơn UUID v4. DB chỉ giữ SHA-256, token thô chỉ trả về đúng lần này.
  const raw = crypto.randomBytes(32).toString('base64url')
  const r = await query<{ id: number }>(
    `INSERT INTO atld.hse_portal_tokens
       (token_hash, purpose, label, contractor_id, contract_id, finding_id, site_id,
        expires_at, max_uses, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' days')::interval, $9, $10)
     RETURNING id`,
    [hashToken(raw), purpose, escapeText(String(b.label ?? '').trim()) || null,
     contractorId, contractId, purpose === 'capa_response' ? findingId : null,
     site, String(days), maxUses, req.user!.id],
  )
  await audit(req.user!, 'PORTAL_TOKEN_CREATE', 'portal_token', r.rows[0]!.id, null,
    { purpose, contractorId, contractId, findingId, days, maxUses }, clientIp(req))
  // token thô KHÔNG vào audit log — log là nơi đọc được rộng hơn danh sách link.
  res.status(201).json({ id: r.rows[0]!.id, token: raw, expires_in_days: days })
})

findingsRouter.delete('/portal-tokens/:id', ...canInspect, async (req, res) => {
  const id = Number(req.params.id)
  const { all, siteId } = siteScope(req.user!)
  const r = await query<{ id: number }>(
    `UPDATE atld.hse_portal_tokens t SET revoked_at = now(), revoked_by = $1
     WHERE t.id = $2 AND t.revoked_at IS NULL
       AND ($3::boolean OR t.site_id = $4)
     RETURNING t.id`,
    [req.user!.id, id, all, siteId])
  if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy link còn hiệu lực.' })
  await audit(req.user!, 'PORTAL_TOKEN_REVOKE', 'portal_token', id, null, null, clientIp(req))
  res.json({ ok: true })
})

// ═══════════════ Pha D — DUYỆT HÀNG CHỜ KHAI BÁO ═══════════════
findingsRouter.get('/submissions/list', ...canInspect, async (req, res) => {
  const { all, siteId } = siteScope(req.user!)
  const status = req.query.status ? String(req.query.status) : 'pending'
  const r = await query(
    `SELECT s.id, s.payload, s.status, s.review_note, s.reviewed_at, s.worker_id,
            s.created_at, s.submitted_ip,
            t.purpose, t.label, t.contractor_id, t.contract_id,
            ct.name AS contractor_name, c.contract_no,
            ru.full_name AS reviewed_by_name,
            (SELECT count(*)::int FROM atld.hse_submission_files sf
             WHERE sf.submission_id = s.id) AS file_count,
            -- hse_workers.id_number không UNIQUE (xem POST /hse/workers cũng không
            -- kiểm), nên duyệt hai bản khai cùng CCCD sẽ ra hai hồ sơ cho một người.
            -- Trả hồ sơ trùng ra để cán bộ thấy trước khi bấm duyệt.
            (SELECT w2.full_name FROM atld.hse_workers w2
             WHERE w2.id_number IS NOT NULL
               AND w2.id_number = (s.payload->>'id_number')
             ORDER BY w2.id LIMIT 1) AS dup_worker_name,
            (SELECT w2.id FROM atld.hse_workers w2
             WHERE w2.id_number IS NOT NULL
               AND w2.id_number = (s.payload->>'id_number')
             ORDER BY w2.id LIMIT 1) AS dup_worker_id
     FROM atld.hse_worker_submissions s
     JOIN atld.hse_portal_tokens t ON t.id = s.token_id
     LEFT JOIN atld.hse_contractors ct ON ct.id = t.contractor_id
     LEFT JOIN atld.hse_contracts c ON c.id = t.contract_id
     LEFT JOIN atld.users ru ON ru.id = s.reviewed_by
     WHERE ($1::boolean OR t.site_id = $2)
       AND ($3::text = 'all' OR s.status = $3)
     ORDER BY s.created_at DESC`,
    [all, siteId, status],
  )
  res.json({ submissions: r.rows })
})

interface SubmissionPayload {
  full_name?: string
  id_number?: string
  birth_date?: string | null
  gender?: string | null
  job_title?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  blood_type?: string | null
  emergency_contact?: string | null
  emergency_phone?: string | null
  note?: string | null
}

/**
 * Duyệt bản khai → tạo hồ sơ NLĐ thật.
 * Đây là biên giới tin cậy: dữ liệu nhà thầu nộp chỉ thành hồ sơ NLĐ sau bước này.
 * NLĐ mới vẫn ở access_status mặc định 'blocked' cho tới khi đủ hồ sơ.
 */
findingsRouter.patch('/submissions/:id/review', ...canInspect, async (req, res) => {
  const id = Number(req.params.id)
  const decision = String(req.body?.decision ?? '')
  if (!['approved', 'rejected'].includes(decision))
    return res.status(400).json({ error: 'Quyết định phải là "approved" hoặc "rejected".' })
  const note = escapeText(String(req.body?.review_note ?? '').trim()) || null

  const { all, siteId } = siteScope(req.user!)
  const s = await query<{
    id: number; payload: SubmissionPayload; status: string
    contractor_id: number | null; contract_id: number | null; token_site: number | null
  }>(
    `SELECT s.id, s.payload, s.status, t.contractor_id, t.contract_id, t.site_id AS token_site
     FROM atld.hse_worker_submissions s
     JOIN atld.hse_portal_tokens t ON t.id = s.token_id
     WHERE s.id = $1 AND ($2::boolean OR t.site_id = $3)`,
    [id, all, siteId])
  if (!s.rows[0]) return res.status(404).json({ error: 'Không tìm thấy bản khai.' })
  if (s.rows[0].status !== 'pending')
    return res.status(400).json({ error: 'Bản khai này đã được xử lý.' })

  if (decision === 'rejected') {
    await query(
      `UPDATE atld.hse_worker_submissions
       SET status = 'rejected', review_note = $1, reviewed_by = $2, reviewed_at = now()
       WHERE id = $3`, [note, req.user!.id, id])
    await audit(req.user!, 'SUBMISSION_REJECT', 'worker_submission', id, null,
      { note }, clientIp(req))
    return res.json({ ok: true, status: 'rejected' })
  }

  const p = s.rows[0].payload ?? {}
  if (!s.rows[0].contractor_id)
    return res.status(400).json({ error: 'Bản khai không gắn nhà thầu, không tạo được hồ sơ NLĐ.' })
  if (!p.full_name)
    return res.status(400).json({ error: 'Bản khai thiếu họ tên, không tạo được hồ sơ NLĐ.' })

  // id_number không UNIQUE trong hse_workers, nên trùng CCCD sẽ ra hai hồ sơ cho một
  // người — hai bộ hồ sơ, hai trạng thái ra/vào cổng, không bên nào đúng. Chặn ở đây
  // và buộc cán bộ xác nhận có chủ ý (link_existing) nếu thật sự là người khác.
  if (p.id_number) {
    const dup = await query<{ id: number; full_name: string }>(
      `SELECT id, full_name FROM atld.hse_workers
       WHERE id_number = $1 ORDER BY id LIMIT 1`, [p.id_number])
    if (dup.rows[0] && req.body?.allow_duplicate !== true)
      return res.status(409).json({
        error: `Đã có hồ sơ NLĐ với CCCD này: ${dup.rows[0].full_name} (mã ${dup.rows[0].id}). `
          + 'Kiểm tra lại trước khi tạo hồ sơ thứ hai cho cùng một người.',
        duplicate_worker_id: dup.rows[0].id,
      })
  }

  const w = await query<{ id: number }>(
    `INSERT INTO atld.hse_workers
       (contractor_id, full_name, id_number, birth_date, gender, job_title, phone,
        email, address, blood_type, emergency_contact, emergency_phone, note,
        worker_type, site_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'contractor',$14)
     RETURNING id`,
    [s.rows[0].contractor_id, p.full_name, p.id_number ?? null,
     p.birth_date ?? null, p.gender ?? null, p.job_title ?? null, p.phone ?? null,
     p.email ?? null, p.address ?? null, p.blood_type ?? null,
     p.emergency_contact ?? null, p.emergency_phone ?? null, p.note ?? null,
     s.rows[0].token_site],
  )
  const workerId = w.rows[0]!.id
  // Gán vào hợp đồng nếu token có hợp đồng, để engine xét điều kiện biết mức rủi ro.
  if (s.rows[0].contract_id) {
    await query(
      `INSERT INTO atld.hse_contract_workers (contract_id, worker_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [s.rows[0].contract_id, workerId])
  }
  // Chuyển file nhà thầu đã nộp thành hồ sơ chờ duyệt của NLĐ (status 'pending' —
  // cán bộ vẫn phải duyệt từng hồ sơ, bước này chỉ đính kèm).
  const files = await query<{ doc_type_id: number | null; file_name: string; stored_name: string }>(
    `SELECT doc_type_id, file_name, stored_name FROM atld.hse_submission_files
     WHERE submission_id = $1 AND doc_type_id IS NOT NULL`, [id])
  for (const f of files.rows) {
    await query(
      `INSERT INTO atld.hse_worker_docs
         (worker_id, doc_type_id, file_name, stored_name, status, uploaded_by)
       VALUES ($1,$2,$3,$4,'pending',$5)`,
      [workerId, f.doc_type_id, f.file_name, f.stored_name, req.user!.id])
  }
  await query(
    `UPDATE atld.hse_worker_submissions
     SET status = 'approved', review_note = $1, reviewed_by = $2, reviewed_at = now(),
         worker_id = $3
     WHERE id = $4`, [note, req.user!.id, workerId, id])
  // Tính access_status ngay: NLĐ mới thiếu hồ sơ nên sẽ là 'blocked' kèm lý do.
  const status = await syncWorkerAccess(workerId)
  await audit(req.user!, 'SUBMISSION_APPROVE', 'worker_submission', id, null,
    { workerId, attachedDocs: files.rows.length, accessStatus: status }, clientIp(req))
  res.json({ ok: true, status: 'approved', worker_id: workerId, access_status: status })
})

findingsRouter.get('/submissions/:id/files', ...canInspect, async (req, res) => {
  const { all, siteId } = siteScope(req.user!)
  const r = await query(
    `SELECT sf.id, sf.doc_type_id, sf.file_name, sf.uploaded_at, dt.name AS doc_type_name
     FROM atld.hse_submission_files sf
     JOIN atld.hse_worker_submissions s ON s.id = sf.submission_id
     JOIN atld.hse_portal_tokens t ON t.id = s.token_id
     LEFT JOIN atld.hse_doc_types dt ON dt.id = sf.doc_type_id
     WHERE sf.submission_id = $1 AND ($2::boolean OR t.site_id = $3)
     ORDER BY sf.uploaded_at`,
    [Number(req.params.id), all, siteId])
  res.json({ files: r.rows })
})

findingsRouter.get('/submission-files/:fileId/download', ...canInspect, async (req, res) => {
  const { all, siteId } = siteScope(req.user!)
  const r = await query<{ file_name: string; stored_name: string }>(
    `SELECT sf.file_name, sf.stored_name FROM atld.hse_submission_files sf
     JOIN atld.hse_worker_submissions s ON s.id = sf.submission_id
     JOIN atld.hse_portal_tokens t ON t.id = s.token_id
     WHERE sf.id = $1 AND ($2::boolean OR t.site_id = $3)`,
    [Number(req.params.fileId), all, siteId])
  if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy tệp.' })
  const filePath = path.join(UPLOAD_DIR, r.rows[0].stored_name)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Tệp không còn trên máy chủ.' })
  res.download(filePath, r.rows[0].file_name)
})

// ═══════════════ ẢNH MINH CHỨNG ═══════════════
findingsRouter.post('/:id/photos', ...canInspect, upload.single('file'), async (req, res) => {
  const id = Number(req.params.id)
  if (!req.file) return res.status(400).json({ error: 'Chưa chọn ảnh.' })
  const stored = path.join(UPLOAD_DIR, req.file.filename)
  const drop = () => { fs.existsSync(stored) && fs.unlinkSync(stored) }

  const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '')
  if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    drop()
    return res.status(400).json({ error: 'Chỉ nhận ảnh png/jpg/jpeg/webp.' })
  }
  const phase = ['detect', 'capa', 'verify'].includes(String(req.body?.phase))
    ? String(req.body.phase) : 'detect'
  const f = await findingInScope(id, req.user!)
  if (!f) {
    drop()
    return res.status(404).json({ error: 'Không tìm thấy phiếu phát hiện.' })
  }
  const r = await query<{ id: number }>(
    `INSERT INTO atld.hse_finding_photos (finding_id, phase, file_name, stored_name, caption, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [id, phase, sanitizeFileName(req.file.originalname), req.file.filename,
     escapeText(String(req.body?.caption ?? '')), req.user!.id],
  )
  await audit(req.user!, 'FINDING_PHOTO_UPLOAD', 'finding', id, null,
    { photoId: r.rows[0]!.id, phase, file_name: req.file.originalname }, clientIp(req))
  res.status(201).json({ id: r.rows[0]!.id, phase, file_name: sanitizeFileName(req.file.originalname) })
})

findingsRouter.get('/photos/:photoId/file', requireAuth, async (req, res) => {
  const { all, siteId } = siteScope(req.user!)
  const r = await query<{ stored_name: string }>(
    `SELECT p.stored_name FROM atld.hse_finding_photos p
     JOIN atld.hse_findings f ON f.id = p.finding_id
     LEFT JOIN atld.hse_contracts c ON c.id = f.contract_id
     WHERE p.id = $1 AND ($2::boolean OR f.site_id = $3 OR c.site_id = $3)`,
    [Number(req.params.photoId), all, siteId])
  if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy ảnh.' })
  const filePath = path.join(UPLOAD_DIR, r.rows[0].stored_name)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Tệp không còn trên máy chủ.' })
  res.sendFile(filePath)
})

findingsRouter.delete('/photos/:photoId', ...canInspect, async (req, res) => {
  const { all, siteId } = siteScope(req.user!)
  const r = await query<{ stored_name: string; finding_id: number }>(
    `SELECT p.stored_name, p.finding_id FROM atld.hse_finding_photos p
     JOIN atld.hse_findings f ON f.id = p.finding_id
     LEFT JOIN atld.hse_contracts c ON c.id = f.contract_id
     WHERE p.id = $1 AND ($2::boolean OR f.site_id = $3 OR c.site_id = $3)`,
    [Number(req.params.photoId), all, siteId])
  if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy ảnh.' })
  const filePath = path.join(UPLOAD_DIR, r.rows[0].stored_name)
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  await query(`DELETE FROM atld.hse_finding_photos WHERE id = $1`, [Number(req.params.photoId)])
  await audit(req.user!, 'FINDING_PHOTO_DELETE', 'finding', r.rows[0].finding_id, null,
    { photoId: Number(req.params.photoId) }, clientIp(req))
  res.json({ ok: true })
})
