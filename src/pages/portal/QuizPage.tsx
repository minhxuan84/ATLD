/**
 * Trang thi tại hiện trường qua link QR (Pha H6).
 *
 * KHÔNG có requireAuth: học viên quét QR không có tài khoản. Thay vào đó link có token,
 * max_uses và expires_at. Cả ba bước (khai thông tin → làm bài → xem kết quả) đều trên
 * một trang, không tải lại.
 *
 * Dùng portalApi (vô danh, KHÔNG gắn JWT) — xem portalApi.ts lý do.
 */
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ShieldCheck, AlertTriangle, Clock, CheckCircle2, XCircle, DownloadCloud, Upload, ArrowRight, Camera } from 'lucide-react'
import { fmtDateTime } from '../../lib/date'
import { portalApi } from './portalApi'

interface QuizField {
  field_key: string
  label: string
  type: 'text' | 'select' | 'image'
  options: string[]
  required: boolean
  purpose: string
}
interface QuizQuestion { id: number; text: string; options: string[] }
interface CourseInfo {
  id: string; title: string; description: string | null
  video_url: string | null; duration: string | null; summary: string | null
  pass_score: number; max_attempts: number
}
interface QuizData {
  course: CourseInfo
  fields: QuizField[]
  questions: QuizQuestion[]
  questionIds: number[]
  seed: string
}
interface PortalQuizInfo {
  purpose: string
  label: string | null
  expires_at: string
  remaining_uses: number | null
  quiz: QuizData | null
}
interface QuizResult {
  score: number
  passed: boolean
  passScore: number
  attempts_used: number | null
  max_attempts: number
  attempt_pdf: string | null
  certificate: {
    certId: string; traineeName: string; courseTitle: string
    score: number; expiresAt: string | null; pdf_url: string | null
  } | null
}

