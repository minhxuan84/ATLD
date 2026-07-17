// Cấu hình động loại hồ sơ HSE (nền ma trận điều kiện). Chỉ 'an-toan' toàn quyền/admin.
import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'

interface DocType {
  id: number; code: string; name: string; scope: string; is_mandatory: boolean
  warn_days_before: number; sort_order: number; is_active: boolean
  group_name: string | null; applies_to: string | null; risk_level: string | null
}

const SCOPE_LABEL: Record<string, string> = {
  contractor: 'Nhà thầu', worker: 'Người lao động', equipment: 'Thiết bị',
}
const EMPTY = {
  code: '', name: '', scope: 'contractor', is_mandatory: true, warn_days_before: 30,
  sort_order: 0, group_name: '', applies_to: '', risk_level: '',
}

export default function DocTypesConfigPage() {
  const [items, setItems] = useState<DocType[]>([])
  const [scope, setScope] = useState('contractor')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [editId, setEditId] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // Xem trước ma trận điều kiện (Phase D): nhập chức danh + rủi ro → hồ sơ bắt buộc.
  const [mScope, setMScope] = useState('worker')
  const [mJob, setMJob] = useState('')
  const [mRisk, setMRisk] = useState('medium')
  const [matrix, setMatrix] = useState<null | { required: DocType[]; optional: DocType[] }>(null)

  const load = useCallback(async () => {
    const d = await api<{ docTypes: DocType[] }>('/hse/doc-types?all=1')
    setItems(d.docTypes)
  }, [])
  useEffect(() => { load() }, [load])

  const runPreview = async () => {
    const p = new URLSearchParams({ scope: mScope, jobTitle: mJob, risk: mRisk })
    const d = await api<{ required: DocType[]; optional: DocType[] }>(`/hse/matrix/preview?${p}`)
    setMatrix(d)
  }

  const openNew = () => { setForm({ ...EMPTY, scope }); setEditId(null); setErr(''); setShowForm(true) }
  const openEdit = (t: DocType) => {
    setForm({ code: t.code, name: t.name, scope: t.scope, is_mandatory: t.is_mandatory,
      warn_days_before: t.warn_days_before, sort_order: t.sort_order, group_name: t.group_name ?? '',
      applies_to: t.applies_to ?? '', risk_level: t.risk_level ?? '' })
    setEditId(t.id); setErr(''); setShowForm(true)
  }

  const submit = async () => {
    setErr(''); setBusy(true)
    try {
      if (editId) await api(`/hse/doc-types/${editId}`, { method: 'PATCH', body: form })
      else await api('/hse/doc-types', { method: 'POST', body: form })
      setShowForm(false); await load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const toggleActive = async (t: DocType) => {
    await api(`/hse/doc-types/${t.id}`, { method: 'PATCH', body: { is_active: !t.is_active } })
    await load()
  }

  const filtered = items.filter((t) => t.scope === scope)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {Object.entries(SCOPE_LABEL).map(([k, label]) => (
            <button key={k} onClick={() => setScope(k)}
              className={`rounded px-3 py-1.5 text-sm font-medium ${scope === k ? 'bg-vicem-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={openNew} className="rounded bg-vicem-500 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">+ Thêm loại hồ sơ</button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
            <th className="px-3 py-2 text-left">Mã</th><th className="px-3 py-2 text-left">Tên hồ sơ</th>
            <th className="px-3 py-2 text-left">Nhóm</th><th className="px-3 py-2 text-center">Bắt buộc</th>
            <th className="px-3 py-2 text-center">Cảnh báo (ngày)</th><th className="px-3 py-2 text-center">Rủi ro</th>
            <th className="px-3 py-2 text-center">Kích hoạt</th><th className="px-3 py-2" />
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((t) => (
              <tr key={t.id} className={`text-xs hover:bg-slate-50 ${!t.is_active ? 'opacity-50' : ''}`}>
                <td className="px-3 py-2 font-mono text-slate-500">{t.code}</td>
                <td className="px-3 py-2 font-medium text-slate-700">{t.name}</td>
                <td className="px-3 py-2 text-slate-500">{t.group_name ?? '—'}</td>
                <td className="px-3 py-2 text-center">{t.is_mandatory ? '✓' : '—'}</td>
                <td className="px-3 py-2 text-center">{t.warn_days_before}</td>
                <td className="px-3 py-2 text-center">{t.risk_level || '—'}</td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => toggleActive(t)}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${t.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {t.is_active ? 'Bật' : 'Tắt'}
                  </button>
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => openEdit(t)} className="rounded px-2 py-0.5 text-vicem-500 hover:bg-slate-100">Sửa</button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-slate-400">Chưa có loại hồ sơ.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Xem trước ma trận điều kiện</h3>
        <p className="mb-3 text-xs text-slate-500">Nhập chức danh và mức rủi ro hợp đồng để xem hồ sơ bắt buộc theo quy tắc <span className="font-mono">applies_to</span> + <span className="font-mono">risk_level</span>.</p>
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="text-xs text-slate-500">Phạm vi</label>
            <select value={mScope} onChange={(e) => setMScope(e.target.value)} className="block rounded border border-slate-300 px-3 py-1.5 text-sm">
              {Object.entries(SCOPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></div>
          <div><label className="text-xs text-slate-500">Chức danh</label>
            <input value={mJob} onChange={(e) => setMJob(e.target.value)} placeholder="VD: thợ hàn, vận hành cẩu…"
              className="block rounded border border-slate-300 px-3 py-1.5 text-sm" /></div>
          <div><label className="text-xs text-slate-500">Mức rủi ro HĐ</label>
            <select value={mRisk} onChange={(e) => setMRisk(e.target.value)} className="block rounded border border-slate-300 px-3 py-1.5 text-sm">
              <option value="low">Thấp</option><option value="medium">Trung bình</option><option value="high">Cao</option>
            </select></div>
          <button onClick={runPreview} className="rounded bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">Xem</button>
        </div>
        {matrix && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div><p className="mb-1 text-xs font-medium text-rose-600">Bắt buộc ({matrix.required.length})</p>
              <ul className="space-y-1 text-xs text-slate-600">
                {matrix.required.map((t) => <li key={t.id} className="rounded bg-white px-2 py-1">{t.name}{t.risk_level ? <span className="ml-1 text-slate-400">· {t.risk_level}</span> : null}</li>)}
                {matrix.required.length === 0 && <li className="text-slate-400">Không có.</li>}
              </ul></div>
            <div><p className="mb-1 text-xs font-medium text-slate-500">Không áp dụng ({matrix.optional.length})</p>
              <ul className="space-y-1 text-xs text-slate-400">
                {matrix.optional.map((t) => <li key={t.id} className="rounded bg-white px-2 py-1">{t.name}</li>)}
                {matrix.optional.length === 0 && <li>—</li>}
              </ul></div>
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-lg rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold">{editId ? 'Sửa loại hồ sơ' : 'Thêm loại hồ sơ'}</h3>
            {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Mã *" value={form.code} disabled={!!editId}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-100" />
              <select value={form.scope} disabled={!!editId} onChange={(e) => setForm({ ...form, scope: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-100">
                {Object.entries(SCOPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <input placeholder="Tên hồ sơ *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="col-span-2 rounded border border-slate-300 px-3 py-1.5 text-sm" />
              <input placeholder="Nhóm hiển thị" value={form.group_name} onChange={(e) => setForm({ ...form, group_name: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
              <input placeholder="Áp dụng chức danh (tùy chọn)" value={form.applies_to} onChange={(e) => setForm({ ...form, applies_to: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
              <div><label className="text-xs text-slate-500">Cảnh báo trước (ngày)</label>
                <input type="number" value={form.warn_days_before} onChange={(e) => setForm({ ...form, warn_days_before: Number(e.target.value) })}
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" /></div>
              <div><label className="text-xs text-slate-500">Thứ tự</label>
                <input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" /></div>
              <select value={form.risk_level} onChange={(e) => setForm({ ...form, risk_level: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm">
                <option value="">-- Mức rủi ro --</option>
                <option value="low">Thấp</option><option value="medium">Trung bình</option><option value="high">Cao</option>
              </select>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={form.is_mandatory} onChange={(e) => setForm({ ...form, is_mandatory: e.target.checked })} />
                Bắt buộc
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="rounded px-3 py-1.5 text-sm text-slate-500">Hủy</button>
              <button onClick={submit} disabled={busy || !form.code || !form.name}
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
