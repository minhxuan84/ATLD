/**
 * SmartCAModal — modal ký số SmartCA VNPT.
 * Flow: nhập tên → gọi init API → hiện QR code → polling status mỗi 3s → callback onSigned.
 */
import { useState, useEffect, useRef } from 'react'
import { api } from '../../lib/api'

interface Props {
  commitmentId: number
  onClose: () => void
  onSigned: () => void
}

type Step = 'form' | 'qr' | 'success' | 'error'

interface TxData {
  txId: string
  qrUrl: string
  deeplink: string
  expiresAt: string
}

export default function SmartCAModal({ commitmentId, onClose, onSigned }: Props) {
  const [step, setStep] = useState<Step>('form')
  const [signerName, setSignerName] = useState('')
  const [signerTitle, setSignerTitle] = useState('')
  const [tx, setTx] = useState<TxData | null>(null)
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('')
  const [countdown, setCountdown] = useState(600) // 10 phút
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Dọn dẹp timers khi unmount
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (countRef.current) clearInterval(countRef.current)
  }, [])

  const startPolling = (txId: string) => {
    // Đếm ngược
    countRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (pollRef.current) clearInterval(pollRef.current)
          if (countRef.current) clearInterval(countRef.current)
          setStep('error')
          setErrMsg('Phiên ký đã hết hạn. Vui lòng thử lại.')
          return 0
        }
        return c - 1
      })
    }, 1000)

    // Polling trạng thái mỗi 3s
    pollRef.current = setInterval(async () => {
      try {
        const r = await api<{ status: string }>(`/hse/commitments/${commitmentId}/smartca/status`)
        if (r.status === 'signed') {
          clearInterval(pollRef.current!)
          clearInterval(countRef.current!)
          setStep('success')
          setTimeout(() => { onSigned() }, 1500)
        } else if (r.status === 'rejected' || r.status === 'expired') {
          clearInterval(pollRef.current!)
          clearInterval(countRef.current!)
          setStep('error')
          setErrMsg(r.status === 'rejected' ? 'Người ký đã từ chối ký.' : 'Phiên ký đã hết hạn.')
        }
      } catch {
        // Bỏ qua lỗi network tạm thời, tiếp tục poll
      }
    }, 3000)
  }

  const initSign = async () => {
    if (!signerName.trim()) { setErrMsg('Nhập họ tên người ký.'); return }
    setBusy(true); setErrMsg('')
    try {
      const r = await api<TxData>(`/hse/commitments/${commitmentId}/smartca/init`, {
        method: 'POST',
        body: { signer_name: signerName.trim(), signer_title: signerTitle.trim() },
      })
      setTx(r)
      setStep('qr')
      startPolling(r.txId)
    } catch (e) {
      setErrMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const fmtCountdown = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Tiêu đề */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-800">
            {step === 'success' ? '✅ Đã ký thành công' : '🔐 Ký số SmartCA VNPT'}
          </h3>
          {step !== 'success' && (
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
          )}
        </div>

        {/* Bước 1: Nhập thông tin người ký */}
        {step === 'form' && (
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Họ và tên người ký *"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
              autoFocus
            />
            <input
              type="text"
              placeholder="Chức vụ"
              value={signerTitle}
              onChange={(e) => setSignerTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
            />
            {errMsg && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-600">{errMsg}</p>}
            <p className="text-xs text-slate-500">
              Sau khi tiếp tục, mở app <strong>SmartCA</strong> trên điện thoại và quét mã QR để ký.
            </p>
            <div className="flex gap-2 pt-1">
              <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Hủy
              </button>
              <button onClick={initSign} disabled={busy} className="flex-1 rounded-lg bg-vicem-500 px-4 py-2 text-sm font-medium text-white hover:bg-vicem-600 disabled:opacity-50">
                {busy ? 'Đang tạo…' : 'Tiếp tục →'}
              </button>
            </div>
          </div>
        )}

        {/* Bước 2: Hiển thị QR code */}
        {step === 'qr' && tx && (
          <div className="text-center">
            <p className="mb-3 text-sm text-slate-600">
              Mở app <strong>SmartCA VNPT</strong> trên điện thoại và quét mã QR bên dưới để ký.
            </p>
            <div className="mx-auto mb-3 flex h-52 w-52 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white">
              <img
                src={tx.qrUrl}
                alt="QR code SmartCA"
                className="h-full w-full object-contain"
                onError={(e) => {
                  // Nếu VNPT trả về URL ảnh không load được, hiển thị URL thay thế
                  ;(e.target as HTMLImageElement).style.display = 'none'
                  const parent = (e.target as HTMLImageElement).parentElement
                  if (parent) {
                    parent.innerHTML = `<p class="text-xs text-slate-500 p-2 break-all">${tx.qrUrl}</p>`
                  }
                }}
              />
            </div>
            <p className="mb-3 text-xs text-slate-400">
              Còn <span className="font-mono font-semibold text-slate-700">{fmtCountdown(countdown)}</span> để ký
            </p>
            <a
              href={tx.deeplink}
              className="mb-3 block rounded-lg bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
            >
              Mở SmartCA trực tiếp →
            </a>
            <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
              Đang chờ xác nhận từ SmartCA…
            </div>
          </div>
        )}

        {/* Bước 3: Thành công */}
        {step === 'success' && (
          <div className="text-center py-4">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">
              ✅
            </div>
            <p className="text-sm text-slate-600">Bản cam kết đã được ký số bằng SmartCA VNPT.</p>
          </div>
        )}

        {/* Lỗi */}
        {step === 'error' && (
          <div className="text-center">
            <p className="mb-4 rounded-lg bg-red-50 px-3 py-3 text-sm text-red-700">{errMsg}</p>
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                Đóng
              </button>
              <button onClick={() => { setStep('form'); setErrMsg('') }} className="flex-1 rounded-lg bg-vicem-500 px-4 py-2 text-sm font-medium text-white hover:bg-vicem-600">
                Thử lại
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
