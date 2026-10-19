import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import RichText from '../../components/RichText'
import { Plus, Trash2, Pencil, X, Check } from 'lucide-react'

const CATEGORIES = ['Thông báo', 'Sự kiện', 'Cảnh báo an toàn']
const CAT_COLOR: Record<string, string> = {
  'Thông báo': 'bg-vicem-100 text-vicem-700',
  'Sự kiện': 'bg-eco-100 text-eco-700',
  'Cảnh báo an toàn': 'bg-amber-100 text-amber-700',
}

interface NewsRow {
  id: number
  title: string
  category: string
  excerpt: string
  content: string
  author: string
  date: string
}

const EMPTY = { id: 0, title: '', category: 'Thông báo', content: '' }

export default function NewsManager() {
  const [items, setItems] = useState<NewsRow[]>([])
  const [editing, setEditing] = useState<typeof EMPTY | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchNews = useCallback(() => {
    api<{ news: NewsRow[] }>('/news').then((d) => setItems(d.news)).catch(() => {})
  }, [])
  useEffect(fetchNews, [fetchNews])

  const startNew = () => { setError(''); setEditing({ ...EMPTY }) }
  const startEdit = (n: NewsRow) => { setError(''); setEditing({ id: n.id, title: n.title, category: n.category, content: n.content }) }
  const cancel = () => { setEditing(null); setError('') }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing) return
    if (!editing.title.trim() || !editing.content.trim()) { setError('Cần tiêu đề và nội dung.'); return }
    setSaving(true); setError('')
    try {
      const body = { title: editing.title, category: editing.category, content: editing.content }
      if (editing.id) await api(`/news/${editing.id}`, { method: 'PUT', body })
      else await api('/news', { method: 'POST', body })
      setEditing(null)
      fetchNews()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lưu thất bại.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    if (!confirm('Xóa tin này?')) return
    await api(`/news/${id}`, { method: 'DELETE' })
    fetchNews()
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Tin tức &amp; bài viết</h1>
          <p className="mt-1 text-slate-500">Soạn thảo nội dung có định dạng bằng trình soạn thảo TinyMCE.</p>
        </div>
        {!editing && (
          <button onClick={startNew} className="inline-flex items-center gap-2 rounded-lg bg-vicem-600 px-4 py-2 font-semibold text-white hover:bg-vicem-700">
            <Plus className="h-4 w-4" /> Viết bài mới
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={save} className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">{editing.id ? 'Sửa bài viết' : 'Bài viết mới'}</h2>
            <button type="button" onClick={cancel} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
            <input
              value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              placeholder="Tiêu đề bài viết" maxLength={200}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
            />
            <select
              value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Nội dung</label>
            <RichText value={editing.content} onChange={(html) => setEditing({ ...editing, content: html })} />
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-vicem-600 px-5 py-2.5 font-semibold text-white hover:bg-vicem-700 disabled:opacity-60">
              <Check className="h-4 w-4" /> {editing.id ? 'Cập nhật' : 'Đăng bài'}
            </button>
            <button type="button" onClick={cancel} className="rounded-lg border border-slate-300 px-5 py-2.5 font-medium text-slate-600 hover:bg-slate-50">Hủy</button>
          </div>
        </form>
      ) : (
        <div className="mt-5 space-y-2">
          {items.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-400">Chưa có bài viết nào.</p>}
          {items.map((n) => (
            <div key={n.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${CAT_COLOR[n.category] ?? 'bg-slate-100 text-slate-600'}`}>{n.category}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-800">{n.title}</p>
                <p className="truncate text-xs text-slate-400">{n.author} · {n.date} · {n.excerpt}</p>
              </div>
              <button onClick={() => startEdit(n)} className="rounded-lg p-1.5 text-slate-400 hover:bg-vicem-50 hover:text-vicem-600" aria-label={`Sửa ${n.title}`}><Pencil className="h-4 w-4" /></button>
              <button onClick={() => remove(n.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Xóa ${n.title}`}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
