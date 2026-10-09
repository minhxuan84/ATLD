// Phiếu phát hiện + vòng CAPA (Pha C) — quy trình kiểm tra định kỳ 8 bước.
// Mỗi phiếu đi tuần tự: ghi nhận → đánh giá → (đình chỉ) → giao khắc phục →
// khắc phục → xác minh → (duyệt làm tiếp) → đóng. Server cưỡng chế thứ tự.
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { fmtDate, fmtDateTime } from '../../lib/date'
import { useAuth, canHse } from '../../context/AuthContext'

interface Finding {
  id: number
  finding_no: string
  source: string
  finding_type: string
  check_period: string | null
  site_id: number | null
  site_name: string | null
  area: string | null
  contractor_id: number | null
  contractor_name: string | null
  contract_id: number | null
  contract_no: string | null
  work_type_id: number | null
  work_type_name: string | null
  worker_id: number | null
  worker_name: string | null
  worker_id_number: string | null
  description: string
  reporter_name: string | null
  detected_at: string
  risk_level: 'high' | 'low' | null
  affects_worker: boolean | null
  has_injury: boolean | null
  assess_basis: string | null
  assessed_by_name: string | null
  assessed_at: string | null
  suspension_id: number | null
  suspension_status: string | null
  capa_requirement: string | null
  responsible_org: string | null
  responsible_person: number | null
  responsible_person_name: string | null
  capa_due_at: string | null
  capa_action: string | null
  capa_done_at: string | null
  root_cause: string | null
  preventive_action: string | null
  verify_result: string | null
  verified_by_name: string | null
  verified_at: string | null
  verify_note: string | null
  resume_decision: string | null
  status: string
  closed_at: string | null
  closed_on_time: boolean | null
  return_count: number
  created_by_name: string | null
  photo_count: number
}
interface Contract { id: number; contract_no: string; title: string; contractor_name: string; status: string }
interface Contractor { id: number; name: string }
interface WorkType { id: number; name: string }
interface Worker { id: number; full_name: string; id_number: string | null }
interface Branch { id: number; name: string }
interface UserOpt { id: number; full_name: string }
interface Photo { id: number; phase: string; file_name: string; caption: string | null; uploaded_at: string }

const STATUS_LABEL: Record<string, string> = {
  new: 'Mới ghi nhận',
  assessed: 'Đã đánh giá',
  suspended: 'Đã đình chỉ',
  capa_assigned: 'Đang khắc phục',
  capa_done: 'Chờ xác minh',
  verifying: 'Đang xác minh',
  verified: 'Đã xác minh',
  resume_approved: 'Đã duyệt làm tiếp',
  closed: 'Đã đóng',
  cancelled: 'Đã huỷ',
}
const STATUS_STYLE: Record<string, string> = {
  new: 'bg-slate-100 text-slate-700',
  assessed: 'bg-blue-100 text-blue-700',
  suspended: 'bg-rose-100 text-rose-700',
  capa_assigned: 'bg-amber-100 text-amber-700',
  capa_done: 'bg-indigo-100 text-indigo-700',
  verifying: 'bg-indigo-100 text-indigo-700',
  verified: 'bg-teal-100 text-teal-700',
  resume_approved: 'bg-green-100 text-green-700',
  closed: 'bg-green-100 text-green-700',
  cancelled: 'bg-slate-100 text-slate-400',
}
const SOURCE_LABEL: Record<string, string> = {
  periodic: 'Kiểm tra định kỳ', adhoc: 'Kiểm tra đột xuất', field_report: 'Báo hiện trường',
}
const TYPE_LABEL: Record<string, string> = {
  unsafe_condition: 'Điều kiện không an toàn',
  unsafe_act: 'Hành vi không an toàn',
  near_miss: 'Suýt xảy ra tai nạn',
}
const PERIOD_LABEL: Record<string, string> = { week: 'Tuần', month: 'Tháng', quarter: 'Quý' }
const PHASE_LABEL: Record<string, string> = {
  detect: 'Lúc phát hiện', capa: 'Sau khắc phục', verify: 'Khi xác minh',
}

/** Quá hạn khắc phục mà chưa khắc phục xong. */
const isOverdue = (f: Finding) =>
  !!f.capa_due_at && new Date(f.capa_due_at) < new Date()
  && ['assessed', 'suspended', 'capa_assigned'].includes(f.status)

