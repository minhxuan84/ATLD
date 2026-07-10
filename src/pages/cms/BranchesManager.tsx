import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'

interface Branch { id: number; name: string; location: string; sort_order: number }

export default function BranchesManager() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [editId, setEditId] = useState<number | null>(null)
  const [draft, setDraft] = useState({ name: '', location: '', sort_order: 0 })
  const [adding, setAdding] = useState({ name: '', location: '', sort_order: 0 })
  const [error, setError] = useState('')

  const fetchAll = useCallback(() => {
    api<{ branches: Branch[] }>('/admin/branches').then((d) => setBranches(d.branches)).catch(() => {})
  }, [])
  useEffect(fetchAll, [fetchAll])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!adding.name.trim()) { setError('Nhập tên chi nhánh.'); return }
    setError('')
    try {
      await api('/admin/branches', { method: 'POST', body: adding })
      setAdding({ name: '', location: '', sort_order: 0 })
      fetchAll()
    } catch (err) { setError(err instanceof Error ? err.message : 'Thêm thất bại.') }
  }

  const startEdit = (b: Branch) => { setEditId(b.id); setDraft({ name: b.name, location: b.location, sort_order: b.sort_order }) }
  const saveEdit = async (id: number) => {
    try {
      await api(`/admin/branches/${id}`, { method: 'PUT', body: draft })
      setEditId(null)
      fetchAll()
    } catch (err) { setError(err instanceof Error ? err.message : 'Lưu thất bại.') }
  }
  const remove = async (id: number) => {
    if (!confirm('Xóa chi nhánh này? Khóa học thuộc chi nhánh sẽ chuyển sang "Chưa phân loại".')) return
    await api(`/admin/branches/${id}`, { method: 'DELETE' })
    fetchAll()
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Chi nhánh / đơn vị</h1>
      <p className="mt-1 text-slate-500">Quản lý danh sách nhà máy, trạm nghiền. Mỗi khóa học được gán vào một chi nhánh.</p>

      <div className="mt-5 space-y-2">
        {branches.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
            {editId === b.id ? (
              <>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Tên chi nhánh" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="Địa điểm" className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <input type="number" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })} className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label="Thứ tự" />
                <button onClick={() => saveEdit(b.id)} className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50"><Check className="h-4 w-4" /></button>
                <button onClick={() => setEditId(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
              </>
            ) : (
              <>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-vicem-50 text-xs font-bold text-vicem-600">{b.sort_order}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800">{b.name}</p>
                  {b.location && <p className="text-xs text-slate-400">{b.location}</p>}
                </div>
                <button onClick={() => startEdit(b)} className="rounded-lg p-1.5 text-slate-400 hover:bg-vicem-50 hover:text-vicem-600" aria-label={`Sửa ${b.name}`}><Pencil className="h-4 w-4" /></button>
                <button onClick={() => remove(b.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Xóa ${b.name}`}><Trash2 className="h-4 w-4" /></button>
              </>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={add} className="mt-4 grid gap-2 rounded-xl border border-dashed border-slate-300 bg-white p-3 sm:grid-cols-[1fr_180px_90px_auto]">
        <input value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} placeholder="Tên chi nhánh mới" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input value={adding.location} onChange={(e) => setAdding({ ...adding, location: e.target.value })} placeholder="Địa điểm" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input type="number" value={adding.sort_order} onChange={(e) => setAdding({ ...adding, sort_order: Number(e.target.value) })} placeholder="Thứ tự" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label="Thứ tự" />
        <button className="inline-flex items-center justify-center gap-1 rounded-lg bg-vicem-600 px-4 py-2 text-sm font-semibold text-white hover:bg-vicem-700"><Plus className="h-4 w-4" /> Thêm</button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  )
}
