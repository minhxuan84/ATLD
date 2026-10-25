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
 * Hai phạm vi: đình chỉ cá nhân (worker_id trỏ thẳng vào NLĐ) và đình chỉ cả hợp đồng
 * (contract_id, phải nối qua hse_contract_workers để biết ai bị chặn).
 */
export async function activeSuspensionReason(workerId: number): Promise<string | null> {
  const r = await query<{ reason: string; target_scope: string }>(
    `SELECT s.reason, s.target_scope FROM atld.hse_suspensions s
     WHERE s.status = 'issued'
       AND (s.worker_id = $1
            OR (s.contract_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM atld.hse_contract_workers cw
              WHERE cw.contract_id = s.contract_id AND cw.worker_id = $1)))
     ORDER BY s.created_at DESC LIMIT 1`,
    [workerId],
  )
  const s = r.rows[0]
  if (!s) return null
  const who = s.target_scope === 'worker' ? 'cá nhân' : 'cả nhà thầu'
  return `Đang bị đình chỉ (${who}): ${s.reason}`
}

// ── Quyết định cho vào nhà máy (R3 + Pha E) ──────────────

export interface AccessDecision {
  /** Trạng thái sẽ ghi vào hse_workers.access_status. */
  status: 'allowed' | 'blocked' | 'suspended' | 'revoked'
  /** Mọi lý do bị chặn, rỗng khi được vào. */
  reasons: string[]
}

/**
 * Một chỗ duy nhất quyết định NLĐ có được vào nhà máy hay không.
 *
 * PHẢI gom về đây, không rải điều kiện ra từng nơi: /gate/log và /gate/lookup trước
 * đây chỉ đọc access_status cho phần đình chỉ còn phần hồ sơ thì gọi
 * evalWorkerEligibility trực tiếp. Thêm điều kiện mới (phê duyệt, hạn hiệu lực, thu
 * hồi) chỉ trong syncWorkerAccess sẽ KHÔNG chặn được ở cổng — đúng loại lỗi Pha A.
 *
 * Thứ tự ưu tiên có ý nghĩa nghiệp vụ: thu hồi và đình chỉ là quyết định của con
 * người, luôn thắng kết quả tính tự động từ hồ sơ.
 */
export async function evalWorkerAccess(workerId: number): Promise<AccessDecision> {
  const w = await query<{
    access_status: string
    revoke_reason: string | null
    revoke_note: string | null
    entry_approval_status: string
    entry_approval_note: string | null
    access_valid_from: string | null
    access_valid_to: string | null
  }>(
    `SELECT access_status, revoke_reason, revoke_note, entry_approval_status,
            entry_approval_note, access_valid_from, access_valid_to
     FROM atld.hse_workers WHERE id = $1`,
    [workerId],
  )
  const row = w.rows[0]
  if (!row) return { status: 'blocked', reasons: ['Không tìm thấy hồ sơ người lao động'] }

  // 1. Thu hồi: khác đình chỉ ở chỗ KHÔNG tự khôi phục khi hồ sơ đủ lại. Chỉ cán bộ
  //    gọi PATCH /workers/:id/restore-access mới đưa về luồng xét bình thường.
  if (row.access_status === 'revoked') {
    const label: Record<string, string> = {
      contract_end: 'hết hợp đồng',
      left_project: 'rời công trường',
      serious_violation: 'vi phạm nghiêm trọng',
      other: 'lý do khác',
    }
    const why = row.revoke_reason ? label[row.revoke_reason] ?? row.revoke_reason : null
    return {
      status: 'revoked',
      reasons: [`Đã thu hồi quyền vào nhà máy${why ? ` (${why})` : ''}`
        + (row.revoke_note ? `: ${row.revoke_note}` : '')],
    }
  }

  // 2. Đình chỉ: quyết định của cấp phê duyệt, thắng kết quả xét hồ sơ.
  const suspendReason = await activeSuspensionReason(workerId)
  if (suspendReason) return { status: 'suspended', reasons: [suspendReason] }

  // 3. Các điều kiện còn lại cộng dồn, để cán bộ thấy hết việc cần làm trong một lần
  //    thay vì sửa xong một thứ mới hiện ra thứ tiếp theo.
  const reasons: string[] = []

  // E1 — phê duyệt cấp quyền (bước 6). Đủ hồ sơ vẫn chưa đủ để vào.
  if (row.entry_approval_status !== 'approved') {
    const label: Record<string, string> = {
      pending: 'Chưa được phê duyệt cấp quyền vào nhà máy',
      returned: 'Hồ sơ bị trả lại, chờ bổ sung',
      rejected: 'Bị từ chối cấp quyền vào nhà máy',
    }
    reasons.push((label[row.entry_approval_status] ?? 'Chưa được phê duyệt cấp quyền')
      + (row.entry_approval_note ? `: ${row.entry_approval_note}` : ''))
  }

  // E2 — hiệu lực theo ngày. So phần ngày dạng chuỗi như evalWorkerEligibility, vì
  // pg trả DATE là chuỗi 'yyyy-mm-dd' (xem setTypeParser trong db.ts).
  const today = new Date().toISOString().slice(0, 10)
  const from = row.access_valid_from ? String(row.access_valid_from).slice(0, 10) : null
  const to = row.access_valid_to ? String(row.access_valid_to).slice(0, 10) : null
  if (from && today < from) reasons.push(`Quyền vào nhà máy chỉ có hiệu lực từ ${from}`)
  if (to && today > to) reasons.push(`Quyền vào nhà máy đã hết hiệu lực từ ${to}`)

  // R3 — hồ sơ bắt buộc theo chức danh và mức rủi ro hợp đồng.
  const el = await evalWorkerEligibility(workerId)
  if (!el.ok) reasons.push(`Thiếu hồ sơ: ${el.missing.join('; ')}`)

  return { status: reasons.length === 0 ? 'allowed' : 'blocked', reasons }
}

// Trả về trạng thái vừa ghi để caller khỏi SELECT lại (và để endpoint trả về cho UI).
export async function syncWorkerAccess(
  workerId: number,
): Promise<'allowed' | 'blocked' | 'suspended' | 'revoked'> {
  // Toàn bộ điều kiện nằm trong evalWorkerAccess. Hàm này chỉ ghi kết quả xuống DB.
  // Thu hồi thì không ghi lại gì: access_status đã là 'revoked' và ghi đè
  // access_block_reason sẽ xóa lý do thu hồi cán bộ đã nhập.
  const d = await evalWorkerAccess(workerId)
  if (d.status === 'revoked') return 'revoked'
  await query(
    `UPDATE atld.hse_workers SET access_status = $1, access_block_reason = $2, updated_at = now()
     WHERE id = $3`,
    [d.status, d.reasons.length ? d.reasons.join('; ') : null, workerId],
  )
  return d.status
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
