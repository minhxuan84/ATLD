/**
 * HSE Core — Các helper dùng chung giữa hse.ts và module mới (jsa.ts, permits.ts).
 * Tách ra để tránh hse.ts phình quá 2073 dòng.
 */
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { Request } from 'express'
import { query } from '../db.js'
import type { AuthUser } from '../auth.js'
import { ALLOWED_EXT, MAX_FILE_MB } from '../util.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'hse')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

// ── Multer upload config ─────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '')
    cb(null, `${crypto.randomUUID()}.${ext}`)
  },
})
export const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '')
    cb(null, ALLOWED_EXT.includes(ext))
  },
})

// ── Ghi audit log bất biến ───────────────────────────────
export async function audit(
  actor: AuthUser,
  action: string,
  entity: string,
  entityId: number,
  oldVal: unknown,
  newVal: unknown,
  ip?: string,
) {
  await query(
    `INSERT INTO atld.hse_audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      actor.id,
      action,
      entity,
      entityId,
      oldVal ? JSON.stringify(oldVal) : null,
      newVal ? JSON.stringify(newVal) : null,
      ip ?? null,
    ],
  )
}

// ── Client IP helper ─────────────────────────────────────
export function clientIp(req: Request): string {
  return (
    String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    ''
  )
}

// ── Ma trận rủi ro ───────────────────────────────────────
export const RISK_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 }

export function titleMatches(appliesTo: string | null, jobTitle: string | null): boolean {
  const rule = String(appliesTo ?? '').trim()
  if (!rule) return true
  const jt = String(jobTitle ?? '').toLowerCase()
  return rule
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((kw) => jt.includes(kw))
}

export function riskApplies(docRisk: string | null, contractRisk: string): boolean {
  const need = RISK_RANK[String(docRisk ?? '').trim()] ?? 0
  return need === 0 || (RISK_RANK[contractRisk] ?? 2) >= need
}

// ── Engine xét điều kiện NLĐ (R1) ────────────────────────
export async function evalWorkerEligibility(
  workerId: number,
): Promise<{ ok: boolean; missing: string[] }> {
  const w = await query<{ job_title: string | null }>(
    `SELECT job_title FROM atld.hse_workers WHERE id = $1`,
    [workerId],
  )
  const jobTitle = w.rows[0]?.job_title ?? null

  // Mức rủi ro cao nhất trong các hợp đồng NLĐ tham gia (mặc định 'medium' nếu chưa gán).
  const cr = await query<{ risk_level: string }>(
    `SELECT c.risk_level FROM atld.hse_contract_workers cw
     JOIN atld.hse_contracts c ON c.id = cw.contract_id WHERE cw.worker_id = $1`,
    [workerId],
  )
  const contractRisk = cr.rows.reduce(
    (m, r) =>
      (RISK_RANK[r.risk_level] ?? 2) > (RISK_RANK[m] ?? 2) ? r.risk_level : m,
    'low',
  )

  const all = await query<{
    id: number
    name: string
    applies_to: string | null
    risk_level: string | null
  }>(
    `SELECT id, name, applies_to, risk_level FROM atld.hse_doc_types
     WHERE scope = 'worker' AND is_mandatory = true AND is_active = true`,
  )

  // Chỉ giữ hồ sơ áp dụng cho chức danh & mức rủi ro này.
  const mandatory = {
    rows: all.rows.filter(
      (dt) => titleMatches(dt.applies_to, jobTitle) && riskApplies(dt.risk_level, contractRisk),
    ),
  }

  const docs = await query<{
    doc_type_id: number
    status: string
    expiry_date: string | null
  }>(
    `SELECT doc_type_id, status, expiry_date FROM atld.hse_worker_docs WHERE worker_id = $1`,
    [workerId],
  )

  const missing: string[] = []
  // So sánh phần ngày (slice) để tránh lệch do pg trả date kèm timestamp/timezone.
  const today = new Date().toISOString().slice(0, 10)
  const dateOf = (d: string | null) => (d ? String(d).slice(0, 10) : null)

  for (const dt of mandatory.rows) {
    const match = docs.rows.filter((d) => d.doc_type_id === dt.id)
    const valid = match.find(
      (d) =>
        d.status === 'approved' && (!dateOf(d.expiry_date) || dateOf(d.expiry_date)! >= today),
    )
    if (!valid) {
      const expired = match.find(
        (d) =>
          d.status === 'approved' && dateOf(d.expiry_date) && dateOf(d.expiry_date)! < today,
      )
      const pending = match.find((d) => d.status === 'pending')
      const rejected = match.find((d) => d.status === 'rejected')
      missing.push(
        expired
          ? `${dt.name} (hết hạn ${dateOf(expired.expiry_date)})`
          : pending
            ? `${dt.name} (đã nộp, chờ duyệt)`
            : rejected
              ? `${dt.name} (bị từ chối, cần nộp lại)`
              : `${dt.name} (chưa nộp)`,
      )
    }
  }
  return { ok: missing.length === 0, missing }
}

// ── Engine xét điều kiện thiết bị (R2) ───────────────────
export async function evalEquipmentEligibility(
  equipmentId: number,
): Promise<{ ok: boolean; missing: string[] }> {
  // Mức rủi ro cao nhất trong các hợp đồng thiết bị tham gia.
  const cr = await query<{ risk_level: string }>(
    `SELECT c.risk_level FROM atld.hse_contract_equipments ce
     JOIN atld.hse_contracts c ON c.id = ce.contract_id WHERE ce.equipment_id = $1`,
    [equipmentId],
  )
  const contractRisk = cr.rows.reduce(
    (m, r) =>
      (RISK_RANK[r.risk_level] ?? 2) > (RISK_RANK[m] ?? 2) ? r.risk_level : m,
    'low',
  )

  const all = await query<{
    id: number
    name: string
    applies_to: string | null
    risk_level: string | null
  }>(
    `SELECT id, name, applies_to, risk_level FROM atld.hse_doc_types
     WHERE scope = 'equipment' AND is_mandatory = true AND is_active = true`,
  )

  // applies_to cho thiết bị không dùng chức danh, match all.
  const mandatory = {
    rows: all.rows.filter((dt) => riskApplies(dt.risk_level, contractRisk)),
  }

  const docs = await query<{
    doc_type_id: number
    status: string
    expiry_date: string | null
  }>(
    `SELECT doc_type_id, status, expiry_date FROM atld.hse_equipment_docs WHERE equipment_id = $1`,
    [equipmentId],
  )

  const missing: string[] = []
  const today = new Date().toISOString().slice(0, 10)
  const dateOf = (d: string | null) => (d ? String(d).slice(0, 10) : null)

  for (const dt of mandatory.rows) {
    const match = docs.rows.filter((d) => d.doc_type_id === dt.id)
    const valid = match.find(
      (d) =>
        d.status === 'approved' && (!dateOf(d.expiry_date) || dateOf(d.expiry_date)! >= today),
    )
    if (!valid) {
      const expired = match.find(
        (d) =>
          d.status === 'approved' && dateOf(d.expiry_date) && dateOf(d.expiry_date)! < today,
      )
      const pending = match.find((d) => d.status === 'pending')
      const rejected = match.find((d) => d.status === 'rejected')
      missing.push(
        expired
          ? `${dt.name} (hết hạn ${dateOf(expired.expiry_date)})`
          : pending
            ? `${dt.name} (đã nộp, chờ duyệt)`
            : rejected
              ? `${dt.name} (bị từ chối, cần nộp lại)`
              : `${dt.name} (chưa nộp)`,
      )
    }
  }
  return { ok: missing.length === 0, missing }
}

/**
 * Lệnh đình chỉ còn hiệu lực của một NLĐ, nếu có.
 * Đình chỉ hiện neo trên hợp đồng (hse_suspensions.contract_id) nên phải nối qua
 * hse_contract_workers để biết NLĐ nào đang bị chặn.
 */
export async function activeSuspensionReason(workerId: number): Promise<string | null> {
  const r = await query<{ reason: string; scope: string }>(
    `SELECT s.reason, s.scope FROM atld.hse_suspensions s
     JOIN atld.hse_contract_workers cw ON cw.contract_id = s.contract_id
     WHERE cw.worker_id = $1 AND s.status = 'issued'
     ORDER BY s.created_at DESC LIMIT 1`,
    [workerId],
  )
  const s = r.rows[0]
  return s ? `Đang bị đình chỉ: ${s.reason}` : null
}

// ── Đồng bộ trạng thái cổng worker/equipment (R3) ────────
// Trả về trạng thái vừa ghi để caller khỏi SELECT lại (và để endpoint trả về cho UI).
export async function syncWorkerAccess(
  workerId: number,
): Promise<'allowed' | 'blocked' | 'suspended'> {
  // Cổng kiểm soát đọc chính access_status để biết ai bị đình chỉ (xem /gate/log và
  // /gate/lookup trong hse.ts). Nếu ở đây ghi 'allowed'/'blocked' vô điều kiện thì mỗi
  // lần duyệt hồ sơ, gán NLĐ vào hợp đồng hay chạy sync toàn bộ đều âm thầm gỡ đình chỉ
  // — người bị đình chỉ vào lại nhà máy được trong khi lệnh vẫn còn 'issued'.
  // Vì vậy đình chỉ luôn thắng kết quả xét hồ sơ.
  const suspendReason = await activeSuspensionReason(workerId)
  if (suspendReason) {
    await query(
      `UPDATE atld.hse_workers SET access_status = 'suspended', access_block_reason = $1,
                                   updated_at = now()
       WHERE id = $2`,
      [suspendReason, workerId],
    )
    return 'suspended'
  }
  const el = await evalWorkerEligibility(workerId)
  const status = el.ok ? 'allowed' : 'blocked'
  await query(
    `UPDATE atld.hse_workers SET access_status = $1, access_block_reason = $2, updated_at = now()
     WHERE id = $3`,
    [status, el.ok ? null : el.missing.join('; '), workerId],
  )
  return status
}

// Trả trạng thái vừa ghi như syncWorkerAccess: PATCH /equipment-docs/:id đã serialize
// kết quả nên nếu để Promise<void> thì access_status luôn vắng trong response.
export async function syncEquipmentAccess(
  equipmentId: number,
): Promise<'allowed' | 'blocked'> {
  const el = await evalEquipmentEligibility(equipmentId)
  const status = el.ok ? 'allowed' : 'blocked'
  await query(
    `UPDATE atld.hse_equipments SET access_status = $1, access_block_reason = $2, updated_at = now()
     WHERE id = $3`,
    [status, el.ok ? null : el.missing.join('; '), equipmentId],
  )
  return status
}

// ── Helper nối atld.users ↔ hse_workers qua CCCD (Pha 0) ─
export async function resolveWorkerIdentity(
  idNumber: string,
): Promise<{ userId: number | null; workerId: number | null }> {
  const u = await query<{ id: number }>(
    `SELECT id FROM atld.users WHERE id_number = $1 LIMIT 1`,
    [idNumber],
  )
  const w = await query<{ id: number }>(
    `SELECT id FROM atld.hse_workers WHERE id_number = $1 LIMIT 1`,
    [idNumber],
  )
  return { userId: u.rows[0]?.id ?? null, workerId: w.rows[0]?.id ?? null }
}
