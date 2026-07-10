import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { Plus, Trash2, ChevronDown, ChevronRight, Check, Pencil, X, Award, Sparkles, Loader2 } from 'lucide-react'

interface CourseRow {
  id: string
  title: string
  description: string
  grp: string
  branch_id: number | null
  branch_name: string | null
  video_url: string
  duration: string
  summary: string[]
  pass_score: number
  question_count: number
}
interface QuestionRow {
  id: number
  text: string
  options: string[]
  correct_index: number
}
interface Branch { id: number; name: string }
interface CertRow {
  cert_id: string
  quiz_score: number
  full_name: string
  date: string | null
  trainee_info: Record<string, string> | null
}
type QuestionDraft = { text: string; options: string[]; correct_index: number }

const emptyQuestion = (): QuestionDraft => ({ text: '', options: ['', '', '', ''], correct_index: 0 })

export default function CoursesManager() {
  const [courses, setCourses] = useState<CourseRow[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [questions, setQuestions] = useState<Record<string, QuestionRow[]>>({})
  const [certs, setCerts] = useState<Record<string, CertRow[]>>({})
  const [showNew, setShowNew] = useState(false)
  const [error, setError] = useState('')

  const [newCourse, setNewCourse] = useState({ id: '', title: '', description: '', grp: 'Nhóm 4', branch_id: '', video_url: '', duration: '', pass_score: 80, summary: '' })
  const [newQ, setNewQ] = useState<QuestionDraft>(emptyQuestion())

  // AI sinh nội dung khóa học từ prompt
  const [aiTopic, setAiTopic] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiQuestions, setAiQuestions] = useState<QuestionDraft[]>([])

  // Sửa khóa học
  const [editCourse, setEditCourse] = useState<string | null>(null)
  const [courseDraft, setCourseDraft] = useState({ title: '', description: '', grp: '', branch_id: '', video_url: '', duration: '', pass_score: 80, summary: '' })
  // Sửa câu hỏi
  const [editQ, setEditQ] = useState<number | null>(null)
  const [qDraft, setQDraft] = useState<QuestionDraft>(emptyQuestion())

  const fetchCourses = useCallback(() => {
    api<{ courses: CourseRow[] }>('/courses').then((d) => setCourses(d.courses)).catch(() => {})
    api<{ branches: Branch[] }>('/admin/branches').then((d) => setBranches(d.branches)).catch(() => {})
  }, [])
  useEffect(fetchCourses, [fetchCourses])

  const reloadQuestions = async (courseId: string) => {
    const d = await api<{ questions: QuestionRow[] }>(`/admin/courses/${courseId}/questions`)
    setQuestions((q) => ({ ...q, [courseId]: d.questions }))
  }

  const reloadCerts = async (courseId: string) => {
    const d = await api<{ certificates: CertRow[] }>(`/admin/courses/${courseId}/certificates`)
    setCerts((c) => ({ ...c, [courseId]: d.certificates }))
  }

  const toggle = async (id: string) => {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (!questions[id]) await reloadQuestions(id)
    if (!certs[id]) await reloadCerts(id).catch(() => {})
  }

  const createCourse = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await api('/admin/courses', {
        method: 'POST',
        body: { ...newCourse, summary: newCourse.summary.split('\n').map((s) => s.trim()).filter(Boolean) },
      })
      // Nếu có bộ câu hỏi do AI sinh, lưu lần lượt vào khóa học vừa tạo
      for (const q of aiQuestions) {
        const opts = q.options.map((o) => o.trim()).filter(Boolean)
        if (!q.text.trim() || opts.length < 2 || q.correct_index >= opts.length) continue
        await api(`/admin/courses/${newCourse.id}/questions`, {
          method: 'POST', body: { text: q.text, options: opts, correct_index: q.correct_index },
        })
      }
      setShowNew(false)
      setNewCourse({ id: '', title: '', description: '', grp: 'Nhóm 4', branch_id: '', video_url: '', duration: '', pass_score: 80, summary: '' })
      setAiQuestions([])
      setAiTopic('')
      fetchCourses()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tạo khóa học thất bại.')
    }
  }

  // Gọi AI sinh nội dung, tự điền vào form (giữ mã khóa học admin đã nhập)
  const aiGenerate = async () => {
    if (aiTopic.trim().length < 3) { setError('Nhập chủ đề để AI soạn nội dung.'); return }
    setAiLoading(true); setError('')
    try {
      const { course } = await api<{ course: {
        title: string; description: string; grp: string; duration: string
        summary: string[]; questions: QuestionDraft[]
      } }>('/admin/courses/ai-generate', { method: 'POST', body: { topic: aiTopic } })
      setNewCourse((c) => ({
        ...c,
        title: course.title, description: course.description, grp: course.grp || c.grp,
        duration: course.duration, summary: course.summary.join('\n'),
      }))
      setAiQuestions(course.questions ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI sinh nội dung thất bại.')
    } finally { setAiLoading(false) }
  }

  const startEditCourse = (c: CourseRow) => {
    setEditCourse(c.id)
    setCourseDraft({
      title: c.title, description: c.description, grp: c.grp, branch_id: c.branch_id ? String(c.branch_id) : '',
      video_url: c.video_url, duration: c.duration, pass_score: c.pass_score, summary: (c.summary ?? []).join('\n'),
    })
  }
  const saveCourse = async (id: string) => {
    setError('')
    try {
      await api(`/admin/courses/${id}`, {
        method: 'PUT',
        body: { ...courseDraft, summary: courseDraft.summary.split('\n').map((s) => s.trim()).filter(Boolean) },
      })
      setEditCourse(null)
      fetchCourses()
    } catch (err) { setError(err instanceof Error ? err.message : 'Lưu khóa học thất bại.') }
  }

  const deleteCourse = async (id: string) => {
    if (!confirm('Xóa khóa học này cùng toàn bộ câu hỏi?')) return
    await api(`/admin/courses/${id}`, { method: 'DELETE' })
    fetchCourses()
  }

  const addQuestion = async (courseId: string) => {
    const opts = newQ.options.map((o) => o.trim()).filter(Boolean)
    if (!newQ.text.trim() || opts.length < 2) { alert('Cần nội dung câu hỏi và ít nhất 2 lựa chọn.'); return }
    if (newQ.correct_index >= opts.length) { alert('Đáp án đúng không hợp lệ.'); return }
    await api(`/admin/courses/${courseId}/questions`, { method: 'POST', body: { text: newQ.text, options: opts, correct_index: newQ.correct_index } })
    await reloadQuestions(courseId)
    setNewQ(emptyQuestion())
    fetchCourses()
  }

  const startEditQ = (q: QuestionRow) => { setEditQ(q.id); setQDraft({ text: q.text, options: [...q.options], correct_index: q.correct_index }) }
  const saveQuestion = async (courseId: string, qid: number) => {
    const opts = qDraft.options.map((o) => o.trim()).filter(Boolean)
    if (!qDraft.text.trim() || opts.length < 2) { alert('Cần nội dung câu hỏi và ít nhất 2 lựa chọn.'); return }
    if (qDraft.correct_index >= opts.length) { alert('Đáp án đúng không hợp lệ.'); return }
    await api(`/admin/questions/${qid}`, { method: 'PUT', body: { text: qDraft.text, options: opts, correct_index: qDraft.correct_index } })
    await reloadQuestions(courseId)
    setEditQ(null)
    fetchCourses()
  }

  const deleteQuestion = async (courseId: string, qid: number) => {
    await api(`/admin/questions/${qid}`, { method: 'DELETE' })
    await reloadQuestions(courseId)
    fetchCourses()
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Khóa học &amp; câu hỏi</h1>
        <button onClick={() => setShowNew((s) => !s)} className="inline-flex items-center gap-2 rounded-lg bg-vicem-600 px-4 py-2 font-semibold text-white hover:bg-vicem-700">
          <Plus className="h-4 w-4" /> Thêm khóa học
        </button>
      </div>

      {showNew && (
        <form onSubmit={createCourse} className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
          {/* ── Khu vực AI sinh nội dung ── */}
          <div className="sm:col-span-2 flex gap-2 rounded-xl bg-vicem-50 p-3 items-start">
            <Sparkles className="mt-2 h-5 w-5 shrink-0 text-vicem-600" aria-hidden />
            <div className="flex-1">
              <p className="text-sm font-semibold text-vicem-800">Tạo nội dung bằng AI</p>
              <p className="text-xs text-vicem-600 mb-2">Nhập chủ đề, AI sẽ tự soạn tên, mô tả, tóm tắt và câu hỏi trắc nghiệm.</p>
              <div className="flex gap-2">
                <input
                  value={aiTopic}
                  onChange={(e) => setAiTopic(e.target.value)}
                  placeholder="Vd: An toàn khi làm việc trên cao, Phòng chống cháy nổ…"
                  className="flex-1 rounded-lg border border-vicem-200 bg-white px-3 py-1.5 text-sm focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
                />
                <button
                  type="button" onClick={aiGenerate} disabled={aiLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-vicem-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-vicem-700 disabled:opacity-60"
                >
                  {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {aiLoading ? 'Đang tạo…' : 'Sinh nội dung'}
                </button>
              </div>
              {aiQuestions.length > 0 && (
                <p className="mt-1.5 text-xs text-emerald-700">✓ AI đã soạn {aiQuestions.length} câu hỏi — sẽ được lưu tự động khi tạo khóa học.</p>
              )}
            </div>
          </div>

          <input value={newCourse.id} onChange={(e) => setNewCourse({ ...newCourse, id: e.target.value })} placeholder="Mã (vd: atld-nang-cao)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input value={newCourse.title} onChange={(e) => setNewCourse({ ...newCourse, title: e.target.value })} placeholder="Tên khóa học" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input value={newCourse.grp} onChange={(e) => setNewCourse({ ...newCourse, grp: e.target.value })} placeholder="Nhóm đối tượng" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <select value={newCourse.branch_id} onChange={(e) => setNewCourse({ ...newCourse, branch_id: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">— Chọn chi nhánh —</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <input value={newCourse.duration} onChange={(e) => setNewCourse({ ...newCourse, duration: e.target.value })} placeholder="Thời lượng (vd: 25 phút)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input value={newCourse.video_url} onChange={(e) => setNewCourse({ ...newCourse, video_url: e.target.value })} placeholder="URL video nhúng (embed)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <input type="number" value={newCourse.pass_score} onChange={(e) => setNewCourse({ ...newCourse, pass_score: Number(e.target.value) })} placeholder="Điểm đạt (%)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <textarea value={newCourse.description} onChange={(e) => setNewCourse({ ...newCourse, description: e.target.value })} placeholder="Mô tả" rows={2} className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <textarea value={newCourse.summary} onChange={(e) => setNewCourse({ ...newCourse, summary: e.target.value })} placeholder="Tóm tắt nội dung (mỗi dòng 1 ý)" rows={3} className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2">
            <button type="submit" className="rounded-lg bg-vicem-600 px-4 py-2 text-sm font-semibold text-white hover:bg-vicem-700">Tạo khóa học</button>
          </div>
        </form>
      )}

      <div className="mt-5 space-y-3">
        {courses.map((c) => (
          <div key={c.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center gap-3 px-4 py-3">
              <button onClick={() => toggle(c.id)} className="text-slate-400 hover:text-vicem-600">
                {expanded === c.id ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-800">{c.title}</p>
                <p className="text-xs text-slate-400">{c.id} · {c.branch_name ?? 'Chưa phân loại'} · {c.grp} · {c.question_count} câu hỏi · đạt ≥ {c.pass_score}%</p>
              </div>
              <button onClick={() => startEditCourse(c)} className="rounded p-1.5 text-slate-400 hover:bg-vicem-50 hover:text-vicem-600" aria-label={`Sửa khóa học ${c.title}`}><Pencil className="h-4 w-4" /></button>
              <button onClick={() => deleteCourse(c.id)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Xóa khóa học"><Trash2 className="h-4 w-4" /></button>
            </div>

            {/* Sửa thông tin khóa học */}
            {editCourse === c.id && (
              <div className="border-t border-slate-100 bg-slate-50 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <input value={courseDraft.title} onChange={(e) => setCourseDraft({ ...courseDraft, title: e.target.value })} placeholder="Tên khóa học" className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
                  <input value={courseDraft.grp} onChange={(e) => setCourseDraft({ ...courseDraft, grp: e.target.value })} placeholder="Nhóm đối tượng" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <select value={courseDraft.branch_id} onChange={(e) => setCourseDraft({ ...courseDraft, branch_id: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    <option value="">— Chọn chi nhánh —</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <input value={courseDraft.duration} onChange={(e) => setCourseDraft({ ...courseDraft, duration: e.target.value })} placeholder="Thời lượng" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <input type="number" value={courseDraft.pass_score} onChange={(e) => setCourseDraft({ ...courseDraft, pass_score: Number(e.target.value) })} placeholder="Điểm đạt (%)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <input value={courseDraft.video_url} onChange={(e) => setCourseDraft({ ...courseDraft, video_url: e.target.value })} placeholder="URL video nhúng" className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
                  <textarea value={courseDraft.description} onChange={(e) => setCourseDraft({ ...courseDraft, description: e.target.value })} placeholder="Mô tả" rows={2} className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
                  <textarea value={courseDraft.summary} onChange={(e) => setCourseDraft({ ...courseDraft, summary: e.target.value })} placeholder="Tóm tắt nội dung (mỗi dòng 1 ý)" rows={3} className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button onClick={() => saveCourse(c.id)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"><Check className="h-4 w-4" /> Lưu</button>
                  <button onClick={() => setEditCourse(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"><X className="h-4 w-4" /></button>
                </div>
              </div>
            )}

            {expanded === c.id && (
              <div className="border-t border-slate-100 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-700">Câu hỏi trắc nghiệm</h3>
                <ul className="mt-3 space-y-2">
                  {(questions[c.id] ?? []).map((q, qi) => (
                    <li key={q.id} className="rounded-lg border border-slate-200 bg-white p-3">
                      {editQ === q.id ? (
                        <QuestionForm draft={qDraft} setDraft={setQDraft} radioName={`edit-${q.id}`}
                          onSave={() => saveQuestion(c.id, q.id)} onCancel={() => setEditQ(null)} saveLabel="Lưu câu hỏi" />
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-slate-700">Câu {qi + 1}. {q.text}</p>
                            <div className="flex shrink-0 gap-1">
                              <button onClick={() => startEditQ(q)} className="rounded p-1 text-slate-400 hover:bg-vicem-50 hover:text-vicem-600" aria-label="Sửa câu hỏi"><Pencil className="h-3.5 w-3.5" /></button>
                              <button onClick={() => deleteQuestion(c.id, q.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Xóa câu hỏi"><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          </div>
                          <ul className="mt-1.5 space-y-1 text-sm">
                            {q.options.map((o, oi) => (
                              <li key={oi} className={`flex items-center gap-1.5 ${oi === q.correct_index ? 'font-medium text-emerald-600' : 'text-slate-500'}`}>
                                {oi === q.correct_index ? <Check className="h-3.5 w-3.5" /> : <span className="w-3.5" />} {o}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </li>
                  ))}
                </ul>

                {/* Thêm câu hỏi */}
                <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-white p-3">
                  <p className="text-sm font-semibold text-slate-700">Thêm câu hỏi mới</p>
                  <QuestionForm draft={newQ} setDraft={setNewQ} radioName={`correct-${c.id}`}
                    onSave={() => addQuestion(c.id)} saveLabel="Thêm câu hỏi" />
                </div>

                {/* Lịch sử chứng chỉ đã đạt của khóa học này */}
                <div className="mt-5">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Award className="h-4 w-4 text-emerald-600" /> Lịch sử chứng chỉ đã đạt
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{(certs[c.id] ?? []).length}</span>
                  </h3>
                  {(certs[c.id] ?? []).length === 0 ? (
                    <p className="mt-2 rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-400">Chưa có học viên nào đạt chứng chỉ ở khóa này.</p>
                  ) : (
                    <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-3 py-2 font-semibold">Học viên</th>
                            <th className="px-3 py-2 font-semibold">Mã chứng chỉ</th>
                            <th className="px-3 py-2 font-semibold">Điểm</th>
                            <th className="px-3 py-2 font-semibold">Ngày cấp</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(certs[c.id] ?? []).map((ct) => (
                            <tr key={ct.cert_id}>
                              <td className="px-3 py-2 font-medium text-slate-700">{ct.trainee_info?.full_name || ct.full_name}</td>
                              <td className="px-3 py-2 font-mono text-xs text-slate-500">{ct.cert_id}</td>
                              <td className="px-3 py-2"><span className="font-semibold text-emerald-600">{ct.quiz_score}%</span></td>
                              <td className="px-3 py-2 text-slate-500">{ct.date ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// Form soạn câu hỏi dùng chung cho thêm mới & sửa: hỗ trợ thêm/bớt lựa chọn động.
function QuestionForm({ draft, setDraft, radioName, onSave, onCancel, saveLabel }: {
  draft: QuestionDraft
  setDraft: React.Dispatch<React.SetStateAction<QuestionDraft>>
  radioName: string
  onSave: () => void
  onCancel?: () => void
  saveLabel: string
}) {
  const setOption = (i: number, val: string) => setDraft((d) => ({ ...d, options: d.options.map((o, idx) => (idx === i ? val : o)) }))
  const addOption = () => setDraft((d) => ({ ...d, options: [...d.options, ''] }))
  const removeOption = (i: number) => setDraft((d) => {
    if (d.options.length <= 2) return d
    const options = d.options.filter((_, idx) => idx !== i)
    // Giữ đáp án đúng trỏ tới lựa chọn cũ sau khi xóa
    let correct = d.correct_index
    if (i === correct) correct = 0
    else if (i < correct) correct -= 1
    return { ...d, options, correct_index: correct }
  })

  return (
    <div>
      <input value={draft.text} onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))} placeholder="Nội dung câu hỏi" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <div className="mt-2 space-y-2">
        {draft.options.map((opt, oi) => (
          <div key={oi} className="flex items-center gap-2">
            <input type="radio" name={radioName} checked={draft.correct_index === oi} onChange={() => setDraft((d) => ({ ...d, correct_index: oi }))} aria-label={`Đáp án đúng là lựa chọn ${oi + 1}`} />
            <input value={opt} onChange={(e) => setOption(oi, e.target.value)} placeholder={`Lựa chọn ${oi + 1}`} className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
            <button type="button" onClick={() => removeOption(oi)} disabled={draft.options.length <= 2}
              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30" aria-label={`Xóa lựa chọn ${oi + 1}`}>
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addOption} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-vicem-600 hover:text-vicem-700">
        <Plus className="h-3.5 w-3.5" /> Thêm lựa chọn
      </button>
      <p className="mt-1 text-xs text-slate-400">Chọn nút radio ở lựa chọn là đáp án đúng. Tối thiểu 2 lựa chọn.</p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={onSave} className="inline-flex items-center gap-1 rounded-lg bg-vicem-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-vicem-700">
          <Check className="h-3.5 w-3.5" /> {saveLabel}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"><X className="h-4 w-4" /></button>}
      </div>
    </div>
  )
}
