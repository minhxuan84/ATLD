import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { X, Award, Eye, Search } from 'lucide-react'

interface ResultRow {
  user_id: number
  full_name: string
  username: string
  quiz_score: number | null
  passed: boolean
  step: number
  cert_id: string | null
  trainee_info: Record<string, string> | null
  completed_at: string | null
  last_updated: string | null
}

export default function CourseResultsModal({ courseId, courseTitle, onClose }: {
  courseId: string
  courseTitle: string
  onClose: () => void
}) {
  const [results, setResults] = useState<ResultRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<ResultRow | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    api<{ results: ResultRow[] }>(`/admin/courses/${courseId}/results`)
      .then((d) => setResults(d.results))
      .catch((e) => setError(e instanceof Error ? e.message : 'Không tải được kết quả.'))
      .finally(() => setLoading(false))
  }, [courseId])

  const filtered = results.filter((r) =>
    !q.trim() || (r.trainee_info?.full_name || r.full_name).toLowerCase().includes(q.toLowerCase()) || r.username.includes(q.toLowerCase()),
  )
  const passedCount = results.filter((r) => r.passed).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Kết quả học viên</h2>
            <p className="text-sm text-slate-500">{courseTitle}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Đóng"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
            <Award className="h-4 w-4" /> {passedCount} đạt / {results.length} lượt học
          </span>
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm học viên…" className="rounded-lg border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100" />
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {loading ? <p className="py-8 text-center text-slate-400">Đang tải…</p>
          : error ? <p className="py-8 text-center text-red-500">{error}</p>
          : filtered.length === 0 ? <p className="py-8 text-center text-slate-400">Chưa có học viên nào.</p>
          : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="pb-2 font-semibold">Học viên</th>
                  <th className="pb-2 font-semibold">Điểm</th>
                  <th className="pb-2 font-semibold">Trạng thái</th>
                  <th className="pb-2 font-semibold">Ngày</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <tr key={r.user_id}>
                    <td className="py-2 font-medium text-slate-700">{r.trainee_info?.full_name || r.full_name}<span className="ml-1 text-xs text-slate-400">@{r.username}</span></td>
                    <td className="py-2">{r.quiz_score != null ? <span className={r.passed ? 'font-semibold text-emerald-600' : 'text-slate-500'}>{r.quiz_score}%</span> : '—'}</td>
                    <td className="py-2">
                      {r.passed ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Đã đạt</span>
                        : r.quiz_score != null ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">Chưa đạt</span>
                        : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Đang học (bước {r.step})</span>}
                    </td>
                    <td className="py-2 text-slate-500">{r.completed_at ?? r.last_updated ?? '—'}</td>
                    <td className="py-2 text-right">
                      <button onClick={() => setDetail(r)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                        <Eye className="h-3.5 w-3.5" /> Chi tiết
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800">Chi tiết kết quả</h3>
              <button onClick={() => setDetail(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Đóng"><X className="h-5 w-5" /></button>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <Row label="Tài khoản" value={`${detail.full_name} (@${detail.username})`} />
              <Row label="Điểm" value={detail.quiz_score != null ? `${detail.quiz_score}%` : 'Chưa làm bài'} />
              <Row label="Trạng thái" value={detail.passed ? 'Đã đạt & cấp chứng chỉ' : detail.quiz_score != null ? 'Chưa đạt' : `Đang học (bước ${detail.step})`} />
              {detail.cert_id && <Row label="Mã chứng chỉ" value={detail.cert_id} mono />}
              {detail.completed_at && <Row label="Ngày hoàn thành" value={detail.completed_at} />}
              {detail.last_updated && <Row label="Cập nhật cuối" value={detail.last_updated} />}
              {detail.trainee_info && Object.entries(detail.trainee_info).map(([k, v]) => <Row key={k} label={`Khai báo · ${k}`} value={v} />)}
            </dl>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className={`text-right font-medium text-slate-700 ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  )
}