export default function QuizPage() {
  const { token = '' } = useParams()
  const [info, setInfo] = useState<PortalQuizInfo | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState<'info' | 'quiz' | 'result'>('info')
  const [traineeInfo, setTraineeInfo] = useState<Record<string, string>>({})
  const [photoBusy, setPhotoBusy] = useState<Record<string, boolean>>({})
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<QuizResult | null>(null)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    setLoading(true)
    portalApi<PortalQuizInfo>(`/${encodeURIComponent(token)}`)
      .then((d) => {
        if (d.purpose !== 'quiz') {
          setError('Đường dẫn này dùng cho việc khác. Kiểm tra lại link cán bộ đào tạo đã gửi.')
          return
        }
        if (!d.quiz) { setError('Khóa học chưa có câu hỏi. Liên hệ cán bộ đào tạo.'); return }
        setInfo(d)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Không mở được đường dẫn.'))
      .finally(() => setLoading(false))
  }, [token])

  const setField = (key: string, val: string) => setTraineeInfo((p) => ({ ...p, [key]: val }))

  const uploadPhoto = async (field: QuizField, file: File) => {
    setPhotoBusy((p) => ({ ...p, [field.field_key]: true }))
    try {
      const form = new FormData()
      form.append('file', file)
      const r = await portalApi<{ stored_name: string }>(
        `/${encodeURIComponent(token)}/quiz/photo`, { method: 'POST', form })
      setField(field.field_key, r.stored_name)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Tải ảnh thất bại.')
    } finally {
      setPhotoBusy((p) => ({ ...p, [field.field_key]: false }))
    }
  }

  const goQuiz = () => {
    const quiz = info?.quiz
    if (!quiz) return
    // Kiểm trường bắt buộc ở client cho phản hồi nhanh; server kiểm lại.
    for (const f of quiz.fields) {
      if (f.required && !traineeInfo[f.field_key]) {
        alert(`Vui lòng ${f.type === 'image' ? 'chụp hoặc tải lên' : 'nhập'} "${f.label}".`)
        return
      }
    }
    setStep('quiz')
  }

  const submit = async () => {
    if (!info?.quiz) return
    setSubmitting(true)
    try {
      const r = await portalApi<QuizResult>(`/${encodeURIComponent(token)}/quiz`, {
        method: 'POST',
        body: {
          answers,
          traineeInfo,
          seed: info.quiz.seed,
          questionIds: info.quiz.questionIds,
        },
      })
      setResult(r)
      setStep('result')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Nộp bài thất bại. Vui lòng thử lại.')
    } finally {
      setSubmitting(false)
    }
  }

  const quiz = info?.quiz
  const answered = Object.keys(answers).length
  const total = quiz?.questions.length ?? 0

  // ─── Loading / error ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4" />
          <p className="text-gray-600">Đang tải...</p>
        </div>
      </div>
    )
  }
  if (error || !info || !quiz) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Không thể mở bài thi</h1>
          <p className="text-gray-600">{error || 'Đường dẫn không hợp lệ.'}</p>
        </div>
      </div>
    )
  }

  // ─── Step: Thông tin học viên ─────────────────────────────────────────────
  if (step === 'info') {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-xl mx-auto">
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            {/* Header */}
            <div className="bg-green-600 px-6 py-5 text-white">
              <div className="flex items-center gap-3 mb-1">
                <ShieldCheck className="h-6 w-6 flex-shrink-0" />
                <h1 className="text-lg font-bold leading-tight">{quiz.course.title}</h1>
              </div>
              {info.label && <p className="text-green-100 text-sm ml-9">{info.label}</p>}
              <div className="flex items-center gap-1 text-green-100 text-xs mt-2 ml-9">
                <Clock className="h-3.5 w-3.5" />
                <span>Hết hạn {fmtDateTime(info.expires_at)}</span>
                {info.remaining_uses !== null && (
                  <span className="ml-2">· Còn {info.remaining_uses} lượt</span>
                )}
              </div>
            </div>

            {/* Thông tin bài thi */}
            <div className="px-6 py-4 bg-green-50 border-b border-green-100 text-sm text-green-800">
              <span className="font-medium">{total} câu hỏi</span>
              {' · '}
              <span>Đạt ≥ {quiz.course.pass_score}%</span>
              {quiz.course.max_attempts > 1 && (
                <span> · Tối đa {quiz.course.max_attempts} lần thi</span>
              )}
            </div>

            {/* Form thông tin */}
            <div className="px-6 py-5 space-y-5">
              <p className="text-sm text-gray-600 font-medium">
                Điền đầy đủ thông tin trước khi làm bài:
              </p>
              {quiz.fields.map((f) => (
                <div key={f.field_key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {f.label}
                    {f.required && <span className="text-red-500 ml-0.5">*</span>}
                  </label>

                  {f.type === 'select' ? (
                    <select
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      value={traineeInfo[f.field_key] ?? ''}
                      onChange={(e) => setField(f.field_key, e.target.value)}
                    >
                      <option value="">-- Chọn --</option>
                      {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.type === 'image' ? (
                    <div>
                      {/* Input chụp ảnh trực tiếp từ camera trước */}
                      <input
                        ref={(el) => { fileRefs.current[`${f.field_key}_cam`] = el }}
                        type="file" accept="image/*" capture="user" className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          setPreviews((p) => ({ ...p, [f.field_key]: URL.createObjectURL(file) }))
                          uploadPhoto(f, file)
                          e.target.value = ''
                        }}
                      />
                      {/* Input chọn từ thư viện / bộ nhớ máy */}
                      <input
                        ref={(el) => { fileRefs.current[f.field_key] = el }}
                        type="file" accept="image/*" className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          setPreviews((p) => ({ ...p, [f.field_key]: URL.createObjectURL(file) }))
                          uploadPhoto(f, file)
                          e.target.value = ''
                        }}
                      />

                      {/* Thumbnail xem trước */}
                      {previews[f.field_key] && (
                        <div className="mb-3 relative inline-block">
                          <img
                            src={previews[f.field_key]}
                            alt="Hình đại diện"
                            className="h-28 w-24 object-cover rounded-lg border border-gray-200 shadow-sm"
                          />
                          {photoBusy[f.field_key] && (
                            <div className="absolute inset-0 bg-white/60 flex items-center justify-center rounded-lg">
                              <div className="animate-spin h-5 w-5 border-2 border-green-600 border-t-transparent rounded-full" />
                            </div>
                          )}
                          {traineeInfo[f.field_key] && !photoBusy[f.field_key] && (
                            <div className="absolute -top-1.5 -right-1.5 bg-green-500 rounded-full p-0.5">
                              <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                            </div>
                          )}
                        </div>
                      )}

                      {/* Nút hành động */}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => fileRefs.current[`${f.field_key}_cam`]?.click()}
                          disabled={photoBusy[f.field_key]}
                          className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-green-700 active:bg-green-800 transition-colors disabled:opacity-50"
                        >
                          <Camera className="h-4 w-4 flex-shrink-0" />
                          Chụp ảnh
                        </button>
                        <button
                          type="button"
                          onClick={() => fileRefs.current[f.field_key]?.click()}
                          disabled={photoBusy[f.field_key]}
                          className="flex-1 flex items-center justify-center gap-2 border border-gray-300 text-gray-700 bg-white rounded-lg px-3 py-2.5 text-sm font-medium hover:border-green-500 hover:text-green-700 active:bg-gray-50 transition-colors disabled:opacity-50"
                        >
                          <Upload className="h-4 w-4 flex-shrink-0" />
                          Tải từ máy
                        </button>
                      </div>
                      {photoBusy[f.field_key] && (
                        <p className="text-xs text-gray-500 mt-2 text-center">Đang tải ảnh lên...</p>
                      )}
                      {!previews[f.field_key] && !photoBusy[f.field_key] && (
                        <p className="text-xs text-gray-400 mt-1.5 text-center">Chụp hoặc chọn ảnh chân dung rõ mặt</p>
                      )}
                    </div>
                  ) : (
                    <input
                      type="text"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      placeholder={f.label}
                      value={traineeInfo[f.field_key] ?? ''}
                      onChange={(e) => setField(f.field_key, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="px-6 pb-6">
              <button
                type="button"
                onClick={goQuiz}
                className="w-full bg-green-600 text-white rounded-lg py-3 font-semibold text-sm hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
              >
                Bắt đầu làm bài <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─── Step: Câu hỏi ────────────────────────────────────────────────────────
  if (step === 'quiz') {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-2xl mx-auto">
          {/* Tiêu đề */}
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden mb-4">
            <div className="bg-green-600 px-6 py-4 text-white">
              <h1 className="font-bold text-base">{quiz.course.title}</h1>
              <p className="text-green-100 text-xs mt-0.5">
                {answered}/{total} câu đã trả lời
              </p>
            </div>
            {/* Progress bar */}
            <div className="h-1.5 bg-gray-100">
              <div
                className="h-full bg-green-500 transition-all"
                style={{ width: `${total ? (answered / total) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* Câu hỏi */}
          <div className="space-y-4">
            {quiz.questions.map((q, qi) => (
              <div key={q.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <p className="font-medium text-gray-900 mb-3 leading-snug">
                  <span className="text-green-600 font-bold mr-1.5">{qi + 1}.</span>
                  {q.text}
                </p>
                <div className="space-y-2">
                  {q.options.map((opt, oi) => {
                    const selected = answers[String(q.id)] === oi
                    return (
                      <button
                        key={oi}
                        type="button"
                        onClick={() => setAnswers((p) => ({ ...p, [String(q.id)]: oi }))}
                        className={[
                          'w-full text-left px-4 py-2.5 rounded-lg border text-sm transition-colors',
                          selected
                            ? 'border-green-500 bg-green-50 text-green-800 font-medium'
                            : 'border-gray-200 hover:border-green-300 hover:bg-green-50/50 text-gray-700',
                        ].join(' ')}
                      >
                        <span className="mr-2 text-gray-400">{String.fromCharCode(65 + oi)}.</span>
                        {opt}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Nộp bài */}
          <div className="mt-6 bg-white rounded-2xl shadow-lg p-5">
            {answered < total && (
              <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-4 py-2.5 mb-4 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                Còn {total - answered} câu chưa trả lời. Bạn vẫn có thể nộp bài.
              </p>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="w-full bg-green-600 text-white rounded-lg py-3 font-semibold text-sm hover:bg-green-700 transition-colors disabled:opacity-60"
            >
              {submitting ? 'Đang chấm bài...' : 'Nộp bài'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Step: Kết quả ────────────────────────────────────────────────────────
  const passed = result?.passed ?? false
  const score = result?.score ?? 0
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-xl mx-auto">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* Kết quả chính */}
          <div className={`px-6 py-8 text-center ${passed ? 'bg-green-600' : 'bg-red-600'}`}>
            {passed
              ? <CheckCircle2 className="h-16 w-16 text-white mx-auto mb-3" />
              : <XCircle className="h-16 w-16 text-white mx-auto mb-3" />}
            <p className="text-white text-3xl font-bold mb-1">{score}%</p>
            <p className="text-white/90 font-semibold text-lg">
              {passed ? 'ĐẠT' : 'CHƯA ĐẠT'}
            </p>
            <p className="text-white/75 text-sm mt-1">
              Điểm đạt ≥ {result?.passScore}%
              {result?.attempts_used != null && result.max_attempts > 1 && (
                <span className="ml-2">· Đã dùng {result.attempts_used}/{result.max_attempts} lần</span>
              )}
            </p>
          </div>

          {/* Tải xuống */}
          <div className="px-6 py-5 space-y-3">
            {result?.attempt_pdf && (
              <a
                href={result.attempt_pdf}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 border border-gray-200 rounded-xl px-4 py-3 hover:bg-gray-50 transition-colors"
              >
                <DownloadCloud className="h-5 w-5 text-gray-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Phiếu bài làm</p>
                  <p className="text-xs text-gray-500">Chi tiết từng câu hỏi và đáp án</p>
                </div>
              </a>
            )}
            {passed && result?.certificate?.pdf_url && (
              <a
                href={result.certificate.pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 border border-green-200 bg-green-50 rounded-xl px-4 py-3 hover:bg-green-100 transition-colors"
              >
                <ShieldCheck className="h-5 w-5 text-green-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-900">Giấy chứng nhận hoàn thành</p>
                  <p className="text-xs text-green-700">
                    {result.certificate.traineeName}
                    {result.certificate.expiresAt && (
                      <> · Hiệu lực đến {fmtDateTime(result.certificate.expiresAt)}</>
                    )}
                  </p>
                </div>
              </a>
            )}
            {!passed && (
              <p className="text-sm text-gray-500 text-center py-2">
                Chưa đạt — không có giấy chứng nhận.
                {result?.attempts_used != null
                  && result.max_attempts > 1
                  && result.attempts_used < result.max_attempts
                  && ' Bạn có thể thi lại bằng cùng đường dẫn QR.'}
              </p>
            )}
          </div>

          <div className="px-6 pb-6 text-center text-xs text-gray-400">
            Ghi lại kết quả hoặc tải xuống trước khi rời trang.
          </div>
        </div>
      </div>
    </div>
  )
}