export default function FindingsPage() {
  const { user } = useAuth()
  const canApprove = canHse(user, 'approve')
  const canPickSite = user?.role === 'admin' || !!user?.permissions?.includes('an-toan')

  const [findings, setFindings] = useState<Finding[]>([])
  const [filter, setFilter] = useState<'open' | 'overdue' | 'closed' | 'all'>('open')
  const [contracts, setContracts] = useState<Contract[]>([])
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [workTypes, setWorkTypes] = useState<WorkType[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [users, setUsers] = useState<UserOpt[]>([])
  const [showForm, setShowForm] = useState(false)
  const [detail, setDetail] = useState<{ finding: Finding; photos: Photo[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const qs = filter === 'overdue' ? '?overdue=1' : filter === 'closed' ? '?status=closed' : ''
    const d = await api<{ findings: Finding[] }>(`/findings${qs}`)
    // "Đang xử lý" = chưa đóng, chưa huỷ. Lọc ở client để đổi tab không phải gọi lại.
    setFindings(filter === 'open'
      ? d.findings.filter((f) => !['closed', 'cancelled'].includes(f.status))
      : d.findings)
  }, [filter])

  useEffect(() => { load().catch((e) => setErr((e as Error).message)) }, [load])

  useEffect(() => {
    api<{ contracts: Contract[] }>('/hse/contracts')
      .then((d) => setContracts(d.contracts.filter((c) => c.status === 'active'))).catch(() => {})
    api<{ contractors: Contractor[] }>('/hse/contractors').then((d) => setContractors(d.contractors)).catch(() => {})
    api<{ workTypes: WorkType[] }>('/jsa/work-types').then((d) => setWorkTypes(d.workTypes)).catch(() => {})
    api<{ workers: Worker[] }>('/hse/workers').then((d) => setWorkers(d.workers)).catch(() => {})
    // /findings/assignees thay vì /admin/users: endpoint kia đòi quyền 'nguoi-dung'
    // nên cán bộ chỉ có 'an-toan:inspect' sẽ nhận 403 và danh sách rỗng âm thầm.
    api<{ users: UserOpt[] }>('/findings/assignees').then((d) => setUsers(d.users)).catch(() => {})
    if (canPickSite) {
      api<{ branches: Branch[] }>('/admin/branches').then((d) => setBranches(d.branches)).catch(() => {})
    }
  }, [canPickSite])

  const openDetail = async (id: number) => {
    setErr('')
    try {
      const d = await api<{ finding: Finding; photos: Photo[] }>(`/findings/${id}`)
      setDetail(d)
    } catch (e) { setErr((e as Error).message) }
  }

  // Gọi một bước của quy trình rồi nạp lại cả danh sách và phiếu đang mở.
  const step = async (id: number, path: string, body: unknown, method = 'PATCH') => {
    setErr(''); setBusy(true)
    try {
      await api(`/findings/${id}${path}`, { method, body })
      await load()
      await openDetail(id)
      return true
    } catch (e) { setErr((e as Error).message); return false } finally { setBusy(false) }
  }

  const counts = {
    open: findings.filter((f) => !['closed', 'cancelled'].includes(f.status)).length,
    overdue: findings.filter(isOverdue).length,
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-slate-200 bg-white">
          {([
            ['open', 'Đang xử lý'],
            ['overdue', 'Quá hạn'],
            ['closed', 'Đã đóng'],
            ['all', 'Tất cả'],
          ] as const).map(([v, label]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={`px-4 py-1.5 text-sm font-medium transition first:rounded-l-lg last:rounded-r-lg
                ${filter === v ? 'bg-vicem-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => { setShowForm(true); setErr('') }}
          className="rounded-lg bg-vicem-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-vicem-600">
          + Ghi nhận phát hiện
        </button>
      </div>

      {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}

      {filter !== 'closed' && counts.overdue > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <span className="text-2xl">⏰</span>
          <div>
            <p className="font-semibold text-amber-700">
              {counts.overdue} phiếu quá hạn khắc phục.
            </p>
            <p className="text-sm text-amber-600">Rủi ro cao phải khắc phục trong 24h, rủi ro thấp 72h.</p>
          </div>
        </div>
      )}

      {findings.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-12 text-center text-sm text-slate-400">
          Không có phiếu phát hiện nào.
        </div>
      )}

      <div className="space-y-3">
        {findings.map((f) => (
          <button key={f.id} onClick={() => openDetail(f.id)}
            className={`w-full rounded-xl border p-4 text-left transition hover:border-vicem-300
              ${isOverdue(f) ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-white'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[f.status] ?? 'bg-slate-100 text-slate-600'}`}>
                    {STATUS_LABEL[f.status] ?? f.status}
                  </span>
                  <span className="font-semibold text-slate-800">{f.finding_no}</span>
                  {f.risk_level && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${f.risk_level === 'high' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                      {f.risk_level === 'high' ? 'Rủi ro cao' : 'Rủi ro thấp'}
                    </span>
                  )}
                  {isOverdue(f) && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      ⏰ Quá hạn
                    </span>
                  )}
                  {f.return_count > 0 && (
                    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                      Trả lại {f.return_count} lượt
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-sm text-slate-700">{f.description}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {SOURCE_LABEL[f.source] ?? f.source} · {TYPE_LABEL[f.finding_type] ?? f.finding_type}
                  {f.area && <> · {f.area}</>}
                  {f.contract_no && <> · {f.contract_no}</>}
                  {f.worker_name && <> · {f.worker_name}</>}
                  {' · '}phát hiện {fmtDateTime(f.detected_at)}
                </p>
                {f.capa_due_at && !['closed', 'cancelled'].includes(f.status) && (
                  <p className={`mt-0.5 text-xs ${isOverdue(f) ? 'font-medium text-amber-700' : 'text-slate-500'}`}>
                    Hạn khắc phục {fmtDateTime(f.capa_due_at)}
                    {f.responsible_person_name && <> — {f.responsible_person_name}</>}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right text-xs text-slate-400">
                {f.photo_count > 0 && <p>📷 {f.photo_count}</p>}
                {f.closed_at && (
                  <p className={f.closed_on_time === false ? 'text-amber-600' : 'text-green-600'}>
                    {f.closed_on_time === false ? 'Đóng trễ hạn' : 'Đóng đúng hạn'}
                  </p>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {showForm && (
        <CreateFindingModal
          contracts={contracts} contractors={contractors} workTypes={workTypes}
          workers={workers} branches={branches} canPickSite={canPickSite}
          onClose={() => setShowForm(false)}
          onDone={async () => { setShowForm(false); await load() }}
        />
      )}

      {detail && (
        <FindingDetailModal
          detail={detail} users={users} workers={workers} canApprove={canApprove}
          busy={busy} err={err} step={step}
          onClose={() => { setDetail(null); setErr('') }}
          onReload={() => openDetail(detail.finding.id)}
        />
      )}
    </div>
  )
}

// ═══════════════ B1 — Ghi nhận ═══════════════
function CreateFindingModal({
  contracts, contractors, workTypes, workers, branches, canPickSite, onClose, onDone,
}: {
  contracts: Contract[]; contractors: Contractor[]; workTypes: WorkType[]
  workers: Worker[]; branches: Branch[]; canPickSite: boolean
  onClose: () => void; onDone: () => void
}) {
  const [f, setF] = useState({
    source: 'periodic', finding_type: 'unsafe_condition', check_period: 'month',
    site_id: '', area: '', contractor_id: '', contract_id: '', work_type_id: '',
    worker_id: '', description: '', reporter_name: '',
  })
  const [shots, setShots] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    if (!f.description.trim()) { setErr('Phải mô tả nội dung phát hiện.'); return }
    if (canPickSite && !f.site_id) { setErr('Phải chọn nhà máy / chi nhánh.'); return }
    setErr(''); setBusy(true)
    try {
      const r = await api<{ id: number; finding_no: string }>('/findings', {
        method: 'POST',
        body: {
          source: f.source, finding_type: f.finding_type, check_period: f.check_period,
          site_id: f.site_id ? Number(f.site_id) : null,
          area: f.area.trim() || null,
          contractor_id: f.contractor_id ? Number(f.contractor_id) : null,
          contract_id: f.contract_id ? Number(f.contract_id) : null,
          work_type_id: f.work_type_id ? Number(f.work_type_id) : null,
          worker_id: f.worker_id ? Number(f.worker_id) : null,
          description: f.description.trim(),
          reporter_name: f.reporter_name.trim() || null,
        },
      })
      // Ảnh lúc phát hiện — tải lần lượt, một ảnh lỗi không làm mất phiếu đã tạo.
      for (const file of shots) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('phase', 'detect')
        await api(`/findings/${r.id}/photos`, { method: 'POST', body: fd, isForm: true })
          .catch(() => {})
      }
      onDone()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className="my-8 w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-lg font-semibold text-slate-800">Ghi nhận phát hiện</h3>
        {err && <p className="mb-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Nguồn phát hiện *</label>
            <select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {Object.entries(SOURCE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Loại phát hiện *</label>
            <select value={f.finding_type} onChange={(e) => setF({ ...f, finding_type: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Kỳ kiểm tra</label>
            <select value={f.check_period} onChange={(e) => setF({ ...f, check_period: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {Object.entries(PERIOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {canPickSite && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Nhà máy / chi nhánh *</label>
              <select value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">-- Chọn</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Khu vực</label>
            <input value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })}
              placeholder="Lò quay, băng tải B3…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Nhà thầu</label>
            <select value={f.contractor_id} onChange={(e) => setF({ ...f, contractor_id: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">-- Không gắn</option>
              {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Hợp đồng</label>
            <select value={f.contract_id} onChange={(e) => setF({ ...f, contract_id: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">-- Không gắn</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} — {c.contractor_name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Loại công việc</label>
            <select value={f.work_type_id} onChange={(e) => setF({ ...f, work_type_id: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">-- Không gắn</option>
              {workTypes.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Người lao động liên quan
            </label>
            <select value={f.worker_id} onChange={(e) => setF({ ...f, worker_id: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">-- Không gắn cá nhân</option>
              {workers.slice(0, 300).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.full_name}{w.id_number ? ` — ${w.id_number}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Người báo</label>
            <input value={f.reporter_name} onChange={(e) => setF({ ...f, reporter_name: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-sm font-medium text-slate-700">Nội dung phát hiện *</label>
          <textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })}
            rows={3} placeholder="Mô tả rõ điều kiện / hành vi không an toàn đã thấy…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-sm font-medium text-slate-700">Ảnh lúc phát hiện</label>
          <input type="file" accept="image/png,image/jpeg,image/webp" multiple
            onChange={(e) => setShots(Array.from(e.target.files ?? []))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          {shots.length > 0 && <p className="mt-1 text-xs text-slate-500">Đã chọn {shots.length} ảnh.</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100">Hủy</button>
          <button onClick={submit} disabled={busy}
            className="rounded-lg bg-vicem-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-vicem-600">
            {busy ? 'Đang lưu…' : 'Ghi nhận'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════ B2–B8 — chi tiết và các bước ═══════════════
function FindingDetailModal({
  detail, users, workers, canApprove, busy, err, step, onClose, onReload,
}: {
  detail: { finding: Finding; photos: Photo[] }
  users: UserOpt[]; workers: Worker[]; canApprove: boolean
  busy: boolean; err: string
  step: (id: number, path: string, body: unknown, method?: string) => Promise<boolean>
  onClose: () => void; onReload: () => void
}) {
  const f = detail.finding
  const [assess, setAssess] = useState({
    risk_level: 'low', affects_worker: false, has_injury: false, assess_basis: '',
  })
  const [suspend, setSuspend] = useState({ target_scope: 'contract', worker_id: '', reason: '' })
  const [assign, setAssign] = useState({
    capa_requirement: '', responsible_org: '', responsible_person: '', capa_due_at: '',
  })
  const [capa, setCapa] = useState({ capa_action: '', root_cause: '', preventive_action: '' })
  const [verify, setVerify] = useState({ verify_result: 'pass', verify_note: '' })
  const [capaShots, setCapaShots] = useState<File[]>([])

  const uploadShots = async (phase: string, files: File[]) => {
    for (const file of files) {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('phase', phase)
      await api(`/findings/${f.id}/photos`, { method: 'POST', body: fd, isForm: true }).catch(() => {})
    }
    onReload()
  }

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex gap-2 py-0.5 text-sm">
      <span className="w-40 shrink-0 text-slate-500">{label}</span>
      <span className="flex-1 text-slate-800">{children}</span>
    </div>
  )

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className="my-8 w-full max-w-3xl rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[f.status] ?? 'bg-slate-100'}`}>
            {STATUS_LABEL[f.status] ?? f.status}
          </span>
          <h3 className="text-lg font-semibold text-slate-800">{f.finding_no}</h3>
          {f.risk_level && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${f.risk_level === 'high' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
              {f.risk_level === 'high' ? 'Rủi ro cao — hạn 24h' : 'Rủi ro thấp — hạn 72h'}
            </span>
          )}
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {err && <p className="mb-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}

        {/* Hồ sơ phiếu */}
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <Row label="Nguồn / loại">
            {SOURCE_LABEL[f.source] ?? f.source} · {TYPE_LABEL[f.finding_type] ?? f.finding_type}
            {f.check_period && <> · kỳ {PERIOD_LABEL[f.check_period] ?? f.check_period}</>}
          </Row>
          <Row label="Nội dung">{f.description}</Row>
          {f.site_name && <Row label="Nhà máy">{f.site_name}</Row>}
          {f.area && <Row label="Khu vực">{f.area}</Row>}
          {f.contract_no && <Row label="Hợp đồng">{f.contract_no} — {f.contractor_name}</Row>}
          {f.work_type_name && <Row label="Loại công việc">{f.work_type_name}</Row>}
          {f.worker_name && (
            <Row label="NLĐ liên quan">
              {f.worker_name}{f.worker_id_number ? ` — CCCD ${f.worker_id_number}` : ''}
            </Row>
          )}
          <Row label="Phát hiện lúc">
            {fmtDateTime(f.detected_at)}{f.reporter_name && <> — {f.reporter_name}</>}
          </Row>
          {f.assessed_at && (
            <Row label="Đánh giá">
              {f.risk_level === 'high' ? 'Rủi ro cao' : 'Rủi ro thấp'}
              {f.affects_worker && ' · ảnh hưởng NLĐ'}
              {f.has_injury && ' · có thương tích'}
              {' — '}{f.assessed_by_name} lúc {fmtDateTime(f.assessed_at)}
              {f.assess_basis && <><br /><span className="text-slate-500">{f.assess_basis}</span></>}
            </Row>
          )}
          {f.suspension_id && (
            <Row label="Đình chỉ">
              Lệnh #{f.suspension_id} — {f.suspension_status === 'lifted' ? 'đã gỡ' : 'đang hiệu lực'}
            </Row>
          )}
          {f.capa_requirement && (
            <Row label="Yêu cầu khắc phục">
              {f.capa_requirement}
              <br />
              <span className="text-slate-500">
                {f.responsible_person_name ?? f.responsible_org ?? '—'}
                {f.capa_due_at && <> · hạn {fmtDateTime(f.capa_due_at)}</>}
              </span>
            </Row>
          )}
          {f.capa_action && (
            <Row label="Đã khắc phục">
              {f.capa_action}
              {f.capa_done_at && <><br /><span className="text-slate-500">Xong lúc {fmtDateTime(f.capa_done_at)}</span></>}
              {f.root_cause && <><br /><span className="text-slate-500">Nguyên nhân gốc: {f.root_cause}</span></>}
              {f.preventive_action && <><br /><span className="text-slate-500">Phòng ngừa: {f.preventive_action}</span></>}
            </Row>
          )}
          {f.verify_result && (
            <Row label="Xác minh">
              <span className={f.verify_result === 'pass' ? 'text-green-700' : 'text-rose-700'}>
                {f.verify_result === 'pass' ? 'Đạt' : 'Chưa đạt'}
              </span>
              {' — '}{f.verified_by_name} lúc {fmtDateTime(f.verified_at)}
              {f.verify_note && <><br /><span className="text-slate-500">{f.verify_note}</span></>}
            </Row>
          )}
          {f.resume_decision && (
            <Row label="Duyệt làm tiếp">
              {f.resume_decision === 'approved' ? 'Cho làm tiếp' : 'Chưa cho làm tiếp'}
            </Row>
          )}
          {f.return_count > 0 && <Row label="Số lượt trả lại">{f.return_count}</Row>}
          {f.closed_at && (
            <Row label="Đóng phiếu">
              {fmtDateTime(f.closed_at)}
              {f.closed_on_time !== null && (
                <span className={f.closed_on_time ? 'text-green-600' : 'text-amber-600'}>
                  {f.closed_on_time ? ' — đúng hạn' : ' — trễ hạn'}
                </span>
              )}
            </Row>
          )}
        </div>

        {/* Ảnh */}
        {detail.photos.length > 0 && (
          <div className="mb-4">
            <p className="mb-1 text-sm font-medium text-slate-700">Ảnh minh chứng</p>
            <div className="space-y-1">
              {detail.photos.map((p) => (
                <p key={p.id} className="text-sm text-slate-600">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                    {PHASE_LABEL[p.phase] ?? p.phase}
                  </span>
                  {' '}{p.file_name}
                  {p.caption && <span className="text-slate-400"> — {p.caption}</span>}
                  <span className="text-slate-400"> · {fmtDate(p.uploaded_at)}</span>
                </p>
              ))}
            </div>
          </div>
        )}

        {/* B2 — Đánh giá */}
        {f.status === 'new' && (
          <StepBox title="Bước 2 — Đánh giá mức độ rủi ro">
            <div className="grid gap-2 sm:grid-cols-2">
              <select value={assess.risk_level} onChange={(e) => setAssess({ ...assess, risk_level: e.target.value })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="low">Rủi ro thấp — khắc phục trong 72h</option>
                <option value="high">Rủi ro cao — khắc phục trong 24h</option>
              </select>
              <div className="flex items-center gap-4 text-sm text-slate-700">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={assess.affects_worker}
                    onChange={(e) => setAssess({ ...assess, affects_worker: e.target.checked })} />
                  Ảnh hưởng NLĐ
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={assess.has_injury}
                    onChange={(e) => setAssess({ ...assess, has_injury: e.target.checked })} />
                  Có thương tích
                </label>
              </div>
            </div>
            <textarea value={assess.assess_basis} onChange={(e) => setAssess({ ...assess, assess_basis: e.target.value })}
              rows={2} placeholder="Căn cứ đánh giá…"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <StepButton busy={busy} label="Lưu đánh giá"
              onClick={() => step(f.id, '/assess', assess)} />
          </StepBox>
        )}

        {/* B3 — Đình chỉ */}
        {f.status === 'assessed' && canApprove && !f.suspension_id && (
          <StepBox title="Bước 3 — Đình chỉ công việc (nếu cần)"
            hint={f.risk_level === 'high'
              ? 'Rủi ro cao: nên đình chỉ trước khi khắc phục.'
              : 'Rủi ro thấp: thường bỏ qua bước này, giao khắc phục luôn.'}>
            <div className="grid gap-2 sm:grid-cols-2">
              <select value={suspend.target_scope} onChange={(e) => setSuspend({ ...suspend, target_scope: e.target.value })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="contract">Cả nhà thầu (theo hợp đồng của phiếu)</option>
                <option value="worker">Một cá nhân</option>
              </select>
              {suspend.target_scope === 'worker' && (
                <select value={suspend.worker_id} onChange={(e) => setSuspend({ ...suspend, worker_id: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="">
                    {f.worker_name ? `Mặc định: ${f.worker_name}` : '-- Chọn người lao động'}
                  </option>
                  {workers.slice(0, 300).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.full_name}{w.id_number ? ` — ${w.id_number}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <textarea value={suspend.reason} onChange={(e) => setSuspend({ ...suspend, reason: e.target.value })}
              rows={2} placeholder="Lý do đình chỉ…"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <StepButton busy={busy} label="Phát lệnh đình chỉ" danger
              onClick={() => step(f.id, '/suspend', {
                target_scope: suspend.target_scope,
                worker_id: suspend.worker_id ? Number(suspend.worker_id) : null,
                reason: suspend.reason,
              }, 'POST')} />
          </StepBox>
        )}

        {/* B4 — Giao khắc phục */}
        {['assessed', 'suspended', 'verifying'].includes(f.status) && (
          <StepBox title="Bước 4 — Giao khắc phục"
            hint={`Hạn mặc định theo mức rủi ro: ${f.risk_level === 'high' ? '24h' : '72h'}. Để trống để dùng mặc định.`}>
            <textarea value={assign.capa_requirement} onChange={(e) => setAssign({ ...assign, capa_requirement: e.target.value })}
              rows={2} placeholder="Yêu cầu khắc phục cụ thể…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <input value={assign.responsible_org} onChange={(e) => setAssign({ ...assign, responsible_org: e.target.value })}
                placeholder="Đơn vị chịu trách nhiệm"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <select value={assign.responsible_person} onChange={(e) => setAssign({ ...assign, responsible_person: e.target.value })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">-- Người chịu trách nhiệm</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
              <input type="datetime-local" value={assign.capa_due_at}
                onChange={(e) => setAssign({ ...assign, capa_due_at: e.target.value })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <StepButton busy={busy}
              label={f.status === 'verifying' ? 'Trả lại, giao khắc phục tiếp' : 'Giao khắc phục'}
              onClick={() => step(f.id, '/assign', {
                capa_requirement: assign.capa_requirement,
                responsible_org: assign.responsible_org || null,
                responsible_person: assign.responsible_person ? Number(assign.responsible_person) : null,
                capa_due_at: assign.capa_due_at || null,
              })} />
          </StepBox>
        )}

        {/* B5 — Khắc phục */}
        {f.status === 'capa_assigned' && (
          <StepBox title="Bước 5 — Ghi nhận đã khắc phục">
            <textarea value={capa.capa_action} onChange={(e) => setCapa({ ...capa, capa_action: e.target.value })}
              rows={2} placeholder="Đã làm gì để khắc phục…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input value={capa.root_cause} onChange={(e) => setCapa({ ...capa, root_cause: e.target.value })}
                placeholder="Nguyên nhân gốc"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <input value={capa.preventive_action} onChange={(e) => setCapa({ ...capa, preventive_action: e.target.value })}
                placeholder="Biện pháp phòng ngừa tái diễn"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div className="mt-2">
              <label className="mb-1 block text-sm text-slate-600">Ảnh sau khắc phục</label>
              <input type="file" accept="image/png,image/jpeg,image/webp" multiple
                onChange={(e) => setCapaShots(Array.from(e.target.files ?? []))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <StepButton busy={busy} label="Báo đã khắc phục"
              onClick={async () => {
                if (capaShots.length) await uploadShots('capa', capaShots)
                return step(f.id, '/capa', capa)
              }} />
          </StepBox>
        )}

        {/* B6 — Xác minh */}
        {f.status === 'capa_done' && (
          <StepBox title="Bước 6 — Xác minh kết quả khắc phục"
            hint="Người chịu trách nhiệm khắc phục không được tự xác minh.">
            <div className="grid gap-2 sm:grid-cols-2">
              <select value={verify.verify_result} onChange={(e) => setVerify({ ...verify, verify_result: e.target.value })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="pass">Đạt — khắc phục xong</option>
                <option value="fail">Chưa đạt — trả lại khắc phục tiếp</option>
              </select>
              <input value={verify.verify_note} onChange={(e) => setVerify({ ...verify, verify_note: e.target.value })}
                placeholder="Ghi chú xác minh"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <StepButton busy={busy} label="Lưu kết quả xác minh"
              onClick={() => step(f.id, '/verify', verify)} />
          </StepBox>
        )}

        {/* B7 — Duyệt làm tiếp */}
        {f.status === 'verified' && canApprove && (
          <StepBox title="Bước 7 — Duyệt cho làm tiếp"
            hint={f.suspension_id ? 'Duyệt sẽ gỡ lệnh đình chỉ của phiếu này.' : undefined}>
            <div className="flex flex-wrap gap-2">
              <StepButton busy={busy} label="Cho làm tiếp"
                onClick={() => step(f.id, '/resume', { resume_decision: 'approved' })} />
              <StepButton busy={busy} label="Chưa cho, khắc phục thêm" danger
                onClick={() => step(f.id, '/resume', { resume_decision: 'rejected' })} />
            </div>
          </StepBox>
        )}

        {/* B8 — Đóng phiếu */}
        {['verified', 'resume_approved', 'assessed'].includes(f.status) && canApprove && (
          <StepBox title="Bước 8 — Đóng phiếu"
            hint={f.status === 'assessed'
              ? 'Đóng luôn khi kết luận không vi phạm.'
              : f.suspension_id && f.status !== 'resume_approved'
                ? 'Phiếu có lệnh đình chỉ phải được duyệt làm tiếp trước khi đóng.'
                : undefined}>
            <StepButton busy={busy} label="Đóng phiếu"
              onClick={() => step(f.id, '/close', {})} />
          </StepBox>
        )}
      </div>
    </div>
  )
}

function StepBox({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 rounded-lg border border-vicem-200 bg-vicem-50/40 p-3">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {hint && <p className="mb-2 text-xs text-slate-500">{hint}</p>}
      <div className={hint ? '' : 'mt-2'}>{children}</div>
    </div>
  )
}

function StepButton({ busy, label, onClick, danger }: {
  busy: boolean; label: string; onClick: () => void | Promise<unknown>; danger?: boolean
}) {
  return (
    <button onClick={() => { void onClick() }} disabled={busy}
      className={`mt-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50
        ${danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-vicem-500 hover:bg-vicem-600'}`}>
      {busy ? 'Đang xử lý…' : label}
    </button>
  )
}
