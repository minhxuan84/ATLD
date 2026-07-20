/**
 * FaceEnrollModal — mở camera, chụp khuôn mặt, lưu descriptor lên API.
 * Dùng cho cả worker (PATCH /hse/workers/:id/face) và visitor (/hse/visitors/:id/face).
 */
import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { enrollFace } from '../../lib/faceRecognition'

interface Props {
  id: number
  /** Loại đối tượng — quyết định endpoint PATCH */
  type: 'worker' | 'visitor'
  name: string
  onClose: () => void
  onSuccess: () => void
}

type Step = 'ready' | 'capturing' | 'success' | 'error'

export default function FaceEnrollModal({ id, type, name, onClose, onSuccess }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [step, setStep] = useState<Step>('ready')
  const [errMsg, setErrMsg] = useState('')
  /** true → lỗi camera (không thể retry), false → lỗi nhận diện (có thể retry) */
  const [cameraErr, setCameraErr] = useState(false)

  // Khởi động webcam khi mở modal.
  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } })
      .then((stream) => {
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
      })
      .catch(() => {
        setErrMsg('Không thể truy cập camera. Vui lòng kiểm tra quyền trình duyệt và thử lại.')
        setCameraErr(true)
        setStep('error')
      })

    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const capture = async () => {
    if (!videoRef.current || step !== 'ready') return
    setStep('capturing')
    setErrMsg('')
    try {
      const descriptor = await enrollFace(videoRef.current)
      const endpoint = type === 'worker'
        ? `/hse/workers/${id}/face`
        : `/hse/visitors/${id}/face`
      await api(endpoint, { method: 'PATCH', body: { descriptor } })
      // Tắt stream sau khi lưu thành công.
      streamRef.current?.getTracks().forEach((t) => t.stop())
      setStep('success')
      setTimeout(() => {
        onSuccess()
        onClose()
      }, 1400)
    } catch (e) {
      setErrMsg((e as Error).message)
      setCameraErr(false)
      setStep('error')
    }
  }

  /** Thử lại sau lỗi nhận diện (stream vẫn còn sống). */
  const retry = () => {
    setStep('ready')
    setErrMsg('')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-0.5 text-base font-semibold text-slate-800">Đăng ký khuôn mặt</h3>
        <p className="mb-4 text-xs text-slate-400">{name}</p>

        {/* --- Khung camera --- */}
        <div className="relative mb-4 overflow-hidden rounded-lg bg-slate-900 aspect-video">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
            style={{ transform: 'scaleX(-1)' }}
          />

          {/* Hình elip hướng dẫn đặt khuôn mặt */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-40 w-32 rounded-full border-2 border-dashed border-white/60" />
          </div>

          {step === 'capturing' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <span className="animate-spin text-3xl">⏳</span>
            </div>
          )}
          {step === 'success' && (
            <div className="absolute inset-0 flex items-center justify-center bg-green-500/80">
              <span className="text-5xl text-white">✓</span>
            </div>
          )}
        </div>

        {/* --- Hướng dẫn / lỗi --- */}
        {step === 'ready' && (
          <p className="mb-3 text-center text-xs text-slate-500">
            Nhìn thẳng vào camera, đảm bảo ánh sáng đủ, sau đó nhấn{' '}
            <strong>Chụp</strong>.
          </p>
        )}
        {step === 'success' && (
          <p className="mb-3 text-center text-xs text-green-600 font-medium">
            Đã lưu khuôn mặt thành công!
          </p>
        )}
        {errMsg && (
          <p className="mb-3 rounded bg-rose-50 px-3 py-2 text-xs text-rose-600">
            {errMsg}
          </p>
        )}

        {/* --- Nút hành động --- */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
          >
            Đóng
          </button>
          {step === 'error' && !cameraErr && (
            <button
              onClick={retry}
              className="rounded bg-slate-600 px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              Thử lại
            </button>
          )}
          {step === 'ready' && (
            <button
              onClick={capture}
              className="rounded bg-vicem-500 px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              📷 Chụp
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
