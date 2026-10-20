import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../lib/api'
import { Badge } from '../components/ui'
import { ArrowLeft } from 'lucide-react'
import { fmtDate } from '../lib/date'

const COLOR: Record<string, 'vicem' | 'eco' | 'red'> = {
  'Thông báo': 'vicem',
  'Sự kiện': 'eco',
  'Cảnh báo an toàn': 'red',
}

interface NewsItem {
  id: number
  title: string
  category: string
  content: string
  /** null khi cán bộ chọn ẩn tên tác giả */
  author: string | null
  date: string
}

export default function NewsDetailPage() {
  const { id = '' } = useParams()
  const [item, setItem] = useState<NewsItem | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    api<{ item: NewsItem }>(`/news/${id}`).then((d) => setItem(d.item)).catch(() => setNotFound(true))
  }, [id])

  if (notFound) {
    return <p className="py-16 text-center text-slate-500">Không tìm thấy tin. <Link className="text-vicem-600 underline" to="/tin-tuc">Về danh sách</Link></p>
  }
  if (!item) return <p className="py-16 text-center text-slate-400">Đang tải…</p>

  return (
    <article className="mx-auto max-w-3xl">
      <Link to="/tin-tuc" className="inline-flex items-center gap-1 text-sm text-vicem-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Danh sách tin
      </Link>
      <div className="mt-3">
        <Badge color={COLOR[item.category] ?? 'slate'}>{item.category}</Badge>
      </div>
      <h1 className="mt-2 text-3xl font-bold leading-tight text-slate-800">{item.title}</h1>
      <p className="mt-2 text-sm text-slate-400">{[item.author, fmtDate(item.date)].filter(Boolean).join(' · ')}</p>
      {/* Nội dung HTML đã được sanitize phía server (chống XSS) trước khi lưu */}
      <div
        className="prose-news mt-6 leading-relaxed text-slate-700"
        dangerouslySetInnerHTML={{ __html: item.content }}
      />
    </article>
  )
}
