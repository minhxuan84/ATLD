// Nhật ký audit ATVSLĐ (Pha 5) — tra cứu chuỗi sự kiện bất biến từ atld.hse_audit_logs.
// Bảng và endpoint đã có từ trước nhưng chưa trang nào dùng; đây là UI tra cứu đầu tiên.
import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { fmtDateTime } from '../../lib/date'

interface AuditLog {
  id: number
  actor_id: number | null
  actor_name: string | null
  action: string
  entity_type: string
  entity_id: number
  old_value: unknown
  new_value: unknown
  ip_address: string | null
  created_at: string
}
interface Facets {
  actions: string[]
  entityTypes: string[]
  actors: { id: number; full_name: string }[]
}

// Nhãn tiếng Việt cho loại thực thể. Giá trị chưa có nhãn thì hiện mã gốc.
const ENTITY_LABELS: Record<string, string> = {
  contractor: 'Nhà thầu', contract: 'Hợp đồng', worker: 'Người lao động',
  equipment: 'Thiết bị', dossier: 'Hồ sơ', commitment: 'Bản cam kết',
  inspection: 'Biên bản kiểm tra', suspension: 'Đình chỉ', visitor: 'Khách & NCC',
  evaluation: 'Đánh giá định kỳ', jsa_permit: 'Giấy phép làm việc',
  jsa_work_type: 'Loại công việc', doc_type: 'Loại hồ sơ', user: 'Người dùng',
}
// Nhãn hành động; khớp các action đang được ghi ở server.
const ACTION_LABELS: Record<string, string> = {
  GATE_PASS: 'Cho qua cổng', GATE_BLOCK: 'Chặn tại cổng',
  VISITOR_FACE_UPDATE: 'Cập nhật ảnh mặt khách',
  PERMIT_CREATE: 'Tạo giấy phép', PERMIT_SUBMIT: 'Trình duyệt giấy phép',
  PERMIT_APPROVE: 'Duyệt giấy phép', PERMIT_REJECT: 'Từ chối giấy phép',
  PERMIT_ACTIVATE: 'Kích hoạt giấy phép', PERMIT_CLOSE: 'Nghiệm thu đóng phép',
  PERMIT_CANCEL: 'Hủy giấy phép', PERMIT_PDF_EXPORT: 'Xuất biên bản nghiệm thu',
  SUSPENSION_ISSUE: 'Ban hành đình chỉ', SUSPENSION_LIFT: 'Gỡ đình chỉ',
  CONTRACT_REPORT_EXPORT: 'Xuất báo cáo hợp đồng',
  WORKER_CREATE: 'Thêm người lao động',
}
// Hành động mang tính chặn/thu hồi thì tô đỏ, cấp phép thì xanh — quét nhanh bằng mắt.
const ACTION_TONE = (a: string): string => {
  if (/BLOCK|REJECT|SUSPEND|CANCEL|DELETE|ISSUE/.test(a)) return 'bg-rose-100 text-rose-700'
  if (/APPROVE|PASS|LIFT|ACTIVATE|CLOSE/.test(a)) return 'bg-green-100 text-green-700'
  if (/EXPORT|PDF/.test(a)) return 'bg-slate-100 text-slate-600'
  return 'bg-blue-100 text-blue-700'
}

