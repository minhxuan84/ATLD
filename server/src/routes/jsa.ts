// JSA (Job Safety Analysis) — Danh mục công việc & điều kiện ATLĐ (Pha 1)
import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth, requireSection, requireHse, siteScope } from '../auth.js'
import { audit, clientIp } from '../lib/hse-core.js'
import { buildPermitPdf, bufferToStream } from '../lib/pdf.js'
import { escapeText } from '../util.js'

export const jsaRouter = Router()

// Guards: chỉ officer 'an-toan' và admin được ghi; đọc thì requireAuth.
const canWrite = [requireAuth, requireSection('an-toan')]
/**
 * Pha E6: giấy phép làm việc là văn bản cho phép thi công trong nhà máy, không phải
 * dữ liệu ai đăng nhập cũng tạo được. Trước đây các endpoint này chỉ gác requireAuth
 * nên tài khoản 'trainee' (học viên) cũng tạo và sửa được permit.
 *
 * Các bước /workers, /hazards, /submit, /cancel vẫn kiểm thêm requester_id: người tạo
 * hoặc admin. Siết cả nhóm về canInspect cho khớp, vì sau thay đổi này người tạo
 * permit luôn có quyền inspect nên không chặn oan ai.
 */
const canInspect = [requireAuth, requireHse('inspect', 'approve')]

// ═══════════════ LOẠI CÔNG VIỆC ═══════════════
jsaRouter.get('/work-types', requireAuth, async (req, res) => {
  const includeInactive = req.query.all === '1'
  const r = await query(
    `SELECT id, code, name, description, risk_level, requires_permit, is_active, sort_order, created_at, updated_at
     FROM atld.jsa_work_types
     WHERE ($1 = true OR is_active = true)
     ORDER BY sort_order, name`,
    [includeInactive],
  )
  res.json({ workTypes: r.rows })
})

jsaRouter.get('/work-types/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const wt = await query(
    `SELECT id, code, name, description, risk_level, requires_permit, is_active, sort_order, created_at, updated_at
     FROM atld.jsa_work_types WHERE id = $1`,
    [id],
  )
  if (!wt.rows[0]) return res.status(404).json({ error: 'Không tìm thấy loại công việc.' })
  res.json({ workType: wt.rows[0] })
})

// GET /jsa/checklist?code=DEFAULT_DAILY — nạp checklist theo work type code
jsaRouter.get('/checklist', requireAuth, async (req, res) => {
  const code = String(req.query.code ?? '')
  if (!code) return res.status(400).json({ error: 'Thiếu mã loại công việc (code).' })

  const wt = await query<{ id: number }>(`SELECT id FROM atld.jsa_work_types WHERE code = $1`, [code])
  if (!wt.rows[0]) return res.status(404).json({ error: 'Không tìm thấy loại công việc.' })

  const items = await query(
    `SELECT item_code, category, item_name, requires_photo, sort_order
     FROM atld.jsa_checklist_items
     WHERE work_type_id = $1
     ORDER BY sort_order, item_code`,
    [wt.rows[0].id],
  )
  res.json({ items: items.rows })
})

