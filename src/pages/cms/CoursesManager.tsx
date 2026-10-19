import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { Plus, Trash2, ChevronDown, ChevronRight, Check, Pencil, X, Award, Sparkles, Loader2, Video, QrCode, Link2, DownloadCloud } from 'lucide-react'
import { fmtDate } from '../../lib/date'

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
  validity_months: number | null
  max_attempts: number
}
interface QuestionRow {
  id: number
  text: string
  options: string[]
  correct_index: number
}
interface Branch { id: number; name: string }
interface CertRow {
  id: number
  cert_id: string
  trainee_name: string
  score: number
  issued_at: string
  expires_at: string | null
  source: 'account' | 'portal'
  cert_pdf: string | null
  download_key: string
  attempt_id: number | null
  attempt_key: string | null
  detail_pdf: string | null
  username: string | null
}
interface TokenRow {
  id: number
  label: string | null
  expires_at: string
  max_uses: number | null
  used_count: number
  created_at: string
  created_by_name: string | null
  active: boolean
}
type QuestionDraft = { text: string; options: string[]; correct_index: number }

const emptyQuestion = (): QuestionDraft => ({ text: '', options: ['', '', '', ''], correct_index: 0 })

/** Biểu tượng một bước trong thanh tiến trình AI sinh nội dung */
function AiStepBadge({ label, status }: { label: string; status: 'waiting' | 'running' | 'done' | 'error' }) {
  return (
    <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
      status === 'done'    ? 'bg-emerald-100 text-emerald-700' :
      status === 'running' ? 'bg-vicem-100 text-vicem-700' :
      status === 'error'   ? 'bg-red-100 text-red-600' :
                             'bg-slate-100 text-slate-400'
    }`}>
      {status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === 'done'    && <Check   className="h-3 w-3" />}
      {status === 'error'   && <X       className="h-3 w-3" />}
      {status === 'waiting' && <span className="inline-block h-2 w-2 rounded-full bg-slate-300" />}
      {label}
    </div>
  )
}

export default function CoursesManager() {
  const [courses, setCourses] = useState<CourseRow[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [questions, setQuestions] = useState<Record<string, QuestionRow[]>>({})
  const [certs, setCerts] = useState<Record<string, CertRow[]>>({})
  const [tokens, setTokens] = useState<Record<string, TokenRow[]>>({})
  const [tokenForm, setTokenForm] = useState({ label: '', days: '30', maxUses: '' })
  const [tokenBusy, setTokenBusy] = useState(false)
  const [createdToken, setCreatedToken] = useState<{
    courseId: string; id: number; token: string; expiresInDays: number; qrUrl: string
  } | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [error, setError] = useState('')

  const [newCourse, setNewCourse] = useState({ id: '', title: '', description: '', grp: 'Nhóm 4', branch_id: '', video_url: '', duration: '', pass_score: 80, validity_months: '', max_attempts: '', summary: '' })
  const [newQ, setNewQ] = useState<QuestionDraft>(emptyQuestion())

  // AI sinh nội dung khóa học từ prompt
  const [aiTopic, setAiTopic] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiQuestions, setAiQuestions] = useState<QuestionDraft[]>([])
  // Cấu hình + theo dõi tiến trình AI
  const [aiQuestionCount, setAiQuestionCount] = useState(8)
  const [aiStep, setAiStep] = useState<null | 'content' | 'quiz' | 'video' | 'done' | 'error'>(null)
  const [aiVideoJobId, setAiVideoJobId] = useState<string | null>(null)
  const [aiFrameImageUrl, setAiFrameImageUrl] = useState('')

  // Sửa khóa học
  const [editCourse, setEditCourse] = useState<string | null>(null)
  const [courseDraft, setCourseDraft] = useState({ title: '', description: '', grp: '', branch_id: '', video_url: '', duration: '', pass_score: 80, validity_months: '', max_attempts: '', summary: '' })
  // Sửa câu hỏi
  const [editQ, setEditQ] = useState<number | null>(null)
  const [qDraft, setQDraft] = useState<QuestionDraft>(emptyQuestion())

  const fetchCourses = useCallback(() => {
    api<{ courses: CourseRow[] }>('/courses').then((d) => setCourses(d.courses)).catch(() => {})
    api<{ branches: Branch[] }>('/admin/branches').then((d) => setBranches(d.branches)).catch(() => {})
  }, [])
  useEffect(fetchCourses, [fetchCourses])

  // Polling trạng thái job video (mỗi 5 giây) khi AI đang render video
  useEffect(() => {
    if (!aiVideoJobId || aiStep !== 'video') return
    const interval = setInterval(async () => {
      try {
        const s = await api<{ status: string; videoUrl: string | null }>(`/admin/videos/${aiVideoJobId}/status`)
        if (s.status === 'done') {
          if (s.videoUrl) setNewCourse(c => ({ ...c, video_url: s.videoUrl! }))
          setAiStep('done'); clearInterval(interval)
        }
        if (s.status === 'error') { setAiStep('error'); clearInterval(interval) }
      } catch { /* bỏ qua lỗi mạng tạm thời */ }
    }, 5000)
    return () => clearInterval(interval)
  }, [aiVideoJobId, aiStep])

  const reloadQuestions = async (courseId: string) => {
    const d = await api<{ questions: QuestionRow[] }>(`/admin/courses/${courseId}/questions`)
    setQuestions((q) => ({ ...q, [courseId]: d.questions }))
  }

  const reloadCerts = async (courseId: string) => {
    const d = await api<{ certificates: CertRow[] }>(`/admin/courses/${courseId}/quiz-certificates`)
    setCerts((c) => ({ ...c, [courseId]: d.certificates }))
  }

  const reloadTokens = async (courseId: string) => {
    const d = await api<{ tokens: TokenRow[] }>(`/admin/courses/${courseId}/quiz-tokens`)
    setTokens((t) => ({ ...t, [courseId]: d.tokens }))
  }

  const createToken = async (courseId: string) => {
    setTokenBusy(true)
    try {
      const r = await api<{ id: number; token: string; expires_in_days: number }>(
        `/admin/courses/${courseId}/quiz-tokens`,
        { method: 'POST', body: { label: tokenForm.label || null, days: Number(tokenForm.days) || 30, max_uses: tokenForm.maxUses ? Number(tokenForm.maxUses) : null } },
      )
      const url = `${window.location.origin}/thi/${r.token}`
      const { default: QRCode } = await import('qrcode')
      const qrUrl = await QRCode.toDataURL(url, { margin: 1, width: 256 })
      setCreatedToken({ courseId, id: r.id, token: r.token, expiresInDays: r.expires_in_days, qrUrl })
      setTokenForm({ label: '', days: '30', maxUses: '' })
      await reloadTokens(courseId)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Tạo link thất bại.')
    } finally { setTokenBusy(false) }
  }

  const revokeToken = async (courseId: string, tokenId: number) => {
    if (!confirm('Thu hồi link thi này? Học viên đang dùng link sẽ bị chặn.')) return
    await api(`/admin/courses/${courseId}/quiz-tokens/${tokenId}`, { method: 'DELETE' })
    await reloadTokens(courseId)
  }

  const toggle = async (id: string) => {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (!questions[id]) await reloadQuestions(id)
    if (!certs[id]) await reloadCerts(id).catch(() => {})
    if (!tokens[id]) await reloadTokens(id).catch(() => {})
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
      setNewCourse({ id: '', title: '', description: '', grp: 'Nhóm 4', branch_id: '', video_url: '', duration: '', pass_score: 80, validity_months: '', max_attempts: '', summary: '' })
      setAiQuestions([])
      setAiTopic('')
      setAiStep(null)
      setAiVideoJobId(null)
      setAiFrameImageUrl('')
      fetchCourses()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tạo khóa học thất bại.')
    }
  }

  // Gọi AI sinh nội dung, tự điền vào form (giữ mã khóa học admin đã nhập)
  const aiGenerate = async () => {
    if (aiTopic.trim().length < 3) { setError('Nhập chủ đề để AI soạn nội dung.'); return }
    setAiLoading(true); setAiStep('content'); setAiVideoJobId(null); setError('')
    try {
      const { course } = await api<{
        course: { title: string; description: string; grp: string; duration: string; summary: string[]; questions: QuestionDraft[] }
      }>('/admin/courses/ai-generate', { method: 'POST', body: { topic: aiTopic, questionCount: aiQuestionCount } })
      setNewCourse((c) => ({
        ...c,
        title: course.title, description: course.description, grp: course.grp || c.grp,
        duration: course.duration, summary: course.summary.join('\n'),
      }))
      setAiQuestions(course.questions ?? [])
      // Nội dung sẵn sàng → chờ admin xem lại trước khi tạo video
      setAiStep('quiz')
    } catch (err) {
      setAiStep('error')
      setError(err instanceof Error ? err.message : 'AI sinh nội dung thất bại.')
    } finally { setAiLoading(false) }
  }

  // Khởi động job tạo video sau khi admin đã kiểm tra nội dung
  const startVideoRender = async () => {
    try {
      const { jobId } = await api<{ jobId: string }>('/admin/videos/create', {
        method: 'POST',
        body: {
          topic: aiTopic,
          imageUrl: aiFrameImageUrl.trim() || null,
          course: {
            title: newCourse.title, description: newCourse.description, grp: newCourse.grp,
            duration: newCourse.duration, summary: newCourse.summary.split('\n').filter((s) => s.trim()),
            questions: [],
          },
        },
      })
      setAiVideoJobId(jobId); setAiStep('video')
    } catch (err) {
      setAiStep('error')
      setError(err instanceof Error ? err.message : 'Không thể khởi động tạo video.')
    }
  }

  const startEditCourse = (c: CourseRow) => {
    setEditCourse(c.id)
    setCourseDraft({
      title: c.title, description: c.description, grp: c.grp, branch_id: c.branch_id ? String(c.branch_id) : '',
      video_url: c.video_url, duration: c.duration, pass_score: c.pass_score,
      validity_months: c.validity_months == null ? '' : String(c.validity_months),
      // 0 = không giới hạn, hiển thị thành ô trống cho khớp placeholder.
      max_attempts: !c.max_attempts ? '' : String(c.max_attempts),
      summary: (c.summary ?? []).join('\n'),
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
          <div className="sm:col-span-2 rounded-xl bg-vicem-50 p-3">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-vicem-600" aria-hidden />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-vicem-800">Tạo nội dung bằng AI</p>
                <p className="text-xs text-vicem-600 mb-2">Nhập chủ đề, AI sẽ soạn nội dung, câu hỏi và khởi động render video tự động.</p>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={aiTopic}
                    onChange={(e) => setAiTopic(e.target.value)}
                    placeholder="Vd: An toàn khi làm việc trên cao, Phòng chống cháy nổ…"
                    className="min-w-0 flex-1 rounded-lg border border-vicem-200 bg-white px-3 py-1.5 text-sm focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
                  />
                  {/* Cấu hình số câu hỏi */}
                  <div className="flex items-center gap-1.5 rounded-lg border border-vicem-200 bg-white px-2.5 py-1.5">
                    <label htmlFor="ai-q-count" className="text-xs text-slate-500 whitespace-nowrap">Số câu hỏi</label>
                    <input
                      id="ai-q-count" type="number" min={3} max={20}
                      value={aiQuestionCount}
                      onChange={(e) => setAiQuestionCount(Math.max(3, Math.min(20, Number(e.target.value) || 8)))}
                      className="w-12 rounded border border-slate-200 px-1 py-0.5 text-center text-sm font-semibold text-vicem-700 focus:border-vicem-400 focus:outline-none"
                    />
                  </div>
                  <button
                    type="button" onClick={aiGenerate} disabled={aiLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-vicem-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-vicem-700 disabled:opacity-60"
                  >
                    {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {aiLoading ? 'Đang xử lý…' : 'Sinh nội dung'}
                  </button>
                </div>

                {/* Thanh tiến trình 3 bước */}
                {aiStep !== null && (
                  <div className="mt-3 flex flex-wrap items-center gap-1">
                    <AiStepBadge
                      label="Soạn nội dung"
                      status={
                        aiStep === 'content' ? 'running' :
                        aiStep === 'error' && !aiVideoJobId ? 'error' : 'done'
                      }
                    />
                    <div className="h-px w-4 shrink-0 bg-slate-200" />
                    <AiStepBadge
                      label={`${aiQuestions.length > 0 ? aiQuestions.length : aiQuestionCount} câu hỏi`}
                      status={
                        aiStep === 'content' ? 'waiting' :
                        aiStep === 'error' && !aiVideoJobId ? 'error' : 'done'
                      }
                    />
                    <div className="h-px w-4 shrink-0 bg-slate-200" />
                    <AiStepBadge
                      label="Video clip"
                      status={
                        aiStep === 'content' || aiStep === 'quiz' ? 'waiting' :
                        aiStep === 'video' ? 'running' :
                        aiStep === 'done' ? 'done' :
                        aiStep === 'error' ? 'error' : 'waiting'
                      }
                    />
                    {aiStep === 'quiz' && (
                      <span className="ml-1 text-xs italic text-sky-600">↓ xem lại bên dưới</span>
                    )}
                    {aiStep === 'video' && (
                      <span className="ml-1 text-xs italic text-slate-400">đang render…</span>
                    )}
                    {aiStep === 'done' && (
                      <span className="ml-1 text-xs font-medium text-emerald-600">✓ Hoàn tất</span>
                    )}
                    {aiStep === 'error' && (
                      <span className="ml-1 text-xs text-red-600">Có lỗi — thử lại.</span>
                    )}
                  </div>
                )}

                {/* Panel xem lại nội dung — xuất hiện sau khi AI sinh xong, chờ admin xác nhận tạo video */}
                {aiStep === 'quiz' && (
                  <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3">
                    <p className="text-sm font-semibold text-sky-800">Xem lại nội dung trước khi tạo video</p>
                    <div className="mt-2 space-y-1 text-xs text-slate-600">
                      <div><span className="font-medium">Tiêu đề:</span> {newCourse.title}</div>
                      <div><span className="font-medium">Mô tả:</span> {newCourse.description}</div>
                      <div>
                        <span className="font-medium">Tóm tắt:</span>{' '}
                        {newCourse.summary.split('\n').filter((s) => s.trim()).length} ý ·{' '}
                        <span className="font-medium">Câu hỏi:</span> {aiQuestions.length} câu
                      </div>
                    </div>
                    {/* Cấu hình ảnh bìa (frame) cho video — tùy chọn */}
                    <div className="mt-3">
                      <input
                        value={aiFrameImageUrl}
                        onChange={(e) => setAiFrameImageUrl(e.target.value)}
                        placeholder="URL ảnh bìa video (tùy chọn — để trống dùng nền màu mặc định)"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-sky-400 focus:ring-1 focus:ring-sky-100"
                      />
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={startVideoRender}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-vicem-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-vicem-700"
                      >
                        <Video className="h-3.5 w-3.5" /> Tạo video
                      </button>
                      <button
                        type="button"
                        onClick={() => setAiStep('done')}
                        className="text-xs text-slate-500 underline hover:text-slate-700"
                      >
                        Bỏ qua video
                      </button>
                    </div>
                  </div>
                )}
              </div>
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
          {/* Để trống = chứng chỉ không hết hạn. Hạn tính từ ngày đạt, dùng cho cảnh báo
              và cho đối chiếu khóa học JSA khi kiểm tra ATMT. */}
          <input type="number" min={0} value={newCourse.validity_months} onChange={(e) => setNewCourse({ ...newCourse, validity_months: e.target.value })} placeholder="Thời hạn chứng chỉ (tháng, trống = vô hạn)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          {/* Trống = không giới hạn. Hết số lần mà vẫn chưa đạt thì hồ sơ NLĐ tương ứng
              (đối chiếu theo CCCD) bị từ chối cấp quyền vào nhà máy. */}
          <input type="number" min={0} max={20} value={newCourse.max_attempts} onChange={(e) => setNewCourse({ ...newCourse, max_attempts: e.target.value })} placeholder="Số lần thi tối đa (trống = không giới hạn)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
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
                <p className="text-xs text-slate-400">
                  {c.id} · {c.branch_name ?? 'Chưa phân loại'} · {c.grp} · {c.question_count} câu hỏi · đạt ≥ {c.pass_score}%
                  {c.max_attempts > 0 && ` · tối đa ${c.max_attempts} lần thi`}
                </p>
              </div>
              {/* Lối tắt tới khối "Link QR thi" — khối đó nằm trong phần mở rộng nên dễ bị bỏ sót. */}
              <button
                onClick={async () => {
                  if (expanded !== c.id) await toggle(c.id)
                  document.getElementById(`qr-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100"
              >
                <QrCode className="h-3.5 w-3.5" /> QR thi
              </button>
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
                  <input type="number" min={0} value={courseDraft.validity_months} onChange={(e) => setCourseDraft({ ...courseDraft, validity_months: e.target.value })} placeholder="Thời hạn chứng chỉ (tháng, trống = vô hạn)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <input type="number" min={0} max={20} value={courseDraft.max_attempts} onChange={(e) => setCourseDraft({ ...courseDraft, max_attempts: e.target.value })} placeholder="Số lần thi tối đa (trống = không giới hạn)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
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

                {/* ─ Link QR thi tại hiện trường (Pha H6) ─ */}
                <div id={`qr-${c.id}`} className="mt-5 scroll-mt-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <QrCode className="h-4 w-4 text-sky-600" /> Link QR thi tại hiện trường
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                      {(tokens[c.id] ?? []).filter((t) => t.active).length} đang hoạt động
                    </span>
                  </h3>

                  {/* Token vừa tạo — kèm QR và nút sao chép. Token thô chỉ trả về đúng lần
                      tạo, nên phải lưu QR ngay; đóng thông báo này là hết. */}
                  {createdToken?.courseId === c.id && (
                    <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4">
                      <div className="flex items-start gap-4">
                        <img src={createdToken.qrUrl} alt="QR code" className="h-32 w-32 rounded border border-emerald-200" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-emerald-800">Link thi đã tạo</p>
                          <p className="mt-0.5 text-xs font-medium text-amber-700">⚠ Lưu QR ngay — không hiển thị lại sau khi đóng.</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button type="button"
                              onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/thi/${createdToken.token}`)}
                              className="inline-flex items-center gap-1.5 rounded border border-emerald-400 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
                              <Link2 className="h-3.5 w-3.5" /> Sao chép link
                            </button>
                            <a href={createdToken.qrUrl} download={`qr-thi-${createdToken.courseId}.png`}
                              className="inline-flex items-center gap-1.5 rounded border border-emerald-400 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
                              <DownloadCloud className="h-3.5 w-3.5" /> Tải ảnh QR
                            </a>
                          </div>
                          <p className="mt-2 text-xs text-slate-500">Hết hạn sau {createdToken.expiresInDays} ngày</p>
                        </div>
                      </div>
                      <button type="button" onClick={() => setCreatedToken(null)}
                        className="mt-3 text-xs text-slate-400 underline hover:text-slate-600">
                        Đóng thông báo này
                      </button>
                    </div>
                  )}

                  {/* Form tạo token */}
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <input value={tokenForm.label} onChange={(e) => setTokenForm({ ...tokenForm, label: e.target.value })} placeholder="Nhãn (tùy chọn)" className="col-span-3 rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-1" />
                    <input type="number" min={1} max={180} value={tokenForm.days} onChange={(e) => setTokenForm({ ...tokenForm, days: e.target.value })} placeholder="Hạn dùng (ngày)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <input type="number" min={1} max={10000} value={tokenForm.maxUses} onChange={(e) => setTokenForm({ ...tokenForm, maxUses: e.target.value })} placeholder="Số lượt (trống = ∞)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <button type="button" onClick={() => createToken(c.id)} disabled={tokenBusy}
                      className="col-span-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60 sm:col-span-1">
                      {tokenBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                      Tạo link QR
                    </button>
                  </div>

                  {/* Danh sách link đã tạo */}
                  {(tokens[c.id] ?? []).length > 0 && (
                    <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr>
                            <th className="px-3 py-2 font-semibold">Nhãn</th>
                            <th className="px-3 py-2 font-semibold">Hết hạn</th>
                            <th className="px-3 py-2 font-semibold">Lượt dùng</th>
                            <th className="px-3 py-2 font-semibold">Trạng thái</th>
                            <th className="px-3 py-2" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(tokens[c.id] ?? []).map((tk) => (
                            <tr key={tk.id}>
                              <td className="px-3 py-2 text-slate-700">{tk.label ?? <span className="text-slate-400 italic">—</span>}</td>
                              <td className="px-3 py-2 text-slate-500">{fmtDate(tk.expires_at)}</td>
                              <td className="px-3 py-2">{tk.used_count}{tk.max_uses !== null ? ` / ${tk.max_uses}` : ''}</td>
                              <td className="px-3 py-2">
                                <span className={`rounded-full px-2 py-0.5 font-medium ${tk.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                                  {tk.active ? 'Hoạt động' : 'Đã đóng'}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                {tk.active && (
                                  <button onClick={() => revokeToken(c.id, tk.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Thu hồi link">
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Chứng nhận đã cấp của khóa — cả hai lối vào (tài khoản và QR) */}
                <div className="mt-5">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Award className="h-4 w-4 text-emerald-600" /> Chứng nhận đã cấp
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{(certs[c.id] ?? []).length}</span>
                  </h3>
                  {(certs[c.id] ?? []).length === 0 ? (
                    <p className="mt-2 rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-400">Chưa có học viên nào đạt chứng chỉ ở khóa này.</p>
                  ) : (
                    <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr>
                            <th className="px-3 py-2 font-semibold">Học viên</th>
                            <th className="px-3 py-2 font-semibold">Mã CC</th>
                            <th className="px-3 py-2 font-semibold">Điểm</th>
                            <th className="px-3 py-2 font-semibold">Ngày cấp</th>
                            <th className="px-3 py-2 font-semibold">Nguồn</th>
                            <th className="px-3 py-2" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(certs[c.id] ?? []).map((ct) => (
                            <tr key={ct.cert_id}>
                              <td className="px-3 py-2 font-medium text-slate-700">{ct.trainee_name}</td>
                              <td className="px-3 py-2 font-mono text-slate-500">{ct.cert_id}</td>
                              <td className="px-3 py-2"><span className="font-semibold text-emerald-600">{ct.score}%</span></td>
                              <td className="px-3 py-2 text-slate-500">{fmtDate(ct.issued_at)}</td>
                              <td className="px-3 py-2">
                                <span className={`rounded px-1.5 py-0.5 font-medium ${ct.source === 'portal' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>
                                  {ct.source === 'portal' ? 'QR' : 'Tài khoản'}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex gap-1">
                                  <a href={`/api/courses/certificates/${encodeURIComponent(ct.cert_id)}/pdf?k=${ct.download_key}`} target="_blank" rel="noreferrer" title="Tải chứng nhận PDF" className="rounded p-1 text-slate-400 hover:text-sky-600" aria-label="Tải chứng nhận PDF">
                                    <Award className="h-3.5 w-3.5" />
                                  </a>
                                  {ct.attempt_id && ct.attempt_key && (
                                    <a href={`/api/courses/attempts/${ct.attempt_id}/pdf?k=${ct.attempt_key}`} target="_blank" rel="noreferrer" title="Tải bài làm PDF" className="rounded p-1 text-slate-400 hover:text-emerald-600" aria-label="Tải bài làm PDF">
                                      <DownloadCloud className="h-3.5 w-3.5" />
                                    </a>
                                  )}
                                </div>
                              </td>
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
