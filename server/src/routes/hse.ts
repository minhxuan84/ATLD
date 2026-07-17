// Quản lý ATVSLĐ / PCCN / BVMT cho nhà thầu, NCC, khách (QT111-07)
// Tất cả bảng dùng schema atld, prefix hse_. Migration additive-only.
import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import { query } from '../db.js'
import { requireAuth, requireSection, requireHse, siteScope } from '../auth.js'
import type { AuthUser } from '../auth.js'
import { escapeText, sanitizeFileName, ALLOWED_EXT, MAX_FILE_MB } from '../util.js'

export const hseRouter = Router()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'hse')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '')
    cb(null, `${crypto.randomUUID()}.${ext}`)
  },
})
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '')
    cb(null, ALLOWED_EXT.includes(ext))
  },
})

// ── Ghi audit log bất biến (không bao giờ update/delete) ─────────
async function audit(
  actor: AuthUser, action: string, entity: string, entityId: number,
  oldVal: unknown, newVal: unknown, ip?: string,
) {
  await query(
    `INSERT INTO atld.hse_audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [actor.id, action, entity, entityId, oldVal ? JSON.stringify(oldVal) : null,
     newVal ? JSON.stringify(newVal) : null, ip ?? null],
  )
}

// ── MIGRATION khi module load (additive-only, schema atld) ──────
;(async () => {
  try {
    await query(`CREATE TABLE IF NOT EXISTS atld.hse_contractors (
      id SERIAL PRIMARY KEY,
      code VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(200) NOT NULL,
      tax_id VARCHAR(20),
      address TEXT,
      phone VARCHAR(30),
      email VARCHAR(120),
      rep_name VARCHAR(120),
      rep_title VARCHAR(120),
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)

    await query(`CREATE TABLE IF NOT EXISTS atld.hse_contracts (
      id SERIAL PRIMARY KEY,
      contractor_id INTEGER NOT NULL REFERENCES atld.hse_contractors(id) ON DELETE CASCADE,
      contract_no VARCHAR(100) UNIQUE NOT NULL,
      title TEXT NOT NULL,
      work_location VARCHAR(200),
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      owner_id INTEGER,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    await query(`CREATE INDEX IF NOT EXISTS idx_hse_contracts_contractor ON atld.hse_contracts(contractor_id)`)

    await query(`CREATE TABLE IF NOT EXISTS atld.hse_doc_types (
      id SERIAL PRIMARY KEY,
      code VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(200) NOT NULL,
      scope VARCHAR(20) NOT NULL,
      is_mandatory BOOLEAN NOT NULL DEFAULT true,
      warn_days_before INTEGER NOT NULL DEFAULT 30,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    await query(`CREATE TABLE IF NOT EXISTS atld.hse_dossiers (
      id SERIAL PRIMARY KEY,
      contract_id INTEGER NOT NULL REFERENCES atld.hse_contracts(id) ON DELETE CASCADE,
      status VARCHAR(30) NOT NULL DEFAULT 'draft',
      submitted_at TIMESTAMPTZ,
      reviewed_by INTEGER,
      reviewed_at TIMESTAMPTZ,
      approved_by INTEGER,
      approved_at TIMESTAMPTZ,
      review_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)

    await query(`CREATE TABLE IF NOT EXISTS atld.hse_contractor_docs (
      id SERIAL PRIMARY KEY,
      dossier_id INTEGER NOT NULL REFERENCES atld.hse_dossiers(id) ON DELETE CASCADE,
      doc_type_id INTEGER NOT NULL REFERENCES atld.hse_doc_types(id),
      file_name VARCHAR(255) NOT NULL,
      stored_name VARCHAR(255) NOT NULL,
      expiry_date DATE,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      reviewer_note TEXT,
      uploaded_by INTEGER,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)

    await query(`CREATE TABLE IF NOT EXISTS atld.hse_workers (
      id SERIAL PRIMARY KEY,
      contractor_id INTEGER NOT NULL REFERENCES atld.hse_contractors(id) ON DELETE CASCADE,
      full_name VARCHAR(200) NOT NULL,
      id_number VARCHAR(30),
      birth_date DATE,
      job_title VARCHAR(120),
      phone VARCHAR(30),
      access_status VARCHAR(20) NOT NULL DEFAULT 'blocked',
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    await query(`CREATE INDEX IF NOT EXISTS idx_hse_workers_contractor ON atld.hse_workers(contractor_id)`)

    await query(`CREATE TABLE IF NOT EXISTS atld.hse_contract_workers (
      contract_id INTEGER NOT NULL REFERENCES atld.hse_contracts(id) ON DELETE CASCADE,
      worker_id INTEGER NOT NULL REFERENCES atld.hse_workers(id) ON DELETE CASCADE,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (contract_id, worker_id)
    )`)

    await query(`CREATE TABLE IF NOT EXISTS atld.hse_worker_docs (
      id SERIAL PRIMARY KEY,
      worker_id INTEGER NOT NULL REFERENCES atld.hse_workers(id) ON DELETE CASCADE,
      doc_type_id INTEGER NOT NULL REFERENCES atld.hse_doc_types(id),
      file_name VARCHAR(255) NOT NULL,
      stored_name VARCHAR(255) NOT NULL,
      expiry_date DATE,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      reviewer_note TEXT,
      uploaded_by INTEGER,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    await query(`CREATE TABLE IF NOT EXISTS atld.hse_equipments (
      id SERIAL PRIMARY KEY,
      contractor_id INTEGER NOT NULL REFERENCES atld.hse_contractors(id) ON DELETE CASCADE,
      name VARCHAR(200) NOT NULL,
      equipment_type VARCHAR(120),
      serial_no VARCHAR(120),
      access_status VARCHAR(20) NOT NULL DEFAULT 'blocked',
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)

    await query(`CREATE TABLE IF NOT EXISTS atld.hse_contract_equipments (
      contract_id INTEGER NOT NULL REFERENCES atld.hse_contracts(id) ON DELETE CASCADE,
      equipment_id INTEGER NOT NULL REFERENCES atld.hse_equipments(id) ON DELETE CASCADE,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (contract_id, equipment_id)
    )`)

    await query(`CREATE TABLE IF NOT EXISTS atld.hse_equipment_docs (
      id SERIAL PRIMARY KEY,
      equipment_id INTEGER NOT NULL REFERENCES atld.hse_equipments(id) ON DELETE CASCADE,
      doc_type_id INTEGER NOT NULL REFERENCES atld.hse_doc_types(id),
      file_name VARCHAR(255) NOT NULL,
      stored_name VARCHAR(255) NOT NULL,
      expiry_date DATE,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      reviewer_note TEXT,
      uploaded_by INTEGER,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)

    await query(`CREATE TABLE IF NOT EXISTS atld.hse_inspections (
      id SERIAL PRIMARY KEY,
      contract_id INTEGER NOT NULL REFERENCES atld.hse_contracts(id) ON DELETE CASCADE,
      inspector_id INTEGER NOT NULL,
      form_type VARCHAR(20) NOT NULL,
      scheduled_date DATE,
      conducted_at TIMESTAMPTZ,
      status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
      overall_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    await query(`CREATE INDEX IF NOT EXISTS idx_hse_inspections_contract ON atld.hse_inspections(contract_id)`)

    await query(`CREATE TABLE IF NOT EXISTS atld.hse_inspection_items (
      id SERIAL PRIMARY KEY,
      inspection_id INTEGER NOT NULL REFERENCES atld.hse_inspections(id) ON DELETE CASCADE,
      category VARCHAR(120),
      description TEXT NOT NULL,
      result VARCHAR(10),
      note TEXT,
      evidence_file VARCHAR(255),
      requires_suspension BOOLEAN NOT NULL DEFAULT false
    )`)

    await query(`CREATE TABLE IF NOT EXISTS atld.hse_suspensions (
      id SERIAL PRIMARY KEY,
      contract_id INTEGER NOT NULL REFERENCES atld.hse_contracts(id) ON DELETE CASCADE,
      inspection_id INTEGER,
      issued_by INTEGER NOT NULL,
      reason TEXT NOT NULL,
      scope TEXT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'issued',
      remediation_desc TEXT,
      remediation_date DATE,
      lifted_by INTEGER,
      lifted_at TIMESTAMPTZ,
      lift_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    await query(`CREATE TABLE IF NOT EXISTS atld.hse_access_logs (
      id SERIAL PRIMARY KEY,
      worker_id INTEGER REFERENCES atld.hse_workers(id) ON DELETE SET NULL,
      equipment_id INTEGER REFERENCES atld.hse_equipments(id) ON DELETE SET NULL,
      contract_id INTEGER REFERENCES atld.hse_contracts(id) ON DELETE SET NULL,
      guard_id INTEGER NOT NULL,
      direction VARCHAR(5) NOT NULL,
      result VARCHAR(10) NOT NULL,
      block_reason TEXT,
      logged_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    await query(`CREATE INDEX IF NOT EXISTS idx_hse_access_logs_at ON atld.hse_access_logs(logged_at DESC)`)

    await query(`CREATE TABLE IF NOT EXISTS atld.hse_audit_logs (
      id SERIAL PRIMARY KEY,
      actor_id INTEGER NOT NULL,
      action VARCHAR(100) NOT NULL,
      entity_type VARCHAR(50) NOT NULL,
      entity_id INTEGER NOT NULL,
      old_value JSONB,
      new_value JSONB,
      ip_address VARCHAR(50),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    await query(`CREATE INDEX IF NOT EXISTS idx_hse_audit_entity ON atld.hse_audit_logs(entity_type, entity_id)`)

    // Bản cam kết điện tử ATVSLĐ-PCCN-BVMT (BM111-07.01) — ký tay lưu dạng dataURL.
    await query(`CREATE TABLE IF NOT EXISTS atld.hse_commitments (
      id SERIAL PRIMARY KEY,
      contract_id INTEGER NOT NULL REFERENCES atld.hse_contracts(id) ON DELETE CASCADE,
      title VARCHAR(200) NOT NULL DEFAULT 'Bản cam kết ATVSLĐ - PCCN - BVMT',
      content TEXT NOT NULL,
      signer_name VARCHAR(200),
      signer_title VARCHAR(120),
      signature_data TEXT,
      signed_at TIMESTAMPTZ,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      verify_code VARCHAR(120),
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    await query(`CREATE INDEX IF NOT EXISTS idx_hse_commitments_contract ON atld.hse_commitments(contract_id)`)

    // ── Additive migrations cho cột mới ──────────────────────────────
    // hse_inspections: bổ sung trường inspector_name, inspection_date, overall_result, suspension_required
    await query(`ALTER TABLE atld.hse_inspections ADD COLUMN IF NOT EXISTS inspector_name VARCHAR(200)`)
    await query(`ALTER TABLE atld.hse_inspections ADD COLUMN IF NOT EXISTS inspection_date DATE`)
    await query(`ALTER TABLE atld.hse_inspections ADD COLUMN IF NOT EXISTS overall_result VARCHAR(20) NOT NULL DEFAULT 'pass'`)
    await query(`ALTER TABLE atld.hse_inspections ADD COLUMN IF NOT EXISTS suspension_required BOOLEAN NOT NULL DEFAULT false`)

    // hse_inspection_items: bổ sung item_code và item_name (tách khỏi category/description cũ)
    await query(`ALTER TABLE atld.hse_inspection_items ADD COLUMN IF NOT EXISTS item_code VARCHAR(50)`)
    await query(`ALTER TABLE atld.hse_inspection_items ADD COLUMN IF NOT EXISTS item_name TEXT`)

    // hse_contracts: bổ sung upload hợp đồng PDF
    await query(`ALTER TABLE atld.hse_contracts ADD COLUMN IF NOT EXISTS contract_file_name VARCHAR(255)`)
    await query(`ALTER TABLE atld.hse_contracts ADD COLUMN IF NOT EXISTS contract_stored_name VARCHAR(255)`)

    // hse_workers: trạng thái hiện diện tại công trường (đã vào / đã ra) + mốc thời gian
    // presence: 'out' (ngoài công trường, mặc định) | 'in' (đang trong công trường)
    await query(`ALTER TABLE atld.hse_workers ADD COLUMN IF NOT EXISTS presence VARCHAR(10) NOT NULL DEFAULT 'out'`)
    await query(`ALTER TABLE atld.hse_workers ADD COLUMN IF NOT EXISTS last_in_at TIMESTAMPTZ`)
    await query(`ALTER TABLE atld.hse_workers ADD COLUMN IF NOT EXISTS last_out_at TIMESTAMPTZ`)

    // hse_doc_types: bổ sung cấu hình động (kích hoạt, nhóm hiển thị, chức danh áp dụng, mức rủi ro)
    await query(`ALTER TABLE atld.hse_doc_types ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true`)
    await query(`ALTER TABLE atld.hse_doc_types ADD COLUMN IF NOT EXISTS group_name VARCHAR(120)`)
    await query(`ALTER TABLE atld.hse_doc_types ADD COLUMN IF NOT EXISTS applies_to TEXT`)
    await query(`ALTER TABLE atld.hse_doc_types ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20)`)

    // Phase D: phân loại rủi ro + loại dịch vụ cho hợp đồng (ma trận điều kiện).
    await query(`ALTER TABLE atld.hse_contracts ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20) NOT NULL DEFAULT 'medium'`)
    await query(`ALTER TABLE atld.hse_contracts ADD COLUMN IF NOT EXISTS service_type VARCHAR(120)`)

    // Phase F: đánh dấu nhà thầu ngoài địa bàn (đánh giá định kỳ theo ISO 45001).
    await query(`ALTER TABLE atld.hse_contractors ADD COLUMN IF NOT EXISTS is_offsite BOOLEAN NOT NULL DEFAULT false`)
    await query(`ALTER TABLE atld.hse_contractors ADD COLUMN IF NOT EXISTS iso45001 BOOLEAN NOT NULL DEFAULT false`)

    // Phase E: NCC & khách bên ngoài (đăng ký + QR + vào/ra tách khỏi NLĐ nhà thầu).
    await query(`CREATE TABLE IF NOT EXISTS atld.hse_visitors (
      id SERIAL PRIMARY KEY,
      kind VARCHAR(20) NOT NULL DEFAULT 'guest',
      full_name VARCHAR(200) NOT NULL,
      id_number VARCHAR(30),
      org_name VARCHAR(200),
      phone VARCHAR(30),
      purpose TEXT,
      host_name VARCHAR(200),
      valid_from DATE,
      valid_to DATE,
      access_status VARCHAR(20) NOT NULL DEFAULT 'allowed',
      presence VARCHAR(10) NOT NULL DEFAULT 'out',
      qr_code VARCHAR(120) UNIQUE,
      last_in_at TIMESTAMPTZ,
      last_out_at TIMESTAMPTZ,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    await query(`CREATE TABLE IF NOT EXISTS atld.hse_visitor_logs (
      id SERIAL PRIMARY KEY,
      visitor_id INTEGER NOT NULL REFERENCES atld.hse_visitors(id) ON DELETE CASCADE,
      guard_id INTEGER,
      direction VARCHAR(4) NOT NULL,
      result VARCHAR(10) NOT NULL,
      block_reason TEXT,
      logged_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    await query(`CREATE INDEX IF NOT EXISTS idx_hse_visitor_logs_visitor ON atld.hse_visitor_logs(visitor_id)`)

    // Phase F: đánh giá định kỳ nhà thầu (BM111-07.05) — điểm tiêu chí lưu JSONB.
    await query(`CREATE TABLE IF NOT EXISTS atld.hse_evaluations (
      id SERIAL PRIMARY KEY,
      contractor_id INTEGER NOT NULL REFERENCES atld.hse_contractors(id) ON DELETE CASCADE,
      contract_id INTEGER REFERENCES atld.hse_contracts(id) ON DELETE SET NULL,
      period VARCHAR(20) NOT NULL,
      eval_date DATE,
      scores JSONB NOT NULL DEFAULT '{}',
      total_score NUMERIC(5,2),
      rating VARCHAR(20),
      note TEXT,
      evaluator_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    await query(`CREATE INDEX IF NOT EXISTS idx_hse_evaluations_contractor ON atld.hse_evaluations(contractor_id)`)

    // ── Phân tách theo SITE (chi nhánh/nhà máy) ──────────────────────
    // Mỗi user (cán bộ) phụ trách 1 site; dữ liệu ATVSLĐ/PCCN/BVMT chỉ hiển thị theo site.
    // Neo site trên hợp đồng + khách; NLĐ/thiết bị/kiểm tra… suy ra site qua hợp đồng.
    await query(`ALTER TABLE atld.users ADD COLUMN IF NOT EXISTS site_id INTEGER REFERENCES atld.branches(id) ON DELETE SET NULL`)
    await query(`ALTER TABLE atld.hse_contracts ADD COLUMN IF NOT EXISTS site_id INTEGER REFERENCES atld.branches(id) ON DELETE SET NULL`)
    await query(`ALTER TABLE atld.hse_visitors ADD COLUMN IF NOT EXISTS site_id INTEGER REFERENCES atld.branches(id) ON DELETE SET NULL`)
    await query(`CREATE INDEX IF NOT EXISTS idx_hse_contracts_site ON atld.hse_contracts(site_id)`)
    await query(`CREATE INDEX IF NOT EXISTS idx_hse_visitors_site ON atld.hse_visitors(site_id)`)
    // Gán site mặc định (Kiên Lương, hoặc chi nhánh có id nhỏ nhất) cho dữ liệu cũ chưa có site.
    await query(`UPDATE atld.hse_contracts SET site_id = COALESCE(
      (SELECT id FROM atld.branches WHERE name ILIKE '%Kiên Lương%' ORDER BY id LIMIT 1),
      (SELECT id FROM atld.branches ORDER BY sort_order, id LIMIT 1)) WHERE site_id IS NULL`)
    await query(`UPDATE atld.hse_visitors SET site_id = COALESCE(
      (SELECT id FROM atld.branches WHERE name ILIKE '%Kiên Lương%' ORDER BY id LIMIT 1),
      (SELECT id FROM atld.branches ORDER BY sort_order, id LIMIT 1)) WHERE site_id IS NULL`)

    // Seed 11 nhóm hồ sơ nhà thầu (BM111-07.02) — upsert theo code, không phá dữ liệu cũ.
    await query(`
      INSERT INTO atld.hse_doc_types (code, name, scope, is_mandatory, warn_days_before, sort_order, group_name)
      VALUES
        ('CTR02_01','ĐKKD / Quyết định thành lập',            'contractor', true, 60, 101, 'Hồ sơ pháp lý & năng lực'),
        ('CTR02_02','Hồ sơ năng lực nhà thầu',                 'contractor', true, 60, 102, 'Hồ sơ pháp lý & năng lực'),
        ('CTR02_03','Cam kết ATVSLĐ-PCCN-BVMT (BM111-07.01)',  'contractor', true, 30, 103, 'Cam kết & chính sách'),
        ('CTR02_04','Kế hoạch/biện pháp thi công an toàn',      'contractor', true, 30, 104, 'Kế hoạch an toàn'),
        ('CTR02_05','Đánh giá rủi ro / JSA công việc',          'contractor', true, 30, 105, 'Kế hoạch an toàn'),
        ('CTR02_06','Quyết định cử cán bộ ATVSLĐ',              'contractor', true, 30, 106, 'Tổ chức an toàn'),
        ('CTR02_07','Danh sách người lao động',                 'contractor', true,  0, 107, 'Nhân sự & thiết bị'),
        ('CTR02_08','Danh sách thiết bị/dụng cụ thi công',      'contractor', true,  0, 108, 'Nhân sự & thiết bị'),
        ('CTR02_09','Bảo hiểm TNDS / bảo hiểm con người',       'contractor', true, 30, 109, 'Bảo hiểm'),
        ('CTR02_10','PA ứng phó sự cố / PCCC hiện trường',      'contractor', true, 30, 110, 'Ứng phó khẩn cấp'),
        ('CTR02_11','Cam kết bảo vệ môi trường',                'contractor', false,30, 111, 'Môi trường')
      ON CONFLICT (code) DO NOTHING`)

    // Seed loại hồ sơ mặc định nếu bảng rỗng
    await query(`
      INSERT INTO atld.hse_doc_types (code, name, scope, is_mandatory, warn_days_before, sort_order)
      SELECT * FROM (VALUES
        ('CTR_LEGAL',    'Giấy phép kinh doanh',                 'contractor', true, 60, 10),
        ('CTR_SAFETY',   'Cam kết ATVSLĐ-PCCN-BVMT (BM111-07.01)','contractor', true, 30, 20),
        ('CTR_INSURANCE','Bảo hiểm trách nhiệm',                 'contractor', true, 30, 30),
        ('WRK_HEALTH',   'Giấy khám sức khỏe',                   'worker',     true, 30, 10),
        ('WRK_SAFETY',   'Chứng chỉ huấn luyện an toàn',         'worker',     true, 30, 20),
        ('WRK_ID',       'CMND/CCCD',                            'worker',     true,  0, 30),
        ('EQP_REGIST',   'Giấy kiểm định thiết bị',              'equipment',  true, 30, 10),
        ('EQP_INSURANCE','Bảo hiểm thiết bị',                    'equipment',  false,30, 20)
      ) AS v(code,name,scope,is_mandatory,warn_days_before,sort_order)
      WHERE NOT EXISTS (SELECT 1 FROM atld.hse_doc_types LIMIT 1)`)
  } catch (e) {
    console.error('[hse migration]', (e as Error).message)
  }
})()
// Chỉ officer/admin được ghi (requireSection kiểm tra quyền 'an-toan').
const canWrite = [requireAuth, requireSection('an-toan')]
// Sub-permission guards — admin và 'an-toan' toàn quyền luôn pass.
const canGate = [requireAuth, requireHse('gate', 'inspect', 'approve')]
const canInspect = [requireAuth, requireHse('inspect', 'approve')]
const canApprove = [requireAuth, requireHse('approve')]

const clientIp = (req: { ip?: string; headers: Record<string, unknown> }) =>
  (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || ''

// ═══════════════ LOẠI HỒ SƠ ═══════════════
hseRouter.get('/doc-types', requireAuth, async (req, res) => {
  const includeInactive = req.query.all === '1'
  const r = await query(`SELECT id, code, name, scope, is_mandatory, warn_days_before, sort_order,
    is_active, group_name, applies_to, risk_level
    FROM atld.hse_doc_types
    WHERE ($1 = true OR is_active = true)
    ORDER BY scope, sort_order, name`, [includeInactive])
  res.json({ docTypes: r.rows })
})

// Cấu hình động loại hồ sơ — chỉ cán bộ 'an-toan' toàn quyền / admin.
hseRouter.post('/doc-types', ...canWrite, async (req, res) => {
  const b = req.body ?? {}
  const code = escapeText(String(b.code ?? '').trim().toUpperCase())
  const name = escapeText(String(b.name ?? '').trim())
  const scope = String(b.scope ?? '')
  if (!code || !name || !['contractor', 'worker', 'equipment'].includes(scope))
    return res.status(400).json({ error: 'Thiếu mã, tên hoặc phạm vi hợp lệ (contractor/worker/equipment).' })
  try {
    const r = await query<{ id: number }>(
      `INSERT INTO atld.hse_doc_types (code, name, scope, is_mandatory, warn_days_before, sort_order, group_name, applies_to, risk_level)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [code, name, scope, b.is_mandatory !== false, Number(b.warn_days_before ?? 30),
       Number(b.sort_order ?? 0), escapeText(String(b.group_name ?? '')),
       escapeText(String(b.applies_to ?? '')), escapeText(String(b.risk_level ?? ''))])
    await audit(req.user!, 'DOCTYPE_CREATE', 'doc_type', r.rows[0]!.id, null, { code, name }, clientIp(req))
    res.status(201).json({ id: r.rows[0]!.id })
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return res.status(409).json({ error: 'Mã loại hồ sơ đã tồn tại.' })
    throw e
  }
})

hseRouter.patch('/doc-types/:id', ...canWrite, async (req, res) => {
  const id = Number(req.params.id)
  const b = req.body ?? {}
  const fields = ['name', 'is_mandatory', 'warn_days_before', 'sort_order', 'is_active', 'group_name', 'applies_to', 'risk_level']
  const sets: string[] = []; const vals: unknown[] = []
  for (const f of fields) {
    if (b[f] === undefined) continue
    const v = (f === 'is_mandatory' || f === 'is_active') ? Boolean(b[f])
      : (f === 'warn_days_before' || f === 'sort_order') ? Number(b[f])
      : escapeText(String(b[f]))
    sets.push(`${f} = $${sets.length + 1}`); vals.push(v)
  }
  if (!sets.length) return res.status(400).json({ error: 'Không có trường nào để cập nhật.' })
  vals.push(id)
  await query(`UPDATE atld.hse_doc_types SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals)
  await audit(req.user!, 'DOCTYPE_UPDATE', 'doc_type', id, null, b, clientIp(req))
  res.json({ ok: true })
})

hseRouter.delete('/doc-types/:id', ...canWrite, async (req, res) => {
  const id = Number(req.params.id)
  // Xóa mềm: ẩn khỏi danh sách nhưng giữ tham chiếu hồ sơ cũ.
  await query(`UPDATE atld.hse_doc_types SET is_active = false WHERE id = $1`, [id])
  await audit(req.user!, 'DOCTYPE_DEACTIVATE', 'doc_type', id, null, null, clientIp(req))
  res.json({ ok: true })
})

// ═══════════════ NHÀ THẦU ═══════════════
type ContractorRow = {
  id: number; code: string; name: string; tax_id: string | null; address: string | null
  phone: string | null; email: string | null; rep_name: string | null; rep_title: string | null
  status: string
}

hseRouter.get('/contractors', requireAuth, async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  const like = `%${q}%`
  const { all, siteId } = siteScope(req.user!)
  // Nhà thầu giới hạn theo site: officer thấy nhà thầu CÓ hợp đồng tại site mình phụ trách,
  // HOẶC nhà thầu chưa có hợp đồng nào (mới tạo, chưa gán site) để còn thao tác thêm HĐ.
  const r = await query<ContractorRow>(
    `SELECT id, code, name, tax_id, address, phone, email, rep_name, rep_title, status, is_offsite, iso45001
     FROM atld.hse_contractors ct
     WHERE ($1 = '' OR name ILIKE $2 OR code ILIKE $2)
       AND ($3::boolean OR EXISTS (
             SELECT 1 FROM atld.hse_contracts c
             WHERE c.contractor_id = ct.id AND c.site_id = $4)
           OR NOT EXISTS (
             SELECT 1 FROM atld.hse_contracts c2 WHERE c2.contractor_id = ct.id))
     ORDER BY name`,
    [q, like, all, siteId],
  )
  res.json({ contractors: r.rows })
})

hseRouter.get('/contractors/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const r = await query<ContractorRow>(`SELECT * FROM atld.hse_contractors WHERE id = $1`, [id])
  if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy nhà thầu.' })
  res.json({ contractor: r.rows[0] })
})

hseRouter.post('/contractors', ...canInspect, async (req, res) => {
  const b = req.body ?? {}
  const code = escapeText(String(b.code ?? '').trim())
  const name = escapeText(String(b.name ?? '').trim())
  if (!code || !name) return res.status(400).json({ error: 'Mã và tên nhà thầu là bắt buộc.' })
  try {
    const r = await query<{ id: number }>(
      `INSERT INTO atld.hse_contractors (code, name, tax_id, address, phone, email, rep_name, rep_title, is_offsite, iso45001)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [code, name, escapeText(String(b.tax_id ?? '')), escapeText(String(b.address ?? '')),
       escapeText(String(b.phone ?? '')), escapeText(String(b.email ?? '')),
       escapeText(String(b.rep_name ?? '')), escapeText(String(b.rep_title ?? '')),
       Boolean(b.is_offsite), Boolean(b.iso45001)],
    )
    await audit(req.user!, 'CONTRACTOR_CREATE', 'contractor', r.rows[0]!.id, null, { code, name }, clientIp(req))
    res.status(201).json({ id: r.rows[0]!.id })
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      return res.status(409).json({ error: 'Mã nhà thầu đã tồn tại.' })
    throw e
  }
})

hseRouter.patch('/contractors/:id', ...canInspect, async (req, res) => {
  const id = Number(req.params.id)
  const b = req.body ?? {}
  const fields = ['name', 'tax_id', 'address', 'phone', 'email', 'rep_name', 'rep_title', 'status']
  const boolFields = ['is_offsite', 'iso45001']
  const sets: string[] = []
  const vals: unknown[] = []
  for (const f of fields) {
    if (b[f] !== undefined) { sets.push(`${f} = $${sets.length + 1}`); vals.push(escapeText(String(b[f]))) }
  }
  for (const f of boolFields) {
    if (b[f] !== undefined) { sets.push(`${f} = $${sets.length + 1}`); vals.push(Boolean(b[f])) }
  }
  if (!sets.length) return res.status(400).json({ error: 'Không có trường nào để cập nhật.' })
  vals.push(id)
  await query(`UPDATE atld.hse_contractors SET ${sets.join(', ')}, updated_at = now()
    WHERE id = $${vals.length}`, vals)
  await audit(req.user!, 'CONTRACTOR_UPDATE', 'contractor', id, null, b, clientIp(req))
  res.json({ ok: true })
})

hseRouter.delete('/contractors/:id', ...canInspect, async (req, res) => {
  const id = Number(req.params.id)
  await query(`UPDATE atld.hse_contractors SET status = 'inactive', updated_at = now() WHERE id = $1`, [id])
  await audit(req.user!, 'CONTRACTOR_DEACTIVATE', 'contractor', id, null, null, clientIp(req))
  res.json({ ok: true })
})
// ═══════════════ HỢP ĐỒNG ═══════════════
hseRouter.get('/contracts', requireAuth, async (req, res) => {
  const contractorId = req.query.contractorId ? Number(req.query.contractorId) : null
  const { all, siteId } = siteScope(req.user!)
  const r = await query(
    `SELECT c.id, c.contract_no, c.title, c.work_location, c.start_date, c.end_date,
            c.status, c.contractor_id, c.contract_file_name, c.risk_level, c.service_type,
            c.site_id, s.name AS site_name, ct.name AS contractor_name
     FROM atld.hse_contracts c
     JOIN atld.hse_contractors ct ON ct.id = c.contractor_id
     LEFT JOIN atld.branches s ON s.id = c.site_id
     WHERE ($1::int IS NULL OR c.contractor_id = $1)
       AND ($2::boolean OR c.site_id = $3)
     ORDER BY c.created_at DESC`,
    [contractorId, all, siteId],
  )
  res.json({ contracts: r.rows })
})

hseRouter.get('/contracts/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const { all, siteId } = siteScope(req.user!)
  const r = await query(
    `SELECT c.*, ct.name AS contractor_name, s.name AS site_name
     FROM atld.hse_contracts c
     JOIN atld.hse_contractors ct ON ct.id = c.contractor_id
     LEFT JOIN atld.branches s ON s.id = c.site_id
     WHERE c.id = $1 AND ($2::boolean OR c.site_id = $3)`, [id, all, siteId])
  if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy hợp đồng.' })
  res.json({ contract: r.rows[0] })
})

hseRouter.post('/contracts', ...canInspect, async (req, res) => {
  const b = req.body ?? {}
  const contractorId = Number(b.contractor_id)
  const contractNo = escapeText(String(b.contract_no ?? '').trim())
  const title = escapeText(String(b.title ?? '').trim())
  if (!contractorId || !contractNo || !title || !b.start_date || !b.end_date)
    return res.status(400).json({ error: 'Thiếu thông tin bắt buộc (nhà thầu, số HĐ, tiêu đề, thời hạn).' })
  try {
    const risk = ['low', 'medium', 'high'].includes(String(b.risk_level)) ? String(b.risk_level) : 'medium'
    // Site: admin/toàn quyền chọn site trong body; officer bị ép về site được phân công.
    const { all } = siteScope(req.user!)
    const siteId = all ? (b.site_id ? Number(b.site_id) : null) : req.user!.siteId
    const r = await query<{ id: number }>(
      `INSERT INTO atld.hse_contracts (contractor_id, contract_no, title, work_location, start_date, end_date, risk_level, service_type, site_id, owner_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [contractorId, contractNo, title, escapeText(String(b.work_location ?? '')),
       b.start_date, b.end_date, risk, escapeText(String(b.service_type ?? '')), siteId, req.user!.id, req.user!.id],
    )
    await audit(req.user!, 'CONTRACT_CREATE', 'contract', r.rows[0]!.id, null, { contractNo, title }, clientIp(req))
    res.status(201).json({ id: r.rows[0]!.id })
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      return res.status(409).json({ error: 'Số hợp đồng đã tồn tại.' })
    throw e
  }
})

hseRouter.patch('/contracts/:id', ...canInspect, async (req, res) => {
  const id = Number(req.params.id)
  const b = req.body ?? {}
  const fields = ['title', 'work_location', 'start_date', 'end_date', 'status', 'risk_level', 'service_type']
  const sets: string[] = []
  const vals: unknown[] = []
  for (const f of fields) {
    if (b[f] !== undefined) { sets.push(`${f} = $${sets.length + 1}`); vals.push(escapeText(String(b[f]))) }
  }
  // Chỉ admin/toàn quyền được đổi site của hợp đồng.
  if (b.site_id !== undefined && siteScope(req.user!).all) {
    sets.push(`site_id = $${sets.length + 1}`); vals.push(b.site_id ? Number(b.site_id) : null)
  }
  if (!sets.length) return res.status(400).json({ error: 'Không có trường nào để cập nhật.' })
  vals.push(id)
  await query(`UPDATE atld.hse_contracts SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals)
  await audit(req.user!, 'CONTRACT_UPDATE', 'contract', id, null, b, clientIp(req))
  res.json({ ok: true })
})

hseRouter.delete('/contracts/:id', ...canInspect, async (req, res) => {
  const id = Number(req.params.id)
  await query(`DELETE FROM atld.hse_contracts WHERE id = $1`, [id])
  await audit(req.user!, 'CONTRACT_DELETE', 'contract', id, null, null, clientIp(req))
  res.json({ ok: true })
})

// Upload file hợp đồng PDF (gắn vào hợp đồng đã có)
hseRouter.post('/contracts/:id/file', ...canInspect, upload.single('file'), async (req, res) => {
  const id = Number(req.params.id)
  if (!req.file) return res.status(400).json({ error: 'Chưa chọn tệp.' })
  const cur = await query<{ contract_stored_name: string | null }>(
    `SELECT contract_stored_name FROM atld.hse_contracts WHERE id = $1`, [id])
  if (!cur.rows[0]) return res.status(404).json({ error: 'Không tìm thấy hợp đồng.' })
  // Xóa file cũ nếu có
  if (cur.rows[0].contract_stored_name) {
    const old = path.join(UPLOAD_DIR, cur.rows[0].contract_stored_name)
    if (fs.existsSync(old)) fs.unlinkSync(old)
  }
  await query(
    `UPDATE atld.hse_contracts SET contract_file_name = $1, contract_stored_name = $2, updated_at = now() WHERE id = $3`,
    [sanitizeFileName(req.file.originalname), req.file.filename, id])
  await audit(req.user!, 'CONTRACT_FILE_UPLOAD', 'contract', id, null,
    { file_name: req.file.originalname }, clientIp(req))
  res.json({ ok: true, file_name: sanitizeFileName(req.file.originalname) })
})

// Xem / tải file hợp đồng
hseRouter.get('/contracts/:id/file', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const r = await query<{ contract_file_name: string | null; contract_stored_name: string | null }>(
    `SELECT contract_file_name, contract_stored_name FROM atld.hse_contracts WHERE id = $1`, [id])
  if (!r.rows[0] || !r.rows[0].contract_stored_name)
    return res.status(404).json({ error: 'Hợp đồng chưa có file đính kèm.' })
  const filePath = path.join(UPLOAD_DIR, r.rows[0].contract_stored_name)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Tệp không còn trên máy chủ.' })
  res.download(filePath, r.rows[0].contract_file_name ?? 'hop-dong.pdf')
})

// ═══════════════ XUẤT BÁO CÁO HỒ SƠ KIỂM SOÁT AN TOÀN (theo hợp đồng) ═══════════════
// Xuất file Excel .xlsx nhiều sheet cho 1 hợp đồng: nhà thầu, hồ sơ NLĐ,
// kiểm tra ATMT, đình chỉ, lịch sử vào/ra. Dành cho nhà thầu/NCC/khách bên ngoài.
const VI_DATE = (d: unknown): string => {
  if (!d) return ''
  const dt = new Date(String(d))
  if (isNaN(dt.getTime())) return String(d).slice(0, 10)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`
}
const VI_DATETIME = (d: unknown): string => {
  if (!d) return ''
  const dt = new Date(String(d))
  if (isNaN(dt.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()} ${p(dt.getHours())}:${p(dt.getMinutes())}`
}
const DOC_STATUS_VI: Record<string, string> = {
  pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Bị từ chối',
}
const RESULT_VI: Record<string, string> = {
  pass: 'Đạt', fail: 'Không đạt', partial: 'Đạt một phần', na: 'Không áp dụng',
}

hseRouter.get('/contracts/:id/report', requireAuth, requireSection('an-toan'), async (req, res) => {
  const id = Number(req.params.id)
  if (!id) return res.status(400).json({ error: 'Thiếu mã hợp đồng.' })

  // Hợp đồng + nhà thầu
  const c = await query<{
    id: number; contract_no: string; title: string; work_location: string | null
    start_date: string; end_date: string; status: string; contractor_id: number
    contractor_name: string; code: string; tax_id: string | null; address: string | null
    phone: string | null; email: string | null; rep_name: string | null; rep_title: string | null
  }>(
    `SELECT c.id, c.contract_no, c.title, c.work_location, c.start_date, c.end_date, c.status,
            c.contractor_id, ct.name AS contractor_name, ct.code, ct.tax_id, ct.address,
            ct.phone, ct.email, ct.rep_name, ct.rep_title
     FROM atld.hse_contracts c JOIN atld.hse_contractors ct ON ct.id = c.contractor_id
     WHERE c.id = $1`, [id])
  if (!c.rows[0]) return res.status(404).json({ error: 'Không tìm thấy hợp đồng.' })
  const ct = c.rows[0]

  // Hồ sơ pháp lý nhà thầu (qua dossier của hợp đồng)
  const ctrDocs = await query<{
    doc_type_name: string; file_name: string; expiry_date: string | null
    status: string; reviewer_note: string | null; uploaded_at: string
  }>(
    `SELECT dt.name AS doc_type_name, d.file_name, d.expiry_date, d.status,
            d.reviewer_note, d.uploaded_at
     FROM atld.hse_contractor_docs d
     JOIN atld.hse_dossiers ds ON ds.id = d.dossier_id
     JOIN atld.hse_doc_types dt ON dt.id = d.doc_type_id
     WHERE ds.contract_id = $1 ORDER BY dt.sort_order, dt.name`, [id])

  // NLĐ gắn với hợp đồng (fallback: toàn bộ NLĐ của nhà thầu nếu chưa gán)
  const assigned = await query<{ id: number; full_name: string; id_number: string | null; job_title: string | null; phone: string | null; access_status: string; presence: string; last_in_at: string | null; last_out_at: string | null }>(
    `SELECT w.id, w.full_name, w.id_number, w.job_title, w.phone, w.access_status,
            w.presence, w.last_in_at, w.last_out_at
     FROM atld.hse_contract_workers cw JOIN atld.hse_workers w ON w.id = cw.worker_id
     WHERE cw.contract_id = $1 ORDER BY w.full_name`, [id])
  const workers = assigned.rows.length ? assigned.rows : (await query<{ id: number; full_name: string; id_number: string | null; job_title: string | null; phone: string | null; access_status: string; presence: string; last_in_at: string | null; last_out_at: string | null }>(
    `SELECT id, full_name, id_number, job_title, phone, access_status, presence, last_in_at, last_out_at
     FROM atld.hse_workers WHERE contractor_id = $1 ORDER BY full_name`, [ct.contractor_id])).rows

  // Hồ sơ từng NLĐ
  const workerIds = workers.map((w) => w.id)
  const wDocs = workerIds.length
    ? (await query<{ worker_id: number; doc_type_name: string; file_name: string; expiry_date: string | null; status: string; reviewer_note: string | null }>(
        `SELECT d.worker_id, dt.name AS doc_type_name, d.file_name, d.expiry_date, d.status, d.reviewer_note
         FROM atld.hse_worker_docs d JOIN atld.hse_doc_types dt ON dt.id = d.doc_type_id
         WHERE d.worker_id = ANY($1) ORDER BY d.worker_id, dt.sort_order`, [workerIds])).rows
    : []

  // Kiểm tra ATMT
  const inspections = await query<{ id: number; form_type: string; inspection_date: string | null; inspector_name: string; overall_result: string; suspension_required: boolean; note: string | null }>(
    `SELECT i.id, i.form_type,
            COALESCE(i.inspection_date, i.scheduled_date, i.conducted_at::date) AS inspection_date,
            COALESCE(i.inspector_name, u.full_name, '') AS inspector_name,
            i.overall_result, i.suspension_required, i.overall_note AS note
     FROM atld.hse_inspections i LEFT JOIN atld.users u ON u.id = i.inspector_id
     WHERE i.contract_id = $1
     ORDER BY COALESCE(i.inspection_date, i.scheduled_date, i.conducted_at::date) DESC NULLS LAST, i.id DESC`, [id])

  // Đình chỉ
  const suspensions = await query<{ reason: string; scope: string; status: string; remediation_desc: string | null; remediation_date: string | null; lift_note: string | null; created_at: string; lifted_at: string | null }>(
    `SELECT reason, scope, status, remediation_desc, remediation_date, lift_note, created_at, lifted_at
     FROM atld.hse_suspensions WHERE contract_id = $1 ORDER BY created_at DESC`, [id])

  // Lịch sử vào/ra: log cũ có thể ghi contract_id = NULL (khi NLĐ chưa gán hợp đồng),
  // nên lọc thêm theo danh sách NLĐ của hợp đồng để không bỏ sót.
  const logs = await query<{ full_name: string | null; id_number: string | null; direction: string; result: string; block_reason: string | null; logged_at: string; guard_name: string | null }>(
    `SELECT w.full_name, w.id_number, l.direction, l.result, l.block_reason, l.logged_at,
            g.full_name AS guard_name
     FROM atld.hse_access_logs l
     LEFT JOIN atld.hse_workers w ON w.id = l.worker_id
     LEFT JOIN atld.users g ON g.id = l.guard_id
     WHERE l.contract_id = $1 OR l.worker_id = ANY($2::int[])
     ORDER BY l.logged_at DESC LIMIT 2000`, [id, workerIds])

  // ── Dựng workbook ──────────────────────────────────────────────
  const wb = new ExcelJS.Workbook()
  wb.creator = 'ATLĐ - QT111-07'
  wb.created = new Date()

  const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0055A4' } }
  const addTable = (ws: ExcelJS.Worksheet, headers: string[], rows: (string | number)[][], widths?: number[]) => {
    ws.columns = headers.map((h, i) => ({ header: h, width: widths?.[i] ?? Math.max(14, h.length + 4) }))
    const hr = ws.getRow(1)
    hr.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    hr.fill = HEADER_FILL
    hr.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    hr.height = 24
    for (const r of rows) ws.addRow(r)
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD0D7DE' } },
          bottom: { style: 'thin', color: { argb: 'FFD0D7DE' } },
          left: { style: 'thin', color: { argb: 'FFD0D7DE' } },
          right: { style: 'thin', color: { argb: 'FFD0D7DE' } },
        }
        if (cell.alignment?.wrapText === undefined) cell.alignment = { vertical: 'top', wrapText: true }
      })
    })
    ws.views = [{ state: 'frozen', ySplit: 1 }]
  }

  // Sheet 1: Nhà thầu & hợp đồng
  const s1 = wb.addWorksheet('Nhà thầu & Hợp đồng')
  addTable(s1, ['Thông tin', 'Nội dung'], [
    ['Nhà thầu / NCC', ct.contractor_name],
    ['Mã nhà thầu', ct.code],
    ['Mã số thuế', ct.tax_id ?? ''],
    ['Địa chỉ', ct.address ?? ''],
    ['Điện thoại', ct.phone ?? ''],
    ['Email', ct.email ?? ''],
    ['Người đại diện', ct.rep_name ?? ''],
    ['Chức vụ đại diện', ct.rep_title ?? ''],
    ['Số hợp đồng', ct.contract_no],
    ['Tên/hạng mục hợp đồng', ct.title],
    ['Địa điểm thi công', ct.work_location ?? ''],
    ['Thời hạn', `${VI_DATE(ct.start_date)} — ${VI_DATE(ct.end_date)}`],
    ['Trạng thái hợp đồng', ct.status],
    ['Ngày xuất báo cáo', VI_DATETIME(new Date())],
  ], [28, 70])

  // Sheet 2: Hồ sơ pháp lý nhà thầu
  const s2 = wb.addWorksheet('Hồ sơ nhà thầu')
  addTable(s2, ['Loại hồ sơ', 'Tên tệp', 'Ngày hết hạn', 'Trạng thái', 'Ghi chú duyệt', 'Ngày nộp'],
    ctrDocs.rows.map((d) => [
      d.doc_type_name, d.file_name, VI_DATE(d.expiry_date),
      DOC_STATUS_VI[d.status] ?? d.status, d.reviewer_note ?? '', VI_DATETIME(d.uploaded_at),
    ]), [34, 30, 16, 14, 30, 20])

  // Sheet 3: Người lao động + hồ sơ
  const s3 = wb.addWorksheet('Người lao động & hồ sơ')
  const docsByWorker = new Map<number, typeof wDocs>()
  for (const d of wDocs) {
    const arr = docsByWorker.get(d.worker_id) ?? []
    arr.push(d); docsByWorker.set(d.worker_id, arr)
  }
  const wRows: (string | number)[][] = []
  for (const w of workers) {
    const ds = docsByWorker.get(w.id) ?? []
    const accessVi = w.access_status === 'suspended' ? 'Đình chỉ'
      : w.access_status === 'allowed' ? 'Được vào' : 'Chưa đủ ĐK'
    const presenceVi = w.presence === 'in' ? 'Đang trong CT' : 'Đã ra / chưa vào'
    if (ds.length === 0) {
      wRows.push([w.full_name, w.id_number ?? '', w.job_title ?? '', w.phone ?? '',
        accessVi, presenceVi, VI_DATETIME(w.last_in_at), VI_DATETIME(w.last_out_at),
        '(chưa có hồ sơ)', '', '', ''])
    } else {
      ds.forEach((d, idx) => {
        wRows.push([
          idx === 0 ? w.full_name : '', idx === 0 ? (w.id_number ?? '') : '',
          idx === 0 ? (w.job_title ?? '') : '', idx === 0 ? (w.phone ?? '') : '',
          idx === 0 ? accessVi : '', idx === 0 ? presenceVi : '',
          idx === 0 ? VI_DATETIME(w.last_in_at) : '', idx === 0 ? VI_DATETIME(w.last_out_at) : '',
          d.doc_type_name, VI_DATE(d.expiry_date), DOC_STATUS_VI[d.status] ?? d.status, d.reviewer_note ?? '',
        ])
      })
    }
  }
  addTable(s3, ['Họ tên', 'CCCD/CMND', 'Chức danh', 'Điện thoại', 'Trạng thái vào cổng',
    'Hiện diện', 'Vào gần nhất', 'Ra gần nhất', 'Loại hồ sơ', 'Ngày hết hạn', 'Trạng thái HS', 'Ghi chú'],
    wRows, [22, 16, 18, 14, 16, 16, 18, 18, 30, 14, 14, 26])

  // Sheet 4: Kiểm tra ATMT
  const s4 = wb.addWorksheet('Kiểm tra ATMT')
  addTable(s4, ['Ngày kiểm tra', 'Loại phiếu', 'Người kiểm tra', 'Kết quả', 'Yêu cầu đình chỉ', 'Ghi chú'],
    inspections.rows.map((i) => [
      VI_DATE(i.inspection_date), i.form_type, i.inspector_name,
      RESULT_VI[i.overall_result] ?? i.overall_result,
      i.suspension_required ? 'Có' : 'Không', i.note ?? '',
    ]), [16, 16, 26, 16, 16, 40])

  // Sheet 5: Đình chỉ
  const s5 = wb.addWorksheet('Đình chỉ công việc')
  addTable(s5, ['Ngày ban hành', 'Lý do', 'Phạm vi', 'Trạng thái', 'Khắc phục', 'Ngày khắc phục', 'Ngày gỡ', 'Ghi chú gỡ'],
    suspensions.rows.map((s) => [
      VI_DATETIME(s.created_at), s.reason, s.scope,
      s.status === 'lifted' ? 'Đã gỡ' : s.status === 'issued' ? 'Đang đình chỉ' : s.status,
      s.remediation_desc ?? '', VI_DATE(s.remediation_date), VI_DATETIME(s.lifted_at), s.lift_note ?? '',
    ]), [20, 34, 26, 16, 30, 16, 20, 26])

  // Sheet 6: Lịch sử vào/ra
  const s6 = wb.addWorksheet('Lịch sử vào-ra')
  addTable(s6, ['Thời gian', 'Họ tên', 'CCCD/CMND', 'Chiều', 'Kết quả', 'Lý do chặn', 'Bảo vệ'],
    logs.rows.map((l) => [
      VI_DATETIME(l.logged_at), l.full_name ?? '', l.id_number ?? '',
      l.direction === 'in' ? 'Vào' : 'Ra',
      l.result === 'allowed' ? 'Cho vào' : 'Chặn', l.block_reason ?? '', l.guard_name ?? '',
    ]), [20, 22, 16, 10, 12, 40, 20])

  await audit(req.user!, 'CONTRACT_REPORT_EXPORT', 'contract', id, null,
    { contract_no: ct.contract_no, workers: workers.length }, clientIp(req))

  const buf = await wb.xlsx.writeBuffer()
  const fname = sanitizeFileName(`HoSoATLD_${ct.contract_no}_${new Date().toISOString().slice(0, 10)}.xlsx`)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`)
  res.send(Buffer.from(buf))
})

// ═══════════════ NGƯỜI LAO ĐỘNG ═══════════════
// Ma trận điều kiện (Phase D):
//  - applies_to: danh sách từ khóa chức danh (phân tách bằng dấu phẩy). Rỗng = áp dụng mọi chức danh.
//  - risk_level: hồ sơ chỉ bắt buộc khi rủi ro hợp đồng ≥ mức này. Rỗng = luôn bắt buộc.
const RISK_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 }
function titleMatches(appliesTo: string | null, jobTitle: string | null): boolean {
  const rule = String(appliesTo ?? '').trim()
  if (!rule) return true
  const jt = String(jobTitle ?? '').toLowerCase()
  return rule.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).some((kw) => jt.includes(kw))
}
function riskApplies(docRisk: string | null, contractRisk: string): boolean {
  const need = RISK_RANK[String(docRisk ?? '').trim()] ?? 0
  return need === 0 || (RISK_RANK[contractRisk] ?? 2) >= need
}

// Engine R1: NLĐ đủ điều kiện vào cổng khi mọi hồ sơ BẮT BUỘC ÁP DỤNG (theo ma trận)
// đều APPROVED và chưa hết hạn. Trả về { ok, missing[] }.
async function evalWorkerEligibility(workerId: number): Promise<{ ok: boolean; missing: string[] }> {
  const w = await query<{ job_title: string | null }>(
    `SELECT job_title FROM atld.hse_workers WHERE id = $1`, [workerId])
  const jobTitle = w.rows[0]?.job_title ?? null
  // Mức rủi ro cao nhất trong các hợp đồng NLĐ tham gia (mặc định 'medium' nếu chưa gán).
  const cr = await query<{ risk_level: string }>(
    `SELECT c.risk_level FROM atld.hse_contract_workers cw
     JOIN atld.hse_contracts c ON c.id = cw.contract_id WHERE cw.worker_id = $1`, [workerId])
  const contractRisk = cr.rows.reduce((m, r) => (RISK_RANK[r.risk_level] ?? 2) > (RISK_RANK[m] ?? 2) ? r.risk_level : m, 'low')
  const all = await query<{ id: number; name: string; applies_to: string | null; risk_level: string | null }>(
    `SELECT id, name, applies_to, risk_level FROM atld.hse_doc_types
     WHERE scope = 'worker' AND is_mandatory = true AND is_active = true`)
  // Chỉ giữ hồ sơ áp dụng cho chức danh & mức rủi ro này.
  const mandatory = { rows: all.rows.filter((dt) => titleMatches(dt.applies_to, jobTitle) && riskApplies(dt.risk_level, contractRisk)) }
  const docs = await query<{ doc_type_id: number; status: string; expiry_date: string | null }>(
    `SELECT doc_type_id, status, expiry_date FROM atld.hse_worker_docs WHERE worker_id = $1`, [workerId])
  const missing: string[] = []
  // So sánh phần ngày (slice) để tránh lệch do pg trả date kèm timestamp/timezone.
  const today = new Date().toISOString().slice(0, 10)
  const dateOf = (d: string | null) => (d ? String(d).slice(0, 10) : null)
  for (const dt of mandatory.rows) {
    const match = docs.rows.filter((d) => d.doc_type_id === dt.id)
    const valid = match.find((d) => d.status === 'approved' && (!dateOf(d.expiry_date) || dateOf(d.expiry_date)! >= today))
    if (!valid) {
      const expired = match.find((d) => d.status === 'approved' && dateOf(d.expiry_date) && dateOf(d.expiry_date)! < today)
      const pending = match.find((d) => d.status === 'pending')
      const rejected = match.find((d) => d.status === 'rejected')
      missing.push(
        expired ? `${dt.name} (hết hạn ${dateOf(expired.expiry_date)})`
        : pending ? `${dt.name} (đã nộp, chờ duyệt)`
        : rejected ? `${dt.name} (bị từ chối, cần nộp lại)`
        : `${dt.name} (chưa nộp)`,
      )
    }
  }
  return { ok: missing.length === 0, missing }
}

// Engine tương tự cho THIẾT BỊ: đủ điều kiện khi mọi hồ sơ bắt buộc (scope=equipment)
// đều approved và chưa hết hạn.
async function evalEquipmentEligibility(equipmentId: number): Promise<{ ok: boolean; missing: string[] }> {
  const mandatory = await query<{ id: number; name: string }>(
    `SELECT id, name FROM atld.hse_doc_types WHERE scope = 'equipment' AND is_mandatory = true AND is_active = true`)
  const docs = await query<{ doc_type_id: number; status: string; expiry_date: string | null }>(
    `SELECT doc_type_id, status, expiry_date FROM atld.hse_equipment_docs WHERE equipment_id = $1`, [equipmentId])
  const missing: string[] = []
  const today = new Date().toISOString().slice(0, 10)
  const dateOf = (d: string | null) => (d ? String(d).slice(0, 10) : null)
  for (const dt of mandatory.rows) {
    const match = docs.rows.filter((d) => d.doc_type_id === dt.id)
    const valid = match.find((d) => d.status === 'approved' && (!dateOf(d.expiry_date) || dateOf(d.expiry_date)! >= today))
    if (!valid) {
      const expired = match.find((d) => d.status === 'approved' && dateOf(d.expiry_date) && dateOf(d.expiry_date)! < today)
      const pending = match.find((d) => d.status === 'pending')
      const rejected = match.find((d) => d.status === 'rejected')
      missing.push(
        expired ? `${dt.name} (hết hạn ${dateOf(expired.expiry_date)})`
        : pending ? `${dt.name} (đã nộp, chờ duyệt)`
        : rejected ? `${dt.name} (bị từ chối, cần nộp lại)`
        : `${dt.name} (chưa nộp)`)
    }
  }
  return { ok: missing.length === 0, missing }
}

async function syncEquipmentAccess(equipmentId: number): Promise<string> {
  const cur = await query<{ access_status: string }>(
    `SELECT access_status FROM atld.hse_equipments WHERE id = $1`, [equipmentId])
  if (cur.rows[0]?.access_status === 'suspended') return 'suspended'
  const { ok } = await evalEquipmentEligibility(equipmentId)
  const next = ok ? 'allowed' : 'blocked'
  await query(`UPDATE atld.hse_equipments SET access_status = $1, updated_at = now() WHERE id = $2`, [next, equipmentId])
  return next
}

// Đồng bộ access_status theo hồ sơ (không hạ cấp khi đang bị đình chỉ).
async function syncWorkerAccess(workerId: number): Promise<string> {
  const cur = await query<{ access_status: string }>(
    `SELECT access_status FROM atld.hse_workers WHERE id = $1`, [workerId])
  if (cur.rows[0]?.access_status === 'suspended') return 'suspended'
  const { ok } = await evalWorkerEligibility(workerId)
  const next = ok ? 'allowed' : 'blocked'
  await query(`UPDATE atld.hse_workers SET access_status = $1, updated_at = now() WHERE id = $2`, [next, workerId])
  return next
}

hseRouter.get('/workers', requireAuth, async (req, res) => {
  const contractorId = req.query.contractorId ? Number(req.query.contractorId) : null
  const q = String(req.query.q ?? '').trim()
  const { all, siteId } = siteScope(req.user!)
  // Officer chỉ thấy NLĐ có tham gia ít nhất 1 hợp đồng thuộc site mình phụ trách.
  const r = await query(
    `SELECT w.id, w.full_name, w.id_number, w.job_title, w.phone, w.access_status, w.contractor_id,
            ct.name AS contractor_name
     FROM atld.hse_workers w
     JOIN atld.hse_contractors ct ON ct.id = w.contractor_id
     WHERE ($1::int IS NULL OR w.contractor_id = $1)
       AND ($2 = '' OR w.full_name ILIKE $3 OR w.id_number ILIKE $3)
       AND ($4::boolean OR EXISTS (
         SELECT 1 FROM atld.hse_contract_workers cw
         JOIN atld.hse_contracts c ON c.id = cw.contract_id
         WHERE cw.worker_id = w.id AND c.site_id = $5))
     ORDER BY w.full_name`,
    [contractorId, q, `%${q}%`, all, siteId],
  )
  res.json({ workers: r.rows })
})

hseRouter.post('/workers', ...canInspect, async (req, res) => {
  const b = req.body ?? {}
  const contractorId = Number(b.contractor_id)
  const fullName = escapeText(String(b.full_name ?? '').trim())
  if (!contractorId || !fullName)
    return res.status(400).json({ error: 'Nhà thầu và họ tên là bắt buộc.' })
  const r = await query<{ id: number }>(
    `INSERT INTO atld.hse_workers (contractor_id, full_name, id_number, birth_date, job_title, phone)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [contractorId, fullName, escapeText(String(b.id_number ?? '')), b.birth_date || null,
     escapeText(String(b.job_title ?? '')), escapeText(String(b.phone ?? ''))],
  )
  await audit(req.user!, 'WORKER_CREATE', 'worker', r.rows[0]!.id, null, { fullName }, clientIp(req))
  res.status(201).json({ id: r.rows[0]!.id })
})

hseRouter.get('/workers/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const w = await query(`SELECT * FROM atld.hse_workers WHERE id = $1`, [id])
  if (!w.rows[0]) return res.status(404).json({ error: 'Không tìm thấy người lao động.' })
  const docs = await query(
    `SELECT d.id, d.doc_type_id, dt.name AS doc_type_name, d.file_name, d.stored_name,
            d.expiry_date, d.status, d.reviewer_note
     FROM atld.hse_worker_docs d JOIN atld.hse_doc_types dt ON dt.id = d.doc_type_id
     WHERE d.worker_id = $1 ORDER BY dt.sort_order`, [id])
  const eligibility = await evalWorkerEligibility(id)
  res.json({ worker: w.rows[0], docs: docs.rows, eligibility })
})

// Xem / tải file hồ sơ NLĐ
hseRouter.get('/worker-docs/:id/file', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const r = await query<{ file_name: string; stored_name: string }>(
    `SELECT file_name, stored_name FROM atld.hse_worker_docs WHERE id = $1`, [id])
  if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy tệp.' })
  const filePath = path.join(UPLOAD_DIR, r.rows[0].stored_name)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Tệp không còn trên máy chủ.' })
  res.download(filePath, r.rows[0].file_name)
})
// Upload hồ sơ NLĐ
hseRouter.post('/workers/:id/docs', ...canInspect, upload.single('file'), async (req, res) => {
  const workerId = Number(req.params.id)
  const docTypeId = Number(req.body.doc_type_id)
  if (!req.file) return res.status(400).json({ error: 'Chưa chọn tệp.' })
  if (!docTypeId) return res.status(400).json({ error: 'Thiếu loại hồ sơ.' })
  const r = await query<{ id: number }>(
    `INSERT INTO atld.hse_worker_docs (worker_id, doc_type_id, file_name, stored_name, expiry_date, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [workerId, docTypeId, sanitizeFileName(req.file.originalname), req.file.filename,
     req.body.expiry_date || null, req.user!.id],
  )
  await audit(req.user!, 'WORKER_DOC_UPLOAD', 'worker_doc', r.rows[0]!.id, null, { workerId, docTypeId }, clientIp(req))
  await syncWorkerAccess(workerId)
  res.status(201).json({ id: r.rows[0]!.id })
})

// Duyệt / từ chối hồ sơ NLĐ → đồng bộ access
hseRouter.patch('/worker-docs/:id', ...canInspect, async (req, res) => {
  const id = Number(req.params.id)
  const status = String(req.body.status ?? '')
  if (!['pending', 'approved', 'rejected'].includes(status))
    return res.status(400).json({ error: 'Trạng thái không hợp lệ.' })
  const cur = await query<{ worker_id: number; status: string }>(
    `SELECT worker_id, status FROM atld.hse_worker_docs WHERE id = $1`, [id])
  if (!cur.rows[0]) return res.status(404).json({ error: 'Không tìm thấy hồ sơ.' })
  await query(`UPDATE atld.hse_worker_docs SET status = $1, reviewer_note = $2 WHERE id = $3`,
    [status, escapeText(String(req.body.reviewer_note ?? '')), id])
  await audit(req.user!, 'WORKER_DOC_REVIEW', 'worker_doc', id,
    { status: cur.rows[0].status }, { status }, clientIp(req))
  const next = await syncWorkerAccess(cur.rows[0].worker_id)
  res.json({ ok: true, access_status: next })
})

// ═══════════════ CỔNG KIỂM SOÁT (R1) ═══════════════
// Tra cứu nhanh: bảo vệ nhập tên/CCCD → biết cho vào hay chặn.
hseRouter.get('/gate/lookup', requireAuth, async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  if (!q) return res.json({ results: [] })
  const workers = await query<{ id: number; full_name: string; id_number: string | null; access_status: string; contractor_name: string; presence: string; last_in_at: string | null; last_out_at: string | null }>(
    `SELECT w.id, w.full_name, w.id_number, w.access_status, w.presence, w.last_in_at, w.last_out_at,
            ct.name AS contractor_name
     FROM atld.hse_workers w JOIN atld.hse_contractors ct ON ct.id = w.contractor_id
     WHERE w.full_name ILIKE $1 OR w.id_number ILIKE $1 ORDER BY w.full_name LIMIT 20`,
    [`%${q}%`],
  )
  const results = []
  for (const w of workers.rows) {
    const elig = await evalWorkerEligibility(w.id)
    results.push({ ...w, eligible: w.access_status !== 'suspended' && elig.ok, reasons: elig.missing,
      suspended: w.access_status === 'suspended' })
  }
  res.json({ results })
})

// Ghi log vào/ra + kết quả cho phép/chặn + cập nhật trạng thái hiện diện
hseRouter.post('/gate/log', ...canGate, async (req, res) => {
  const workerId = Number(req.body.worker_id)
  const direction = String(req.body.direction ?? 'in')
  if (!workerId || !['in', 'out'].includes(direction))
    return res.status(400).json({ error: 'Thiếu người lao động hoặc chiều vào/ra.' })
  const w = await query<{ access_status: string; presence: string }>(
    `SELECT access_status, presence FROM atld.hse_workers WHERE id = $1`, [workerId])
  if (!w.rows[0]) return res.status(404).json({ error: 'Không tìm thấy người lao động.' })
  const elig = await evalWorkerEligibility(workerId)
  const suspended = w.rows[0].access_status === 'suspended'
  const allowed = direction === 'out' || (!suspended && elig.ok)
  const reason = allowed ? null
    : suspended ? 'Đang bị đình chỉ' : `Thiếu hồ sơ: ${elig.missing.join('; ')}`
  const contract = await query<{ contract_id: number }>(
    `SELECT contract_id FROM atld.hse_contract_workers WHERE worker_id = $1 LIMIT 1`, [workerId])
  const logged = await query<{ logged_at: string }>(
    `INSERT INTO atld.hse_access_logs (worker_id, contract_id, guard_id, direction, result, block_reason)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING logged_at`,
    [workerId, contract.rows[0]?.contract_id ?? null, req.user!.id, direction,
     allowed ? 'allowed' : 'blocked', reason],
  )
  // Chỉ cập nhật trạng thái hiện diện khi thực sự cho qua cổng.
  let presence = w.rows[0].presence
  if (allowed) {
    presence = direction === 'in' ? 'in' : 'out'
    const col = direction === 'in' ? 'last_in_at' : 'last_out_at'
    await query(
      `UPDATE atld.hse_workers SET presence = $1, ${col} = now(), updated_at = now() WHERE id = $2`,
      [presence, workerId])
  }
  res.json({ allowed, reason, presence, logged_at: logged.rows[0]?.logged_at ?? null })
})

// Lịch sử vào/ra: theo hợp đồng, NLĐ, hoặc gần đây nhất
hseRouter.get('/gate/logs', requireAuth, async (req, res) => {
  const contractId = req.query.contractId ? Number(req.query.contractId) : null
  const workerId = req.query.workerId ? Number(req.query.workerId) : null
  const { all, siteId } = siteScope(req.user!)
  const r = await query(
    `SELECT l.id, l.worker_id, w.full_name, w.id_number, l.direction, l.result,
            l.block_reason, l.logged_at, ct.name AS contractor_name,
            g.full_name AS guard_name
     FROM atld.hse_access_logs l
     LEFT JOIN atld.hse_workers w ON w.id = l.worker_id
     LEFT JOIN atld.hse_contractors ct ON ct.id = w.contractor_id
     LEFT JOIN atld.hse_contracts c ON c.id = l.contract_id
     LEFT JOIN atld.users g ON g.id = l.guard_id
     WHERE ($1::int IS NULL OR l.contract_id = $1)
       AND ($2::int IS NULL OR l.worker_id = $2)
       AND ($3::boolean OR c.site_id = $4)
     ORDER BY l.logged_at DESC LIMIT 200`,
    [contractId, workerId, all, siteId],
  )
  res.json({ logs: r.rows })
})

// Lịch sử vào/ra hợp nhất NLĐ + khách/NCC cho bảo vệ theo dõi tại cổng.
hseRouter.get('/gate/history', requireAuth, async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
  const { all, siteId } = siteScope(req.user!)
  // NLĐ lọc theo site hợp đồng; khách/NCC lọc theo site của khách.
  const r = await query(
    `SELECT * FROM (
       SELECT 'worker' AS kind, l.id, w.full_name AS name, w.id_number, ct.name AS org,
              l.direction, l.result, l.block_reason, l.logged_at, g.full_name AS guard_name
       FROM atld.hse_access_logs l
       LEFT JOIN atld.hse_workers w ON w.id = l.worker_id
       LEFT JOIN atld.hse_contractors ct ON ct.id = w.contractor_id
       LEFT JOIN atld.hse_contracts c ON c.id = l.contract_id
       LEFT JOIN atld.users g ON g.id = l.guard_id
       WHERE ($2::boolean OR c.site_id = $3)
       UNION ALL
       SELECT 'visitor' AS kind, vl.id, v.full_name, v.id_number, v.org_name,
              vl.direction, vl.result, vl.block_reason, vl.logged_at, g.full_name
       FROM atld.hse_visitor_logs vl
       LEFT JOIN atld.hse_visitors v ON v.id = vl.visitor_id
       LEFT JOIN atld.users g ON g.id = vl.guard_id
       WHERE ($2::boolean OR v.site_id = $3)
     ) x ORDER BY logged_at DESC LIMIT $1`, [limit, all, siteId])
  res.json({ history: r.rows })
})
// ═══════════════ KIỂM TRA ATMT (BM111-07.03 / 07.04) ═══════════════
hseRouter.get('/inspections', requireAuth, async (req, res) => {
  const contractId = req.query.contractId ? Number(req.query.contractId) : null
  const { all, siteId } = siteScope(req.user!)
  const r = await query(
    `SELECT i.id, i.contract_id, i.form_type,
            COALESCE(i.inspection_date, i.scheduled_date, i.conducted_at::date) AS inspection_date,
            COALESCE(i.inspector_name, u.full_name, '') AS inspector_name,
            i.overall_result, i.suspension_required,
            i.overall_note AS note,
            c.contract_no, c.title AS contract_title
     FROM atld.hse_inspections i
     JOIN atld.hse_contracts c ON c.id = i.contract_id
     LEFT JOIN atld.users u ON u.id = i.inspector_id
     WHERE ($1::int IS NULL OR i.contract_id = $1)
       AND ($2::boolean OR c.site_id = $3)
     ORDER BY COALESCE(i.inspection_date, i.scheduled_date, i.conducted_at::date) DESC NULLS LAST, i.id DESC`,
    [contractId, all, siteId],
  )
  res.json({ inspections: r.rows })
})

hseRouter.get('/inspections/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const insp = await query(
    `SELECT i.id, i.contract_id, i.form_type,
            COALESCE(i.inspection_date, i.scheduled_date, i.conducted_at::date) AS inspection_date,
            COALESCE(i.inspector_name, u.full_name, '') AS inspector_name,
            i.overall_result, i.suspension_required,
            i.overall_note AS note
     FROM atld.hse_inspections i
     LEFT JOIN atld.users u ON u.id = i.inspector_id
     WHERE i.id = $1`, [id])
  if (!insp.rows[0]) return res.status(404).json({ error: 'Không tìm thấy phiếu kiểm tra.' })
  const items = await query(
    `SELECT id, inspection_id,
            COALESCE(item_code, '') AS item_code,
            COALESCE(item_name, description, '') AS item_name,
            COALESCE(category, '') AS category,
            result, note, requires_suspension
     FROM atld.hse_inspection_items WHERE inspection_id = $1 ORDER BY id`, [id])
  res.json({ inspection: insp.rows[0], items: items.rows })
})

hseRouter.post('/inspections', ...canInspect, async (req, res) => {
  const b = req.body ?? {}
  const contractId = Number(b.contract_id)
  const formType = String(b.form_type ?? '')
  const allowed = ['BM03_INITIAL', 'BM03_MONTHLY', 'BM03_WEEKLY', 'BM04_DAILY']
  if (!contractId || !allowed.includes(formType))
    return res.status(400).json({ error: 'Thiếu hợp đồng hoặc loại phiếu không hợp lệ.' })
  const items = Array.isArray(b.items) ? b.items : []
  // Tính overall_result và suspension_required từ danh sách hạng mục
  const hasFail = items.some((it: { result?: string }) => it.result === 'fail')
  const hasPass = items.some((it: { result?: string }) => it.result === 'pass')
  const overallResult = hasFail && hasPass ? 'partial' : hasFail ? 'fail' : 'pass'
  const suspReq = items.some((it: { requires_suspension?: boolean }) => !!it.requires_suspension)
  const r = await query<{ id: number }>(
    `INSERT INTO atld.hse_inspections
       (contract_id, inspector_id, inspector_name, form_type,
        inspection_date, scheduled_date, conducted_at, status,
        overall_result, suspension_required, overall_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [contractId, req.user!.id, escapeText(String(b.inspector_name ?? '')),
     formType, b.inspection_date || null, b.inspection_date || null, null,
     'completed', overallResult, suspReq, escapeText(String(b.note ?? b.overall_note ?? ''))],
  )
  for (const it of items) {
    await query(
      `INSERT INTO atld.hse_inspection_items
         (inspection_id, item_code, item_name, category, description, result, note, requires_suspension)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [r.rows[0]!.id,
       escapeText(String(it.item_code ?? '')), escapeText(String(it.item_name ?? '')),
       escapeText(String(it.category ?? '')), escapeText(String(it.item_name ?? '')),
       it.result || null, escapeText(String(it.note ?? '')), !!it.requires_suspension],
    )
  }
  await audit(req.user!, 'INSPECTION_CREATE', 'inspection', r.rows[0]!.id, null, { contractId, formType }, clientIp(req))
  res.status(201).json({ id: r.rows[0]!.id })
})

// ═══════════════ ĐÌNH CHỈ CÔNG VIỆC (R6 — chặn tức thì) ═══════════════
hseRouter.get('/suspensions', requireAuth, async (req, res) => {
  const contractId = req.query.contractId ? Number(req.query.contractId) : null
  const status = req.query.status ? String(req.query.status) : null
  const { all, siteId } = siteScope(req.user!)
  const r = await query(
    `SELECT s.*, s.created_at AS issued_at,
            c.contract_no, c.title AS contract_title,
            ct.name AS contractor_name,
            iu.full_name AS issued_by_name,
            lu.full_name AS lifted_by_name
     FROM atld.hse_suspensions s
     JOIN atld.hse_contracts c ON c.id = s.contract_id
     LEFT JOIN atld.hse_contractors ct ON ct.id = c.contractor_id
     LEFT JOIN atld.users iu ON iu.id = s.issued_by
     LEFT JOIN atld.users lu ON lu.id = s.lifted_by
     WHERE ($1::int IS NULL OR s.contract_id = $1)
       AND ($2::text IS NULL OR s.status = $2)
       AND ($3::boolean OR c.site_id = $4)
     ORDER BY s.created_at DESC`,
    [contractId, status, all, siteId],
  )
  res.json({ suspensions: r.rows })
})

hseRouter.post('/suspensions', ...canApprove, async (req, res) => {
  const b = req.body ?? {}
  const contractId = Number(b.contract_id)
  const reason = escapeText(String(b.reason ?? '').trim())
  const scope = escapeText(String(b.scope ?? '').trim())
  if (!contractId || !reason || !scope)
    return res.status(400).json({ error: 'Thiếu hợp đồng, lý do hoặc phạm vi đình chỉ.' })
  const r = await query<{ id: number }>(
    `INSERT INTO atld.hse_suspensions (contract_id, inspection_id, issued_by, reason, scope)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [contractId, b.inspection_id ? Number(b.inspection_id) : null, req.user!.id, reason, scope],
  )
  // Chặn tức thì mọi NLĐ thuộc hợp đồng
  await query(
    `UPDATE atld.hse_workers SET access_status = 'suspended', updated_at = now()
     WHERE id IN (SELECT worker_id FROM atld.hse_contract_workers WHERE contract_id = $1)`,
    [contractId],
  )
  await audit(req.user!, 'SUSPENSION_ISSUE', 'suspension', r.rows[0]!.id, null, { contractId, reason }, clientIp(req))
  res.status(201).json({ id: r.rows[0]!.id })
})

// Gỡ đình chỉ → khôi phục access theo hồ sơ
hseRouter.patch('/suspensions/:id/lift', ...canApprove, async (req, res) => {
  const id = Number(req.params.id)
  const cur = await query<{ contract_id: number; status: string }>(
    `SELECT contract_id, status FROM atld.hse_suspensions WHERE id = $1`, [id])
  if (!cur.rows[0]) return res.status(404).json({ error: 'Không tìm thấy lệnh đình chỉ.' })
  await query(
    `UPDATE atld.hse_suspensions SET status = 'lifted', lifted_by = $1, lifted_at = now(), lift_note = $2, updated_at = now()
     WHERE id = $3`,
    [req.user!.id, escapeText(String(req.body.lift_note ?? '')), id],
  )
  // Đưa worker về 'blocked' trước, rồi sync lại theo hồ sơ
  const workers = await query<{ worker_id: number }>(
    `SELECT worker_id FROM atld.hse_contract_workers WHERE contract_id = $1`, [cur.rows[0].contract_id])
  for (const w of workers.rows) {
    await query(`UPDATE atld.hse_workers SET access_status = 'blocked' WHERE id = $1`, [w.worker_id])
    await syncWorkerAccess(w.worker_id)
  }
  await audit(req.user!, 'SUSPENSION_LIFT', 'suspension', id, { status: cur.rows[0].status }, { status: 'lifted' }, clientIp(req))
  res.json({ ok: true })
})

// ═══════════════ AUDIT LOG (chỉ đọc) ═══════════════
hseRouter.get('/audit', requireAuth, requireSection('an-toan'), async (req, res) => {
  const entity = String(req.query.entityType ?? '')
  const entityId = req.query.entityId ? Number(req.query.entityId) : null
  const r = await query(
    `SELECT a.id, a.actor_id, u.full_name AS actor_name, a.action, a.entity_type, a.entity_id,
            a.old_value, a.new_value, a.ip_address, a.created_at
     FROM atld.hse_audit_logs a LEFT JOIN atld.users u ON u.id = a.actor_id
     WHERE ($1 = '' OR a.entity_type = $1) AND ($2::int IS NULL OR a.entity_id = $2)
     ORDER BY a.created_at DESC LIMIT 200`,
    [entity, entityId],
  )
  res.json({ logs: r.rows })
})

// ═══════════════ THIẾT BỊ (Phase A) ═══════════════
hseRouter.get('/equipments', requireAuth, async (req, res) => {
  const contractorId = req.query.contractorId ? Number(req.query.contractorId) : null
  const q = String(req.query.q ?? '').trim()
  const { all, siteId } = siteScope(req.user!)
  const r = await query(
    `SELECT e.id, e.name, e.equipment_type, e.serial_no, e.access_status, e.contractor_id,
            ct.name AS contractor_name
     FROM atld.hse_equipments e JOIN atld.hse_contractors ct ON ct.id = e.contractor_id
     WHERE ($1::int IS NULL OR e.contractor_id = $1)
       AND ($2 = '' OR e.name ILIKE $3 OR e.serial_no ILIKE $3)
       AND ($4::boolean OR EXISTS (
         SELECT 1 FROM atld.hse_contract_equipments ce
         JOIN atld.hse_contracts c ON c.id = ce.contract_id
         WHERE ce.equipment_id = e.id AND c.site_id = $5))
     ORDER BY e.name`,
    [contractorId, q, `%${q}%`, all, siteId])
  res.json({ equipments: r.rows })
})

hseRouter.post('/equipments', ...canInspect, async (req, res) => {
  const b = req.body ?? {}
  const contractorId = Number(b.contractor_id)
  const name = escapeText(String(b.name ?? '').trim())
  if (!contractorId || !name) return res.status(400).json({ error: 'Nhà thầu và tên thiết bị là bắt buộc.' })
  const r = await query<{ id: number }>(
    `INSERT INTO atld.hse_equipments (contractor_id, name, equipment_type, serial_no, note)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [contractorId, name, escapeText(String(b.equipment_type ?? '')),
     escapeText(String(b.serial_no ?? '')), escapeText(String(b.note ?? ''))])
  await audit(req.user!, 'EQUIPMENT_CREATE', 'equipment', r.rows[0]!.id, null, { name }, clientIp(req))
  res.status(201).json({ id: r.rows[0]!.id })
})

hseRouter.get('/equipments/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const e = await query(`SELECT * FROM atld.hse_equipments WHERE id = $1`, [id])
  if (!e.rows[0]) return res.status(404).json({ error: 'Không tìm thấy thiết bị.' })
  const docs = await query(
    `SELECT d.id, d.doc_type_id, dt.name AS doc_type_name, d.file_name, d.stored_name,
            d.expiry_date, d.status, d.reviewer_note
     FROM atld.hse_equipment_docs d JOIN atld.hse_doc_types dt ON dt.id = d.doc_type_id
     WHERE d.equipment_id = $1 ORDER BY dt.sort_order`, [id])
  const eligibility = await evalEquipmentEligibility(id)
  res.json({ equipment: e.rows[0], docs: docs.rows, eligibility })
})

hseRouter.get('/equipment-docs/:id/file', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const r = await query<{ file_name: string; stored_name: string }>(
    `SELECT file_name, stored_name FROM atld.hse_equipment_docs WHERE id = $1`, [id])
  if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy tệp.' })
  const filePath = path.join(UPLOAD_DIR, r.rows[0].stored_name)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Tệp không còn trên máy chủ.' })
  res.download(filePath, r.rows[0].file_name)
})

hseRouter.post('/equipments/:id/docs', ...canInspect, upload.single('file'), async (req, res) => {
  const equipmentId = Number(req.params.id)
  const docTypeId = Number(req.body.doc_type_id)
  if (!req.file) return res.status(400).json({ error: 'Chưa chọn tệp.' })
  if (!docTypeId) return res.status(400).json({ error: 'Thiếu loại hồ sơ.' })
  const r = await query<{ id: number }>(
    `INSERT INTO atld.hse_equipment_docs (equipment_id, doc_type_id, file_name, stored_name, expiry_date, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [equipmentId, docTypeId, sanitizeFileName(req.file.originalname), req.file.filename,
     req.body.expiry_date || null, req.user!.id])
  await audit(req.user!, 'EQUIPMENT_DOC_UPLOAD', 'equipment_doc', r.rows[0]!.id, null, { equipmentId, docTypeId }, clientIp(req))
  await syncEquipmentAccess(equipmentId)
  res.status(201).json({ id: r.rows[0]!.id })
})

hseRouter.patch('/equipment-docs/:id', ...canInspect, async (req, res) => {
  const id = Number(req.params.id)
  const status = String(req.body.status ?? '')
  if (!['pending', 'approved', 'rejected'].includes(status))
    return res.status(400).json({ error: 'Trạng thái không hợp lệ.' })
  const cur = await query<{ equipment_id: number; status: string }>(
    `SELECT equipment_id, status FROM atld.hse_equipment_docs WHERE id = $1`, [id])
  if (!cur.rows[0]) return res.status(404).json({ error: 'Không tìm thấy hồ sơ.' })
  await query(`UPDATE atld.hse_equipment_docs SET status = $1, reviewer_note = $2 WHERE id = $3`,
    [status, escapeText(String(req.body.reviewer_note ?? '')), id])
  await audit(req.user!, 'EQUIPMENT_DOC_REVIEW', 'equipment_doc', id,
    { status: cur.rows[0].status }, { status }, clientIp(req))
  const next = await syncEquipmentAccess(cur.rows[0].equipment_id)
  res.json({ ok: true, access_status: next })
})

// ═══════════════ ĐÁNH GIÁ HỒ SƠ NHÀ THẦU (BM111-07.02, Phase B) ═══════════════
// Mỗi hợp đồng có 1 dossier. Trả về dossier + checklist các nhóm hồ sơ nhà thầu.
hseRouter.get('/contracts/:id/dossier', requireAuth, async (req, res) => {
  const contractId = Number(req.params.id)
  const c = await query(`SELECT id FROM atld.hse_contracts WHERE id = $1`, [contractId])
  if (!c.rows[0]) return res.status(404).json({ error: 'Không tìm thấy hợp đồng.' })
  let d = await query(
    `SELECT id, status, submitted_at, reviewed_by, reviewed_at, approved_by, approved_at, review_note
     FROM atld.hse_dossiers WHERE contract_id = $1`, [contractId])
  if (!d.rows[0]) {
    const ins = await query<{ id: number }>(
      `INSERT INTO atld.hse_dossiers (contract_id) VALUES ($1) RETURNING id`, [contractId])
    d = await query(
      `SELECT id, status, submitted_at, reviewed_by, reviewed_at, approved_by, approved_at, review_note
       FROM atld.hse_dossiers WHERE id = $1`, [ins.rows[0]!.id])
  }
  const dossierId = (d.rows[0] as { id: number }).id
  const docTypes = await query(
    `SELECT id, code, name, group_name, is_mandatory, warn_days_before, sort_order
     FROM atld.hse_doc_types WHERE scope = 'contractor' AND is_active = true ORDER BY sort_order, name`)
  const docs = await query(
    `SELECT id, doc_type_id, file_name, stored_name, expiry_date, status, reviewer_note, uploaded_at
     FROM atld.hse_contractor_docs WHERE dossier_id = $1 ORDER BY uploaded_at DESC`, [dossierId])
  // Tổng hợp trạng thái đầy đủ theo nhóm bắt buộc.
  const today = new Date().toISOString().slice(0, 10)
  const dateOf = (x: string | null) => (x ? String(x).slice(0, 10) : null)
  const missing: string[] = []
  for (const dt of docTypes.rows as { id: number; name: string; is_mandatory: boolean }[]) {
    if (!dt.is_mandatory) continue
    const match = (docs.rows as { doc_type_id: number; status: string; expiry_date: string | null }[])
      .filter((x) => x.doc_type_id === dt.id)
    const valid = match.find((x) => x.status === 'approved' && (!dateOf(x.expiry_date) || dateOf(x.expiry_date)! >= today))
    if (!valid) missing.push(dt.name)
  }
  res.json({ dossier: d.rows[0], docTypes: docTypes.rows, docs: docs.rows,
    completeness: { ok: missing.length === 0, missing } })
})

hseRouter.post('/dossiers/:id/docs', ...canInspect, upload.single('file'), async (req, res) => {
  const dossierId = Number(req.params.id)
  const docTypeId = Number(req.body.doc_type_id)
  if (!req.file) return res.status(400).json({ error: 'Chưa chọn tệp.' })
  if (!docTypeId) return res.status(400).json({ error: 'Thiếu loại hồ sơ.' })
  const r = await query<{ id: number }>(
    `INSERT INTO atld.hse_contractor_docs (dossier_id, doc_type_id, file_name, stored_name, expiry_date, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [dossierId, docTypeId, sanitizeFileName(req.file.originalname), req.file.filename,
     req.body.expiry_date || null, req.user!.id])
  await audit(req.user!, 'DOSSIER_DOC_UPLOAD', 'contractor_doc', r.rows[0]!.id, null, { dossierId, docTypeId }, clientIp(req))
  res.status(201).json({ id: r.rows[0]!.id })
})

hseRouter.get('/contractor-docs/:id/file', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const r = await query<{ file_name: string; stored_name: string }>(
    `SELECT file_name, stored_name FROM atld.hse_contractor_docs WHERE id = $1`, [id])
  if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy tệp.' })
  const filePath = path.join(UPLOAD_DIR, r.rows[0].stored_name)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Tệp không còn trên máy chủ.' })
  res.download(filePath, r.rows[0].file_name)
})

hseRouter.patch('/contractor-docs/:id', ...canInspect, async (req, res) => {
  const id = Number(req.params.id)
  const status = String(req.body.status ?? '')
  if (!['pending', 'approved', 'rejected'].includes(status))
    return res.status(400).json({ error: 'Trạng thái không hợp lệ.' })
  const cur = await query<{ status: string }>(`SELECT status FROM atld.hse_contractor_docs WHERE id = $1`, [id])
  if (!cur.rows[0]) return res.status(404).json({ error: 'Không tìm thấy hồ sơ.' })
  await query(`UPDATE atld.hse_contractor_docs SET status = $1, reviewer_note = $2 WHERE id = $3`,
    [status, escapeText(String(req.body.reviewer_note ?? '')), id])
  await audit(req.user!, 'DOSSIER_DOC_REVIEW', 'contractor_doc', id, { status: cur.rows[0].status }, { status }, clientIp(req))
  res.json({ ok: true })
})

// Chuyển trạng thái dossier: submitted (nộp) / approved (duyệt) / rejected (từ chối).
hseRouter.patch('/dossiers/:id/status', ...canInspect, async (req, res) => {
  const id = Number(req.params.id)
  const status = String(req.body.status ?? '')
  if (!['draft', 'submitted', 'approved', 'rejected'].includes(status))
    return res.status(400).json({ error: 'Trạng thái không hợp lệ.' })
  const note = escapeText(String(req.body.review_note ?? ''))
  // approved/rejected cần quyền phê duyệt.
  if ((status === 'approved' || status === 'rejected') &&
      !(req.user!.role === 'admin' || req.user!.permissions.includes('an-toan') || req.user!.permissions.includes('an-toan:approve')))
    return res.status(403).json({ error: 'Cần quyền phê duyệt để duyệt/từ chối hồ sơ.' })
  const sets = status === 'submitted' ? `status = $1, submitted_at = now(), review_note = $2`
    : status === 'approved' ? `status = $1, approved_by = ${req.user!.id}, approved_at = now(), review_note = $2`
    : status === 'rejected' ? `status = $1, reviewed_by = ${req.user!.id}, reviewed_at = now(), review_note = $2`
    : `status = $1, review_note = $2`
  await query(`UPDATE atld.hse_dossiers SET ${sets}, updated_at = now() WHERE id = $3`, [status, note, id])
  await audit(req.user!, 'DOSSIER_STATUS', 'dossier', id, null, { status }, clientIp(req))
  res.json({ ok: true })
})

// ═══════════════ BẢN CAM KẾT ĐIỆN TỬ (BM111-07.01, Phase C) ═══════════════
const DEFAULT_COMMITMENT = `Chúng tôi, nhà thầu thi công tại công trường Công ty CP Xi măng Vicem Hà Tiên, cam kết:
1. Chấp hành đầy đủ nội quy, quy định về An toàn - Vệ sinh lao động, Phòng cháy chữa cháy và Bảo vệ môi trường (ATVSLĐ-PCCN-BVMT) của Công ty.
2. Trang bị đầy đủ phương tiện bảo vệ cá nhân cho người lao động; chỉ bố trí lao động đã được huấn luyện an toàn và đủ sức khỏe.
3. Bố trí cán bộ giám sát an toàn tại hiện trường trong suốt quá trình thi công.
4. Thực hiện đánh giá rủi ro, biện pháp thi công an toàn trước khi triển khai công việc.
5. Báo cáo ngay mọi sự cố, tai nạn, nguy cơ mất an toàn cho bộ phận ATMT của Công ty.
6. Chịu hoàn toàn trách nhiệm và bồi thường thiệt hại do vi phạm quy định ATVSLĐ-PCCN-BVMT gây ra.`

hseRouter.get('/commitments', requireAuth, async (req, res) => {
  const contractId = req.query.contractId ? Number(req.query.contractId) : null
  const { all, siteId } = siteScope(req.user!)
  const r = await query(
    `SELECT cm.id, cm.contract_id, cm.title, cm.signer_name, cm.signer_title, cm.status,
            cm.signed_at, cm.created_at, c.contract_no, c.title AS contract_title, ct.name AS contractor_name
     FROM atld.hse_commitments cm
     JOIN atld.hse_contracts c ON c.id = cm.contract_id
     LEFT JOIN atld.hse_contractors ct ON ct.id = c.contractor_id
     WHERE ($1::int IS NULL OR cm.contract_id = $1)
       AND ($2::boolean OR c.site_id = $3)
     ORDER BY cm.created_at DESC`, [contractId, all, siteId])
  res.json({ commitments: r.rows })
})

hseRouter.get('/commitments/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id)
  const r = await query(
    `SELECT cm.*, c.contract_no, c.title AS contract_title, c.work_location,
            ct.name AS contractor_name, ct.rep_name, ct.rep_title
     FROM atld.hse_commitments cm
     JOIN atld.hse_contracts c ON c.id = cm.contract_id
     LEFT JOIN atld.hse_contractors ct ON ct.id = c.contractor_id
     WHERE cm.id = $1`, [id])
  if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy bản cam kết.' })
  res.json({ commitment: r.rows[0] })
})

hseRouter.post('/commitments', ...canInspect, async (req, res) => {
  const b = req.body ?? {}
  const contractId = Number(b.contract_id)
  if (!contractId) return res.status(400).json({ error: 'Thiếu hợp đồng.' })
  const content = escapeText(String(b.content ?? DEFAULT_COMMITMENT))
  const title = escapeText(String(b.title ?? 'Bản cam kết ATVSLĐ - PCCN - BVMT'))
  const r = await query<{ id: number }>(
    `INSERT INTO atld.hse_commitments (contract_id, title, content, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
    [contractId, title, content, req.user!.id])
  await audit(req.user!, 'COMMITMENT_CREATE', 'commitment', r.rows[0]!.id, null, { contractId }, clientIp(req))
  res.status(201).json({ id: r.rows[0]!.id })
})

hseRouter.patch('/commitments/:id', ...canInspect, async (req, res) => {
  const id = Number(req.params.id)
  const b = req.body ?? {}
  const cur = await query<{ status: string }>(`SELECT status FROM atld.hse_commitments WHERE id = $1`, [id])
  if (!cur.rows[0]) return res.status(404).json({ error: 'Không tìm thấy bản cam kết.' })
  if (cur.rows[0].status === 'signed') return res.status(409).json({ error: 'Bản cam kết đã ký, không thể sửa nội dung.' })
  const sets: string[] = []; const vals: unknown[] = []
  for (const f of ['title', 'content'] as const) {
    if (b[f] !== undefined) { sets.push(`${f} = $${sets.length + 1}`); vals.push(escapeText(String(b[f]))) }
  }
  if (!sets.length) return res.status(400).json({ error: 'Không có nội dung để cập nhật.' })
  vals.push(id)
  await query(`UPDATE atld.hse_commitments SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals)
  res.json({ ok: true })
})

// Ký cam kết: lưu chữ ký (dataURL PNG) + người ký. Chỉ lưu dataURL image/png hợp lệ.
hseRouter.patch('/commitments/:id/sign', ...canInspect, async (req, res) => {
  const id = Number(req.params.id)
  const b = req.body ?? {}
  const signerName = escapeText(String(b.signer_name ?? '').trim())
  const sig = String(b.signature_data ?? '')
  if (!signerName) return res.status(400).json({ error: 'Thiếu tên người ký.' })
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig) || sig.length > 500_000)
    return res.status(400).json({ error: 'Chữ ký không hợp lệ.' })
  const verifyCode = `ATLD|CMT|${id}|${crypto.randomUUID().slice(0, 8)}`
  await query(
    `UPDATE atld.hse_commitments SET signer_name = $1, signer_title = $2, signature_data = $3,
            signed_at = now(), status = 'signed', verify_code = $4, updated_at = now() WHERE id = $5`,
    [signerName, escapeText(String(b.signer_title ?? '')), sig, verifyCode, id])
  await audit(req.user!, 'COMMITMENT_SIGN', 'commitment', id, null, { signerName }, clientIp(req))
  res.json({ ok: true, verify_code: verifyCode })
})

// ═══════════════ MA TRẬN ĐIỀU KIỆN (Phase D) ═══════════════
// Xem trước hồ sơ bắt buộc theo (chức danh, mức rủi ro) — hỗ trợ cán bộ cấu hình.
hseRouter.get('/matrix/preview', requireAuth, async (req, res) => {
  const scope = ['worker', 'equipment', 'contractor'].includes(String(req.query.scope)) ? String(req.query.scope) : 'worker'
  const jobTitle = String(req.query.jobTitle ?? '')
  const risk = ['low', 'medium', 'high'].includes(String(req.query.risk)) ? String(req.query.risk) : 'medium'
  const all = await query<{ id: number; code: string; name: string; applies_to: string | null; risk_level: string | null; is_mandatory: boolean }>(
    `SELECT id, code, name, applies_to, risk_level, is_mandatory FROM atld.hse_doc_types
     WHERE scope = $1 AND is_active = true ORDER BY sort_order, name`, [scope])
  const rows = all.rows.map((dt) => ({
    ...dt,
    applies: dt.is_mandatory && titleMatches(dt.applies_to, jobTitle) && riskApplies(dt.risk_level, risk),
  }))
  res.json({ scope, jobTitle, risk, required: rows.filter((r) => r.applies), optional: rows.filter((r) => !r.applies), all: rows })
})

// ═══════════════ NCC & KHÁCH BÊN NGOÀI (Phase E) ═══════════════
hseRouter.get('/visitors', requireAuth, async (req, res) => {
  const kind = req.query.kind ? String(req.query.kind) : null
  const q = String(req.query.q ?? '').trim()
  const { all, siteId } = siteScope(req.user!)
  const r = await query(
    `SELECT v.id, v.kind, v.full_name, v.id_number, v.org_name, v.phone, v.purpose, v.host_name,
            v.valid_from, v.valid_to, v.access_status, v.presence, v.qr_code, v.last_in_at, v.last_out_at,
            v.site_id, s.name AS site_name
     FROM atld.hse_visitors v
     LEFT JOIN atld.branches s ON s.id = v.site_id
     WHERE ($1::text IS NULL OR v.kind = $1) AND ($2 = '' OR v.full_name ILIKE $3 OR v.org_name ILIKE $3)
       AND ($4::boolean OR v.site_id = $5)
     ORDER BY v.created_at DESC`, [kind, q, `%${q}%`, all, siteId])
  res.json({ visitors: r.rows })
})

hseRouter.post('/visitors', ...canInspect, async (req, res) => {
  const b = req.body ?? {}
  const fullName = escapeText(String(b.full_name ?? '').trim())
  const kind = ['guest', 'supplier', 'contractor_visitor', 'authority'].includes(String(b.kind)) ? String(b.kind) : 'guest'
  if (!fullName) return res.status(400).json({ error: 'Thiếu họ tên khách/NCC.' })
  const qrCode = `ATLD|VIS|${kind}|${crypto.randomUUID()}`
  // Site: admin chọn trong body; officer bị ép về site được phân công.
  const { all } = siteScope(req.user!)
  const siteId = all ? (b.site_id ? Number(b.site_id) : null) : req.user!.siteId
  const r = await query<{ id: number }>(
    `INSERT INTO atld.hse_visitors (kind, full_name, id_number, org_name, phone, purpose, host_name, valid_from, valid_to, qr_code, site_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [kind, fullName, escapeText(String(b.id_number ?? '')), escapeText(String(b.org_name ?? '')),
     escapeText(String(b.phone ?? '')), escapeText(String(b.purpose ?? '')), escapeText(String(b.host_name ?? '')),
     b.valid_from || null, b.valid_to || null, qrCode, siteId, req.user!.id])
  await audit(req.user!, 'VISITOR_CREATE', 'visitor', r.rows[0]!.id, null, { fullName, kind }, clientIp(req))
  res.status(201).json({ id: r.rows[0]!.id, qr_code: qrCode })
})

hseRouter.patch('/visitors/:id', ...canInspect, async (req, res) => {
  const id = Number(req.params.id)
  const b = req.body ?? {}
  const fields = ['full_name', 'id_number', 'org_name', 'phone', 'purpose', 'host_name', 'valid_from', 'valid_to', 'access_status']
  const sets: string[] = []; const vals: unknown[] = []
  for (const f of fields) {
    if (b[f] === undefined) continue
    const v = (f === 'valid_from' || f === 'valid_to') ? (b[f] || null) : escapeText(String(b[f]))
    sets.push(`${f} = $${sets.length + 1}`); vals.push(v)
  }
  if (!sets.length) return res.status(400).json({ error: 'Không có trường nào để cập nhật.' })
  vals.push(id)
  await query(`UPDATE atld.hse_visitors SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals)
  await audit(req.user!, 'VISITOR_UPDATE', 'visitor', id, null, b, clientIp(req))
  res.json({ ok: true })
})

// Tra cứu khách qua QR (chưa ghi log) — dùng ở cổng để hiện thẻ trước khi bấm vào/ra.
hseRouter.get('/visitors/lookup', requireAuth, async (req, res) => {
  const qr = String(req.query.qr ?? '').trim()
  if (!qr) return res.json({ visitor: null })
  const v = await query<{ id: number; full_name: string; kind: string; org_name: string | null; id_number: string | null; access_status: string; presence: string; valid_from: string | null; valid_to: string | null; last_in_at: string | null; last_out_at: string | null; qr_code: string }>(
    `SELECT id, full_name, kind, org_name, id_number, access_status, presence, valid_from, valid_to, last_in_at, last_out_at, qr_code
     FROM atld.hse_visitors WHERE qr_code = $1`, [qr])
  if (!v.rows[0]) return res.status(404).json({ error: 'Mã QR khách không hợp lệ.' })
  const vis = v.rows[0]
  const today = new Date().toISOString().slice(0, 10)
  const df = (d: string | null) => (d ? String(d).slice(0, 10) : null)
  const reasons: string[] = []
  if (vis.access_status !== 'allowed') reasons.push('Khách bị chặn/hết hiệu lực.')
  if (df(vis.valid_from) && today < df(vis.valid_from)!) reasons.push('Chưa đến ngày hiệu lực.')
  if (df(vis.valid_to) && today > df(vis.valid_to)!) reasons.push('Đã quá hạn ra vào.')
  res.json({ visitor: { ...vis, eligible: reasons.length === 0, reasons } })
})

// Quét QR khách tại cổng: kiểm tra hiệu lực + trạng thái rồi ghi log vào/ra.
hseRouter.post('/visitors/scan', ...canGate, async (req, res) => {
  const qr = String(req.body.qr_code ?? '').trim()
  const direction = req.body.direction === 'out' ? 'out' : 'in'
  const v = await query<{ id: number; full_name: string; kind: string; access_status: string; presence: string; valid_from: string | null; valid_to: string | null }>(
    `SELECT id, full_name, kind, access_status, presence, valid_from, valid_to FROM atld.hse_visitors WHERE qr_code = $1`, [qr])
  if (!v.rows[0]) return res.status(404).json({ error: 'Mã QR khách không hợp lệ.' })
  const vis = v.rows[0]
  const today = new Date().toISOString().slice(0, 10)
  const df = (d: string | null) => (d ? String(d).slice(0, 10) : null)
  let result = 'allowed'; let reason = ''
  if (vis.access_status !== 'allowed') { result = 'blocked'; reason = 'Khách bị chặn/hết hiệu lực.' }
  else if (df(vis.valid_from) && today < df(vis.valid_from)!) { result = 'blocked'; reason = 'Chưa đến ngày hiệu lực.' }
  else if (df(vis.valid_to) && today > df(vis.valid_to)!) { result = 'blocked'; reason = 'Đã quá hạn ra vào.' }
  await query(
    `INSERT INTO atld.hse_visitor_logs (visitor_id, guard_id, direction, result, block_reason) VALUES ($1,$2,$3,$4,$5)`,
    [vis.id, req.user!.id, direction, result, reason || null])
  if (result === 'allowed') {
    await query(
      `UPDATE atld.hse_visitors SET presence = $1, ${direction === 'in' ? 'last_in_at' : 'last_out_at'} = now(), updated_at = now() WHERE id = $2`,
      [direction === 'in' ? 'in' : 'out', vis.id])
  }
  await audit(req.user!, 'VISITOR_SCAN', 'visitor', vis.id, null, { direction, result }, clientIp(req))
  res.json({ result, reason, visitor: { full_name: vis.full_name, kind: vis.kind, direction } })
})

// ═══════════════ ĐÁNH GIÁ ĐỊNH KỲ NHÀ THẦU (BM111-07.05, Phase F) ═══════════════
// Tiêu chí chấm điểm chuẩn (0–100), có thể mở rộng qua scores JSONB.
const EVAL_CRITERIA = [
  { key: 'compliance', label: 'Tuân thủ nội quy ATVSLĐ-PCCN-BVMT', weight: 25 },
  { key: 'ppe', label: 'Trang bị & sử dụng PTBVCN', weight: 15 },
  { key: 'training', label: 'Huấn luyện an toàn đầy đủ', weight: 15 },
  { key: 'incident', label: 'Không để xảy ra sự cố/tai nạn', weight: 25 },
  { key: 'housekeeping', label: 'Vệ sinh, gọn gàng hiện trường', weight: 10 },
  { key: 'response', label: 'Phối hợp & khắc phục kiến nghị', weight: 10 },
]
hseRouter.get('/eval-criteria', requireAuth, (_req, res) => res.json({ criteria: EVAL_CRITERIA }))

hseRouter.get('/evaluations', requireAuth, async (req, res) => {
  const contractorId = req.query.contractorId ? Number(req.query.contractorId) : null
  const { all, siteId } = siteScope(req.user!)
  // Đánh giá gắn hợp đồng tại site; nếu không có hợp đồng thì xét nhà thầu có HĐ nào tại site.
  const r = await query(
    `SELECT e.id, e.contractor_id, e.contract_id, e.period, e.eval_date, e.total_score, e.rating, e.note,
            ct.name AS contractor_name, u.full_name AS evaluator_name
     FROM atld.hse_evaluations e
     JOIN atld.hse_contractors ct ON ct.id = e.contractor_id
     LEFT JOIN atld.users u ON u.id = e.evaluator_id
     WHERE ($1::int IS NULL OR e.contractor_id = $1)
       AND ($2::boolean
            OR EXISTS (SELECT 1 FROM atld.hse_contracts c WHERE c.id = e.contract_id AND c.site_id = $3)
            OR (e.contract_id IS NULL AND EXISTS (
                  SELECT 1 FROM atld.hse_contracts c2 WHERE c2.contractor_id = e.contractor_id AND c2.site_id = $3)))
     ORDER BY e.eval_date DESC NULLS LAST, e.created_at DESC`, [contractorId, all, siteId])
  res.json({ evaluations: r.rows })
})

hseRouter.get('/evaluations/:id', requireAuth, async (req, res) => {
  const r = await query(
    `SELECT e.*, ct.name AS contractor_name, u.full_name AS evaluator_name
     FROM atld.hse_evaluations e JOIN atld.hse_contractors ct ON ct.id = e.contractor_id
     LEFT JOIN atld.users u ON u.id = e.evaluator_id WHERE e.id = $1`, [Number(req.params.id)])
  if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy phiếu đánh giá.' })
  res.json({ evaluation: r.rows[0], criteria: EVAL_CRITERIA })
})

hseRouter.post('/evaluations', ...canInspect, async (req, res) => {
  const b = req.body ?? {}
  const contractorId = Number(b.contractor_id)
  const period = escapeText(String(b.period ?? '').trim())
  if (!contractorId || !period) return res.status(400).json({ error: 'Thiếu nhà thầu hoặc kỳ đánh giá.' })
  // Điểm tổng có trọng số; clamp mỗi tiêu chí về 0–100.
  const scores = (b.scores ?? {}) as Record<string, number>
  let total = 0
  for (const c of EVAL_CRITERIA) {
    const s = Math.max(0, Math.min(100, Number(scores[c.key] ?? 0)))
    total += (s * c.weight) / 100
  }
  total = Math.round(total * 100) / 100
  const rating = total >= 85 ? 'Tốt' : total >= 70 ? 'Khá' : total >= 50 ? 'Đạt' : 'Không đạt'
  const r = await query<{ id: number }>(
    `INSERT INTO atld.hse_evaluations (contractor_id, contract_id, period, eval_date, scores, total_score, rating, note, evaluator_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [contractorId, b.contract_id ? Number(b.contract_id) : null, period, b.eval_date || null,
     JSON.stringify(scores), total, rating, escapeText(String(b.note ?? '')), req.user!.id])
  await audit(req.user!, 'EVALUATION_CREATE', 'evaluation', r.rows[0]!.id, null, { contractorId, period, total, rating }, clientIp(req))
  res.status(201).json({ id: r.rows[0]!.id, total_score: total, rating })
})

// ═══════════════ DASHBOARD / KPI (Phase G) ═══════════════
hseRouter.get('/dashboard', requireAuth, async (req, res) => {
  const { all, siteId } = siteScope(req.user!)
  // KPI đếm nhanh theo site + cảnh báo hồ sơ sắp/đã hết hạn theo warn_days_before.
  // $1 = all (bỏ lọc site), $2 = siteId. NLĐ/thiết bị/nhà thầu suy site qua hợp đồng.
  const counts = await query<{ k: string; v: string }>(`
    SELECT 'contractors' AS k, count(*)::text AS v FROM atld.hse_contractors ct WHERE status = 'active'
      AND ($1::boolean OR EXISTS (SELECT 1 FROM atld.hse_contracts c WHERE c.contractor_id = ct.id AND c.site_id = $2))
    UNION ALL SELECT 'contracts', count(*)::text FROM atld.hse_contracts WHERE status IN ('active','pending')
      AND ($1::boolean OR site_id = $2)
    UNION ALL SELECT 'workers_allowed', count(*)::text FROM atld.hse_workers w WHERE access_status = 'allowed'
      AND ($1::boolean OR EXISTS (SELECT 1 FROM atld.hse_contract_workers cw JOIN atld.hse_contracts c ON c.id=cw.contract_id WHERE cw.worker_id=w.id AND c.site_id=$2))
    UNION ALL SELECT 'workers_blocked', count(*)::text FROM atld.hse_workers w WHERE access_status = 'blocked'
      AND ($1::boolean OR EXISTS (SELECT 1 FROM atld.hse_contract_workers cw JOIN atld.hse_contracts c ON c.id=cw.contract_id WHERE cw.worker_id=w.id AND c.site_id=$2))
    UNION ALL SELECT 'workers_in', count(*)::text FROM atld.hse_workers w WHERE presence = 'in'
      AND ($1::boolean OR EXISTS (SELECT 1 FROM atld.hse_contract_workers cw JOIN atld.hse_contracts c ON c.id=cw.contract_id WHERE cw.worker_id=w.id AND c.site_id=$2))
    UNION ALL SELECT 'equipments_allowed', count(*)::text FROM atld.hse_equipments e WHERE access_status = 'allowed'
      AND ($1::boolean OR EXISTS (SELECT 1 FROM atld.hse_contract_equipments ce JOIN atld.hse_contracts c ON c.id=ce.contract_id WHERE ce.equipment_id=e.id AND c.site_id=$2))
    UNION ALL SELECT 'visitors_in', count(*)::text FROM atld.hse_visitors WHERE presence = 'in'
      AND ($1::boolean OR site_id = $2)
    UNION ALL SELECT 'suspensions_active', count(*)::text FROM atld.hse_suspensions s WHERE status = 'issued'
      AND ($1::boolean OR EXISTS (SELECT 1 FROM atld.hse_contracts c WHERE c.id=s.contract_id AND c.site_id=$2))
    UNION ALL SELECT 'dossiers_pending', count(*)::text FROM atld.hse_dossiers ds WHERE status = 'submitted'
      AND ($1::boolean OR EXISTS (SELECT 1 FROM atld.hse_contracts c WHERE c.id=ds.contract_id AND c.site_id=$2))
  `, [all, siteId])
  const kpi: Record<string, number> = {}
  for (const row of counts.rows) kpi[row.k] = Number(row.v)

  // Cảnh báo hết hạn: gom worker/equipment/contractor docs còn approved, hết hạn trong warn_days_before.
  const expiring = await query<{ scope: string; entity: string; doc_name: string; expiry_date: string; days_left: number }>(`
    SELECT scope, entity, doc_name, expiry_date, days_left FROM (
      SELECT 'Người lao động' AS scope, w.full_name AS entity, dt.name AS doc_name, d.expiry_date,
             (d.expiry_date - CURRENT_DATE) AS days_left, dt.warn_days_before AS warn
      FROM atld.hse_worker_docs d JOIN atld.hse_doc_types dt ON dt.id = d.doc_type_id
      JOIN atld.hse_workers w ON w.id = d.worker_id
      WHERE d.status = 'approved' AND d.expiry_date IS NOT NULL
        AND ($1::boolean OR EXISTS (SELECT 1 FROM atld.hse_contract_workers cw JOIN atld.hse_contracts c ON c.id=cw.contract_id WHERE cw.worker_id=w.id AND c.site_id=$2))
      UNION ALL
      SELECT 'Thiết bị', e.name, dt.name, d.expiry_date,
             (d.expiry_date - CURRENT_DATE), dt.warn_days_before
      FROM atld.hse_equipment_docs d JOIN atld.hse_doc_types dt ON dt.id = d.doc_type_id
      JOIN atld.hse_equipments e ON e.id = d.equipment_id
      WHERE d.status = 'approved' AND d.expiry_date IS NOT NULL
        AND ($1::boolean OR EXISTS (SELECT 1 FROM atld.hse_contract_equipments ce JOIN atld.hse_contracts c ON c.id=ce.contract_id WHERE ce.equipment_id=e.id AND c.site_id=$2))
      UNION ALL
      SELECT 'Nhà thầu', ct.name, dt.name, d.expiry_date,
             (d.expiry_date - CURRENT_DATE), dt.warn_days_before
      FROM atld.hse_contractor_docs d JOIN atld.hse_doc_types dt ON dt.id = d.doc_type_id
      JOIN atld.hse_dossiers ds ON ds.id = d.dossier_id
      JOIN atld.hse_contracts c ON c.id = ds.contract_id
      JOIN atld.hse_contractors ct ON ct.id = c.contractor_id
      WHERE d.status = 'approved' AND d.expiry_date IS NOT NULL
        AND ($1::boolean OR c.site_id = $2)
    ) x
    WHERE (expiry_date - CURRENT_DATE) <= warn
    ORDER BY days_left ASC LIMIT 100`, [all, siteId])

  // Xu hướng lượt vào/ra 7 ngày gần nhất (worker + visitor gộp).
  const trend = await query<{ d: string; ins: string; outs: string }>(`
    SELECT to_char(day, 'YYYY-MM-DD') AS d,
           sum(CASE WHEN direction = 'in' THEN 1 ELSE 0 END)::text AS ins,
           sum(CASE WHEN direction = 'out' THEN 1 ELSE 0 END)::text AS outs
    FROM (
      SELECT date_trunc('day', l.logged_at) AS day, l.direction FROM atld.hse_access_logs l
      LEFT JOIN atld.hse_contracts c ON c.id = l.contract_id
      WHERE l.logged_at >= CURRENT_DATE - INTERVAL '6 days' AND l.result = 'allowed'
        AND ($1::boolean OR c.site_id = $2)
      UNION ALL
      SELECT date_trunc('day', vl.logged_at), vl.direction FROM atld.hse_visitor_logs vl
      LEFT JOIN atld.hse_visitors v ON v.id = vl.visitor_id
      WHERE vl.logged_at >= CURRENT_DATE - INTERVAL '6 days' AND vl.result = 'allowed'
        AND ($1::boolean OR v.site_id = $2)
    ) t GROUP BY day ORDER BY day`, [all, siteId])

  res.json({ kpi, expiring: expiring.rows, trend: trend.rows })
})
