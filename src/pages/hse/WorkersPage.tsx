// Hồ sơ người lao động (nhà thầu / nhân viên nội bộ / khách):
// thông tin cá nhân, hồ sơ bắt buộc + chứng chỉ chuyên môn, lịch sử huấn luyện ATLĐ,
// và cảnh báo tự động khi chứng chỉ/giấy phép sắp hết hạn.
import { useEffect, useState, useCallback, useRef } from 'react'
import { api, openFileInNewTab } from '../../lib/api'
import { fmtDate } from '../../lib/date'
import { useAuth, seesAllSites, canHse } from '../../context/AuthContext'
import FaceEnrollModal from '../../components/hse/FaceEnrollModal'
import SmartCAModal from '../../components/hse/SmartCAModal'

interface Worker {
  id: number; full_name: string; id_number: string | null; job_title: string | null
  phone: string | null; access_status: string; contractor_id: number | null
  contractor_name: string | null; worker_type: string; expiring_docs: number
}
interface WorkerFull extends Worker {
  birth_date: string | null; gender: string | null; address: string | null
  email: string | null; blood_type: string | null
  emergency_contact: string | null; emergency_phone: string | null
  note: string | null; site_id: number | null; site_name: string | null
  presence: string; access_block_reason: string | null
  // Pha E1–E3: phê duyệt cấp quyền, hiệu lực/khu vực, thu hồi.
  entry_approval_status: string; entry_approval_note: string | null
  entry_approved_at: string | null; entry_signature: string | null
  access_valid_from: string | null; access_valid_to: string | null
  allowed_areas: string[] | null
  revoke_reason: string | null; revoke_note: string | null; revoked_at: string | null
}
interface DocType {
  id: number; code: string; name: string; scope: string
  is_mandatory: boolean; group_name: string | null
}
interface WorkerDoc {
  id: number; doc_type_id: number; doc_type_name: string; doc_type_code: string
  group_name: string | null; is_mandatory: boolean; warn_days_before: number
  file_name: string; stored_name: string | null
  expiry_date: string | null; status: string; reviewer_note: string | null
  days_left: number | null
}
interface TrainingRecord {
  course_id: string; course_title: string; grp: string | null
  passed: boolean; quiz_score: number | null; pass_score: number
  cert_id: string | null; completed_at: string | null
  expires_at: string | null; validity_months: number | null
  status: 'valid' | 'expired' | 'not_passed' | 'in_progress'
  days_left: number | null
}
interface WorkerContract {
  id: number; contract_no: string; title: string | null
  risk_level: string; status: string; assigned_at: string
}
interface Detail {
  worker: WorkerFull; docs: WorkerDoc[]; contracts: WorkerContract[]
  // eligibility: chỉ nói về giấy tờ. access: quyết định cuối ở cổng (Pha E).
  eligibility: { ok: boolean; missing: string[] }
  access: { status: string; reasons: string[] }
  training: TrainingRecord[]
}

const STATUS_COLOR: Record<string, string> = {
  allowed: 'bg-green-100 text-green-700', blocked: 'bg-rose-100 text-rose-700',
  suspended: 'bg-orange-100 text-orange-700', revoked: 'bg-slate-700 text-white',
}
const STATUS_LABEL: Record<string, string> = {
  allowed: 'Cho phép', blocked: 'Chặn', suspended: 'Đình chỉ', revoked: 'Đã thu hồi',
}
const APPROVAL_LABEL: Record<string, string> = {
  pending: 'Chờ phê duyệt', approved: 'Đã phê duyệt',
  returned: 'Trả lại bổ sung', rejected: 'Từ chối',
}
const APPROVAL_COLOR: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700',
  returned: 'bg-amber-100 text-amber-700', rejected: 'bg-rose-100 text-rose-700',
}
const REVOKE_LABEL: Record<string, string> = {
  contract_end: 'Hết hợp đồng', left_project: 'Rời công trường',
  serious_violation: 'Vi phạm nghiêm trọng', other: 'Lý do khác',
}
const DOC_STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700',
  rejected: 'bg-rose-100 text-rose-700',
}
const TRAINING_LABEL: Record<TrainingRecord['status'], string> = {
  valid: 'Còn hiệu lực', expired: 'Hết hạn',
  not_passed: 'Chưa đạt', in_progress: 'Đang học',
}
const TRAINING_COLOR: Record<TrainingRecord['status'], string> = {
  valid: 'bg-green-100 text-green-700', expired: 'bg-rose-100 text-rose-700',
  not_passed: 'bg-orange-100 text-orange-700', in_progress: 'bg-slate-100 text-slate-600',
}
const WORKER_TYPE_LABEL: Record<string, string> = {
  contractor: 'NLĐ nhà thầu', internal: 'Nhân viên nội bộ', visitor: 'Khách',
}
// Nhóm hồ sơ do seed đặt cho các loại WRK_CERT_* — tách khỏi hồ sơ bắt buộc.
const CERT_GROUP = 'Chứng chỉ chuyên môn'

