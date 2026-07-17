// Danh sách người lao động + upload/review hồ sơ.
import { useEffect, useState, useCallback, useRef } from 'react'
import { api, openFileInNewTab } from '../../lib/api'
import { fmtDate } from '../../lib/date'

interface Worker {
  id: number; full_name: string; id_number: string | null; job_title: string | null
  phone: string | null; access_status: string; contractor_id: number; contractor_name: string
}
interface DocType { id: number; code: string; name: string; scope: string; is_mandatory: boolean }
interface WorkerDoc {
  id: number; doc_type_id: number; doc_type_name: string; file_name: string; stored_name: string | null
  expiry_date: string | null; status: string; reviewer_note: string | null
}

const STATUS_COLOR: Record<string, string> = {
  allowed: 'bg-green-100 text-green-700', blocked: 'bg-rose-100 text-rose-700',
  suspended: 'bg-orange-100 text-orange-700',
}
const DOC_STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700',
  rejected: 'bg-rose-100 text-rose-700',
}

export default function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([])
  const [docTypes, setDocTypes] = useState<DocType[]>([])
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Worker | null>(null)
  const [detail, setDetail] = useState<{ docs: WorkerDoc[]; eligibility: { ok: boolean; missing: string[] } } | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ full_name: '', id_number: '', job_title: '', phone: '', contractor_id: '', birth_date: '' })
  const [contractors, setContractors] = useState<{ id: number; name: string }[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const d = await api<{ workers: Worker[] }>(`/hse/workers?q=${encodeURIComponent(q)}`)
    setWorkers(d.workers)
  }, [q])

  useEffect(() => {
    load()
    api<{ docTypes: DocType[] }>('/hse/doc-types').then((d) => setDocTypes(d.docTypes.filter((t) => t.scope === 'worker')))
    api<{ contractors: { id: number; name: string }[] }>('/hse/contractors').then((d) => setContractors(d.contractors))
  }, [load])

  const openWorker = async (w: Worker) => {
    setSelected(w)
    const d = await api<{ docs: WorkerDoc[]; eligibility: { ok: boolean; missing: string[] } }>(`/hse/workers/${w.id}`)
    setDetail(d)
  }

  const submit = async () => {
    setErr(''); setBusy(true)
    try {
      await api('/hse/workers', { method: 'POST', body: form })
      setShowForm(false); setForm({ full_name: '', id_number: '', job_title: '', phone: '', contractor_id: '', birth_date: '' })
      await load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1.3fr]">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm NLĐ / CCCD…"
            className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm" />
          <button onClick={() => { setShowForm(true); setErr('') }}
            className="rounded bg-vicem-500 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">+ Thêm</button>
        </div>
        <ul className="divide-y divide-slate-100">
          {workers.map((w) => (
            <li key={w.id}>
              <button onClick={() => openWorker(w)}
                className={`flex w-full items-center justify-between px-2 py-2 text-left text-sm hover:bg-slate-50 ${selected?.id === w.id ? 'bg-slate-50' : ''}`}>
                <span>
                  <span className="font-medium text-slate-800">{w.full_name}</span>
                  <span className="ml-1 text-xs text-slate-400">{w.id_number}</span>
                  <span className="block text-xs text-slate-400">{w.contractor_name} · {w.job_title}</span>
                </span>
                <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[w.access_status] ?? 'bg-slate-100 text-slate-600'}`}>
                  {w.access_status === 'allowed' ? 'Cho phép' : w.access_status === 'blocked' ? 'Chặn' : 'Đình chỉ'}
                </span>
              </button>
            </li>
          ))}
          {workers.length === 0 && <li className="py-6 text-center text-sm text-slate-400">Chưa có NLĐ.</li>}
        </ul>
      </section>

      <WorkerDetail worker={selected} detail={detail} docTypes={docTypes} onRefresh={() => selected && openWorker(selected)} />

      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold">Thêm người lao động</h3>
            {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
            <div className="space-y-2">
              <select value={form.contractor_id} onChange={(e) => setForm({ ...form, contractor_id: e.target.value })}
                className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm">
                <option value="">-- Chọn nhà thầu *</option>
                {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {([['full_name', 'Họ và tên *'], ['id_number', 'CCCD/CMND'], ['job_title', 'Chức danh'], ['phone', 'SĐT']] as const).map(([k, label]) => (
                <input key={k} placeholder={label} value={form[k as keyof typeof form]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" />
              ))}
              <div><label className="text-xs text-slate-500">Ngày sinh</label>
                <input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" /></div>
            </div>
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

function WorkerDetail({ worker, detail, docTypes, onRefresh }: {
  worker: Worker | null
  detail: { docs: WorkerDoc[]; eligibility: { ok: boolean; missing: string[] } } | null
  docTypes: DocType[]; onRefresh: () => void
}) {
  const [showUpload, setShowUpload] = useState(false)
  const [upDocType, setUpDocType] = useState('')
  const [expiry, setExpiry] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

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

  if (!worker || !detail) return (
    <section className="flex items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-sm text-slate-400">
      Chọn người lao động để xem hồ sơ.
    </section>
  )

  const { eligibility } = detail
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-semibold text-slate-800">{worker.full_name}</p>
          <p className="text-xs text-slate-400">{worker.id_number} · {worker.job_title} · {worker.contractor_name}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${eligibility.ok ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'}`}>
            {eligibility.ok ? '✓ Đủ điều kiện' : '✗ Chưa đủ'}
          </span>
          <button onClick={() => { setShowUpload(true); setErr('') }}
            className="rounded bg-vicem-500 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
            + Upload hồ sơ
          </button>
        </div>
      </div>

      {!eligibility.ok && eligibility.missing.length > 0 && (
        <div className="mb-3 rounded bg-rose-50 p-2 text-xs text-rose-600">
          <p className="font-semibold mb-1">Hồ sơ còn thiếu:</p>
          <ul className="list-disc list-inside space-y-0.5">{eligibility.missing.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}

      <table className="w-full text-sm">
        <thead><tr className="border-b border-slate-200 text-xs text-slate-400">
          <th className="py-1.5 text-left">Loại hồ sơ</th>
          <th className="py-1.5 text-left">Tệp</th>
          <th className="py-1.5 text-left">Hạn</th>
          <th className="py-1.5 text-left">TT</th>
          <th className="py-1.5" />
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {detail.docs.map((d) => (
            <tr key={d.id} className="hover:bg-slate-50 text-xs">
              <td className="py-1.5 font-medium text-slate-700">{d.doc_type_name}</td>
              <td className="py-1.5 text-slate-500 max-w-[140px]">
                {d.stored_name ? (
                  <button onClick={() => openFileInNewTab(`/hse/worker-docs/${d.id}/file`).catch((e) => alert((e as Error).message))}
                    className="truncate text-vicem-500 hover:underline" title={`Xem ${d.file_name}`}>
                    👁 {d.file_name}
                  </button>
                ) : (
                  <span className="truncate">{d.file_name}</span>
                )}
              </td>
              <td className={`py-1.5 ${d.expiry_date && d.expiry_date.slice(0, 10) < new Date().toISOString().slice(0, 10) ? 'text-rose-600 font-medium' : 'text-slate-500'}`}>
                {fmtDate(d.expiry_date)}
              </td>
              <td className="py-1.5">
                <span className={`rounded-full px-1.5 py-0.5 text-xs ${DOC_STATUS_COLOR[d.status] ?? 'bg-slate-100 text-slate-600'}`}>
                  {d.status === 'pending' ? 'Chờ' : d.status === 'approved' ? 'Đã duyệt' : 'Từ chối'}
                </span>
              </td>
              <td className="py-1.5">
                {d.status !== 'approved' ? (
                  <div className="flex gap-1">
                    <button onClick={() => review(d.id, 'approved')} className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700 hover:bg-green-200" title="Duyệt">✓</button>
                    {d.status !== 'rejected' && (
                      <button onClick={() => review(d.id, 'rejected')} className="rounded bg-rose-100 px-1.5 py-0.5 text-xs text-rose-700 hover:bg-rose-200" title="Từ chối">✗</button>
                    )}
                  </div>
                ) : (
                  <button onClick={() => review(d.id, 'rejected')} className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Hủy duyệt">↺</button>
                )}
              </td>
            </tr>
          ))}
          {detail.docs.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-400">Chưa có hồ sơ.</td></tr>}
        </tbody>
      </table>

      {showUpload && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowUpload(false)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 font-semibold">Upload hồ sơ — {worker.full_name}</h3>
            {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
            <div className="space-y-2">
              <select value={upDocType} onChange={(e) => setUpDocType(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm">
                <option value="">-- Loại hồ sơ *</option>
                {docTypes.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_mandatory ? ' *' : ''}</option>)}
              </select>
              <div><label className="text-xs text-slate-500">Ngày hết hạn</label>
                <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" /></div>
              <input type="file" ref={fileRef} accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm" />
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
