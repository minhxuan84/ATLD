// Bản cam kết điện tử ATVSLĐ-PCCN-BVMT (BM111-07.01, Phase C): tạo, ký tay, xuất PDF QR.
import { useEffect, useState, useCallback, useRef, useLayoutEffect } from 'react'
import { api } from '../../lib/api'
import { exportCommitmentPdf } from '../../lib/formPdf'
import { fmtDate } from '../../lib/date'
import SmartCAModal from '../../components/hse/SmartCAModal'

interface Contract { id: number; contract_no: string; title: string; contractor_name: string }
interface Commitment {
  id: number; contract_id: number; title: string; signer_name: string | null; signer_title: string | null
  status: string; signed_at: string | null; created_at: string
  contract_no: string; contract_title: string; contractor_name: string
}
interface CommitmentFull extends Commitment {
  content: string; signature_data: string | null; verify_code: string | null
  work_location: string | null; rep_name: string | null; rep_title: string | null
}

const VI_DATE = (s: string | null) => fmtDate(s)

export default function CommitmentsPage() {
  const [list, setList] = useState<Commitment[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [detail, setDetail] = useState<CommitmentFull | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newContract, setNewContract] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const d = await api<{ commitments: Commitment[] }>('/hse/commitments')
    setList(d.commitments)
  }, [])

  useEffect(() => {
    load()
    api<{ contracts: Contract[] }>('/hse/contracts').then((d) => setContracts(d.contracts))
  }, [load])

  const open = async (c: Commitment) => {
    const d = await api<{ commitment: CommitmentFull }>(`/hse/commitments/${c.id}`)
    setDetail(d.commitment)
  }

  const create = async () => {
    if (!newContract) return
    setErr('')
    try {
      const r = await api<{ id: number }>('/hse/commitments', { method: 'POST', body: { contract_id: newContract } })
      setShowNew(false); setNewContract(''); await load()
      await open({ id: r.id } as Commitment)
    } catch (e) { setErr((e as Error).message) }
  }

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1.6fr]">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex justify-between">
          <h3 className="font-semibold text-slate-800">Bản cam kết</h3>
          <button onClick={() => { setShowNew(true); setErr('') }}
            className="rounded bg-vicem-500 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">+ Tạo mới</button>
        </div>
        <ul className="divide-y divide-slate-100">
          {list.map((c) => (
            <li key={c.id}>
              <button onClick={() => open(c)}
                className={`w-full px-2 py-2 text-left text-sm hover:bg-slate-50 ${detail?.id === c.id ? 'bg-slate-50' : ''}`}>
                <span className="font-medium text-slate-800">{c.contract_no}</span>
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${c.status === 'signed' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                  {c.status === 'signed' ? '✓ Đã ký' : 'Nháp'}
                </span>
                <span className="block text-xs text-slate-400">{c.contractor_name}</span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="py-6 text-center text-sm text-slate-400">Chưa có bản cam kết.</li>}
        </ul>
      </section>

      <CommitmentDetail commitment={detail} onRefresh={() => detail && open(detail)} />

      {showNew && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowNew(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold">Tạo bản cam kết</h3>
            {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
            <select value={newContract} onChange={(e) => setNewContract(e.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm">
              <option value="">-- Chọn hợp đồng *</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} — {c.contractor_name}</option>)}
            </select>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowNew(false)} className="rounded px-3 py-1.5 text-sm text-slate-500">Hủy</button>
              <button onClick={create} disabled={!newContract}
                className="rounded bg-vicem-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">Tạo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CommitmentDetail({ commitment, onRefresh }: { commitment: CommitmentFull | null; onRefresh: () => void }) {
  const [content, setContent] = useState('')
  const [editing, setEditing] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signingMode, setSigningMode] = useState<'canvas' | 'smartca' | null>(null)
  const [signer, setSigner] = useState({ name: '', title: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (commitment) {
      setContent(commitment.content); setEditing(false); setSigning(false)
      setSigner({ name: commitment.rep_name ?? '', title: commitment.rep_title ?? '' })
    }
  }, [commitment])

  if (!commitment) return (
    <section className="flex items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-sm text-slate-400">
      Chọn hoặc tạo bản cam kết để xem chi tiết.
    </section>
  )
  const signed = commitment.status === 'signed'

  const saveContent = async () => {
    setBusy(true); setErr('')
    try {
      await api(`/hse/commitments/${commitment.id}`, { method: 'PATCH', body: { content } })
      setEditing(false); onRefresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const doSign = async (dataUrl: string) => {
    if (!signer.name.trim()) { setErr('Nhập tên người ký.'); return }
    setBusy(true); setErr('')
    try {
      await api(`/hse/commitments/${commitment.id}/sign`, {
        method: 'PATCH',
        body: { signer_name: signer.name, signer_title: signer.title, signature_data: dataUrl },
      })
      setSigning(false); onRefresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const exportPdf = () => exportCommitmentPdf({
    formCode: 'BM111-07.01', title: commitment.title,
    meta: [
      { label: 'Nhà thầu', value: commitment.contractor_name },
      { label: 'Hợp đồng', value: commitment.contract_no },
      { label: 'Hạng mục', value: commitment.contract_title },
      { label: 'Địa điểm', value: commitment.work_location ?? '' },
    ],
    content: commitment.content,
    signerName: commitment.signer_name ?? '', signerTitle: commitment.signer_title ?? '',
    signatureDataUrl: commitment.signature_data ?? undefined,
    signedAt: commitment.signed_at ? VI_DATE(commitment.signed_at) : undefined,
    verifyCode: commitment.verify_code ?? `ATLD|CMT|${commitment.id}`,
    fileName: `CamKet_${commitment.contract_no}.pdf`,
  }).catch((e) => alert((e as Error).message))

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-semibold text-slate-800">{commitment.title}</p>
          <p className="text-xs text-slate-400">{commitment.contract_no} · {commitment.contractor_name}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${signed ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
          {signed ? `✓ Đã ký ${VI_DATE(commitment.signed_at)}` : 'Nháp'}
        </span>
      </div>

      {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}

      {editing && !signed ? (
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={12}
          className="w-full rounded border border-slate-300 p-3 text-sm leading-relaxed" />
      ) : (
        <div className="whitespace-pre-line rounded bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">{commitment.content}</div>
      )}

      {signed && commitment.signature_data && (
        <div className="mt-3 flex items-center gap-3 rounded border border-slate-200 p-3">
          <img src={commitment.signature_data} alt="Chữ ký" className="h-16 w-40 object-contain" />
          <div className="text-sm">
            <p className="font-semibold text-slate-800">{commitment.signer_name}</p>
            <p className="text-xs text-slate-400">{commitment.signer_title}</p>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
        {!signed && !editing && <button onClick={() => setEditing(true)} className="rounded bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200">Sửa nội dung</button>}
        {!signed && editing && (
          <>
            <button onClick={() => { setEditing(false); setContent(commitment.content) }} className="rounded px-3 py-1.5 text-sm text-slate-500">Hủy</button>
            <button onClick={saveContent} disabled={busy} className="rounded bg-slate-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Lưu nội dung</button>
          </>
        )}
        {!signed && !editing && (
          <div className="relative inline-block">
            <button
              onClick={() => { setSigning(true); setErr('') }}
              className="rounded bg-vicem-500 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              Ký cam kết ▾
            </button>
          </div>
        )}
        {signed && <button onClick={exportPdf} className="rounded bg-vicem-500 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">⬇ Xuất PDF</button>}
      </div>

      {/* Chọn phương thức ký */}
      {signing && !signed && !signingMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSigning(false)}>
          <div className="w-full max-w-xs rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-center text-base font-semibold text-slate-800">Chọn phương thức ký</h3>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setSigningMode('canvas')}
                className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-left hover:bg-slate-50"
              >
                <span className="text-2xl">✍️</span>
                <div>
                  <p className="text-sm font-medium text-slate-800">Ký tay</p>
                  <p className="text-xs text-slate-500">Vẽ chữ ký trực tiếp trên màn hình</p>
                </div>
              </button>
              <button
                onClick={() => setSigningMode('smartca')}
                className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-left hover:bg-blue-100"
              >
                <span className="text-2xl">🔐</span>
                <div>
                  <p className="text-sm font-medium text-blue-800">Ký số SmartCA VNPT</p>
                  <p className="text-xs text-blue-600">Chữ ký số pháp lý qua ứng dụng SmartCA</p>
                </div>
              </button>
            </div>
            <button onClick={() => setSigning(false)} className="mt-3 w-full text-center text-sm text-slate-400 hover:text-slate-600">Hủy</button>
          </div>
        </div>
      )}

      {/* Ký tay — canvas */}
      {signing && !signed && signingMode === 'canvas' && (
        <SignatureModal signer={signer} setSigner={setSigner} busy={busy}
          onClose={() => { setSigning(false); setSigningMode(null) }} onSign={doSign} />
      )}

      {/* Ký số SmartCA */}
      {signing && !signed && signingMode === 'smartca' && (
        <SmartCAModal
          initPath={`/hse/commitments/${commitment.id}/smartca/init`}
          statusPath={`/hse/commitments/${commitment.id}/smartca/status`}
          onClose={() => { setSigning(false); setSigningMode(null) }}
          onSigned={() => { setSigning(false); setSigningMode(null); onRefresh() }}
        />
      )}
    </section>
  )
}

function SignatureModal({ signer, setSigner, busy, onClose, onSign }: {
  signer: { name: string; title: string }
  setSigner: (s: { name: string; title: string }) => void
  busy: boolean; onClose: () => void; onSign: (dataUrl: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const hasInk = useRef(false)

  useLayoutEffect(() => {
    const c = canvasRef.current
    if (!c) return
    // Scale theo devicePixelRatio để nét ký sắc trên màn hình retina.
    const rect = c.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    c.width = rect.width * dpr; c.height = rect.height * dpr
    const ctx = c.getContext('2d')!
    ctx.scale(dpr, dpr); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#0f172a'
  }, [])

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const start = (e: React.PointerEvent) => {
    drawing.current = true
    const ctx = canvasRef.current!.getContext('2d')!
    const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y)
    canvasRef.current!.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return
    const ctx = canvasRef.current!.getContext('2d')!
    const { x, y } = pos(e); ctx.lineTo(x, y); ctx.stroke(); hasInk.current = true
  }
  const end = () => { drawing.current = false }
  const clear = () => {
    const c = canvasRef.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); hasInk.current = false
  }
  const confirm = () => {
    if (!hasInk.current) { alert('Vui lòng ký vào khung.'); return }
    onSign(canvasRef.current!.toDataURL('image/png'))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-lg font-semibold">Ký cam kết</h3>
        <div className="space-y-2">
          <input placeholder="Họ tên người ký *" value={signer.name}
            onChange={(e) => setSigner({ ...signer, name: e.target.value })}
            className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" />
          <input placeholder="Chức vụ" value={signer.title}
            onChange={(e) => setSigner({ ...signer, title: e.target.value })}
            className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" />
          <div>
            <label className="text-xs text-slate-500">Ký tay trong khung dưới</label>
            <canvas ref={canvasRef} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
              className="mt-1 h-40 w-full touch-none rounded border-2 border-dashed border-slate-300 bg-white" />
          </div>
        </div>
        <div className="mt-4 flex justify-between">
          <button onClick={clear} className="rounded px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">Xóa ký</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-slate-500">Hủy</button>
            <button onClick={confirm} disabled={busy}
              className="rounded bg-vicem-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              {busy ? 'Đang lưu…' : 'Xác nhận ký'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