jsaRouter.post('/work-types', ...canWrite, async (req, res) => {
  const b = req.body ?? {}
  const code = escapeText(String(b.code ?? '').trim().toUpperCase())
  const name = escapeText(String(b.name ?? '').trim())
  const riskLevel = ['low', 'medium', 'high'].includes(String(b.risk_level)) ? String(b.risk_level) : 'medium'
  if (!code || !name) return res.status(400).json({ error: 'Thiếu mã hoặc tên loại công việc.' })

  try {
    const r = await query<{ id: number }>(
      `INSERT INTO atld.jsa_work_types (code, name, description, risk_level, requires_permit, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        code,
        name,
        escapeText(String(b.description ?? '')),
        riskLevel,
        b.requires_permit !== false,
        b.is_active !== false,
        Number(b.sort_order ?? 0),
      ],
    )
    await audit(req.user!, 'JSA_WORK_TYPE_CREATE', 'jsa_work_type', r.rows[0]!.id, null, { code, name }, clientIp(req))
    res.status(201).json({ id: r.rows[0]!.id })
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      return res.status(409).json({ error: 'Mã loại công việc đã tồn tại.' })
    throw e
  }
})

jsaRouter.patch('/work-types/:id', ...canWrite, async (req, res) => {
  const id = Number(req.params.id)
  const b = req.body ?? {}
  const fields = ['name', 'description', 'risk_level', 'requires_permit', 'is_active', 'sort_order']
  const sets: string[] = []
  const vals: unknown[] = []
  for (const f of fields) {
    if (b[f] === undefined) continue
    const v =
      f === 'name' || f === 'description'
        ? escapeText(String(b[f]))
        : f === 'risk_level'
          ? ['low', 'medium', 'high'].includes(String(b[f]))
            ? String(b[f])
            : 'medium'
          : f === 'requires_permit' || f === 'is_active'
            ? Boolean(b[f])
            : Number(b[f])
    sets.push(`${f} = $${sets.length + 1}`)
    vals.push(v)
  }
  if (!sets.length) return res.status(400).json({ error: 'Không có trường nào để cập nhật.' })
  vals.push(id)
  await query(
    `UPDATE atld.jsa_work_types SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}`,
    vals,
  )
  await audit(req.user!, 'JSA_WORK_TYPE_UPDATE', 'jsa_work_type', id, null, b, clientIp(req))
  res.json({ ok: true })
})

jsaRouter.delete('/work-types/:id', ...canWrite, async (req, res) => {
  const id = Number(req.params.id)
  await query(`DELETE FROM atld.jsa_work_types WHERE id = $1`, [id])
  await audit(req.user!, 'JSA_WORK_TYPE_DELETE', 'jsa_work_type', id, null, null, clientIp(req))
  res.json({ ok: true })
})

// ═══════════════ PPE (Thiết bị bảo hộ) ═══════════════
jsaRouter.get('/ppe-items', requireAuth, async (req, res) => {
  const includeInactive = req.query.all === '1'
  const r = await query(
    `SELECT id, code, name, is_active, sort_order, created_at
     FROM atld.jsa_ppe_items
     WHERE ($1 = true OR is_active = true)
     ORDER BY sort_order, name`,
    [includeInactive],
  )
  res.json({ ppeItems: r.rows })
})

jsaRouter.post('/ppe-items', ...canWrite, async (req, res) => {
  const b = req.body ?? {}
  const code = escapeText(String(b.code ?? '').trim().toUpperCase())
  const name = escapeText(String(b.name ?? '').trim())
  if (!code || !name) return res.status(400).json({ error: 'Thiếu mã hoặc tên thiết bị bảo hộ.' })

  try {
    const r = await query<{ id: number }>(
      `INSERT INTO atld.jsa_ppe_items (code, name, is_active, sort_order)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [code, name, b.is_active !== false, Number(b.sort_order ?? 0)],
    )
    await audit(req.user!, 'JSA_PPE_CREATE', 'jsa_ppe', r.rows[0]!.id, null, { code, name }, clientIp(req))
    res.status(201).json({ id: r.rows[0]!.id })
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      return res.status(409).json({ error: 'Mã thiết bị bảo hộ đã tồn tại.' })
    throw e
  }
})