const emptyForm = {
  worker_type: 'contractor', contractor_id: '', site_id: '', full_name: '', id_number: '',
  job_title: '', phone: '', birth_date: '', gender: '', address: '', email: '',
  blood_type: '', emergency_contact: '', emergency_phone: '',
}

export default function WorkersPage() {
  const { user } = useAuth()
  const canPickSite = seesAllSites(user)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [docTypes, setDocTypes] = useState<DocType[]>([])
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [contractors, setContractors] = useState<{ id: number; name: string }[]>([])
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const d = await api<{ workers: Worker[] }>(
      `/hse/workers?q=${encodeURIComponent(q)}&type=${typeFilter}`)
    setWorkers(d.workers)
  }, [q, typeFilter])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    api<{ docTypes: DocType[] }>('/hse/doc-types').then((d) => setDocTypes(d.docTypes.filter((t) => t.scope === 'worker')))
    api<{ contractors: { id: number; name: string }[] }>('/hse/contractors').then((d) => setContractors(d.contractors))
    if (canPickSite) api<{ branches: { id: number; name: string }[] }>('/admin/branches').then((d) => setBranches(d.branches)).catch(() => {})
  }, [canPickSite])

  const openWorker = useCallback(async (id: number) => {
    setSelectedId(id)
    const d = await api<Detail>(`/hse/workers/${id}`)
    setDetail(d)
  }, [])

  const refresh = useCallback(async () => {
    if (selectedId) await openWorker(selectedId)
    await load()
  }, [selectedId, openWorker, load])

  const submit = async () => {
    setErr(''); setBusy(true)
    try {
      const d = await api<{ id: number }>('/hse/workers', { method: 'POST', body: form })
      setShowForm(false); setForm(emptyForm)
      await load()
      await openWorker(d.id)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-2 flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm NLĐ / CCCD…"
            className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm" />
          <button onClick={() => { setShowForm(true); setErr('') }}
            className="rounded bg-vicem-500 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">+ Thêm</button>
        </div>
        <div className="mb-3 flex gap-1 text-xs">
          {([['', 'Tất cả'], ['contractor', 'Nhà thầu'], ['internal', 'Nội bộ'], ['visitor', 'Khách']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setTypeFilter(v)}
              className={`rounded px-2 py-1 font-medium ${typeFilter === v ? 'bg-vicem-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {label}
            </button>
          ))}
        </div>
        <ul className="divide-y divide-slate-100">
          {workers.map((w) => (
            <li key={w.id}>
              <button onClick={() => openWorker(w.id)}
                className={`flex w-full items-center justify-between px-2 py-2 text-left text-sm hover:bg-slate-50 ${selectedId === w.id ? 'bg-slate-50' : ''}`}>
                <span className="min-w-0">
                  <span className="font-medium text-slate-800">{w.full_name}</span>
                  <span className="ml-1 text-xs text-slate-400">{w.id_number}</span>
                  {w.expiring_docs > 0 && (
                    <span className="ml-1 rounded bg-amber-100 px-1 text-xs font-medium text-amber-700"
                      title={`${w.expiring_docs} hồ sơ/chứng chỉ sắp hoặc đã hết hạn`}>
                      ⚠ {w.expiring_docs}
                    </span>
                  )}
                  <span className="block truncate text-xs text-slate-400">
                    {w.worker_type !== 'contractor' ? WORKER_TYPE_LABEL[w.worker_type] : w.contractor_name}
                    {w.job_title ? ` · ${w.job_title}` : ''}
                  </span>
                </span>
                <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[w.access_status] ?? 'bg-slate-100 text-slate-600'}`}>
                  {STATUS_LABEL[w.access_status] ?? w.access_status}
                </span>
              </button>
            </li>
          ))}
          {workers.length === 0 && <li className="py-6 text-center text-sm text-slate-400">Chưa có NLĐ.</li>}
        </ul>
      </section>

      <WorkerDetail detail={detail} docTypes={docTypes} contractors={contractors}
        branches={branches} canPickSite={canPickSite} onRefresh={refresh} />

      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold">Thêm hồ sơ người lao động</h3>
            {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <select value={form.worker_type} onChange={(e) => setForm({ ...form, worker_type: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm">
                <option value="contractor">NLĐ nhà thầu</option>
                <option value="internal">Nhân viên nội bộ</option>
                <option value="visitor">Khách</option>
              </select>
              {form.worker_type === 'contractor' ? (
                <select value={form.contractor_id} onChange={(e) => setForm({ ...form, contractor_id: e.target.value })}
                  className="rounded border border-slate-300 px-3 py-1.5 text-sm">
                  <option value="">-- Chọn nhà thầu *</option>
                  {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              ) : canPickSite ? (
                <select value={form.site_id} onChange={(e) => setForm({ ...form, site_id: e.target.value })}
                  className="rounded border border-slate-300 px-3 py-1.5 text-sm">
                  <option value="">-- Chi nhánh / công trường *</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              ) : (
                <p className="self-center text-xs text-slate-400">Gán vào công trường bạn phụ trách.</p>
              )}
              <input placeholder="Họ và tên *" value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
              <input placeholder="CCCD/CMND" value={form.id_number}
                onChange={(e) => setForm({ ...form, id_number: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
              <input placeholder="Chức danh" value={form.job_title}
                onChange={(e) => setForm({ ...form, job_title: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
              <input placeholder="Số điện thoại" value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
              <div>
                <label className="text-xs text-slate-500">Ngày sinh</label>
                <input type="date" value={form.birth_date}
                  onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-500">Giới tính</label>
                <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm">
                  <option value="">—</option><option value="Nam">Nam</option><option value="Nữ">Nữ</option>
                </select>
              </div>
              <input placeholder="Email" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
              <input placeholder="Nhóm máu" value={form.blood_type}
                onChange={(e) => setForm({ ...form, blood_type: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
              <input placeholder="Địa chỉ" value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm sm:col-span-2" />
              <input placeholder="Người liên hệ khi khẩn cấp" value={form.emergency_contact}
                onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
              <input placeholder="SĐT liên hệ khẩn cấp" value={form.emergency_phone}
                onChange={(e) => setForm({ ...form, emergency_phone: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
            </div>
            <p className="mt-2 text-xs text-slate-400">
              CCCD/CMND là căn cứ nối hồ sơ với lịch sử huấn luyện và chứng chỉ đã cấp — nên khai đầy đủ.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="rounded px-3 py-1.5 text-sm text-slate-500">Hủy</button>
              <button onClick={submit} disabled={busy}
                className="rounded bg-vicem-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                {busy ? 'Đang lưu…' : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Màu theo số ngày còn lại — dùng chung cho hồ sơ và chứng chỉ huấn luyện.
function expiryClass(daysLeft: number | null, warnDays: number): string {
  if (daysLeft == null) return 'text-slate-500'
  if (daysLeft < 0) return 'text-rose-600 font-semibold'
  if (daysLeft <= warnDays) return 'text-amber-600 font-medium'
  return 'text-slate-500'
}
function expiryNote(daysLeft: number | null, warnDays: number): string {
  if (daysLeft == null) return ''
  if (daysLeft < 0) return `quá hạn ${-daysLeft} ngày`
  if (daysLeft <= warnDays) return `còn ${daysLeft} ngày`
  return ''
}

function WorkerDetail({ detail, docTypes, contractors, branches, canPickSite, onRefresh }: {
  detail: Detail | null
  docTypes: DocType[]
  contractors: { id: number; name: string }[]
  branches: { id: number; name: string }[]
  canPickSite: boolean
  onRefresh: () => void
}) {
  const [showUpload, setShowUpload] = useState(false)
  const [showFaceEnroll, setShowFaceEnroll] = useState(false)
  const [editing, setEditing] = useState(false)
  const [upDocType, setUpDocType] = useState('')
  const [expiry, setExpiry] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const worker = detail?.worker ?? null

  const upload = async () => {
    if (!file || !upDocType || !worker) return
    setErr(''); setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('doc_type_id', upDocType)
      if (expiry) fd.append('expiry_date', expiry)
      await api(`/hse/workers/${worker.id}/docs`, { method: 'POST', body: fd, isForm: true })
      setShowUpload(false); setFile(null); setUpDocType(''); setExpiry('')
      onRefresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const review = async (docId: number, status: 'approved' | 'rejected') => {
    await api(`/hse/worker-docs/${docId}`, { method: 'PATCH', body: { status } })
    onRefresh()
  }

  if (!detail || !worker) return (
    <section className="flex items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-sm text-slate-400">
      Chọn người lao động để xem hồ sơ.
    </section>
  )

  const { eligibility, access, training, contracts } = detail
  const certDocs = detail.docs.filter((d) => d.group_name === CERT_GROUP)
  const mainDocs = detail.docs.filter((d) => d.group_name !== CERT_GROUP)
  // Cảnh báo tự động: gộp hồ sơ/chứng chỉ sắp hết hạn và chứng chỉ huấn luyện hết hạn.
  const warnings = [
    ...detail.docs
      .filter((d) => d.status === 'approved' && d.days_left != null && d.days_left <= d.warn_days_before)
      .map((d) => ({
        label: d.doc_type_name, date: d.expiry_date,
        days: d.days_left as number, warn: d.warn_days_before,
      })),
    ...training
      .filter((t) => t.expires_at != null && t.passed && (t.days_left ?? 0) <= 30)
      .map((t) => ({
        label: `Chứng chỉ: ${t.course_title}`, date: t.expires_at,
        days: t.days_left as number, warn: 30,
      })),
  ].sort((a, b) => a.days - b.days)

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-slate-800">{worker.full_name}</p>
            <p className="text-xs text-slate-400">
              {[worker.id_number, worker.job_title,
                worker.worker_type === 'contractor' ? worker.contractor_name : WORKER_TYPE_LABEL[worker.worker_type],
                worker.site_name].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Hai nhãn khác nhau: hồ sơ đủ chưa, và cổng có cho vào không. Trước Pha E
                hai thứ này là một nên chỉ cần một nhãn. */}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${eligibility.ok ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'}`}>
              {eligibility.ok ? '✓ Đủ hồ sơ' : '✗ Thiếu hồ sơ'}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[access.status] ?? 'bg-slate-100 text-slate-600'}`}>
              {access.status === 'allowed' ? '✓ Được vào nhà máy' : STATUS_LABEL[access.status] ?? access.status}
            </span>
            <button onClick={() => setEditing(true)}
              className="rounded bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200">
              ✎ Sửa thông tin
            </button>
            <button onClick={() => { setShowUpload(true); setErr('') }}
              className="rounded bg-vicem-500 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
              + Hồ sơ / chứng chỉ
            </button>
            <button onClick={() => setShowFaceEnroll(true)}
              className="rounded bg-slate-600 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
              title="Đăng ký khuôn mặt để nhận diện tại cổng">
              📷 Khuôn mặt
            </button>
          </div>
        </div>

        {warnings.length > 0 && (
          <div className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs">
            <p className="mb-1 font-semibold text-amber-800">
              ⚠ Cảnh báo hết hạn ({warnings.length})
            </p>
            <ul className="space-y-0.5">
              {warnings.map((w, i) => (
                <li key={i} className={expiryClass(w.days, w.warn)}>
                  {w.label} — {fmtDate(w.date)} ({expiryNote(w.days, w.warn)})
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Lý do bị chặn ở cổng — gồm cả thiếu hồ sơ, chưa phê duyệt, hết hiệu lực,
            đình chỉ và thu hồi. Thay cho hộp "hồ sơ còn thiếu" cũ vì hồ sơ đủ vẫn
            có thể bị chặn. */}
        {access.status !== 'allowed' && access.reasons.length > 0 && (
          <div className="mb-3 rounded bg-rose-50 p-2 text-xs text-rose-600">
            <p className="mb-1 font-semibold">Chưa được vào nhà máy vì:</p>
            <ul className="list-inside list-disc space-y-0.5">{access.reasons.map((m, i) => <li key={i}>{m}</li>)}</ul>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          {([
            ['Ngày sinh', fmtDate(worker.birth_date)],
            ['Giới tính', worker.gender],
            ['Nhóm máu', worker.blood_type],
            ['Điện thoại', worker.phone],
            ['Email', worker.email],
            ['Hiện diện', worker.presence === 'in' ? 'Trong công trường' : 'Ngoài công trường'],
            ['Địa chỉ', worker.address],
            ['Liên hệ khẩn cấp', [worker.emergency_contact, worker.emergency_phone].filter(Boolean).join(' · ')],
          ] as const).map(([label, value]) => (
            <div key={label}>
              <dt className="text-slate-400">{label}</dt>
              <dd className="text-slate-700">{value || '—'}</dd>
            </div>
          ))}
        </dl>
      </div>

      <AccessApprovalPanel worker={worker} onRefresh={onRefresh} />

      <DocTable title="Hồ sơ an toàn bắt buộc" docs={mainDocs} onReview={review}
        empty="Chưa có hồ sơ." />
      <DocTable title="Chứng chỉ chuyên môn" docs={certDocs} onReview={review}
        empty="Chưa có chứng chỉ chuyên môn (hàn, điện, làm việc trên cao…)." />

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Lịch sử huấn luyện ATLĐ</h3>
        {!worker.id_number && (
          <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
            Hồ sơ chưa có CCCD/CMND nên không đối chiếu được với chứng chỉ đã cấp.
          </p>
        )}
        <table className="w-full text-xs">
          <thead><tr className="border-b border-slate-200 text-slate-400">
            <th className="py-1.5 text-left">Khóa học</th>
            <th className="py-1.5 text-left">Điểm</th>
            <th className="py-1.5 text-left">Ngày đạt</th>
            <th className="py-1.5 text-left">Hết hạn</th>
            <th className="py-1.5 text-left">Tình trạng</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {training.map((t) => (
              <tr key={t.course_id} className="hover:bg-slate-50">
                <td className="py-1.5">
                  <span className="font-medium text-slate-700">{t.course_title}</span>
                  {t.cert_id && <span className="block text-slate-400">Số CC: {t.cert_id}</span>}
                </td>
                <td className="py-1.5 text-slate-500">
                  {t.quiz_score == null ? '—' : `${t.quiz_score}/${t.pass_score}`}
                </td>
                <td className="py-1.5 text-slate-500">{fmtDate(t.completed_at)}</td>
                <td className={`py-1.5 ${expiryClass(t.days_left, 30)}`}>
                  {/* Chưa đạt thì chưa có hạn — không hiển thị "Không hết hạn" gây hiểu nhầm. */}
                  {t.expires_at ? fmtDate(t.expires_at) : t.passed ? 'Không hết hạn' : '—'}
                </td>
                <td className="py-1.5">
                  <span className={`rounded-full px-1.5 py-0.5 ${TRAINING_COLOR[t.status]}`}>
                    {TRAINING_LABEL[t.status]}
                  </span>
                </td>
              </tr>
            ))}
            {training.length === 0 && (
              <tr><td colSpan={5} className="py-4 text-center text-slate-400">Chưa có kết quả huấn luyện.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Hợp đồng đang tham gia</h3>
        <ul className="divide-y divide-slate-100 text-xs">
          {contracts.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-1.5">
              <span>
                <span className="font-medium text-slate-700">{c.contract_no}</span>
                {c.title && <span className="text-slate-400"> · {c.title}</span>}
                <span className="block text-slate-400">Gán ngày {fmtDate(c.assigned_at)}</span>
              </span>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                Rủi ro {c.risk_level}
              </span>
            </li>
          ))}
          {contracts.length === 0 && (
            <li className="py-3 text-center text-slate-400">
              Chưa được khai báo vào hợp đồng nào — mức rủi ro mặc định thấp nhất.
            </li>
          )}
        </ul>
      </div>

      {showFaceEnroll && (
        <FaceEnrollModal id={worker.id} type="worker" name={worker.full_name}
          onClose={() => setShowFaceEnroll(false)} onSuccess={onRefresh} />
      )}

      {editing && (
        <EditWorkerModal worker={worker} contractors={contractors} branches={branches}
          canPickSite={canPickSite} onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); onRefresh() }} />
      )}

      {showUpload && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowUpload(false)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 font-semibold">Hồ sơ / chứng chỉ — {worker.full_name}</h3>
            {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
            <div className="space-y-2">
              <select value={upDocType} onChange={(e) => setUpDocType(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm">
                <option value="">-- Loại hồ sơ *</option>
                {docTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.group_name ? `[${t.group_name}] ` : ''}{t.name}{t.is_mandatory ? ' *' : ''}
                  </option>
                ))}
              </select>
              <div>
                <label className="text-xs text-slate-500">Ngày hết hạn (để trống nếu không hết hạn)</label>
                <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" />
              </div>
              <input type="file" ref={fileRef} accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full text-sm" />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowUpload(false)} className="rounded px-3 py-1.5 text-sm text-slate-500">Hủy</button>
              <button onClick={upload} disabled={busy || !file || !upDocType}
                className="rounded bg-vicem-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                {busy ? 'Đang tải…' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * Phê duyệt cấp quyền vào nhà máy (Pha E, bước 6–7–10).
 *
 * Chỉ người có quyền 'approve' thấy các nút; người chỉ có 'inspect' vẫn đọc được trạng
 * thái để biết hồ sơ đang nằm ở đâu, nhưng không bấm được — khớp với guard canApprove
 * ở server, không để UI mời bấm rồi nhận 403.
 */
function AccessApprovalPanel({ worker, onRefresh }: {
  worker: WorkerFull; onRefresh: () => void
}) {
  const { user } = useAuth()
  const canApprove = canHse(user, 'approve')
  const [validFrom, setValidFrom] = useState(worker.access_valid_from?.slice(0, 10) ?? '')
  const [validTo, setValidTo] = useState(worker.access_valid_to?.slice(0, 10) ?? '')
  const [areas, setAreas] = useState((worker.allowed_areas ?? []).join(', '))
  const [note, setNote] = useState('')
  const [revokeReason, setRevokeReason] = useState('contract_end')
  const [showRevoke, setShowRevoke] = useState(false)
  const [signing, setSigning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Đổi NLĐ đang xem thì nạp lại form theo hồ sơ mới, không giữ số liệu của người trước.
  useEffect(() => {
    setValidFrom(worker.access_valid_from?.slice(0, 10) ?? '')
    setValidTo(worker.access_valid_to?.slice(0, 10) ?? '')
    setAreas((worker.allowed_areas ?? []).join(', '))
    setNote(''); setErr(''); setShowRevoke(false)
  }, [worker.id, worker.access_valid_from, worker.access_valid_to, worker.allowed_areas])

  const decide = async (status: 'approved' | 'returned' | 'rejected' | 'pending') => {
    setErr(''); setBusy(true)
    try {
      await api(`/hse/workers/${worker.id}/entry-approval`, {
        method: 'PATCH',
        body: {
          status, note,
          access_valid_from: validFrom || null,
          access_valid_to: validTo || null,
          allowed_areas: areas.split(',').map((a) => a.trim()).filter(Boolean),
        },
      })
      setNote('')
      onRefresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const revoke = async () => {
    setErr(''); setBusy(true)
    try {
      await api(`/hse/workers/${worker.id}/revoke`, {
        method: 'PATCH', body: { reason: revokeReason, note },
      })
      setShowRevoke(false); setNote('')
      onRefresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const restore = async () => {
    setErr(''); setBusy(true)
    try {
      await api(`/hse/workers/${worker.id}/restore-access`, { method: 'PATCH', body: { note } })
      setNote('')
      onRefresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const revoked = worker.access_status === 'revoked'

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">Quyền vào nhà máy</h3>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${APPROVAL_COLOR[worker.entry_approval_status] ?? 'bg-slate-100 text-slate-600'}`}>
            {APPROVAL_LABEL[worker.entry_approval_status] ?? worker.entry_approval_status}
          </span>
          {worker.entry_signature && (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700"
              title="Quyết định phê duyệt đã được ký số bằng SmartCA VNPT">
              🔐 Đã ký số
            </span>
          )}
        </div>
      </div>

      {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-xs text-rose-600">{err}</p>}

      {worker.entry_approved_at && (
        <p className="mb-2 text-xs text-slate-400">
          Quyết định ngày {fmtDate(worker.entry_approved_at)}
          {worker.entry_approval_note ? ` — ${worker.entry_approval_note}` : ''}
        </p>
      )}

      {revoked ? (
        <div className="rounded border border-slate-300 bg-slate-50 p-3 text-xs">
          <p className="font-semibold text-slate-700">
            Đã thu hồi quyền{worker.revoke_reason ? `: ${REVOKE_LABEL[worker.revoke_reason] ?? worker.revoke_reason}` : ''}
          </p>
          {worker.revoke_note && <p className="mt-0.5 text-slate-500">{worker.revoke_note}</p>}
          {worker.revoked_at && <p className="mt-0.5 text-slate-400">Ngày {fmtDate(worker.revoked_at)}</p>}
          <p className="mt-1 text-slate-500">
            Thu hồi không tự khôi phục khi hồ sơ đủ lại. Khôi phục xong vẫn phải phê duyệt lại.
          </p>
          {canApprove && (
            <button onClick={restore} disabled={busy}
              className="mt-2 rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              {busy ? 'Đang xử lý…' : 'Khôi phục quyền'}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-xs text-slate-500">Hiệu lực từ</label>
              <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)}
                disabled={!canApprove}
                className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-50" />
            </div>
            <div>
              <label className="text-xs text-slate-500">Đến ngày (trống = không hạn)</label>
              <input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)}
                disabled={!canApprove}
                className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-50" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-slate-500">Khu vực được phép (phân tách bằng dấu phẩy)</label>
              <input value={areas} onChange={(e) => setAreas(e.target.value)}
                disabled={!canApprove} placeholder="VD: Lò nung, Nghiền xi măng, Kho clinker"
                className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-50" />
            </div>
            {canApprove && (
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Ý kiến phê duyệt / lý do trả lại, từ chối"
                className="rounded border border-slate-300 px-3 py-1.5 text-sm sm:col-span-2" />
            )}
          </div>

          {canApprove && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => decide('approved')} disabled={busy}
                className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                ✓ Phê duyệt cấp quyền
              </button>
              <button onClick={() => decide('returned')} disabled={busy}
                className="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                ↩ Trả lại bổ sung
              </button>
              <button onClick={() => decide('rejected')} disabled={busy}
                className="rounded bg-rose-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                ✗ Từ chối
              </button>
              {worker.entry_approval_status === 'approved' && !worker.entry_signature && (
                <button onClick={() => setSigning(true)} disabled={busy}
                  className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                  🔐 Ký số SmartCA
                </button>
              )}
              <button onClick={() => { setShowRevoke(true); setErr('') }} disabled={busy}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                Thu hồi quyền
              </button>
            </div>
          )}
          {!canApprove && (
            <p className="mt-2 text-xs text-slate-400">
              Phê duyệt cấp quyền vào nhà máy thuộc quyền "approve" — liên hệ cấp phê duyệt.
            </p>
          )}
        </>
      )}

      {showRevoke && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowRevoke(false)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 font-semibold">Thu hồi quyền — {worker.full_name}</h3>
            <p className="mb-3 text-xs text-slate-500">
              Thu hồi khác đình chỉ: hồ sơ đủ lại cũng không tự mở, và dấu phê duyệt hiện
              tại bị xóa. Muốn mở lại phải khôi phục rồi phê duyệt lại.
            </p>
            {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-xs text-rose-600">{err}</p>}
            <select value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm">
              {Object.entries(REVOKE_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={revokeReason === 'other' ? 'Ghi rõ lý do *' : 'Ghi chú'}
              className="mt-2 w-full rounded border border-slate-300 px-3 py-1.5 text-sm" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowRevoke(false)} className="rounded px-3 py-1.5 text-sm text-slate-500">Hủy</button>
              <button onClick={revoke} disabled={busy || (revokeReason === 'other' && !note.trim())}
                className="rounded bg-rose-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                {busy ? 'Đang xử lý…' : 'Thu hồi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {signing && (
        <SmartCAModal
          initPath={`/hse/workers/${worker.id}/entry-approval/smartca/init`}
          statusPath={`/hse/workers/${worker.id}/entry-approval/smartca/status`}
          // Người ký là tài khoản đang đăng nhập, server không nhận signer_name.
          collectSigner={false}
          successText="Quyết định cấp quyền vào nhà máy đã được ký số."
          onClose={() => setSigning(false)}
          onSigned={() => { setSigning(false); onRefresh() }}
        />
      )}
    </div>
  )
}

function DocTable({ title, docs, empty, onReview }: {
  title: string; docs: WorkerDoc[]; empty: string
  onReview: (id: number, status: 'approved' | 'rejected') => void
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{title}</h3>
      <table className="w-full text-xs">
        <thead><tr className="border-b border-slate-200 text-slate-400">
          <th className="py-1.5 text-left">Loại hồ sơ</th>
          <th className="py-1.5 text-left">Tệp</th>
          <th className="py-1.5 text-left">Hạn</th>
          <th className="py-1.5 text-left">TT</th>
          <th className="py-1.5" />
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {docs.map((d) => (
            <tr key={d.id} className="hover:bg-slate-50">
              <td className="py-1.5 font-medium text-slate-700">
                {d.doc_type_name}{d.is_mandatory ? ' *' : ''}
              </td>
              <td className="max-w-[140px] py-1.5 text-slate-500">
                {d.stored_name ? (
                  <button onClick={() => openFileInNewTab(`/hse/worker-docs/${d.id}/file`).catch((e) => alert((e as Error).message))}
                    className="truncate text-vicem-500 hover:underline" title={`Xem ${d.file_name}`}>
                    👁 {d.file_name}
                  </button>
                ) : <span className="truncate">{d.file_name}</span>}
              </td>
              <td className={`py-1.5 ${expiryClass(d.days_left, d.warn_days_before)}`}>
                {fmtDate(d.expiry_date)}
                {d.status === 'approved' && expiryNote(d.days_left, d.warn_days_before) && (
                  <span className="block">{expiryNote(d.days_left, d.warn_days_before)}</span>
                )}
              </td>
              <td className="py-1.5">
                <span className={`rounded-full px-1.5 py-0.5 ${DOC_STATUS_COLOR[d.status] ?? 'bg-slate-100 text-slate-600'}`}>
                  {d.status === 'pending' ? 'Chờ' : d.status === 'approved' ? 'Đã duyệt' : 'Từ chối'}
                </span>
              </td>
              <td className="py-1.5">
                {d.status !== 'approved' ? (
                  <div className="flex gap-1">
                    <button onClick={() => onReview(d.id, 'approved')} className="rounded bg-green-100 px-1.5 py-0.5 text-green-700 hover:bg-green-200" title="Duyệt">✓</button>
                    {d.status !== 'rejected' && (
                      <button onClick={() => onReview(d.id, 'rejected')} className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-700 hover:bg-rose-200" title="Từ chối">✗</button>
                    )}
                  </div>
                ) : (
                  <button onClick={() => onReview(d.id, 'rejected')} className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Hủy duyệt">↺</button>
                )}
              </td>
            </tr>
          ))}
          {docs.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-400">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function EditWorkerModal({ worker, contractors, branches, canPickSite, onClose, onSaved }: {
  worker: WorkerFull
  contractors: { id: number; name: string }[]
  branches: { id: number; name: string }[]
  canPickSite: boolean
  onClose: () => void; onSaved: () => void
}) {
  const [f, setF] = useState({
    worker_type: worker.worker_type,
    contractor_id: worker.contractor_id ? String(worker.contractor_id) : '',
    site_id: worker.site_id ? String(worker.site_id) : '',
    full_name: worker.full_name,
    id_number: worker.id_number ?? '',
    job_title: worker.job_title ?? '',
    phone: worker.phone ?? '',
    // input[type=date] chỉ nhận yyyy-mm-dd; hiển thị dd/mm/yyyy là việc của fmtDate ở chỗ khác.
    birth_date: worker.birth_date ? worker.birth_date.slice(0, 10) : '',
    gender: worker.gender ?? '',
    address: worker.address ?? '',
    email: worker.email ?? '',
    blood_type: worker.blood_type ?? '',
    emergency_contact: worker.emergency_contact ?? '',
    emergency_phone: worker.emergency_phone ?? '',
    note: worker.note ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    setErr(''); setBusy(true)
    try {
      const body: Record<string, unknown> = { ...f }
      if (!canPickSite) delete body.site_id
      await api(`/hse/workers/${worker.id}`, { method: 'PATCH', body })
      onSaved()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-lg font-semibold">Sửa hồ sơ — {worker.full_name}</h3>
        {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          <select value={f.worker_type} onChange={(e) => setF({ ...f, worker_type: e.target.value })}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm">
            <option value="contractor">NLĐ nhà thầu</option>
            <option value="internal">Nhân viên nội bộ</option>
            <option value="visitor">Khách</option>
          </select>
          <select value={f.contractor_id} onChange={(e) => setF({ ...f, contractor_id: e.target.value })}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm">
            <option value="">-- Không thuộc nhà thầu</option>
            {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {canPickSite && (
            <select value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm sm:col-span-2">
              <option value="">-- Chi nhánh / công trường</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <input placeholder="Họ và tên *" value={f.full_name}
            onChange={(e) => setF({ ...f, full_name: e.target.value })}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
          <input placeholder="CCCD/CMND" value={f.id_number}
            onChange={(e) => setF({ ...f, id_number: e.target.value })}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
          <input placeholder="Chức danh" value={f.job_title}
            onChange={(e) => setF({ ...f, job_title: e.target.value })}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
          <input placeholder="Số điện thoại" value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
          <div>
            <label className="text-xs text-slate-500">Ngày sinh</label>
            <input type="date" value={f.birth_date}
              onChange={(e) => setF({ ...f, birth_date: e.target.value })}
              className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500">Giới tính</label>
            <select value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}
              className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm">
              <option value="">—</option><option value="Nam">Nam</option><option value="Nữ">Nữ</option>
            </select>
          </div>
          <input placeholder="Email" value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
          <input placeholder="Nhóm máu" value={f.blood_type}
            onChange={(e) => setF({ ...f, blood_type: e.target.value })}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
          <input placeholder="Địa chỉ" value={f.address}
            onChange={(e) => setF({ ...f, address: e.target.value })}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm sm:col-span-2" />
          <input placeholder="Người liên hệ khi khẩn cấp" value={f.emergency_contact}
            onChange={(e) => setF({ ...f, emergency_contact: e.target.value })}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
          <input placeholder="SĐT liên hệ khẩn cấp" value={f.emergency_phone}
            onChange={(e) => setF({ ...f, emergency_phone: e.target.value })}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
          <textarea placeholder="Ghi chú" rows={2} value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm sm:col-span-2" />
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Đổi chức danh sẽ xét lại bộ hồ sơ bắt buộc (theo ma trận chức danh × mức rủi ro) và cập nhật quyền ra/vào.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-slate-500">Hủy</button>
          <button onClick={save} disabled={busy || !f.full_name.trim()}
            className="rounded bg-vicem-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {busy ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  )
}
