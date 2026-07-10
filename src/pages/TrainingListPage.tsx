import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { Card, Badge } from '../components/ui'
import { PlayCircle, Clock, Award, Building2, LayoutGrid, Pencil, Trash2, BarChart2 } from 'lucide-react'
import { useAuth, canAccess } from '../context/AuthContext'
import CourseResultsModal from '../components/CourseResultsModal'
import CourseEditModal from '../components/CourseEditModal'

interface CourseRow {
  id: string
  title: string
  description: string
  grp: string
  branch_id: number | null
  branch_name: string | null
  duration: string
  pass_score: number
  question_count: number
  video_url: string
  summary: string[]
  progress: { passed: boolean; step: number } | null
}

const UNGROUPED = 'Khóa học chung'

export default function TrainingListPage() {
  const { user } = useAuth()
  const canManage = canAccess(user, 'khoa-hoc')

  const [courses, setCourses] = useState<CourseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('all')
  const [resultsFor, setResultsFor] = useState<{ id: string; title: string } | null>(null)
  const [editFor, setEditFor] = useState<CourseRow | null>(null)

  const load = useCallback(() => {
    api<{ courses: CourseRow[] }>('/courses')
      .then((d) => setCourses(d.courses))
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const deleteCourse = async (c: CourseRow) => {
    if (!confirm(`Xóa khóa học "${c.title}" và toàn bộ câu hỏi?`)) return
    await api(`/admin/courses/${c.id}`, { method: 'DELETE' })
    load()
  }

  // Nhóm khóa học theo chi nhánh, giữ nguyên thứ tự server trả về
  const groups: { name: string; items: CourseRow[] }[] = []
  for (const c of courses) {
    const name = c.branch_name ?? UNGROUPED
    let g = groups.find((x) => x.name === name)
    if (!g) { g = { name, items: [] }; groups.push(g) }
    g.items.push(c)
  }

  // Khóa học hiển thị theo tab đang chọn
  const visible = activeTab === 'all' ? groups : groups.filter((g) => g.name === activeTab)

  const renderCard = (c: CourseRow) => (
    <Card key={c.id} hover className="flex flex-col p-5">
      <div className="flex items-center justify-between">
        <Badge>{c.grp}</Badge>
        <div className="flex items-center gap-1">
          {c.progress?.passed && <Badge color="green"><Award className="mr-1 inline h-3 w-3" />Đã đạt</Badge>}
          {/* Icon sửa/xóa/kết quả chỉ hiện với admin/cán bộ có quyền khoa-hoc */}
          {canManage && (
            <div className="ml-1 flex items-center gap-0.5" onClick={(e) => e.preventDefault()}>
              <button
                onClick={() => setResultsFor({ id: c.id, title: c.title })}
                className="rounded p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                aria-label="Xem kết quả học viên" title="Kết quả học viên"
              >
                <BarChart2 className="h-4 w-4" />
              </button>
              <button
                onClick={() => setEditFor(c)}
                className="rounded p-1.5 text-slate-400 hover:bg-vicem-50 hover:text-vicem-600"
                aria-label="Sửa khóa học" title="Sửa khóa học"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => deleteCourse(c)}
                className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                aria-label="Xóa khóa học" title="Xóa khóa học"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
      <h2 className="mt-2 text-lg font-semibold text-slate-800">{c.title}</h2>
      <p className="mt-1 flex-1 text-sm text-slate-600">{c.description}</p>
      <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{c.duration}</span>
        <span>{c.question_count} câu hỏi</span>
        <span>Đạt ≥ {c.pass_score}%</span>
      </div>
      <Link
        to={`/huan-luyen/${c.id}`}
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-vicem-600 px-4 py-2 font-semibold text-white hover:bg-vicem-700"
      >
        <PlayCircle className="h-5 w-5" aria-hidden />
        {c.progress ? 'Tiếp tục học' : 'Bắt đầu học'}
      </Link>
    </Card>
  )

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Huấn luyện An toàn lao động</h1>
      <p className="mt-1 text-slate-600">
        Quy trình 3 bước: Xem video → Tóm tắt nội dung → Trắc nghiệm &amp; cấp chứng chỉ.
      </p>

      {loading ? (
        <p className="py-10 text-center text-slate-400">Đang tải…</p>
      ) : courses.length === 0 ? (
        <p className="py-10 text-center text-slate-400">Chưa có khóa học nào.</p>
      ) : (
        <>
          {/* Tab chi nhánh */}
          <div className="mt-6 flex flex-wrap gap-2 border-b border-slate-200 pb-3" role="tablist" aria-label="Chi nhánh">
            <button
              role="tab" aria-selected={activeTab === 'all'} onClick={() => setActiveTab('all')}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition ${
                activeTab === 'all' ? 'bg-vicem-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <LayoutGrid className="h-4 w-4" /> Tất cả
              <span className={`rounded-full px-1.5 text-xs ${activeTab === 'all' ? 'bg-white/20' : 'bg-white/70 text-slate-500'}`}>{courses.length}</span>
            </button>
            {groups.map((g) => (
              <button
                key={g.name} role="tab" aria-selected={activeTab === g.name} onClick={() => setActiveTab(g.name)}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition ${
                  activeTab === g.name ? 'bg-vicem-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <Building2 className="h-4 w-4" /> {g.name}
                <span className={`rounded-full px-1.5 text-xs ${activeTab === g.name ? 'bg-white/20' : 'bg-white/70 text-slate-500'}`}>{g.items.length}</span>
              </button>
            ))}
          </div>

          <div className="mt-6 space-y-8">
            {visible.map((g) => (
              <section key={g.name}>
                {activeTab === 'all' && (
                  <div className="flex items-center gap-3">
                    <Building2 className="h-5 w-5 text-vicem-600" aria-hidden />
                    <h2 className="text-lg font-bold text-slate-800">{g.name}</h2>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{g.items.length} khóa</span>
                    <span className="h-px flex-1 bg-slate-200" />
                  </div>
                )}
                <div className={`grid gap-5 md:grid-cols-2 ${activeTab === 'all' ? 'mt-4' : ''}`}>
                  {g.items.map(renderCard)}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {/* Modal kết quả học viên */}
      {resultsFor && (
        <CourseResultsModal
          courseId={resultsFor.id}
          courseTitle={resultsFor.title}
          onClose={() => setResultsFor(null)}
        />
      )}

      {/* Modal sửa khóa học */}
      {editFor && (
        <CourseEditModal
          courseId={editFor.id}
          initial={{ ...editFor }}
          onSaved={load}
          onClose={() => setEditFor(null)}
        />
      )}
    </div>
  )
}
