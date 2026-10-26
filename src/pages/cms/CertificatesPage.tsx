import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Award, FileText, Search, Loader2 } from 'lucide-react'
import { api, openFileInNewTab } from '../../lib/api'
import { fmtDate } from '../../lib/date'

interface CertRow {
  cert_id: string
  course_id: string
  title: string
  branch_id: number | null
  branch_name: string | null
  full_name: string | null
  username: string | null
  score: number | null
  issued_at: string | null
  expires_at: string | null
  source: string | null
  attempt_id: number | null
  has_cert_pdf: boolean
  has_attempt_pdf: boolean
}

const SOURCE_LABEL: Record<string, string> = { account: 'Tài khoản', portal: 'Link/QR' }

export default function CertificatesPage() {
  const [rows, setRows] = useState<CertRow[] | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [course, setCourse] = useState('')

  useEffect(() => {
    api<{ certificates: CertRow[] }>('/admin/certificates')
      .then((d) => setRows(d.certificates))
      .catch((e: Error) => { setError(e.message); setRows([]) })
  }, [])

  const courses = useMemo(() => {
    const m = new Map<string, string>()
    rows?.forEach((r) => m.set(r.course_id, r.title))
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi'))
  }, [rows])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return (rows ?? []).filter((r) =>
      (!course || r.course_id === course) &&
      (!kw || [r.cert_id, r.full_name, r.username, r.title, r.branch_name]
        .some((v) => v?.toLowerCase().includes(kw))),
    )
  }, [rows, q, course])

  const open = (path: string) => openFileInNewTab(path).catch((e: Error) => alert(e.message))

  return (
    <div>
      <Link to="/cms" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-vicem-600">
        <ArrowLeft className="h-4 w-4" /> Tổng quan
      </Link>
      <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold text-slate-800">
        <Award className="h-6 w-6 text-purple-600" /> Chứng chỉ đã cấp
      </h1>
      <p className="mt-1 text-slate-500">Danh sách chứng chỉ trong phạm vi chi nhánh/nhà máy bạn phụ trách.</p>

      <div className="mt-5 flex flex-wrap gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo mã, họ tên, khóa học…"
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" />
        </div>
        <select value={course} onChange={(e) => setCourse(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Tất cả khóa học</option>
          {courses.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
        </select>
      </div>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {rows === null ? (
        <p className="mt-6 flex items-center gap-2 text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải…</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2.5">Mã chứng chỉ</th>
                <th className="px-3 py-2.5">Học viên</th>
                <th className="px-3 py-2.5">Khóa học</th>
                <th className="px-3 py-2.5">Chi nhánh</th>
                <th className="px-3 py-2.5 text-right">Điểm</th>
                <th className="px-3 py-2.5">Ngày cấp</th>
                <th className="px-3 py-2.5">Hết hạn</th>
                <th className="px-3 py-2.5">Nguồn</th>
                <th className="px-3 py-2.5">Tải PDF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">Không có chứng chỉ nào.</td></tr>
              )}
              {filtered.map((r) => {
                const expired = r.expires_at != null && new Date(r.expires_at) < new Date()
                return (
                  <tr key={`${r.cert_id}-${r.course_id}`} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">{r.cert_id}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-700">{r.full_name || '—'}</p>
                      {r.username && <p className="text-xs text-slate-400">{r.username}</p>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{r.title}</td>
                    <td className="px-3 py-2 text-slate-500">{r.branch_name || '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold text-emerald-600">{r.score != null ? `${r.score}%` : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-500">{fmtDate(r.issued_at)}</td>
                    <td className={`whitespace-nowrap px-3 py-2 ${expired ? 'text-red-500' : 'text-slate-500'}`}>
                      {r.expires_at ? fmtDate(r.expires_at) : 'Không thời hạn'}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{SOURCE_LABEL[r.source ?? ''] ?? r.source ?? '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {r.has_attempt_pdf && r.attempt_id != null && (
                          <button onClick={() => open(`/courses/attempts/${r.attempt_id}/pdf`)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100">
                            <FileText className="h-3.5 w-3.5" /> Bài làm
                          </button>
                        )}
                        {r.has_cert_pdf && (
                          <button onClick={() => open(`/courses/certificates/${encodeURIComponent(r.cert_id)}/pdf`)}
                            className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-2 py-1 text-xs text-white hover:bg-purple-700">
                            <Award className="h-3.5 w-3.5" /> Chứng chỉ
                          </button>
                        )}
                        {!r.has_attempt_pdf && !r.has_cert_pdf && <span className="text-xs text-slate-400">Chưa có PDF</span>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows && rows.length > 0 && <p className="mt-2 text-xs text-slate-400">Hiển thị {filtered.length}/{rows.length} chứng chỉ.</p>}
    </div>
  )
}
