import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { fmtDate } from '../../lib/date'
import { useAuth, canAccess } from '../../context/AuthContext'
import type { CmsSection } from '../../types'
import { Users, GraduationCap, FileText, Newspaper, Award } from 'lucide-react'

interface Stats {
  totals: { users: number; courses: number; documents: number; news: number; certificates: number }
  roleBreakdown: { role: string; n: number }[]
  recentCertificates: { cert_id: string; full_name: string; title: string; quiz_score: number; date: string; trainee_info?: Record<string, string> }[]
}

const ROLE_LABEL: Record<string, string> = { trainee: 'Học viên', officer: 'Cán bộ ATLĐ', admin: 'Quản trị' }

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const { user } = useAuth()

  useEffect(() => {
    api<Stats>('/admin/stats').then(setStats).catch(() => {})
  }, [])

  if (!stats) return <p className="text-slate-400">Đang tải…</p>

  const cards: { label: string; value: number; icon: typeof Users; grad: string; to: string; section: CmsSection }[] = [
    { label: 'Người dùng', value: stats.totals.users, icon: Users, grad: 'from-vicem-500 to-vicem-700', to: '/cms/nguoi-dung', section: 'nguoi-dung' },
    { label: 'Khóa học', value: stats.totals.courses, icon: GraduationCap, grad: 'from-emerald-500 to-emerald-700', to: '/cms/khoa-hoc', section: 'khoa-hoc' },
    { label: 'Tài liệu', value: stats.totals.documents, icon: FileText, grad: 'from-amber-500 to-amber-600', to: '/cms/tai-lieu', section: 'tai-lieu' },
    { label: 'Tin tức', value: stats.totals.news, icon: Newspaper, grad: 'from-eco-500 to-eco-700', to: '/cms/tin-tuc', section: 'tin-tuc' },
    { label: 'Chứng chỉ đã cấp', value: stats.totals.certificates, icon: Award, grad: 'from-purple-500 to-purple-700', to: '/cms/chung-chi', section: 'khoa-hoc' },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Tổng quan hệ thống</h1>
      <p className="mt-1 text-slate-500">Thống kê nhanh về hoạt động huấn luyện ATLĐ &amp; Môi trường.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => {
          const Icon = c.icon
          const body = (
            <>
              <div className="flex items-center justify-between">
                <span className="rounded-xl bg-white/20 p-2.5"><Icon className="h-6 w-6" /></span>
                <span className="text-4xl font-extrabold">{c.value}</span>
              </div>
              <p className="mt-3 font-medium text-white/90">{c.label}</p>
            </>
          )
          const cls = `card-hover block rounded-2xl bg-gradient-to-br ${c.grad} p-5 text-white shadow-md`
          // Chỉ gắn link khi user có quyền mục đó (server vẫn chặn nếu vào thẳng URL).
          return canAccess(user, c.section)
            ? <Link key={c.label} to={c.to} className={cls} title={`Xem chi tiết ${c.label.toLowerCase()}`}>{body}</Link>
            : <div key={c.label} className={cls}>{body}</div>
        })}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-800">Phân bố người dùng theo vai trò</h2>
          <div className="mt-4 space-y-3">
            {stats.roleBreakdown.map((r) => {
              const pct = stats.totals.users ? Math.round((r.n / stats.totals.users) * 100) : 0
              return (
                <div key={r.role}>
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>{ROLE_LABEL[r.role] ?? r.role}</span>
                    <span>{r.n} ({pct}%)</span>
                  </div>
                  <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-vicem-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">Chứng chỉ cấp gần đây</h2>
            {canAccess(user, 'khoa-hoc') && <Link to="/cms/chung-chi" className="text-sm text-vicem-600 hover:underline">Xem tất cả →</Link>}
          </div>
          {stats.recentCertificates.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">Chưa có chứng chỉ nào được cấp.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {stats.recentCertificates.map((c) => (
                <li key={c.cert_id} className="flex items-center justify-between py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-700">{c.trainee_info?.full_name || c.full_name}</p>
                    <p className="truncate text-xs text-slate-400">
                      {c.title}
                      {c.trainee_info?.cccd && <span> · CCCD: {c.trainee_info.cccd}</span>}
                      {c.trainee_info?.grp && <span> · {c.trainee_info.grp}</span>}
                    </p>
                  </div>
                  <div className="ml-3 text-right">
                    <p className="font-semibold text-emerald-600">{c.quiz_score}%</p>
                    <p className="text-xs text-slate-400">{fmtDate(c.date)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
