import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../lib/api'
import { toEmbedUrl } from '../lib/embedUrl'
import { Card } from '../components/ui'
import { PlayCircle, FileText, ClipboardCheck, Check, ArrowRight, ArrowLeft, RefreshCw, Camera, Upload, Loader2 } from 'lucide-react'
import Certificate, { type CertData } from '../components/Certificate'

const STEPS = [
  { n: 1, label: 'Xem video', icon: PlayCircle },
  { n: 2, label: 'Tóm tắt nội dung', icon: FileText },
  { n: 3, label: 'Trắc nghiệm & chứng chỉ', icon: ClipboardCheck },
]

interface Course {
  id: string
  title: string
  video_url: string
  summary: string[]
  pass_score: number
}
interface Question {
  id: number
  text: string
  options: string[]
}
interface QuizField {
  field_key: string
  label: string
  type: 'text' | 'select' | 'image'
  options: string[]
  required: boolean
  purpose?: 'none' | 'full_name' | 'id_number' | 'photo'
}
interface ProgressRow {
  step: number
  quiz_score: number | null
  passed: boolean
  cert_id: string | null
  completed_at: string | null
}

export default function TrainingDetailPage() {
  const { id = '' } = useParams()
  const [course, setCourse] = useState<Course | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [step, setStep] = useState(1)
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [result, setResult] = useState<{
    score: number; passed: boolean; passScore: number
    certificate: CertData | null; attempt_pdf?: string | null
  } | null>(null)
  // Pha E4: 0 = không giới hạn. attemptsLeft null khi khóa học không giới hạn.
  const [maxAttempts, setMaxAttempts] = useState(0)
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [quizFields, setQuizFields] = useState<QuizField[]>([])
  const [traineeInfo, setTraineeInfo] = useState<Record<string, string>>({})
  const [infoConfirmed, setInfoConfirmed] = useState(false)
  const [seed, setSeed] = useState('')
  const [questionIds, setQuestionIds] = useState<number[]>([])
  // Trường ảnh (type='image'): traineeInfo giữ stored_name server trả về, còn previews giữ
  // blob URL để hiện ảnh ngay trên máy, không phải tải ngược từ server.
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [photoBusy, setPhotoBusy] = useState<Record<string, boolean>>({})
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    api<{
      course: Course; questions: Question[]; progress: ProgressRow | null
      max_attempts: number; attempts_left: number | null
      questionIds: number[]; seed: string
    }>(`/courses/${id}`)
      .then((d) => {
        setCourse(d.course)
        setQuestions(d.questions)
        // seed + questionIds phải gửi trả lại khi nộp: seed để server dựng lại đúng
        // phép xáo phương án, questionIds để chỉ chấm đúng bộ câu đã phát.
        setSeed(d.seed ?? '')
        setQuestionIds(d.questionIds ?? [])
        setStep(d.progress?.step ?? 1)
        setMaxAttempts(d.max_attempts ?? 0)
        setAttemptsLeft(d.attempts_left ?? null)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
    api<{ fields: QuizField[] }>('/courses/meta/quiz-fields')
      .then((d) => setQuizFields(d.fields))
      .catch(() => {})
  }, [id])

  const uploadPhoto = async (key: string, file: File) => {
    setPreviews((p) => ({ ...p, [key]: URL.createObjectURL(file) }))
    // Xóa giá trị cũ trong lúc tải: ảnh mới chưa lên xong thì chưa được tính là đã khai.
    setTraineeInfo((t) => ({ ...t, [key]: '' }))
    setPhotoBusy((b) => ({ ...b, [key]: true }))
    try {
      const form = new FormData()
      form.append('file', file)
      const r = await api<{ stored_name: string }>(
        `/courses/${id}/trainee-photo`, { method: 'POST', body: form, isForm: true })
      setTraineeInfo((t) => ({ ...t, [key]: r.stored_name }))
    } catch (e) {
      setPreviews((p) => { const n = { ...p }; delete n[key]; return n })
      alert(e instanceof Error ? e.message : 'Tải ảnh thất bại.')
    } finally {
      setPhotoBusy((b) => ({ ...b, [key]: false }))
    }
  }

  const onPickPhoto = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // cho phép chọn lại cùng một file
    if (file) uploadPhoto(key, file)
  }

  const goStep = (n: number) => {
    setStep(n)
    api(`/courses/${id}/step`, { method: 'POST', body: { step: n } }).catch(() => {})
  }

  const submitQuiz = async () => {
    setError('')
    try {
      const r = await api<NonNullable<typeof result> & { attempts_left: number | null }>(
        `/courses/${id}/submit`,
        { method: 'POST', body: { answers, traineeInfo, seed, questionIds } })
      setResult(r)
      setAttemptsLeft(r.attempts_left ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nộp bài thất bại.')
      // Hết lượt thì server trả 403; cập nhật để ẩn nút "Làm lại" thay vì để bấm vô ích.
      if (maxAttempts > 0) setAttemptsLeft(0)
    }
  }

  const retry = () => {
    setAnswers({})
    setResult(null)
  }

  // Kiểm tra các trường bắt buộc đã điền đủ chưa
  const infoComplete = quizFields.every((f) => !f.required || (traineeInfo[f.field_key] ?? '').trim() !== '')

  if (loading) return <p className="py-16 text-center text-slate-400">Đang tải…</p>
  if (error && !course) return <p className="py-16 text-center text-slate-500">{error} <Link className="text-vicem-600 underline" to="/huan-luyen">Quay lại</Link></p>
  if (!course) return null

  const allAnswered = questions.every((q) => answers[q.id] !== undefined)
  const showCert = result?.passed && result.certificate
  // Hết lượt thì không cho nộp nữa; server cũng chặn, đây chỉ là để không mời bấm.
  const outOfAttempts = maxAttempts > 0 && attemptsLeft != null && attemptsLeft <= 0

  return (
    <div>
      <Link to="/huan-luyen" className="inline-flex items-center gap-1 text-sm text-vicem-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Danh sách khóa học
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-slate-800">{course.title}</h1>

      <ol className="mt-5 flex flex-wrap gap-2">
        {STEPS.map((s) => {
          const done = step > s.n || (s.n === 3 && result?.passed)
          const active = step === s.n
          const Icon = s.icon
          return (
            <li key={s.n}>
              <button
                onClick={() => (s.n <= step ? goStep(s.n) : undefined)}
                disabled={s.n > step}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
                  active ? 'border-vicem-500 bg-vicem-50 text-vicem-700'
                  : done ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-400'
                } ${s.n > step ? 'cursor-not-allowed' : ''}`}
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs">
                  {done ? <Check className="h-4 w-4 text-emerald-600" /> : s.n}
                </span>
                <Icon className="h-4 w-4" aria-hidden /> {s.label}
              </button>
            </li>
          )
        })}
      </ol>

      <Card className="mt-6 p-6">
        {step === 1 && (
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Bước 1 · Xem video huấn luyện</h2>
            <div className="mt-4 aspect-video w-full overflow-hidden rounded-lg bg-black">
              {course.video_url.startsWith('/') ? (
                <video
                  className="h-full w-full"
                  src={course.video_url}
                  controls
                  title={`Video huấn luyện: ${course.title}`}
                />
              ) : (
                <iframe
                  className="h-full w-full"
                  src={toEmbedUrl(course.video_url)}
                  title={`Video huấn luyện: ${course.title}`}
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              )}
            </div>
            <div className="mt-5 flex justify-end">
              <button onClick={() => goStep(2)} className="inline-flex items-center gap-2 rounded-lg bg-vicem-600 px-5 py-2.5 font-semibold text-white hover:bg-vicem-700">
                Đã xem xong, tiếp tục <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Bước 2 · Tóm tắt nội dung buổi huấn luyện</h2>
            <ul className="mt-4 space-y-3">
              {course.summary.map((s, i) => (
                <li key={i} className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 text-slate-700">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-vicem-100 text-sm font-semibold text-vicem-700">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex justify-between">
              <button onClick={() => goStep(1)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 font-medium text-slate-600 hover:bg-slate-50">
                <ArrowLeft className="h-4 w-4" /> Xem lại video
              </button>
              <button onClick={() => goStep(3)} className="inline-flex items-center gap-2 rounded-lg bg-vicem-600 px-5 py-2.5 font-semibold text-white hover:bg-vicem-700">
                Tôi đã đọc, làm trắc nghiệm <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Bước 3 · Trắc nghiệm trực tuyến</h2>

            {showCert ? (
              <Certificate
                data={result!.certificate!}
                attemptPdfUrl={result!.attempt_pdf}
                photoUrl={(() => {
                  // Ảnh lấy từ trường có vai trò 'photo'; không đánh dấu thì lấy trường ảnh đầu tiên.
                  const pf = quizFields.find((f) => f.purpose === 'photo') ?? quizFields.find((f) => f.type === 'image')
                  return pf ? previews[pf.field_key] ?? null : null
                })()}
              />
            ) : quizFields.length > 0 && !infoConfirmed ? (
              <div className="mt-4">
                <p className="text-sm text-slate-500">Vui lòng khai báo thông tin trước khi làm bài trắc nghiệm.</p>
                <form
                  onSubmit={(e) => { e.preventDefault(); if (infoComplete) setInfoConfirmed(true) }}
                  className="mt-4 grid gap-4 sm:grid-cols-2"
                >
                  {quizFields.map((f) => (
                    <div key={f.field_key}>
                      <label className="block text-sm font-medium text-slate-700">
                        {f.label} {f.required && <span className="text-eco-600">*</span>}
                      </label>
                      {f.type === 'image' ? (
                        <div className="mt-1">
                          {/* capture="user": điện thoại mở thẳng camera trước; máy tính thì bỏ qua và mở hộp chọn file. */}
                          <input
                            ref={(el) => { fileRefs.current[`${f.field_key}_cam`] = el }}
                            type="file" accept="image/*" capture="user" className="hidden"
                            onChange={onPickPhoto(f.field_key)}
                          />
                          <input
                            ref={(el) => { fileRefs.current[f.field_key] = el }}
                            type="file" accept="image/*" className="hidden"
                            onChange={onPickPhoto(f.field_key)}
                          />
                          <div className="flex items-center gap-3">
                            {previews[f.field_key] && (
                              <div className="relative shrink-0">
                                <img src={previews[f.field_key]} alt={`Ảnh ${f.label}`}
                                  className="h-24 w-20 rounded-lg border border-slate-200 object-cover" />
                                {photoBusy[f.field_key] && (
                                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/60">
                                    <Loader2 className="h-5 w-5 animate-spin text-vicem-600" aria-label="Đang tải ảnh" />
                                  </div>
                                )}
                                {traineeInfo[f.field_key] && !photoBusy[f.field_key] && (
                                  <span className="absolute -right-1.5 -top-1.5 rounded-full bg-emerald-500 p-0.5">
                                    <Check className="h-3 w-3 text-white" aria-label="Đã tải lên" />
                                  </span>
                                )}
                              </div>
                            )}
                            <div className="flex flex-1 flex-wrap gap-2">
                              <button type="button" disabled={photoBusy[f.field_key]}
                                onClick={() => fileRefs.current[`${f.field_key}_cam`]?.click()}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-vicem-600 px-3 py-2 text-sm font-medium text-white hover:bg-vicem-700 disabled:opacity-50">
                                <Camera className="h-4 w-4" /> Chụp ảnh
                              </button>
                              <button type="button" disabled={photoBusy[f.field_key]}
                                onClick={() => fileRefs.current[f.field_key]?.click()}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                                <Upload className="h-4 w-4" /> Tải từ máy
                              </button>
                            </div>
                          </div>
                          {!previews[f.field_key] && (
                            <p className="mt-1 text-xs text-slate-400">Ảnh chân dung rõ mặt, PNG/JPG/WEBP, tối đa 4MB.</p>
                          )}
                        </div>
                      ) : f.type === 'select' ? (
                        <select
                          value={traineeInfo[f.field_key] ?? ''}
                          onChange={(e) => setTraineeInfo((t) => ({ ...t, [f.field_key]: e.target.value }))}
                          required={f.required}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
                        >
                          <option value="">— Chọn —</option>
                          {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input
                          value={traineeInfo[f.field_key] ?? ''}
                          onChange={(e) => setTraineeInfo((t) => ({ ...t, [f.field_key]: e.target.value }))}
                          required={f.required}
                          maxLength={200}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
                        />
                      )}
                    </div>
                  ))}
                  <div className="sm:col-span-2 flex justify-between">
                    <button type="button" onClick={() => goStep(2)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 font-medium text-slate-600 hover:bg-slate-50">
                      <ArrowLeft className="h-4 w-4" /> Quay lại
                    </button>
                    <button
                      type="submit" disabled={!infoComplete}
                      className={`rounded-lg px-5 py-2.5 font-semibold text-white ${infoComplete ? 'bg-vicem-600 hover:bg-vicem-700' : 'cursor-not-allowed bg-slate-300'}`}
                    >
                      Bắt đầu làm bài
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <>
                <p className="mt-1 text-sm text-slate-500">Cần đạt tối thiểu {course.pass_score}% để được cấp chứng chỉ.</p>
                {quizFields.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-vicem-50 px-4 py-2.5 text-sm text-vicem-800">
                    {quizFields.map((f) => traineeInfo[f.field_key] && (
                      f.type === 'image' ? (
                        previews[f.field_key] && (
                          <img key={f.field_key} src={previews[f.field_key]} alt={f.label}
                            className="h-10 w-8 rounded object-cover" />
                        )
                      ) : (
                        <span key={f.field_key}><span className="text-vicem-500">{f.label}:</span> <b>{traineeInfo[f.field_key]}</b></span>
                      )
                    ))}
                    <button onClick={() => setInfoConfirmed(false)} className="ml-auto text-xs font-medium text-vicem-600 underline">Sửa thông tin</button>
                  </div>
                )}
                <div className="mt-4 space-y-5">
                  {questions.map((q, qi) => (
                    <fieldset key={q.id} className="rounded-lg border border-slate-200 p-4">
                      <legend className="px-1 text-sm font-semibold text-slate-800">Câu {qi + 1}. {q.text}</legend>
                      <div className="mt-2 space-y-2">
                        {q.options.map((opt, oi) => {
                          const chosen = answers[q.id] === oi
                          return (
                            <label
                              key={oi}
                              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                                chosen ? 'border-vicem-400 bg-vicem-50' : 'border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              <input
                                type="radio"
                                name={`q${q.id}`}
                                checked={chosen}
                                onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                              />
                              <span>{opt}</span>
                            </label>
                          )
                        })}
                      </div>
                    </fieldset>
                  ))}
                </div>

                {/* Nói trước còn mấy lượt, không để học viên làm hết bài rồi mới nhận 403. */}
                {maxAttempts > 0 && !result && (
                  <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${(attemptsLeft ?? 0) > 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                    {(attemptsLeft ?? 0) > 0
                      ? `Khóa học này giới hạn ${maxAttempts} lần làm bài — bạn còn ${attemptsLeft} lượt.`
                      : `Bạn đã dùng hết ${maxAttempts} lần làm bài. Liên hệ cán bộ ATVSLĐ để được xem xét.`}
                  </p>
                )}

                {result && !result.passed && (
                  <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    Kết quả: <b>{result.score}%</b> — Chưa đạt (yêu cầu ≥ {result.passScore}%).
                    {maxAttempts > 0 && attemptsLeft === 0
                      ? ' Đã hết số lần làm bài cho phép; hồ sơ cấp quyền vào nhà máy sẽ do cán bộ ATVSLĐ xem xét lại.'
                      : maxAttempts > 0
                        ? ` Vui lòng ôn lại và làm lại — còn ${attemptsLeft} lượt.`
                        : ' Vui lòng ôn lại và làm lại.'}
                  </div>
                )}
                {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

                <div className="mt-5 flex justify-between">
                  <button onClick={() => goStep(2)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 font-medium text-slate-600 hover:bg-slate-50">
                    <ArrowLeft className="h-4 w-4" /> Xem lại tóm tắt
                  </button>
                  {!result ? (
                    <button
                      onClick={submitQuiz}
                      disabled={!allAnswered || outOfAttempts}
                      className={`rounded-lg px-5 py-2.5 font-semibold text-white ${allAnswered && !outOfAttempts ? 'bg-eco-600 hover:bg-eco-700' : 'cursor-not-allowed bg-slate-300'}`}
                    >
                      Nộp bài &amp; chấm điểm
                    </button>
                  ) : outOfAttempts ? null : (
                    <button onClick={retry} className="inline-flex items-center gap-2 rounded-lg bg-vicem-600 px-5 py-2.5 font-semibold text-white hover:bg-vicem-700">
                      <RefreshCw className="h-4 w-4" /> Làm lại
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
