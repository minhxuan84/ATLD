import { Link } from 'react-router-dom'
import { Card, Badge } from '../ui'

const COLOR: Record<string, 'vicem' | 'eco' | 'red'> = {
  'Thông báo': 'vicem',
  'Sự kiện': 'eco',
  'Cảnh báo an toàn': 'red',
}

interface Props {
  items: { id: number; title: string; category: string; excerpt: string; date: string }[]
}

export default function LatestNews({ items }: Props) {
  return (
    <section className="mt-10">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-800">Tin tức mới nhất</h2>
        <Link to="/tin-tuc" className="text-sm font-medium text-vicem-600 hover:underline">Xem tất cả →</Link>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((n) => (
          <Card key={n.id} hover className="flex flex-col p-4">
            <Badge color={COLOR[n.category] ?? 'slate'}>{n.category}</Badge>
            <h3 className="mt-2 font-semibold text-slate-800 line-clamp-2">
              <Link to={`/tin-tuc/${n.id}`} className="hover:text-vicem-600">{n.title}</Link>
            </h3>
            <p className="mt-1 flex-1 text-sm text-slate-600 line-clamp-3">{n.excerpt}</p>
            <p className="mt-2 text-xs text-slate-400">{n.date}</p>
          </Card>
        ))}
      </div>
    </section>
  )
}