jsaRouter.patch('/ppe-items/:id', ...canWrite, async (req, res) => {
  const id = Number(req.params.id)
  const b = req.body ?? {}
  const fields = ['name', 'is_active', 'sort_order']
  const sets: string[] = []
  const vals: unknown[] = []
  for (const f of fields) {
    if (b[f] === undefined) continue
    const v = f === 'name' ? escapeText(String(b[f])) : f === 'is_active' ? Boolean(b[f]) : Number(b[f])
    sets.push(`${f} = $${sets.length + 1}`)
    vals.push(v)
  }
  if (!sets.length) return res.status(400).json({ error: 'Không có trường nào để cập nhật.' })
  vals.push(id)
  await query(`UPDATE atld.jsa_ppe_items SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals)
  await audit(req.user!, 'JSA_PPE_UPDATE', 'jsa_ppe', id, null, b, clientIp(req))
  res.json({ ok: true })
})

jsaRouter.delete('/ppe-items/:id', ...canWrite, async (req, res) => {
  const id = Number(req.params.id)
  await query(`DELETE FROM atld.jsa_ppe_items WHERE id = $1`, [id])
  await audit(req.user!, 'JSA_PPE_DELETE', 'jsa_ppe', id, null, null, clientIp(req))
  res.json({ ok: true })
})

// ═══════════════ YÊU CẦU THEO LOẠI CÔNG VIỆC ═══════════════
// GET /jsa/work-types/:id/requirements — trả PPE, doc types, courses, checklist cho 1 loại công việc
jsaRouter.get('/work-types/:id/requirements', requireAuth, async (req, res) => {
  const id = Number(req.params.id)

  // PPE
  const ppe = await query(
    `SELECT p.id, p.code, p.name FROM atld.jsa_ppe_items p
     JOIN atld.jsa_work_type_ppe wp ON wp.ppe_item_id = p.id
     WHERE wp.work_type_id = $1 AND p.is_active = true
     ORDER BY p.sort_order, p.name`,
    [id],
  )

  // Doc types
  const docs = await query(
    `SELECT dt.id, dt.code, dt.name, dt.scope, dt.is_mandatory FROM atld.hse_doc_types dt
     JOIN atld.jsa_work_type_docs wd ON wd.doc_type_id = dt.id
     WHERE wd.work_type_id = $1 AND dt.is_active = true
     ORDER BY dt.scope, dt.sort_order, dt.name`,
    [id],
  )

  // Courses
  const courses = await query(
    `SELECT c.id, c.title, c.pass_score FROM atld.courses c
     JOIN atld.jsa_work_type_courses wc ON wc.course_id = c.id
     WHERE wc.work_type_id = $1
     ORDER BY c.title`,
    [id],
  )

  // Checklist
  const checklist = await query(
    `SELECT id, item_code, category, item_name, requires_photo, sort_order
     FROM atld.jsa_checklist_items
     WHERE work_type_id = $1
     ORDER BY sort_order, id`,
    [id],
  )

  res.json({
    ppe: ppe.rows,
    docTypes: docs.rows,
    courses: courses.rows,
    checklist: checklist.rows,
  })
})

// POST /jsa/work-types/:id/ppe — gán PPE cho loại công việc
jsaRouter.post('/work-types/:id/ppe', ...canWrite, async (req, res) => {
  const workTypeId = Number(req.params.id)
  const ppeIds = (req.body.ppe_ids ?? []) as number[]
  if (!Array.isArray(ppeIds)) return res.status(400).json({ error: 'ppe_ids phải là mảng.' })

  // Xóa hết, insert lại
  await query(`DELETE FROM atld.jsa_work_type_ppe WHERE work_type_id = $1`, [workTypeId])
  for (const ppeId of ppeIds) {
    await query(
      `INSERT INTO atld.jsa_work_type_ppe (work_type_id, ppe_item_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [workTypeId, ppeId],
    )
  }
  await audit(req.user!, 'JSA_WORK_TYPE_PPE_UPDATE', 'jsa_work_type', workTypeId, null, { ppeIds }, clientIp(req))
  res.json({ ok: true })
})

