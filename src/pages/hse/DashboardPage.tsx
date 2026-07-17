// Dashboard & KPI an toàn (Phase G): số liệu nhanh, cảnh báo hết hạn, xu hướng vào/ra.
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

interface Expiring { scope: string; entity: string; doc_name: string; expiry_date: string; days_left: number }
interface Trend { d: string; ins: string; outs: string }
interface DashData { kpi: Record<string, number>; expiring: Expiring[]; trend: Trend[] }

const KPI_CARDS: { key: string; label: string; color: string }[] = [
  { key: 'contractors', label: 'Nhà thầu hoạt động', color: 'text-vicem-500' },
  { key: 'contracts', label: 'Hợp đồng hiệu lực', color: 'text-indigo-500' },
  { key: 'workers_allowed', label: 'NLĐ đủ điều kiện', color: 'text-green-600' },
  { key: 'workers_blocked', label: 'NLĐ bị chặn', color: 'text-rose-600' },
  { key: 'workers_in', label: 'NLĐ trong cơ sở', color: 'text-blue-600' },
  { key: 'equipments_allowed', label: 'Thiết bị đủ ĐK', color: 'text-teal-600' },
  { key: 'visitors_in', label: 'Khách trong CS', color: 'text-amber-600' },
  { key: 'suspensions_active', label: 'Lệnh đình chỉ', color: 'text-rose-600' },
  { key: 'dossiers_pending', label: 'Hồ sơ chờ duyệt', color: 'text-orange-500' },
]

export default function DashboardPage() {
  const [data, setData] = useState<DashData | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    api<DashData>('/hse/dashboard').then(setData).catch((e) => setErr((e as Error).message))
  }, [])

  if (err) return <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>
  if (!data) return <p className="py-10 text-center text-slate-400">Đang tải…</p>

  const maxTrend = Math.max(1, ...data.trend.map((t) => Number(t.ins) + Number(t.outs)))
  const dayLeftColor = (d: number) => (d < 0 ? 'text-rose-600 font-semibold' : d <= 7 ? 'text-orange-500 font-medium' : 'text-slate-500')

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {KPI_CARDS.map((c) => (
          <div key={c.key} className="rounded-lg border border-slate-200 bg-white p-4">
            <p className={`text-3xl font-bold ${c.color}`}>{data.kpi[c.key] ?? 0}</p>
            <p className="mt-1 text-xs text-slate-500">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Hồ sơ sắp / đã hết hạn</h3>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-slate-200 text-slate-400">
                <th className="px-2 py-1.5 text-left">Phạm vi</th><th className="px-2 py-1.5 text-left">Đối tượng</th>
                <th className="px-2 py-1.5 text-left">Hồ sơ</th><th className="px-2 py-1.5 text-center">Còn lại</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.expiring.map((e, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-2 py-1.5 text-slate-500">{e.scope}</td>
                    <td className="px-2 py-1.5 font-medium text-slate-700">{e.entity}</td>
                    <td className="px-2 py-1.5 text-slate-500">{e.doc_name}</td>
                    <td className={`px-2 py-1.5 text-center ${dayLeftColor(Number(e.days_left))}`}>
                      {Number(e.days_left) < 0 ? `Quá ${-Number(e.days_left)} ngày` : `${e.days_left} ngày`}</td>
                  </tr>
                ))}
                {data.expiring.length === 0 && <tr><td colSpan={4} className="py-5 text-center text-slate-400">Không có hồ sơ sắp hết hạn.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Lượt vào/ra 7 ngày gần nhất</h3>
          <div className="space-y-2">
            {data.trend.map((t) => {
              const ins = Number(t.ins); const outs = Number(t.outs)
              return (
                <div key={t.d} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-slate-500">{t.d.slice(5)}</span>
                  <div className="flex h-5 flex-1 overflow-hidden rounded bg-slate-100">
                    <div className="bg-blue-500" style={{ width: `${(ins / maxTrend) * 100}%` }} title={`Vào: ${ins}`} />
                    <div className="bg-slate-400" style={{ width: `${(outs / maxTrend) * 100}%` }} title={`Ra: ${outs}`} />
                  </div>
                  <span className="w-16 shrink-0 text-right text-slate-500">{ins} / {outs}</span>
                </div>
              )
            })}
            {data.trend.length === 0 && <p className="py-5 text-center text-slate-400">Chưa có dữ liệu vào/ra.</p>}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-blue-500" /> Vào</span>
            <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-slate-400" /> Ra</span>
          </div>
        </div>
      </div>
    </div>
  )
}