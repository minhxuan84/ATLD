// Kiểm tra ATMT — lập biên bản BM-03 / BM-04, liệt kê kết quả.
import { useEffect, useState, useCallback, Fragment } from 'react'
import { api } from '../../lib/api'
import { exportFormPdf, type FormSection } from '../../lib/formPdf'
import { fmtDate } from '../../lib/date'

// Mã biểu mẫu QT111-07 theo loại phiếu
const FORM_CODES: Record<string, string> = {
  BM03_INITIAL: 'BM111-07.03', BM03_MONTHLY: 'BM111-07.03',
  BM03_WEEKLY: 'BM111-07.03', BM04_DAILY: 'BM111-07.04',
}

interface Contract {
  id: number; contract_no: string; title: string; contractor_name: string
}
interface InspectionItem {
  item_code: string; item_name: string; category: string
  result: 'pass' | 'fail' | 'na'; note: string
  requires_suspension: boolean
}
interface Inspection {
  id: number; contract_id: number; contract_no: string; form_type: string
  inspection_date: string; inspector_name: string; overall_result: string
  suspension_required: boolean; note: string | null
}

const FORM_LABELS: Record<string, string> = {
  BM03_INITIAL: 'BM-03 Lần đầu', BM03_MONTHLY: 'BM-03 Hàng tháng',
  BM03_WEEKLY: 'BM-03 Hàng tuần', BM04_DAILY: 'BM-04 Hàng ngày',
}
const RESULT_COLOR: Record<string, string> = {
  pass: 'bg-green-100 text-green-700', fail: 'bg-rose-100 text-rose-700',
  partial: 'bg-yellow-100 text-yellow-700',
}

// Nhãn nhóm hạng mục theo QT111-07
const CATEGORY_LABELS: Record<string, string> = {
  A: 'Nhóm A — Người lao động',
  B: 'Nhóm B — Yêu cầu ATMT hiện trường',
  C: 'Nhóm C — Thiết bị thi công',
}
const mk = (item_code: string, category: string, item_name: string): InspectionItem =>
  ({ item_code, category, item_name, result: 'pass', note: '', requires_suspension: false })

// BM-04 Kiểm tra hàng ngày — rút gọn theo 3 nhóm
const DEFAULT_DAILY: InspectionItem[] = [
  mk('A01', 'A', 'Trang bị & sử dụng đúng BHLĐ cá nhân'),
  mk('A02', 'A', 'NLĐ có thẻ ra/vào, đủ điều kiện làm việc'),
  mk('B01', 'B', 'Rào chắn, biển báo, cảnh báo khu vực thi công'),
  mk('B02', 'B', 'Vệ sinh môi trường, thu gom chất thải'),
  mk('B03', 'B', 'An toàn điện thi công, PCCC & thoát hiểm'),
  mk('C01', 'C', 'Thiết bị, dụng cụ trong tình trạng an toàn'),
]

// BM-03 Kiểm tra ban đầu/tuần/tháng — toàn diện theo 3 nhóm
const DEFAULT_FULL: InspectionItem[] = [
  mk('A01', 'A', 'Trang bị & sử dụng đúng BHLĐ cá nhân'),
  mk('A02', 'A', 'NLĐ có thẻ ra/vào, đủ điều kiện làm việc'),
  mk('A03', 'A', 'Hồ sơ huấn luyện ATVSLĐ, khám sức khỏe còn hiệu lực'),
  mk('B01', 'B', 'Rào chắn, biển báo, cảnh báo khu vực thi công'),
  mk('B02', 'B', 'Vệ sinh môi trường, thu gom chất thải'),
  mk('B03', 'B', 'An toàn điện thi công, PCCC & thoát hiểm'),
  mk('B04', 'B', 'Giàn giáo / thang / sàn công tác đạt yêu cầu'),
  mk('B05', 'B', 'Quản lý hóa chất / vật liệu nguy hiểm'),
  mk('C01', 'C', 'Thiết bị, dụng cụ trong tình trạng an toàn'),
  mk('C02', 'C', 'Thiết bị nâng / cẩu có kiểm định còn hiệu lực'),
]