// POST /jsa/work-types/:id/docs — gán doc types
jsaRouter.post('/work-types/:id/docs', ...canWrite, async (req, res) => {
  const workTypeId = Number(req.params.id)
  const docTypeIds = (req.body.doc_type_ids ?? []) as number[]
  if (!Array.isArray(docTypeIds)) return res.status(400).json({ error: 'doc_type_ids phải là mảng.' })

  await query(`DELETE FROM atld.jsa_work_type_docs WHERE work_type_id = $1`, [workTypeId])
  for (const docTypeId of docTypeIds) {
    await query(
      `INSERT INTO atld.jsa_work_type_docs (work_type_id, doc_type_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [workTypeId, docTypeId],
    )
  }
  await audit(req.user!, 'JSA_WORK_TYPE_DOCS_UPDATE', 'jsa_work_type', workTypeId, null, { docTypeIds }, clientIp(req))
  res.json({ ok: true })
})

// POST /jsa/work-types/:id/courses — gán courses
jsaRouter.post('/work-types/:id/courses', ...canWrite, async (req, res) => {
  const workTypeId = Number(req.params.id)
  const courseIds = (req.body.course_ids ?? []) as string[]
  if (!Array.isArray(courseIds)) return res.status(400).json({ error: 'course_ids phải là mảng.' })

  await query(`DELETE FROM atld.jsa_work_type_courses WHERE work_type_id = $1`, [workTypeId])
  for (const courseId of courseIds) {
    await query(
      `INSERT INTO atld.jsa_work_type_courses (work_type_id, course_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [workTypeId, courseId],
    )
  }
  await audit(req.user!, 'JSA_WORK_TYPE_COURSES_UPDATE', 'jsa_work_type', workTypeId, null, { courseIds }, clientIp(req))
  res.json({ ok: true })
})

// POST /jsa/work-types/:id/checklist — thay toàn bộ checklist
jsaRouter.post('/work-types/:id/checklist', ...canWrite, async (req, res) => {
  const workTypeId = Number(req.params.id)
  const items = (req.body.items ?? []) as Array<{
    item_code?: string
    category?: string
    item_name: string
    requires_photo?: boolean
    sort_order?: number
  }>
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items phải là mảng.' })

  // Xóa hết, insert lại
  await query(`DELETE FROM atld.jsa_checklist_items WHERE work_type_id = $1`, [workTypeId])
  for (const it of items) {
    await query(
      `INSERT INTO atld.jsa_checklist_items (work_type_id, item_code, category, item_name, requires_photo, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        workTypeId,
        escapeText(String(it.item_code ?? '')),
        escapeText(String(it.category ?? '')),
        escapeText(String(it.item_name ?? '')),
        Boolean(it.requires_photo),
        Number(it.sort_order ?? 0),
      ],
    )
  }
  await audit(req.user!, 'JSA_CHECKLIST_UPDATE', 'jsa_work_type', workTypeId, null, { count: items.length }, clientIp(req))
  res.json({ ok: true })
})

// ═══════════════ GIẤY PHÉP LÀM VIỆC (PERMITS) - Pha 3 ═══════════════

// Helper: tạo số permit tự động — GP-{siteId}-{YYYYMMDD}-{seq}.
// branches không có cột code nên dùng site_id cho ổn định.
async function generatePermitNumber(siteId: number): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const count = await query<{ cnt: string }>(
    `SELECT COUNT(*)::text as cnt FROM atld.jsa_permits WHERE site_id = $1 AND created_at >= CURRENT_DATE`,
    [siteId],
  )
  const seq = String(Number(count.rows[0]?.cnt ?? '0') + 1).padStart(3, '0')
  return `GP-${siteId}-${today}-${seq}`
}

// GET /jsa/permits — danh sách permits (site-scoped)
jsaRouter.get('/permits', requireAuth, async (req, res) => {
  const { all, siteId } = siteScope(req.user!)
  const status = req.query.status ? String(req.query.status) : null

  const r = await query(
    `SELECT p.id, p.permit_number, p.site_id, s.name as site_name, p.work_type_id, wt.name as work_type_name,
            p.location, p.work_description, p.start_time, p.end_time, p.status, p.requester_id, u.full_name as requester_name,
            p.submitted_at, p.approved_by, p.approved_at, p.activated_at, p.closed_at, p.created_at, p.updated_at
     FROM atld.jsa_permits p
     LEFT JOIN atld.branches s ON s.id = p.site_id
     LEFT JOIN atld.jsa_work_types wt ON wt.id = p.work_type_id
     LEFT JOIN atld.users u ON u.id = p.requester_id
     WHERE ($1::boolean OR p.site_id = $2)
       AND ($3::text IS NULL OR p.status = $3)
     ORDER BY p.created_at DESC LIMIT 200`,
    [all, siteId, status],
  )
  res.json({ permits: r.rows })
})

// GET /jsa/permits/:id — chi tiết permit
jsaRouter.get('/permits/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const scope = siteScope(req.user!)

  const p = await query(
    `SELECT p.*, s.name as site_name, wt.name as work_type_name, u.full_name as requester_name,
            approver.full_name as approver_name
     FROM atld.jsa_permits p
     LEFT JOIN atld.branches s ON s.id = p.site_id
     LEFT JOIN atld.jsa_work_types wt ON wt.id = p.work_type_id
     LEFT JOIN atld.users u ON u.id = p.requester_id
     LEFT JOIN atld.users approver ON approver.id = p.approved_by
     WHERE p.id = $1 AND ($2::boolean OR p.site_id = $3)`,
    [id, scope.all, scope.siteId],
  )
  if (!p.rows[0]) return res.status(404).json({ error: 'Không tìm thấy giấy phép.' })

  const workers = await query(
    `SELECT pw.id, pw.worker_id, pw.role, w.full_name, w.id_number
     FROM atld.jsa_permit_workers pw
     JOIN atld.hse_workers w ON w.id = pw.worker_id
     WHERE pw.permit_id = $1
     ORDER BY pw.id`,
    [id],
  )

  const hazards = await query(
    `SELECT h.id, h.hazard_description, h.risk_level, h.sequence
     FROM atld.jsa_permit_hazards h
     WHERE h.permit_id = $1
     ORDER BY h.sequence`,
    [id],
  )

  const controls = await query(
    `SELECT c.id, c.hazard_id, c.control_measure, c.sequence
     FROM atld.jsa_permit_controls c
     JOIN atld.jsa_permit_hazards h ON h.id = c.hazard_id
     WHERE h.permit_id = $1
     ORDER BY h.sequence, c.sequence`,
    [id],
  )

  const approvals = await query(
    `SELECT a.id, a.approver_id, u.full_name as approver_name, a.role, a.decision, a.comments, a.created_at
     FROM atld.jsa_permit_approvals a
     JOIN atld.users u ON u.id = a.approver_id
     WHERE a.permit_id = $1
     ORDER BY a.created_at DESC`,
    [id],
  )

  res.json({
    permit: p.rows[0],
    workers: workers.rows,
    hazards: hazards.rows,
    controls: controls.rows,
    approvals: approvals.rows,
  })
})

// POST /jsa/permits — tạo draft permit
jsaRouter.post('/permits', ...canInspect, async (req, res) => {
  const b = req.body ?? {}
  const siteId = Number(b.site_id)
  const workTypeId = b.work_type_id ? Number(b.work_type_id) : null
  const location = escapeText(String(b.location ?? '').trim())
  const workDescription = escapeText(String(b.work_description ?? '').trim())
  const startTime = b.start_time ? new Date(b.start_time).toISOString() : null
  const endTime = b.end_time ? new Date(b.end_time).toISOString() : null

  if (!siteId || !location || !workDescription || !startTime || !endTime) {
    return res.status(400).json({ error: 'Thiếu thông tin bắt buộc (site_id, location, work_description, start_time, end_time).' })
  }

  const scope = siteScope(req.user!)
  if (!scope.all && scope.siteId !== siteId) {
    return res.status(403).json({ error: 'Bạn không có quyền tạo permit cho site này.' })
  }

  const permitNumber = await generatePermitNumber(siteId)

  const r = await query<{ id: number }>(
    `INSERT INTO atld.jsa_permits (permit_number, site_id, work_type_id, location, work_description, start_time, end_time, requester_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft') RETURNING id`,
    [permitNumber, siteId, workTypeId, location, workDescription, startTime, endTime, req.user!.id],
  )

  await audit(req.user!, 'PERMIT_CREATE', 'jsa_permit', r.rows[0].id, null, { permitNumber }, clientIp(req))
  res.json({ id: r.rows[0].id, permitNumber })
})

// PATCH /jsa/permits/:id — cập nhật draft
jsaRouter.patch('/permits/:id', ...canInspect, async (req, res) => {
  const id = Number(req.params.id)
  const scope = siteScope(req.user!)

  const permit = await query<{ status: string; site_id: number; requester_id: number }>(
    `SELECT status, site_id, requester_id FROM atld.jsa_permits WHERE id = $1 AND ($2::boolean OR site_id = $3)`,
    [id, scope.all, scope.siteId],
  )
  if (!permit.rows[0]) return res.status(404).json({ error: 'Không tìm thấy giấy phép.' })
  if (permit.rows[0].status !== 'draft') {
    return res.status(400).json({ error: 'Chỉ được cập nhật permit ở trạng thái draft.' })
  }
  if (permit.rows[0].requester_id !== req.user!.id && req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ người tạo hoặc admin mới được cập nhật.' })
  }

  const b = req.body ?? {}
  const updates: string[] = []
  const params: any[] = []
  let idx = 1

  if (b.work_type_id !== undefined) {
    updates.push(`work_type_id = $${idx++}`)
    params.push(b.work_type_id ? Number(b.work_type_id) : null)
  }
  if (b.location) {
    updates.push(`location = $${idx++}`)
    params.push(escapeText(String(b.location).trim()))
  }
  if (b.work_description) {
    updates.push(`work_description = $${idx++}`)
    params.push(escapeText(String(b.work_description).trim()))
  }
  if (b.start_time) {
    updates.push(`start_time = $${idx++}`)
    params.push(new Date(b.start_time).toISOString())
  }
  if (b.end_time) {
    updates.push(`end_time = $${idx++}`)
    params.push(new Date(b.end_time).toISOString())
  }

  if (updates.length > 0) {
    updates.push(`updated_at = now()`)
    params.push(id)
    await query(`UPDATE atld.jsa_permits SET ${updates.join(', ')} WHERE id = $${idx}`, params)
  }

  await audit(req.user!, 'PERMIT_UPDATE', 'jsa_permit', id, null, { fields: Object.keys(b) }, clientIp(req))
  res.json({ ok: true })
})

// POST /jsa/permits/:id/workers — gán workers cho permit
jsaRouter.post('/permits/:id/workers', ...canInspect, async (req, res) => {
  const id = Number(req.params.id)
  const scope = siteScope(req.user!)

  const permit = await query<{ status: string; requester_id: number }>(
    `SELECT status, requester_id FROM atld.jsa_permits WHERE id = $1 AND ($2::boolean OR site_id = $3)`,
    [id, scope.all, scope.siteId],
  )
  if (!permit.rows[0]) return res.status(404).json({ error: 'Không tìm thấy giấy phép.' })
  if (permit.rows[0].status !== 'draft') {
    return res.status(400).json({ error: 'Chỉ được cập nhật workers cho permit draft.' })
  }
  if (permit.rows[0].requester_id !== req.user!.id && req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ người tạo hoặc admin mới được cập nhật.' })
  }

  const workers = (req.body.workers ?? []) as Array<{ worker_id: number; role?: string }>
  if (!Array.isArray(workers)) return res.status(400).json({ error: 'workers phải là mảng.' })

  await query(`DELETE FROM atld.jsa_permit_workers WHERE permit_id = $1`, [id])
  for (const w of workers) {
    await query(
      `INSERT INTO atld.jsa_permit_workers (permit_id, worker_id, role) VALUES ($1,$2,$3)`,
      [id, Number(w.worker_id), escapeText(String(w.role ?? '').trim())],
    )
  }

  await audit(req.user!, 'PERMIT_WORKERS_UPDATE', 'jsa_permit', id, null, { count: workers.length }, clientIp(req))
  res.json({ ok: true })
})

// POST /jsa/permits/:id/hazards — cập nhật hazards & controls
jsaRouter.post('/permits/:id/hazards', ...canInspect, async (req, res) => {
  const id = Number(req.params.id)
  const scope = siteScope(req.user!)

  const permit = await query<{ status: string; requester_id: number }>(
    `SELECT status, requester_id FROM atld.jsa_permits WHERE id = $1 AND ($2::boolean OR site_id = $3)`,
    [id, scope.all, scope.siteId],
  )
  if (!permit.rows[0]) return res.status(404).json({ error: 'Không tìm thấy giấy phép.' })
  if (permit.rows[0].status !== 'draft') {
    return res.status(400).json({ error: 'Chỉ được cập nhật hazards cho permit draft.' })
  }
  if (permit.rows[0].requester_id !== req.user!.id && req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ người tạo hoặc admin mới được cập nhật.' })
  }

  const hazards = (req.body.hazards ?? []) as Array<{
    hazard_description: string
    risk_level?: string
    controls: Array<{ control_measure: string }>
  }>
  if (!Array.isArray(hazards)) return res.status(400).json({ error: 'hazards phải là mảng.' })

  // Xóa hazards cũ (cascade xóa controls)
  await query(`DELETE FROM atld.jsa_permit_hazards WHERE permit_id = $1`, [id])

  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i]
    const riskLevel = ['low', 'medium', 'high'].includes(String(h.risk_level)) ? String(h.risk_level) : null
    const hr = await query<{ id: number }>(
      `INSERT INTO atld.jsa_permit_hazards (permit_id, hazard_description, risk_level, sequence)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [id, escapeText(String(h.hazard_description).trim()), riskLevel, i],
    )
    const hazardId = hr.rows[0].id

    const controls = h.controls ?? []
    for (let j = 0; j < controls.length; j++) {
      await query(
        `INSERT INTO atld.jsa_permit_controls (hazard_id, control_measure, sequence) VALUES ($1,$2,$3)`,
        [hazardId, escapeText(String(controls[j].control_measure).trim()), j],
      )
    }
  }

  await audit(req.user!, 'PERMIT_HAZARDS_UPDATE', 'jsa_permit', id, null, { count: hazards.length }, clientIp(req))
  res.json({ ok: true })
})

// POST /jsa/permits/:id/submit — submit permit cho approval
jsaRouter.post('/permits/:id/submit', ...canInspect, async (req, res) => {
  const id = Number(req.params.id)
  const scope = siteScope(req.user!)

  const permit = await query<{ status: string; requester_id: number }>(
    `SELECT status, requester_id FROM atld.jsa_permits WHERE id = $1 AND ($2::boolean OR site_id = $3)`,
    [id, scope.all, scope.siteId],
  )
  if (!permit.rows[0]) return res.status(404).json({ error: 'Không tìm thấy giấy phép.' })
  if (permit.rows[0].status !== 'draft') {
    return res.status(400).json({ error: 'Chỉ được submit permit ở trạng thái draft.' })
  }
  if (permit.rows[0].requester_id !== req.user!.id && req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ người tạo hoặc admin mới được submit.' })
  }

  await query(`UPDATE atld.jsa_permits SET status = 'submitted', submitted_at = now(), updated_at = now() WHERE id = $1`, [id])
  await audit(req.user!, 'PERMIT_SUBMIT', 'jsa_permit', id, null, null, clientIp(req))
  res.json({ ok: true })
})

// POST /jsa/permits/:id/approve — phê duyệt permit (requireHse('approve'))
jsaRouter.post('/permits/:id/approve', requireAuth, requireHse('approve'), async (req, res) => {
  const id = Number(req.params.id)
  const scope = siteScope(req.user!)
  const b = req.body ?? {}
  const decision = String(b.decision ?? 'approved')
  const comments = escapeText(String(b.comments ?? '').trim())

  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision phải là approved hoặc rejected.' })
  }

  const permit = await query<{ status: string }>(
    `SELECT status FROM atld.jsa_permits WHERE id = $1 AND ($2::boolean OR site_id = $3)`,
    [id, scope.all, scope.siteId],
  )
  if (!permit.rows[0]) return res.status(404).json({ error: 'Không tìm thấy giấy phép.' })
  if (permit.rows[0].status !== 'submitted') {
    return res.status(400).json({ error: 'Chỉ được approve permit ở trạng thái submitted.' })
  }

  const newStatus = decision === 'approved' ? 'approved' : 'draft'
  await query(
    `UPDATE atld.jsa_permits SET status = $1, approved_by = $2, approved_at = now(), updated_at = now() WHERE id = $3`,
    [newStatus, req.user!.id, id],
  )

  await query(
    `INSERT INTO atld.jsa_permit_approvals (permit_id, approver_id, role, decision, comments)
     VALUES ($1,$2,$3,$4,$5)`,
    [id, req.user!.id, 'approver', decision, comments],
  )

  await audit(req.user!, 'PERMIT_APPROVE', 'jsa_permit', id, null, { decision, comments }, clientIp(req))
  res.json({ ok: true })
})

// POST /jsa/permits/:id/activate — kích hoạt permit (requireHse('approve'))
jsaRouter.post('/permits/:id/activate', requireAuth, requireHse('approve'), async (req, res) => {
  const id = Number(req.params.id)
  const scope = siteScope(req.user!)

  const permit = await query<{ status: string }>(
    `SELECT status FROM atld.jsa_permits WHERE id = $1 AND ($2::boolean OR site_id = $3)`,
    [id, scope.all, scope.siteId],
  )
  if (!permit.rows[0]) return res.status(404).json({ error: 'Không tìm thấy giấy phép.' })
  if (permit.rows[0].status !== 'approved') {
    return res.status(400).json({ error: 'Chỉ được activate permit đã approved.' })
  }

  await query(`UPDATE atld.jsa_permits SET status = 'active', activated_at = now(), updated_at = now() WHERE id = $1`, [id])
  await audit(req.user!, 'PERMIT_ACTIVATE', 'jsa_permit', id, null, null, clientIp(req))
  res.json({ ok: true })
})

// POST /jsa/permits/:id/close — đóng permit
jsaRouter.post('/permits/:id/close', requireAuth, requireHse('inspect', 'approve'), async (req, res) => {
  const id = Number(req.params.id)
  const scope = siteScope(req.user!)
  const closureNotes = escapeText(String(req.body.closure_notes ?? '').trim())

  const permit = await query<{ status: string }>(
    `SELECT status FROM atld.jsa_permits WHERE id = $1 AND ($2::boolean OR site_id = $3)`,
    [id, scope.all, scope.siteId],
  )
  if (!permit.rows[0]) return res.status(404).json({ error: 'Không tìm thấy giấy phép.' })
  if (permit.rows[0].status !== 'active') {
    return res.status(400).json({ error: 'Chỉ được close permit đang active.' })
  }

  await query(
    `UPDATE atld.jsa_permits SET status = 'closed', closed_at = now(), closed_by = $1,
            closure_notes = $2, updated_at = now() WHERE id = $3`,
    [req.user!.id, closureNotes, id],
  )
  await audit(req.user!, 'PERMIT_CLOSE', 'jsa_permit', id,
    { status: permit.rows[0].status }, { status: 'closed', closureNotes }, clientIp(req))
  res.json({ ok: true })
})

// GET /jsa/permits/:id/pdf — biên bản nghiệm thu (Pha 5)
jsaRouter.get('/permits/:id/pdf', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const scope = siteScope(req.user!)

  const p = await query<{
    permit_number: string; site_name: string | null; work_type_name: string | null
    location: string; work_description: string; start_time: string; end_time: string
    requester_name: string | null; approver_name: string | null
    closed_by_name: string | null; closed_at: string | null; closure_notes: string | null
  }>(
    `SELECT p.permit_number, s.name AS site_name, wt.name AS work_type_name,
            p.location, p.work_description, p.start_time, p.end_time,
            u.full_name AS requester_name, approver.full_name AS approver_name,
            closer.full_name AS closed_by_name, p.closed_at, p.closure_notes
     FROM atld.jsa_permits p
     LEFT JOIN atld.branches s ON s.id = p.site_id
     LEFT JOIN atld.jsa_work_types wt ON wt.id = p.work_type_id
     LEFT JOIN atld.users u ON u.id = p.requester_id
     LEFT JOIN atld.users approver ON approver.id = p.approved_by
     LEFT JOIN atld.users closer ON closer.id = p.closed_by
     WHERE p.id = $1 AND ($2::boolean OR p.site_id = $3)`,
    [id, scope.all, scope.siteId],
  )
  if (!p.rows[0]) return res.status(404).json({ error: 'Không tìm thấy giấy phép.' })
  const row = p.rows[0]

  const workers = await query<{ full_name: string; id_number: string | null; role: string | null }>(
    `SELECT w.full_name, w.id_number, pw.role
     FROM atld.jsa_permit_workers pw JOIN atld.hse_workers w ON w.id = pw.worker_id
     WHERE pw.permit_id = $1 ORDER BY pw.id`,
    [id],
  )
  // Mỗi mối nguy kèm các biện pháp kiểm soát của nó (gộp ở tầng app cho dễ đọc).
  const hazards = await query<{ id: number; hazard_description: string; risk_level: string | null }>(
    `SELECT id, hazard_description, risk_level FROM atld.jsa_permit_hazards
     WHERE permit_id = $1 ORDER BY sequence`,
    [id],
  )
  const controls = await query<{ hazard_id: number; control_measure: string }>(
    `SELECT c.hazard_id, c.control_measure
     FROM atld.jsa_permit_controls c JOIN atld.jsa_permit_hazards h ON h.id = c.hazard_id
     WHERE h.permit_id = $1 ORDER BY h.sequence, c.sequence`,
    [id],
  )
  const approvals = await query<{
    approver_name: string; role: string | null; decision: string | null
    comments: string | null; created_at: string
  }>(
    `SELECT u.full_name AS approver_name, a.role, a.decision, a.comments, a.created_at
     FROM atld.jsa_permit_approvals a JOIN atld.users u ON u.id = a.approver_id
     WHERE a.permit_id = $1 ORDER BY a.created_at`,
    [id],
  )

  const pdf = await buildPermitPdf({
    permitNumber: row.permit_number,
    siteName: row.site_name ?? '',
    workTypeName: row.work_type_name ?? '',
    location: row.location,
    workDescription: row.work_description,
    startTime: row.start_time,
    endTime: row.end_time,
    requesterName: row.requester_name ?? '',
    approverName: row.approver_name ?? '',
    closedByName: row.closed_by_name ?? '',
    closedAt: row.closed_at ?? '',
    closureNotes: row.closure_notes ?? '',
    workers: workers.rows.map((w) => ({
      fullName: w.full_name, idNumber: w.id_number ?? '', role: w.role ?? '',
    })),
    hazards: hazards.rows.map((h) => ({
      description: h.hazard_description,
      riskLevel: h.risk_level ?? '',
      controls: controls.rows.filter((c) => c.hazard_id === h.id).map((c) => c.control_measure),
    })),
    approvals: approvals.rows.map((a) => ({
      approverName: a.approver_name, role: a.role ?? '', decision: a.decision ?? '',
      comments: a.comments ?? '', decidedAt: a.created_at,
    })),
  })

  await audit(req.user!, 'PERMIT_PDF_EXPORT', 'jsa_permit', id, null, null, clientIp(req))
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="nghiem-thu-${row.permit_number}.pdf"`)
  bufferToStream(pdf).pipe(res)
})

// POST /jsa/permits/:id/cancel — hủy permit
jsaRouter.post('/permits/:id/cancel', ...canInspect, async (req, res) => {
  const id = Number(req.params.id)
  const scope = siteScope(req.user!)

  const permit = await query<{ status: string; requester_id: number }>(
    `SELECT status, requester_id FROM atld.jsa_permits WHERE id = $1 AND ($2::boolean OR site_id = $3)`,
    [id, scope.all, scope.siteId],
  )
  if (!permit.rows[0]) return res.status(404).json({ error: 'Không tìm thấy giấy phép.' })
  if (!['draft', 'submitted'].includes(permit.rows[0].status)) {
    return res.status(400).json({ error: 'Chỉ được cancel permit ở trạng thái draft hoặc submitted.' })
  }
  if (permit.rows[0].requester_id !== req.user!.id && req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ người tạo hoặc admin mới được cancel.' })
  }

  await query(`UPDATE atld.jsa_permits SET status = 'cancelled', updated_at = now() WHERE id = $1`, [id])
  await audit(req.user!, 'PERMIT_CANCEL', 'jsa_permit', id, null, null, clientIp(req))
  res.json({ ok: true })
})