// old_value/new_value là JSONB tự do → hiện gọn thành "khóa: giá trị", không dump JSON thô.
function summarize(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v !== 'object') return String(v)
  return Object.entries(v as Record<string, unknown>)
    .filter(([, val]) => val !== null && val !== undefined && val !== '')
    .map(([k, val]) => `${k}: ${typeof val === 'object' ? JSON.stringify(val) : String(val)}`)
    .join('; ')
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [facets, setFacets] = useState<Facets>({ actions: [], entityTypes: [], actors: [] })
  const [entityType, setEntityType] = useState('')
  const [entityId, setEntityId] = useState('')
  const [actorId, setActorId] = useState('')
  const [action, setAction] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  useEffect(() => {
    api<Facets>('/hse/audit/facets').then(setFacets).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setBusy(true); setErr('')
    try {
      const qs = new URLSearchParams()
      if (entityType) qs.set('entityType', entityType)
      if (entityId) qs.set('entityId', entityId)
      if (actorId) qs.set('actorId', actorId)
      if (action) qs.set('action', action)
      if (dateFrom) qs.set('dateFrom', dateFrom)
      if (dateTo) qs.set('dateTo', dateTo)
      qs.set('page', String(page))
      qs.set('pageSize', String(pageSize))
      const d = await api<{ logs: AuditLog[]; total: number }>(`/hse/audit?${qs}`)
      setLogs(d.logs)
      setTotal(d.total)
    } catch (e) {
      setErr((e as Error).message || 'Không tải được nhật ký.')
    } finally {
      setBusy(false)
    }
  }, [entityType, entityId, actorId, action, dateFrom, dateTo, page, pageSize])

  useEffect(() => { load() }, [load])

  // Đổi bộ lọc thì về trang 1, nếu không sẽ rơi vào trang trống.
  const setFilter = (fn: () => void) => { fn(); setPage(1) }
  const resetFilters = () => {
    setEntityType(''); setEntityId(''); setActorId(''); setAction('')
    setDateFrom(''); setDateTo(''); setPage(1)
  }

  const toggleRow = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  const hasFilter = !!(entityType || entityId || actorId || action || dateFrom || dateTo)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Nhật ký hoạt động</h2>
          <p className="text-sm text-slate-500">
            Ghi nhận bất biến mọi thao tác trên hồ sơ, giấy phép và cổng kiểm soát.
          </p>
        </div>
        <div className="text-sm text-slate-500">{total.toLocaleString('vi-VN')} bản ghi</div>
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Loại thực thể</span>
          <select value={entityType} onChange={(e) => setFilter(() => setEntityType(e.target.value))}
            className="w-full rounded border border-slate-300 px-3 py-2">
            <option value="">Tất cả</option>
            {facets.entityTypes.map((t) => (
              <option key={t} value={t}>{ENTITY_LABELS[t] ?? t}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Mã thực thể</span>
          <input type="number" value={entityId} placeholder="vd 12"
            onChange={(e) => setFilter(() => setEntityId(e.target.value))}
            className="w-full rounded border border-slate-300 px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Hành động</span>
          <select value={action} onChange={(e) => setFilter(() => setAction(e.target.value))}
            className="w-full rounded border border-slate-300 px-3 py-2">
            <option value="">Tất cả</option>
            {facets.actions.map((a) => (
              <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Người thực hiện</span>
          <select value={actorId} onChange={(e) => setFilter(() => setActorId(e.target.value))}
            className="w-full rounded border border-slate-300 px-3 py-2">
            <option value="">Tất cả</option>
            {facets.actors.map((a) => (
              <option key={a.id} value={a.id}>{a.full_name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Từ ngày</span>
          <input type="date" value={dateFrom}
            onChange={(e) => setFilter(() => setDateFrom(e.target.value))}
            className="w-full rounded border border-slate-300 px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Đến ngày</span>
          <input type="date" value={dateTo}
            onChange={(e) => setFilter(() => setDateTo(e.target.value))}
            className="w-full rounded border border-slate-300 px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Số dòng/trang</span>
          <select value={pageSize}
            onChange={(e) => setFilter(() => setPageSize(Number(e.target.value)))}
            className="w-full rounded border border-slate-300 px-3 py-2">
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button onClick={load} disabled={busy}
            className="rounded bg-vicem-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy ? 'Đang tải…' : 'Tra cứu'}
          </button>
          {hasFilter && (
            <button onClick={resetFilters}
              className="rounded border border-slate-300 px-4 py-2 text-sm">Xóa lọc</button>
          )}
        </div>
      </div>

      {err && <div className="rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{err}</div>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr className="text-left text-xs uppercase text-slate-500">
              <th className="px-4 py-3">Thời điểm</th>
              <th className="px-4 py-3">Người thực hiện</th>
              <th className="px-4 py-3">Hành động</th>
              <th className="px-4 py-3">Thực thể</th>
              <th className="px-4 py-3">Thay đổi</th>
              <th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.map((l) => {
              const before = summarize(l.old_value)
              const after = summarize(l.new_value)
              const isOpen = expanded.has(l.id)
              const hasDetail = !!(before || after)
              return (
                <tr key={l.id} className="align-top hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3">{fmtDateTime(l.created_at)}</td>
                  <td className="px-4 py-3">{l.actor_name ?? `#${l.actor_id ?? '—'}`}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded px-2 py-1 text-xs font-medium ${ACTION_TONE(l.action)}`}>
                      {ACTION_LABELS[l.action] ?? l.action}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {ENTITY_LABELS[l.entity_type] ?? l.entity_type}
                    <span className="ml-1 text-slate-400">#{l.entity_id}</span>
                  </td>
                  <td className="px-4 py-3">
                    {!hasDetail ? <span className="text-slate-400">—</span> : isOpen ? (
                      <div className="space-y-1">
                        {before && <div><span className="font-medium text-slate-500">Trước:</span> {before}</div>}
                        {after && <div><span className="font-medium text-slate-500">Sau:</span> {after}</div>}
                        <button onClick={() => toggleRow(l.id)} className="text-xs text-vicem-500">Thu gọn</button>
                      </div>
                    ) : (
                      <button onClick={() => toggleRow(l.id)} className="text-xs text-vicem-500">Xem chi tiết</button>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{l.ip_address ?? '—'}</td>
                </tr>
              )
            })}
            {!logs.length && !busy && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                {hasFilter ? 'Không có bản ghi khớp bộ lọc.' : 'Chưa có bản ghi nào.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {total > pageSize && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">Trang {page}/{lastPage}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(1)} disabled={page <= 1 || busy}
              className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-40">Đầu</button>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || busy}
              className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-40">Trước</button>
            <button onClick={() => setPage((p) => Math.min(lastPage, p + 1))} disabled={page >= lastPage || busy}
              className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-40">Sau</button>
            <button onClick={() => setPage(lastPage)} disabled={page >= lastPage || busy}
              className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-40">Cuối</button>
          </div>
        </div>
      )}
    </div>
  )
}
