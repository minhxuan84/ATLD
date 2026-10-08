import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../lib/api'
import { toEmbedUrl } from '../lib/embedUrl'
import { Card } from '../components/ui'
import { PlayCircle, FileText, ClipboardCheck, Check, ArrowRight, ArrowLeft, RefreshCw } from 'lucide-react'
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
  type: 'text' | 'select'
  options: string[]
  required: boolean
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
  const [result, setResult] = useState<{ score: number; passed: boolean; passScore: number; certificate: CertData | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [quizFields, setQuizFields] = useState<QuizField[]>([])
  const [traineeInfo, setTraineeInfo] = useState<Record<string, string>>({})
  const [infoConfirmed, setInfoConfirmed] = useState(false)

  useEffect(() => {
    api<{ course: Course; questions: Question[]; progress: ProgressRow | null }>(`/courses/${id}`)
      .then((d) => {
        setCourse(d.course)
        setQuestions(d.questions)
        setStep(d.progress?.step ?? 1)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
    api<{ fields: QuizField[] }>('/courses/meta/quiz-fields')
      .then((d) => setQuizFields(d.fields))
      .catch(() => {})
  }, [id])

  const goStep = (n: number) => {
    setStep(n)
    api(`/courses/${id}/step`, { method: 'POST', body: { step: n } }).catch(() => {})
  }

  const submitQuiz = async () => {
    setError('')
    try {
      const r = await api<typeof result>(`/courses/${id}/submit`, { method: 'POST', body: { answers, traineeInfo } })
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nộp bài thất bại.')
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
              <Certificate data={result!.certificate!} />
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
                        {f.label} {f.required && <span className="text-hatien-500">*</span>}
                      </label>
                      {f.type === 'select' ? (
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
                      <span key={f.field_key}><span className="text-vicem-500">{f.label}:</span> <b>{traineeInfo[f.field_key]}</b></span>
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

                {result && !result.passed && (
                  <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    Kết quả: <b>{result.score}%</b> — Chưa đạt (yêu cầu ≥ {result.passScore}%). Vui lòng ôn lại và làm lại.
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
                      disabled={!allAnswered}
                      className={`rounded-lg px-5 py-2.5 font-semibold text-white ${allAnswered ? 'bg-hatien-500 hover:bg-hatien-600' : 'cursor-not-allowed bg-slate-300'}`}
                    >
                      Nộp bài &amp; chấm điểm
                    </button>
                  ) : (
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
