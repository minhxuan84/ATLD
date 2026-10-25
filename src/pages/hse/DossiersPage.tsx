// Đánh giá hồ sơ nhà thầu theo hợp đồng (BM111-07.02, Phase B).
import { useEffect, useState, useCallback, useRef, Fragment } from 'react'
import { api, openFileInNewTab } from '../../lib/api'
import EmptyContractsHint from '../../components/hse/EmptyContractsHint'

interface Contract {
  id: number; contract_no: string; title: string; contractor_name: string; status: string
}
interface DocType { id: number; code: string; name: string; group_name: string | null; is_mandatory: boolean }
interface CtrDoc {
  id: number; doc_type_id: number; file_name: string; stored_name: string | null
  expiry_date: string | null; status: string; reviewer_note: string | null; uploaded_at: string
}
interface Dossier {
  id: number; status: string; submitted_at: string | null; approved_at: string | null; review_note: string | null
}
interface DossierData {
  dossier: Dossier; docTypes: DocType[]; docs: CtrDoc[]
  completeness: { ok: boolean; missing: string[] }
}

const DOSSIER_STATUS: Record<string, [string, string]> = {
  draft: ['Nháp', 'bg-slate-100 text-slate-600'],
  submitted: ['Đã nộp', 'bg-blue-100 text-blue-700'],
  approved: ['Đã duyệt', 'bg-green-100 text-green-700'],
  rejected: ['Từ chối', 'bg-rose-100 text-rose-700'],
}
const DOC_STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700',
  rejected: 'bg-rose-100 text-rose-700',
}

export default function DossiersPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [selected, setSelected] = useState<Contract | null>(null)
  const [data, setData] = useState<DossierData | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    api<{ contracts: Contract[] }>('/hse/contracts').then((d) => setContracts(d.contracts))
  }, [])

  const openContract = useCallback(async (c: Contract) => {
    setSelected(c)
    const d = await api<DossierData>(`/hse/contracts/${c.id}/dossier`)
    setData(d)
  }, [])

  const refresh = () => { if (selected) openContract(selected) }
  const filtered = contracts.filter((c) =>
    !q || c.contract_no.toLowerCase().includes(q.toLowerCase()) || c.title.toLowerCase().includes(q.toLowerCase()) ||
    c.contractor_name.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1.5fr]">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm hợp đồng / nhà thầu…"
          className="mb-3 w-full rounded border border-slate-300 px-3 py-1.5 text-sm" />
        <ul className="divide-y divide-slate-100">
          {filtered.map((c) => (
            <li key={c.id}>
              <button onClick={() => openContract(c)}
                className={`w-full px-2 py-2 text-left text-sm hover:bg-slate-50 ${selected?.id === c.id ? 'bg-slate-50' : ''}`}>
                <span className="font-medium text-slate-800">{c.contract_no}</span>
                <span className="block text-xs text-slate-400">{c.title}</span>
                <span className="block text-xs text-slate-400">{c.contractor_name}</span>
              </button>
            </li>
          ))}
          {/* Rỗng vì tìm kiếm không khớp là chuyện khác với rỗng vì không có hợp đồng nào
              thuộc site mình — chỉ gợi ý lý do site khi danh sách gốc cũng rỗng. */}
          {filtered.length === 0 && (
            <li className="py-6 text-center text-sm text-slate-400">
              {contracts.length === 0 ? <EmptyContractsHint /> : 'Không khớp từ khóa tìm kiếm.'}
            </li>
          )}
        </ul>
      </section>

      <DossierDetail contract={selected} data={data} onRefresh={refresh} />
    </div>
  )
}

