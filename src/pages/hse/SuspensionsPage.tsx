// Đình chỉ công việc (R6) — tạo lệnh đình chỉ tức thì, xem danh sách, gỡ đình chỉ.
import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { exportFormPdf } from '../../lib/formPdf'
import { fmtDate, fmtDateTime } from '../../lib/date'

interface Contract {
  id: number; contract_no: string; title: string; contractor_name: string; status: string
}
interface Suspension {
  id: number; contract_id: number; contract_no: string; contractor_name: string
  reason: string; scope: string; issued_at: string; issued_by_name: string
  status: 'issued' | 'lifted'; lifted_at: string | null; lift_note: string | null
}

export default function SuspensionsPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [suspensions, setSuspensions] = useState<Suspension[]>([])
  const [filterStatus, setFilterStatus] = useState<'all' | 'issued' | 'lifted'>('issued')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ contract_id: '', reason: '', scope: 'toan_bo' })
  const [liftTarget, setLiftTarget] = useState<Suspension | null>(null)
  const [liftNote, setLiftNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const d = await api<{ suspensions: Suspension[] }>('/hse/suspensions')
    setSuspensions(d.suspensions)
  }, [])

  useEffect(() => {
    load()
    api<{ contracts: Contract[] }>('/hse/contracts').then((d) =>
      setContracts(d.contracts.filter((c) => c.status === 'active'))
    )
  }, [load])

  const createSuspension = async () => {
    if (!form.contract_id || !form.reason.trim() || !form.scope.trim()) {
      setErr('Chọn hợp đồng, phạm vi và nhập lý do đình chỉ.')
      return
    }
    setErr(''); setBusy(true)
    try {
      await api('/hse/suspensions', {
        method: 'POST',
        body: {
          contract_id: Number(form.contract_id),
          reason: form.reason.trim(),
          scope: form.scope === 'toan_bo' ? 'Toàn bộ hợp đồng' : form.scope.trim(),
        },
      })
      setShowForm(false)
      setForm({ contract_id: '', reason: '', scope: 'toan_bo' })
      await load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const liftSuspension = async () => {
    if (!liftTarget) return
    setBusy(true)
    try {
      await api(`/hse/suspensions/${liftTarget.id}/lift`, {
        method: 'PATCH',
        body: { note: liftNote.trim() || null },
      })
      setLiftTarget(null); setLiftNote('')
      await load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const exportSuspensionPdf = async (s: Suspension) => {
    const date = fmtDate(s.issued_at)
    await exportFormPdf({
      formCode: 'BM111-07',
      formTitle: 'Lệnh đình chỉ thi công',
      meta: [
        { label: 'Hợp đồng', value: s.contract_no },
        { label: 'Nhà thầu', value: s.contractor_name ?? '' },
        { label: 'Ngày phát lệnh', value: date },
        { label: 'Người phát lệnh', value: s.issued_by_name ?? '' },
        { label: 'Trạng thái', value: s.status === 'issued' ? 'Đang hiệu lực' : 'Đã gỡ' },
      ],
      sections: [{ rows: [
        { code: '1', name: 'Lý do đình chỉ', note: s.reason },
        { code: '2', name: 'Phạm vi đình chỉ', note: s.scope ?? '' },
        ...(s.status === 'lifted' ? [{ code: '3', name: 'Ghi chú gỡ lệnh', note: s.lift_note ?? '' }] : []),
      ]}],
      verifyCode: `ATLD|SUSP|${s.id}|${s.contract_no}|${date}`,
      signatureLabels: ['Người phát lệnh', 'Người phê duyệt'],
      fileName: `LenhDinhChi_${s.contract_no}_${s.id}.pdf`,
    })
  }

  const issued = suspensions.filter((s) => s.status === 'issued')
  const lifted = suspensions.filter((s) => s.status === 'lifted')
  const visible = filterStatus === 'all' ? suspensions : suspensions.filter((s) => s.status === filterStatus)

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-slate-200 bg-white">
          {(['all', 'issued', 'lifted'] as const).map((v) => (
            <button key={v} onClick={() => setFilterStatus(v)}
              className={`px-4 py-1.5 text-sm font-medium transition first:rounded-l-lg last:rounded-r-lg
                ${filterStatus === v ? 'bg-vicem-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
              {v === 'all' ? 'Tất cả' : v === 'issued' ? `Đang hiệu lực (${issued.length})` : `Đã gỡ (${lifted.length})`}
            </button>
          ))}
        </div>
        <button onClick={() => { setShowForm(true); setErr('') }}
          className="rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-rose-700">
          ⚠ Lệnh đình chỉ mới
        </button>
      </div>

      {/* Banner cảnh báo khi có đình chỉ đang hiệu lực */}
      {issued.length > 0 && filterStatus !== 'lifted' && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <span className="text-2xl">🚫</span>
          <div>
            <p className="font-semibold text-rose-700">
              {issued.length} hợp đồng đang bị đình chỉ — NLĐ liên quan bị chặn cổng tức thì.
            </p>
            <p className="text-sm text-rose-500">Xử lý vi phạm trước khi gỡ đình chỉ.</p>
          </div>
        </div>
      )}

      {/* Danh sách */}
      {visible.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-12 text-center text-sm text-slate-400">
          {filterStatus === 'issued' ? 'Không có hợp đồng nào đang bị đình chỉ.' : 'Không có dữ liệu.'}
        </div>
      )}

      <div className="space-y-3">
        {visible.map((s) => (
          <div key={s.id}
            className={`rounded-xl border p-4 ${s.status === 'issued' ? 'border-rose-200 bg-white' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.status === 'issued' ? 'bg-rose-100 text-rose-700' : 'bg-green-100 text-green-700'}`}>
                    {s.status === 'issued' ? '🚫 Đang đình chỉ' : '✓ Đã gỡ'}
                  </span>
                  <span className="font-semibold text-slate-800">{s.contract_no}</span>
                  <span className="text-sm text-slate-500">— {s.contractor_name}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  <span className="font-medium">Lý do:</span> {s.reason}
                </p>
                {s.scope && (
                  <p className="mt-0.5 text-sm text-slate-600">
                    <span className="font-medium">Phạm vi:</span> {s.scope}
                  </p>
                )}
                <p className="mt-1 text-xs text-slate-400">
                  Lệnh phát ngày {fmtDateTime(s.issued_at)} bởi {s.issued_by_name ?? '—'}
                </p>
                {s.status === 'lifted' && s.lifted_at && (
                  <p className="mt-0.5 text-xs text-green-600">
                    ✓ Gỡ lệnh lúc {fmtDateTime(s.lifted_at)}
                    {s.lift_note && <> — {s.lift_note}</>}
                  </p>
                )}
              </div>
              {s.status === 'issued' && (
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => exportSuspensionPdf(s)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
                    ⬇ PDF
                  </button>
                  <button onClick={() => { setLiftTarget(s); setLiftNote(''); setErr('') }}
                    className="rounded-lg border border-green-300 bg-white px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50">
                    Gỡ đình chỉ
                  </button>
                </div>
              )}
              {s.status === 'lifted' && (
                <button onClick={() => exportSuspensionPdf(s)}
                  className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
                  ⬇ PDF
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Modal tạo lệnh đình chỉ */}
      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-2">
              <span className="text-2xl">⚠</span>
              <h3 className="text-lg font-semibold text-slate-800">Phát lệnh đình chỉ thi công</h3>
            </div>
            <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
              Tất cả NLĐ thuộc hợp đồng sẽ bị chặn cổng <strong>ngay lập tức</strong> khi tạo lệnh này.
            </div>
            {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Hợp đồng đang hoạt động *</label>
                <select value={form.contract_id} onChange={(e) => setForm({ ...form, contract_id: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="">-- Chọn hợp đồng</option>
                  {contracts.map((c) => (
                    <option key={c.id} value={c.id}>{c.contract_no} — {c.contractor_name} ({c.title})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Phạm vi đình chỉ *</label>
                <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="toan_bo">Toàn bộ hợp đồng (chặn tất cả NLĐ)</option>
                  <option value="Một phần công việc / hạng mục">Một phần công việc / hạng mục</option>
                  <option value="Một khu vực thi công">Một khu vực thi công</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Lý do đình chỉ *</label>
                <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  rows={3} placeholder="Nêu rõ lý do và căn cứ pháp lý (vi phạm ATVSLD, không đủ hồ sơ, tai nạn…)"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100">Hủy</button>
              <button onClick={createSuspension} disabled={busy}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-rose-700">
                {busy ? 'Đang xử lý…' : '⚠ Phát lệnh đình chỉ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal xác nhận gỡ đình chỉ */}
      {liftTarget && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={() => setLiftTarget(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-lg font-semibold text-slate-800">Gỡ lệnh đình chỉ</h3>
            <p className="mb-4 text-sm text-slate-500">
              Hợp đồng <strong>{liftTarget.contract_no}</strong> — {liftTarget.contractor_name}
            </p>
            <div className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              NLĐ đủ hồ sơ sẽ được phép vào cổng trở lại. NLĐ thiếu hồ sơ vẫn bị chặn.
            </div>
            {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Ghi chú gỡ lệnh (tuỳ chọn)</label>
              <textarea value={liftNote} onChange={(e) => setLiftNote(e.target.value)}
                rows={2} placeholder="Vi phạm đã được khắc phục, nghiệm thu ngày…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setLiftTarget(null)} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100">Hủy</button>
              <button onClick={liftSuspension} disabled={busy}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-green-700">
                {busy ? 'Đang xử lý…' : '✓ Xác nhận gỡ đình chỉ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
