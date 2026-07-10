import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth, canAccess } from '../context/AuthContext'
import { Card, Badge } from '../components/ui'
import { Plus, Trash2 } from 'lucide-react'

const CATEGORIES = ['Thông báo', 'Sự kiện', 'Cảnh báo an toàn']
const COLOR: Record<string, 'vicem' | 'hatien' | 'red'> = {
  'Thông báo': 'vicem',
  'Sự kiện': 'hatien',
  'Cảnh báo an toàn': 'red',
}

interface NewsRow {
  id: number
  title: string
  category: string
  excerpt: string
  author: string
  date: string
}

export default function NewsPage() {
  const { user } = useAuth()
  const canManage = canAccess(user, 'tin-tuc')

  const [items, setItems] = useState<NewsRow[]>([])
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('Thông báo')
  const [content, setContent] = useState('')

  const fetchNews = useCallback(() => {
    api<{ news: NewsRow[] }>('/news').then((d) => setItems(d.news)).catch(() => {})
  }, [])

  useEffect(fetchNews, [fetchNews])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !content.trim()) return
    await api('/news', { method: 'POST', body: { title, category, content } })
    setTitle(''); setContent(''); setOpen(false)
    fetchNews()
  }

  const remove = async (id: number) => {
    await api(`/news/${id}`, { method: 'DELETE' })
    fetchNews()
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Tin tức</h1>
        {canManage && (
          <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-2 rounded-lg bg-vicem-600 px-4 py-2 font-semibold text-white hover:bg-vicem-700">
            <Plus className="h-4 w-4" /> Đăng tin
          </button>
        )}
      </div>

      {canManage && open && (
        <Card className="mt-4 p-5">
          <form onSubmit={submit} className="grid gap-3">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tiêu đề" maxLength={200} className="rounded-lg border border-slate-300 p-2 text-sm" />
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-slate-300 p-2 text-sm">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Nội dung" rows={4} maxLength={2000} className="rounded-lg border border-slate-300 p-2 text-sm" />
            <div>
              <button type="submit" className="rounded-lg bg-vicem-600 px-5 py-2 font-semibold text-white hover:bg-vicem-700">Lưu tin</button>
            </div>
          </form>
        </Card>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((n) => (
          <Card key={n.id} className="flex flex-col p-4">
            <div className="flex items-center justify-between">
              <Badge color={COLOR[n.category] ?? 'slate'}>{n.category}</Badge>
              {canManage && (
                <button onClick={() => remove(n.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Xóa tin ${n.title}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <h2 className="mt-2 font-semibold text-slate-800 line-clamp-2">
              <Link to={`/tin-tuc/${n.id}`} className="hover:text-vicem-600">{n.title}</Link>
            </h2>
            <p className="mt-1 flex-1 text-sm text-slate-600 line-clamp-3">{n.excerpt}</p>
            <p className="mt-2 text-xs text-slate-400">{n.author} · {n.date}</p>
          </Card>
        ))}
      </div>
    </div>
  )
}