function DossierDetail({ contract, data, onRefresh }: {
  contract: Contract | null; data: DossierData | null; onRefresh: () => void
}) {
  const [showUpload, setShowUpload] = useState<DocType | null>(null)
  const [expiry, setExpiry] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const upload = async () => {
    if (!file || !showUpload || !data) return
    setErr(''); setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file); fd.append('doc_type_id', String(showUpload.id))
      if (expiry) fd.append('expiry_date', expiry)
      await api(`/hse/dossiers/${data.dossier.id}/docs`, { method: 'POST', body: fd, isForm: true })
      setShowUpload(null); setFile(null); setExpiry(''); onRefresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const review = async (docId: number, status: 'approved' | 'rejected') => {
    await api(`/hse/contractor-docs/${docId}`, { method: 'PATCH', body: { status } })
    onRefresh()
  }
  const setStatus = async (status: string) => {
    if (!data) return
    await api(`/hse/dossiers/${data.dossier.id}/status`, { method: 'PATCH', body: { status } })
    onRefresh()
  }

  if (!contract || !data) return (
    <section className="flex items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-sm text-slate-400">
      Chọn hợp đồng để đánh giá hồ sơ nhà thầu.
    </section>
  )

  // Nhóm doc theo group_name; mỗi loại lấy bản mới nhất để hiển thị trạng thái.
  const groups = new Map<string, DocType[]>()
  for (const dt of data.docTypes) {
    const g = dt.group_name ?? 'Khác'
    groups.set(g, [...(groups.get(g) ?? []), dt])
  }
  const docsByType = new Map<number, CtrDoc[]>()
  for (const d of data.docs) docsByType.set(d.doc_type_id, [...(docsByType.get(d.doc_type_id) ?? []), d])
  const [stLabel, stColor] = DOSSIER_STATUS[data.dossier.status] ?? ['—', 'bg-slate-100']

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-semibold text-slate-800">{contract.contract_no}</p>
          <p className="text-xs text-slate-400">{contract.title} · {contract.contractor_name}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stColor}`}>{stLabel}</span>
      </div>

      <div className={`mb-3 rounded p-2 text-xs ${data.completeness.ok ? 'bg-green-50 text-green-700' : 'bg-rose-50 text-rose-600'}`}>
        {data.completeness.ok ? '✓ Đầy đủ hồ sơ bắt buộc' : (
          <><p className="font-semibold mb-1">Còn thiếu hồ sơ bắt buộc:</p>
            <ul className="list-disc list-inside space-y-0.5">{data.completeness.missing.map((m, i) => <li key={i}>{m}</li>)}</ul></>
        )}
      </div>

      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {[...groups.entries()].map(([g, types]) => (
            <Fragment key={g}>
              <tr><td colSpan={4} className="bg-slate-50 px-2 py-1 text-xs font-semibold text-vicem-500">{g}</td></tr>
              {types.map((dt) => {
                const docs = docsByType.get(dt.id) ?? []
                const latest = docs[0]
                return (
                  <tr key={dt.id} className="text-xs hover:bg-slate-50">
                    <td className="py-1.5 font-medium text-slate-700">{dt.name}{dt.is_mandatory && <span className="text-rose-500"> *</span>}</td>
                    <td className="py-1.5 text-slate-500 max-w-[150px]">
                      {latest?.stored_name ? (
                        <button onClick={() => openFileInNewTab(`/hse/contractor-docs/${latest.id}/file`).catch((e) => alert((e as Error).message))}
                          className="truncate text-vicem-500 hover:underline" title={latest.file_name}>👁 {latest.file_name}</button>
                      ) : <span className="text-slate-300">chưa nộp</span>}
                    </td>
                    <td className="py-1.5">
                      {latest && <span className={`rounded-full px-1.5 py-0.5 ${DOC_STATUS_COLOR[latest.status] ?? 'bg-slate-100'}`}>
                        {latest.status === 'pending' ? 'Chờ' : latest.status === 'approved' ? 'Duyệt' : 'Từ chối'}</span>}
                    </td>
                    <td className="py-1.5 text-right">
                      <div className="flex justify-end gap-1">
                        {latest && latest.status !== 'approved' && (
                          <button onClick={() => review(latest.id, 'approved')} className="rounded bg-green-100 px-1.5 py-0.5 text-green-700 hover:bg-green-200" title="Duyệt">✓</button>
                        )}
                        {latest && latest.status !== 'rejected' && (
                          <button onClick={() => review(latest.id, 'rejected')} className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-700 hover:bg-rose-200" title="Từ chối">✗</button>
                        )}
                        <button onClick={() => { setShowUpload(dt); setErr(''); setFile(null); setExpiry('') }}
                          className="rounded bg-vicem-500 px-1.5 py-0.5 text-white hover:opacity-90" title="Upload">⤒</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </Fragment>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
        {data.dossier.status !== 'submitted' && (
          <button onClick={() => setStatus('submitted')} className="rounded bg-blue-100 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-200">Đánh dấu đã nộp</button>
        )}
        <button onClick={() => setStatus('approved')} disabled={!data.completeness.ok}
          className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40" title={data.completeness.ok ? '' : 'Cần đủ hồ sơ bắt buộc'}>Duyệt hồ sơ</button>
        <button onClick={() => setStatus('rejected')} className="rounded bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">Từ chối</button>
      </div>

      {showUpload && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowUpload(null)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 font-semibold">Upload hồ sơ</h3>
            <p className="mb-3 text-xs text-slate-400">{showUpload.name}</p>
            {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
            <div className="space-y-2">
              <div><label className="text-xs text-slate-500">Ngày hết hạn (nếu có)</label>
                <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" /></div>
              <input type="file" ref={fileRef} accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full text-sm" />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowUpload(null)} className="rounded px-3 py-1.5 text-sm text-slate-500">Hủy</button>
              <button onClick={upload} disabled={busy || !file}
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
