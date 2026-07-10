import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { useConfig } from '../../context/ConfigContext'
import { Plus, Trash2, Pencil, Check, X, Eye, EyeOff } from 'lucide-react'

interface MenuItem { id: number; label: string; href: string; visible: boolean; sort_order: number }

export default function MenuManager() {
  const { reload } = useConfig()
  const [items, setItems] = useState<MenuItem[]>([])
  const [editId, setEditId] = useState<number | null>(null)
  const [draft, setDraft] = useState({ label: '', href: '', visible: true, sort_order: 0 })
  const [adding, setAdding] = useState({ label: '', href: '', visible: true, sort_order: 0 })
  const [error, setError] = useState('')

  const fetchAll = useCallback(() => {
    api<{ menu: MenuItem[] }>('/admin/menu').then((d) => setItems(d.menu)).catch(() => {})
  }, [])
  useEffect(fetchAll, [fetchAll])

  const refresh = () => { fetchAll(); reload() }

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!adding.label.trim() || !adding.href.trim()) { setError('Nhập tên hiển thị và đường dẫn.'); return }
    setError('')
    try {
      await api('/admin/menu', { method: 'POST', body: adding })
      setAdding({ label: '', href: '', visible: true, sort_order: 0 })
      refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'Thêm thất bại.') }
  }

  const startEdit = (m: MenuItem) => { setEditId(m.id); setDraft({ label: m.label, href: m.href, visible: m.visible, sort_order: m.sort_order }) }
  const saveEdit = async (id: number) => {
    try {
      await api(`/admin/menu/${id}`, { method: 'PUT', body: draft })
      setEditId(null)
      refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'Lưu thất bại.') }
  }
  const toggleVisible = async (m: MenuItem) => {
    try {
      await api(`/admin/menu/${m.id}`, { method: 'PUT', body: { label: m.label, href: m.href, visible: !m.visible, sort_order: m.sort_order } })
      refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'Cập nhật thất bại.') }
  }
  const remove = async (id: number) => {
    if (!confirm('Xóa mục menu này?')) return
    await api(`/admin/menu/${id}`, { method: 'DELETE' })
    refresh()
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Quản lý menu</h1>
      <p className="mt-1 text-slate-500">Điều chỉnh các mục điều hướng trên đầu trang chủ. Đường dẫn dạng <code className="rounded bg-slate-100 px-1">#gioi-thieu</code> để cuộn tới mục, hoặc <code className="rounded bg-slate-100 px-1">/dao-tao</code> để mở trang.</p>

      <div className="mt-5 space-y-2">
        {items.map((m) => (
          <div key={m.id} className={`flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 ${!m.visible ? 'opacity-60' : ''}`}>
            {editId === m.id ? (
              <>
                <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Tên hiển thị" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <input value={draft.href} onChange={(e) => setDraft({ ...draft, href: e.target.value })} placeholder="#muc hoặc /trang" className="w-44 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <input type="number" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })} className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label="Thứ tự" />
                <button onClick={() => saveEdit(m.id)} className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50"><Check className="h-4 w-4" /></button>
                <button onClick={() => setEditId(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
              </>
            ) : (
              <>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-vicem-50 text-xs font-bold text-vicem-600">{m.sort_order}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800">{m.label}</p>
                  <p className="text-xs text-slate-400">{m.href}</p>
                </div>
                <button onClick={() => toggleVisible(m)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label={m.visible ? `Ẩn ${m.label}` : `Hiện ${m.label}`}>
                  {m.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
                <button onClick={() => startEdit(m)} className="rounded-lg p-1.5 text-slate-400 hover:bg-vicem-50 hover:text-vicem-600" aria-label={`Sửa ${m.label}`}><Pencil className="h-4 w-4" /></button>
                <button onClick={() => remove(m.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Xóa ${m.label}`}><Trash2 className="h-4 w-4" /></button>
              </>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={add} className="mt-4 grid gap-2 rounded-xl border border-dashed border-slate-300 bg-white p-3 sm:grid-cols-[1fr_180px_90px_auto]">
        <input value={adding.label} onChange={(e) => setAdding({ ...adding, label: e.target.value })} placeholder="Tên hiển thị" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input value={adding.href} onChange={(e) => setAdding({ ...adding, href: e.target.value })} placeholder="#muc hoặc /trang" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input type="number" value={adding.sort_order} onChange={(e) => setAdding({ ...adding, sort_order: Number(e.target.value) })} placeholder="Thứ tự" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label="Thứ tự" />
        <button className="inline-flex items-center justify-center gap-1 rounded-lg bg-vicem-600 px-4 py-2 text-sm font-semibold text-white hover:bg-vicem-700"><Plus className="h-4 w-4" /> Thêm</button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  )
}