export default function InspectionsPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [contractId, setContractId] = useState('')
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [showForm, setShowForm] = useState(false)
  const [formType, setFormType] = useState('BM04_DAILY')
  const [inspDate, setInspDate] = useState(new Date().toISOString().slice(0, 10))
  const [inspectorName, setInspectorName] = useState('')
  const [items, setItems] = useState<InspectionItem[]>(DEFAULT_DAILY)
  const [globalNote, setGlobalNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [detail, setDetail] = useState<{ inspection: Inspection; items: InspectionItem[] } | null>(null)

  useEffect(() => {
    api<{ contracts: Contract[] }>('/hse/contracts').then((d) => setContracts(d.contracts))
  }, [])

  const load = useCallback(async () => {
    if (!contractId) { setInspections([]); return }
    const d = await api<{ inspections: Inspection[] }>(`/hse/inspections?contractId=${contractId}`)
    setInspections(d.inspections)
  }, [contractId])

  useEffect(() => { load() }, [load])

  // Khi đổi form_type → nạp danh sách hạng mục mặc định
  const changeFormType = (ft: string) => {
    setFormType(ft)
    setItems(ft === 'BM04_DAILY' ? DEFAULT_DAILY : DEFAULT_FULL)
  }

  const setItemResult = (idx: number, result: 'pass' | 'fail' | 'na') => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, result } : it)))
  }
  const setItemNote = (idx: number, note: string) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, note } : it)))
  }
  const setItemSuspend = (idx: number, v: boolean) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, requires_suspension: v } : it)))
  }

  const submit = async () => {
    if (!contractId || !inspectorName) { setErr('Chọn hợp đồng và nhập tên kiểm tra viên.'); return }
    setErr(''); setBusy(true)
    try {
      await api('/hse/inspections', {
        method: 'POST',
        body: {
          contract_id: Number(contractId), form_type: formType,
          inspection_date: inspDate, inspector_name: inspectorName,
          note: globalNote || null, items,
        },
      })
      setShowForm(false); setGlobalNote(''); setInspectorName('')
      setItems(formType === 'BM04_DAILY' ? DEFAULT_DAILY : DEFAULT_FULL)
      await load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const openDetail = async (insp: Inspection) => {
    const d = await api<{ inspection: Inspection; items: InspectionItem[] }>(`/hse/inspections/${insp.id}`)
    setDetail(d)
  }

  const [exporting, setExporting] = useState(false)
  const exportPdf = async () => {
    if (!detail) return
    setExporting(true)
    try {
      const insp = detail.inspection
      const code = FORM_CODES[insp.form_type] ?? 'BM111-07'
      // Gom hạng mục theo nhóm A/B/C giữ thứ tự
      const sections: FormSection[] = []
      for (const it of detail.items) {
        const title = CATEGORY_LABELS[it.category] ?? (it.category || 'Hạng mục')
        let sec = sections.find((s) => s.title === title)
        if (!sec) { sec = { title, rows: [] }; sections.push(sec) }
        sec.rows.push({ code: it.item_code, name: it.item_name, result: it.result, note: it.note })
      }
      const date = insp.inspection_date?.slice(0, 10) ?? ''
      await exportFormPdf({
        formCode: code,
        formTitle: `Biên bản kiểm tra ATVSLĐ – ${FORM_LABELS[insp.form_type] ?? insp.form_type}`,
        meta: [
          { label: 'Hợp đồng', value: insp.contract_no ?? '' },
          { label: 'Ngày kiểm tra', value: date },
          { label: 'Kiểm tra viên', value: insp.inspector_name ?? '' },
          { label: 'Kết quả chung', value: insp.overall_result === 'pass' ? 'Đạt' : insp.overall_result === 'fail' ? 'Không đạt' : 'Một phần' },
        ],
        sections,
        footerNote: insp.note ?? undefined,
        verifyCode: `ATLD|INSP|${insp.id}|${code}|${date}`,
        signatureLabels: ['Kiểm tra viên', 'Người phê duyệt'],
        fileName: `${code}_HD-${insp.contract_no ?? insp.id}_${date}.pdf`,
      })
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Không tạo được PDF.')
    } finally { setExporting(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select value={contractId} onChange={(e) => setContractId(e.target.value)}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm min-w-[220px]">
          <option value="">-- Chọn hợp đồng</option>
          {contracts.map((c) => (
            <option key={c.id} value={c.id}>{c.contract_no} — {c.title}</option>
          ))}
        </select>
        <button onClick={() => { setShowForm(true); setErr('') }}
          className="rounded bg-vicem-500 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
          + Lập biên bản
        </button>
      </div>

      {inspections.length === 0 && contractId && (
        <p className="py-8 text-center text-sm text-slate-400">Chưa có biên bản kiểm tra cho hợp đồng này.</p>
      )}
      {!contractId && (
        <p className="py-8 text-center text-sm text-slate-400">Chọn hợp đồng để xem biên bản.</p>
      )}

      {inspections.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-xs text-slate-400">
              <th className="px-3 py-2 text-left">Ngày</th>
              <th className="px-3 py-2 text-left">Loại</th>
              <th className="px-3 py-2 text-left">Kiểm tra viên</th>
              <th className="px-3 py-2 text-left">Kết quả</th>
              <th className="px-3 py-2 text-left">Đình chỉ</th>
              <th className="px-3 py-2" />
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {inspections.map((insp) => (
                <tr key={insp.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-xs text-slate-600">{fmtDate(insp.inspection_date)}</td>
                  <td className="px-3 py-2 text-xs text-slate-700">{FORM_LABELS[insp.form_type] ?? insp.form_type}</td>
                  <td className="px-3 py-2 text-slate-700">{insp.inspector_name}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RESULT_COLOR[insp.overall_result] ?? 'bg-slate-100 text-slate-600'}`}>
                      {insp.overall_result === 'pass' ? 'Đạt' : insp.overall_result === 'fail' ? 'Không đạt' : 'Một phần'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {insp.suspension_required && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-xs text-rose-700">⚠ Đình chỉ</span>}
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => openDetail(insp)} className="text-xs text-vicem-500 hover:underline">Chi tiết</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal lập biên bản */}
      {showForm && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="my-4 w-full max-w-2xl rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold">Lập biên bản kiểm tra ATMT</h3>
            {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}

            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">Hợp đồng *</label>
                <select value={contractId} onChange={(e) => setContractId(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm">
                  <option value="">-- Chọn</option>
                  {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} — {c.title}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500">Loại biên bản *</label>
                <select value={formType} onChange={(e) => changeFormType(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm">
                  {Object.entries(FORM_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500">Ngày kiểm tra *</label>
                <input type="date" value={inspDate} onChange={(e) => setInspDate(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-500">Kiểm tra viên *</label>
                <input value={inspectorName} onChange={(e) => setInspectorName(e.target.value)} placeholder="Họ tên"
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" />
              </div>
            </div>

            <p className="mb-1 text-xs font-semibold text-slate-600">Hạng mục</p>
            <div className="mb-3 max-h-72 overflow-y-auto rounded border border-slate-200">
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-50 text-slate-400">
                  <th className="px-2 py-1.5 text-left">Hạng mục</th>
                  <th className="px-2 py-1.5 text-center w-24">Kết quả</th>
                  <th className="px-2 py-1.5 text-center w-16">Đình chỉ</th>
                  <th className="px-2 py-1.5 text-left">Ghi chú</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((it, idx) => (
                    <Fragment key={it.item_code}>
                    {(idx === 0 || items[idx - 1].category !== it.category) && (
                      <tr className="bg-vicem-50">
                        <td colSpan={4} className="px-2 py-1 text-xs font-semibold text-vicem-800">
                          {CATEGORY_LABELS[it.category] ?? it.category}
                        </td>
                      </tr>
                    )}
                    <tr className={it.result === 'fail' ? 'bg-rose-50' : ''}>
                      <td className="px-2 py-1.5 text-slate-700">{it.item_code} — {it.item_name}</td>
                      <td className="px-2 py-1.5 text-center">
                        <select value={it.result} onChange={(e) => setItemResult(idx, e.target.value as 'pass' | 'fail' | 'na')}
                          className={`rounded border px-1 py-0.5 text-xs ${it.result === 'pass' ? 'border-green-300 text-green-700' : it.result === 'fail' ? 'border-rose-300 text-rose-700' : 'border-slate-300 text-slate-500'}`}>
                          <option value="pass">Đạt</option>
                          <option value="fail">Không đạt</option>
                          <option value="na">N/A</option>
                        </select>
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={it.requires_suspension} onChange={(e) => setItemSuspend(idx, e.target.checked)}
                          disabled={it.result !== 'fail'} className="cursor-pointer accent-rose-500 disabled:opacity-30" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input value={it.note} onChange={(e) => setItemNote(idx, e.target.value)} placeholder="Ghi chú…"
                          className="w-full rounded border border-slate-200 px-1.5 py-0.5 text-xs" />
                      </td>
                    </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <label className="text-xs text-slate-500">Nhận xét chung</label>
              <textarea value={globalNote} onChange={(e) => setGlobalNote(e.target.value)} rows={2}
                className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="rounded px-3 py-1.5 text-sm text-slate-500">Hủy</button>
              <button onClick={submit} disabled={busy}
                className="rounded bg-vicem-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                {busy ? 'Đang lưu…' : 'Lưu biên bản'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal chi tiết */}
      {detail && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="my-4 w-full max-w-xl rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between">
              <div>
                <p className="font-semibold text-slate-800">{FORM_LABELS[detail.inspection.form_type]} — {fmtDate(detail.inspection.inspection_date)}</p>
                <p className="text-xs text-slate-400">Kiểm tra viên: {detail.inspection.inspector_name}</p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RESULT_COLOR[detail.inspection.overall_result] ?? 'bg-slate-100 text-slate-600'}`}>
                {detail.inspection.overall_result === 'pass' ? 'Đạt' : detail.inspection.overall_result === 'fail' ? 'Không đạt' : 'Một phần'}
              </span>
            </div>
            {detail.inspection.suspension_required && (
              <div className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600 font-medium">⚠ Biên bản này yêu cầu đình chỉ thi công.</div>
            )}
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-50 text-slate-400">
                <th className="px-2 py-1.5 text-left">Hạng mục</th>
                <th className="px-2 py-1.5 text-center">Kết quả</th>
                <th className="px-2 py-1.5 text-left">Ghi chú</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {detail.items.map((it, idx) => (
                  <Fragment key={it.item_code}>
                  {it.category && (idx === 0 || detail.items[idx - 1].category !== it.category) && (
                    <tr className="bg-vicem-50">
                      <td colSpan={3} className="px-2 py-1 text-xs font-semibold text-vicem-800">
                        {CATEGORY_LABELS[it.category] ?? it.category}
                      </td>
                    </tr>
                  )}
                  <tr className={it.result === 'fail' ? 'bg-rose-50' : ''}>
                    <td className="px-2 py-1.5">{it.item_code} — {it.item_name}</td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={`rounded-full px-1.5 py-0.5 ${it.result === 'pass' ? 'bg-green-100 text-green-700' : it.result === 'fail' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>
                        {it.result === 'pass' ? 'Đạt' : it.result === 'fail' ? 'Không đạt' : 'N/A'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-slate-500">{it.note || '—'}</td>
                  </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
            {detail.inspection.note && <p className="mt-2 text-xs text-slate-500">Nhận xét: {detail.inspection.note}</p>}
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className="text-xs text-slate-400">
                Mã biểu mẫu: <b className="text-slate-600">{FORM_CODES[detail.inspection.form_type] ?? '—'}</b>
              </span>
              <div className="flex gap-2">
                <button onClick={exportPdf} disabled={exporting}
                  className="rounded bg-vicem-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-vicem-700 disabled:opacity-50">
                  {exporting ? 'Đang tạo PDF…' : '⬇ Tải PDF biểu mẫu'}
                </button>
                <button onClick={() => setDetail(null)} className="rounded px-4 py-1.5 text-sm text-slate-500 hover:bg-slate-100">Đóng</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
