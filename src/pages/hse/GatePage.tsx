// Cổng kiểm soát — mobile-first, tra cứu NLĐ, ghi log vào/ra + quét QR CCCD.
// Dùng độc lập (/cong-kiem-soat) hoặc nhúng vào HsePage qua prop embedded.
import { useState, useRef, useEffect, useCallback } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { api } from '../../lib/api'
import { fmtDate } from '../../lib/date'
import { loadModels, detectFaceWithBox, matchFace } from '../../lib/faceRecognition'
import type { FaceCandidate } from '../../lib/faceRecognition'

/** FaceCandidate mở rộng: khách/NCC có thêm qr_code để gọi lookupVisitor trực tiếp */
type GateFaceCandidate = FaceCandidate & { qr_code?: string }

// Backend /hse/gate/lookup trả về { results: [...] } với shape này:
interface GateWorker {
  id: number
  full_name: string
  id_number: string | null
  access_status: string
  contractor_name: string
  eligible: boolean
  reasons: string[]
  suspended: boolean
  presence: string          // 'in' = đang trong công trường, 'out' = đã ra/chưa vào
  last_in_at: string | null
  last_out_at: string | null
}

// Khách/NCC tra qua QR (backend /hse/visitors/lookup)
interface GateVisitor {
  id: number
  full_name: string
  kind: string
  org_name: string | null
  id_number: string | null
  access_status: string
  presence: string
  valid_from: string | null
  valid_to: string | null
  last_in_at: string | null
  last_out_at: string | null
  qr_code: string
  eligible: boolean
  reasons: string[]
}

// Một dòng lịch sử vào/ra hợp nhất (NLĐ + khách)
interface GateHistoryRow {
  kind: 'worker' | 'visitor'
  id: number
  name: string | null
  id_number: string | null
  org: string | null
  direction: string
  result: string
  block_reason: string | null
  logged_at: string
  guard_name: string | null
}

const VISITOR_KIND_LABEL: Record<string, string> = {
  guest: 'Khách tham quan', supplier: 'Nhà cung cấp',
  contractor_visitor: 'Thăm NLĐ', authority: 'Cơ quan kiểm tra',
}

// Định dạng thời gian ngắn gọn cho mobile (dd/MM HH:mm)
function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

interface Props { embedded?: boolean }

// Tách số CCCD (12 số) từ chuỗi QR thẻ CCCD gắn chip VN.
// Định dạng: "SoCCCD|SoCMND|HoTen|NgaySinh|GioiTinh|DiaChi|NgayCap"
function parseCccdQr(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  const parts = text.split('|')
  // Ưu tiên trường đầu tiên (số CCCD 12 số)
  const first = (parts[0] ?? '').replace(/\D/g, '')
  if (first.length >= 9) return first
  // Fallback: tìm cụm 9–12 chữ số bất kỳ trong chuỗi
  const m = text.match(/\b\d{9,12}\b/)
  return m ? m[0] : null
}

export default function GatePage({ embedded = false }: Props) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<GateWorker[]>([])
  const [selected, setSelected] = useState<GateWorker | null>(null)
  const [visitor, setVisitor] = useState<GateVisitor | null>(null)
  const [searching, setSearching] = useState(false)
  const [logging, setLogging] = useState(false)
  const [err, setErr] = useState('')
  const [lastLog, setLastLog] = useState<{ name: string; dir: string; ok: boolean; time: string } | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [scanErr, setScanErr] = useState('')
  const [history, setHistory] = useState<GateHistoryRow[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)

  // ── Chế độ nhận diện khuôn mặt ──────────────────────────────────
  const [faceMode, setFaceMode] = useState(false)
  const [faceStatus, setFaceStatus] = useState<'loading' | 'scanning'>('loading')
  const faceVideoRef = useRef<HTMLVideoElement>(null)
  const faceStreamRef = useRef<MediaStream | null>(null)
  const faceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadHistory = useCallback(async () => {
    try {
      const d = await api<{ history: GateHistoryRow[] }>('/hse/gate/history?limit=50')
      setHistory(Array.isArray(d?.history) ? d.history : [])
    } catch { /* im lặng — lịch sử không chặn thao tác cổng */ }
  }, [])

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { void loadHistory() }, [loadHistory])

  const search = useCallback(async (val: string) => {
    if (val.trim().length < 2) { setResults([]); return }
    setSearching(true); setErr('')
    try {
      const d = await api<{ results: GateWorker[] }>(`/hse/gate/lookup?q=${encodeURIComponent(val)}`)
      setResults(Array.isArray(d?.results) ? d.results : [])
    } catch (e) {
      setResults([])
      setErr(e instanceof Error ? e.message : 'Lỗi tra cứu, thử lại.')
    } finally { setSearching(false) }
  }, [])

  const handleInput = (val: string) => {
    setQ(val); setSelected(null); setVisitor(null)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => search(val), 300)
  }

  const logEntry = async (direction: 'in' | 'out') => {
    if (!selected) return
    setLogging(true); setErr('')
    try {
      const r = await api<{ allowed: boolean; reason: string | null; presence: string; logged_at: string | null }>('/hse/gate/log',
        { method: 'POST', body: { worker_id: selected.id, direction } })
      const label = direction === 'in' ? 'vào' : 'ra'
      setLastLog({ name: selected.full_name, dir: label, ok: !!r?.allowed, time: fmtTime(r?.logged_at ?? null) })
      setQ(''); setResults([]); setSelected(null)
      inputRef.current?.focus()
      void loadHistory()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Không ghi được log, thử lại.')
    } finally { setLogging(false) }
  }

  // Ghi log vào/ra cho khách/NCC (dùng QR khách đã quét được).
  const logVisitor = async (direction: 'in' | 'out') => {
    if (!visitor) return
    setLogging(true); setErr('')
    try {
      const r = await api<{ result: string; reason?: string; visitor?: { full_name: string } }>('/hse/visitors/scan',
        { method: 'POST', body: { qr_code: visitor.qr_code, direction } })
      const label = direction === 'in' ? 'vào' : 'ra'
      setLastLog({ name: visitor.full_name, dir: label, ok: r?.result === 'allowed', time: fmtTime(new Date().toISOString()) })
      setVisitor(null); setQ('')
      inputRef.current?.focus()
      void loadHistory()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Không ghi được log khách, thử lại.')
    } finally { setLogging(false) }
  }

  // ── Quét QR CCCD ──────────────────────────────────────────────
  const stopScanner = useCallback(async () => {
    const s = scannerRef.current
    scannerRef.current = null
    if (s) {
      try { await s.stop() } catch { /* đã dừng */ }
      try { await s.clear() } catch { /* noop */ }
    }
  }, [])

  // Tra cứu khách theo QR khách (ATLD|VIS|…) — hiện thẻ, chưa ghi log.
  const lookupVisitor = useCallback(async (qr: string) => {
    setSearching(true); setErr('')
    try {
      const d = await api<{ visitor: (GateVisitor & { qr_code: string }) | null }>(`/hse/visitors/lookup?qr=${encodeURIComponent(qr)}`)
      if (d?.visitor) { setVisitor({ ...d.visitor, qr_code: qr }); setSelected(null); setResults([]) }
      else setErr('Không tìm thấy khách với mã QR này.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Lỗi tra cứu khách, thử lại.')
    } finally { setSearching(false) }
  }, [])

  const onScan = useCallback(async (decoded: string) => {
    await stopScanner()
    setScanOpen(false)
    const raw = decoded.trim()
    // QR khách/NCC do hệ thống phát hành có tiền tố ATLD|VIS|…
    if (/^ATLD\|VIS\|/i.test(raw)) {
      setSelected(null); setQ('')
      await lookupVisitor(raw)
      return
    }
    // Ngược lại coi là QR thẻ CCCD của NLĐ
    const cccd = parseCccdQr(raw)
    if (!cccd) { setScanErr(''); setErr('Không đọc được mã QR (CCCD hoặc QR khách).'); return }
    setSelected(null); setVisitor(null)
    setQ(cccd)
    await search(cccd)
  }, [search, stopScanner, lookupVisitor])

  // Khởi động camera khi mở modal quét
  useEffect(() => {
    if (!scanOpen) return
    let cancelled = false
    setScanErr('')
    const el = document.getElementById('qr-reader')
    if (!el) return
    const scanner = new Html5Qrcode('qr-reader', {
      verbose: false,
      // Chỉ nhận diện QR (bỏ các định dạng khác) → nhanh hơn nhiều.
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      // Dùng BarcodeDetector gốc của trình duyệt nếu có — nhanh hơn hẳn thư viện JS.
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    })
    scannerRef.current = scanner
    scanner
      .start(
        // ideal: không bắt buộc back-camera → fallback về front-cam nếu cần
        { facingMode: { ideal: 'environment' } },
        {
          fps: 30,
          // qrbox động = 80% cạnh nhỏ nhất → luôn fit màn hình, không bị crop
          qrbox: (w, h) => {
            const side = Math.floor(Math.min(w, h) * 0.8)
            return { width: side, height: side }
          },
          // viewport vuông hơn → không phải resize nhiều → giải mã nhanh hơn
          aspectRatio: 1.0,
          // Ưu tiên độ phân giải cao → camera cho ảnh rõ hơn, QR nhỏ cũng nhận diện được
          videoConstraints: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        (decoded) => { if (!cancelled) void onScan(decoded) },
        () => { /* bỏ qua khung không đọc được */ },
      )
      .catch((e) => {
        if (!cancelled) setScanErr(
          e instanceof Error && /permission|denied|NotAllowed/i.test(e.message)
            ? 'Không truy cập được camera. Kiểm tra quyền camera của trình duyệt.'
            : 'Không mở được camera trên thiết bị này.')
      })
    return () => { cancelled = true; void stopScanner() }
  }, [scanOpen, onScan, stopScanner])

  // ── Vòng đời chế độ nhận diện khuôn mặt ────────────────────────
  useEffect(() => {
    if (!faceMode) {
      faceIntervalRef.current && clearInterval(faceIntervalRef.current)
      faceIntervalRef.current = null
      faceStreamRef.current?.getTracks().forEach((t) => t.stop())
      faceStreamRef.current = null
      return
    }
    let cancelled = false
    setFaceStatus('loading')
    ;(async () => {
      try {
        const [descData] = await Promise.all([
          api<{
            workers: GateFaceCandidate[]
            visitors: GateFaceCandidate[]
          }>('/hse/gate/descriptors'),
          loadModels(),
        ])
        if (cancelled) return
        const candidates: GateFaceCandidate[] = [...descData.workers, ...descData.visitors]

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        faceStreamRef.current = stream
        if (faceVideoRef.current) faceVideoRef.current.srcObject = stream
        setFaceStatus('scanning')

        // Nhận diện mỗi 800 ms — dừng ngay sau khi khớp thành công
        faceIntervalRef.current = setInterval(async () => {
          if (!faceVideoRef.current || cancelled) return
          const detection = await detectFaceWithBox(faceVideoRef.current).catch(() => null)
          if (!detection || cancelled) return
          const match = matchFace(detection.descriptor, candidates)
          if (!match) return

          clearInterval(faceIntervalRef.current!)
          faceIntervalRef.current = null
          if (!cancelled) {
            setFaceMode(false)
            if (match.type === 'worker') {
              setQ(match.name)
              await search(match.name)
            } else {
              const vc = candidates.find((c) => c.id === match.id && c.type === 'visitor')
              if (vc?.qr_code) await lookupVisitor(vc.qr_code)
            }
          }
        }, 800)
      } catch (e) {
        if (!cancelled) {
          setFaceMode(false)
          setErr(e instanceof Error ? e.message : 'Không khởi động được nhận diện khuôn mặt.')
        }
      }
    })()

    return () => {
      cancelled = true
      faceIntervalRef.current && clearInterval(faceIntervalRef.current)
      faceIntervalRef.current = null
      faceStreamRef.current?.getTracks().forEach((t) => t.stop())
      faceStreamRef.current = null
    }
  }, [faceMode, search, lookupVisitor])

  const allowed = !!selected && selected.eligible && selected.access_status !== 'suspended'

  const wrap = (children: React.ReactNode) =>
    embedded
      ? <div className="space-y-4">{children}</div>
      : (
        <div className="flex min-h-screen items-start justify-center bg-slate-100 p-4 pt-10">
          <div className="w-full max-w-sm space-y-4">{children}</div>
        </div>
      )

  return wrap(
    <>
      {/* Header */}
      <div className="text-center">
        {!embedded && <p className="mb-1 text-2xl font-bold text-slate-800">🏗 Cổng kiểm soát</p>}
        {!embedded && <p className="text-sm text-slate-400">Tra cứu NLĐ, khách & NCC trước khi vào công trường</p>}
      </div>

      {/* Thanh tìm kiếm + nút quét QR */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="Nhập tên hoặc CCCD/CMND…"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base shadow-sm focus:border-vicem-500 focus:outline-none focus:ring-2 focus:ring-vicem-500/20"
          />
          {searching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Đang tìm…</span>
          )}
        </div>
        <button
          onClick={() => { setScanErr(''); setScanOpen(true) }}
          className="shrink-0 rounded-xl bg-vicem-500 px-4 py-3 text-base font-bold text-white shadow active:bg-vicem-600"
          title="Quét mã QR trên thẻ CCCD"
        >
          📷 QR
        </button>
        <button
          onClick={() => setFaceMode(true)}
          disabled={faceMode}
          className="shrink-0 rounded-xl bg-indigo-600 px-4 py-3 text-base font-bold text-white shadow disabled:opacity-50 active:bg-indigo-700"
          title="Nhận diện khuôn mặt"
        >
          🤳
        </button>
      </div>

      {/* Panel nhận diện khuôn mặt — hiện khi faceMode = true */}
      {faceMode && (
        <div className="relative overflow-hidden rounded-2xl bg-slate-900 shadow-xl">
          <video
            ref={faceVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full"
          />
          {/* Hình elip định vị khuôn mặt */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-48 w-36 rounded-full border-2 border-dashed border-white/50" />
          </div>
          {faceStatus === 'loading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/80 text-white">
              <span className="animate-spin text-3xl">⚙</span>
              <span className="text-sm">Đang tải model nhận diện…</span>
            </div>
          )}
          {faceStatus === 'scanning' && (
            <div className="absolute bottom-3 left-0 right-0 flex justify-center">
              <span className="rounded-full bg-black/60 px-3 py-1 text-xs text-white">Đang nhận diện khuôn mặt…</span>
            </div>
          )}
          <button
            onClick={() => setFaceMode(false)}
            className="absolute right-2 top-2 rounded-lg bg-black/50 px-2.5 py-1 text-sm font-bold text-white hover:bg-black/70"
          >✕</button>
        </div>
      )}

      {/* Lỗi chung */}
      {err && (
        <div className="rounded-xl bg-rose-100 px-4 py-3 text-sm text-rose-700">
          {err}
          <button onClick={() => setErr('')} className="ml-2 text-xs opacity-60 hover:opacity-100">×</button>
        </div>
      )}

      {/* Danh sách kết quả */}
      {results.length > 0 && !selected && (
        <ul className="rounded-xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
          {results.map((w) => {
            const ok = w.eligible && w.access_status !== 'suspended'
            return (
              <li key={w.id}>
                <button
                  onClick={() => { setSelected(w); setResults([]) }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${ok ? 'bg-green-500' : 'bg-rose-500'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-800">{w.full_name}</span>
                    <span className="block truncate text-xs text-slate-400">{w.id_number ?? '—'} · {w.contractor_name}</span>
                  </span>
                  {w.presence === 'in' && (
                    <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">Đã vào</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* Không tìm thấy */}
      {!searching && !selected && q.trim().length >= 2 && results.length === 0 && !err && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-6 text-center text-sm text-slate-400">
          Không tìm thấy NLĐ khớp với “{q}”.
        </div>
      )}

      {/* Card kết quả chính */}
      {selected && (
        <div className={`rounded-2xl border-2 p-5 shadow ${allowed ? 'border-green-400 bg-green-50' : 'border-rose-400 bg-rose-50'}`}>
          <div className="mb-4 text-center">
            <p className={`text-5xl font-black tracking-wide ${allowed ? 'text-green-600' : 'text-rose-600'}`}>
              {allowed ? '✓ ĐƯỢC VÀO' : '✗ KHÔNG VÀO'}
            </p>
            {selected.access_status === 'suspended' && (
              <p className="mt-1 text-sm font-semibold text-orange-600">⚠ Đang bị đình chỉ</p>
            )}
          </div>

          <div className="mb-4 rounded-xl bg-white/70 px-4 py-3">
            <p className="text-lg font-semibold text-slate-800">{selected.full_name}</p>
            <p className="text-sm text-slate-500">{selected.id_number ?? '—'}</p>
            <p className="text-sm text-slate-600">{selected.contractor_name}</p>
            <div className="mt-2 flex items-center gap-2 border-t border-slate-200 pt-2">
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${selected.presence === 'in' ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${selected.presence === 'in' ? 'bg-green-500' : 'bg-slate-400'}`} />
                {selected.presence === 'in' ? 'Đang trong công trường' : 'Đã ra / chưa vào'}
              </span>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-2 text-xs text-slate-500">
              <span>Vào gần nhất: <strong className="text-slate-700">{fmtTime(selected.last_in_at)}</strong></span>
              <span>Ra gần nhất: <strong className="text-slate-700">{fmtTime(selected.last_out_at)}</strong></span>
            </div>
          </div>

          {!allowed && Array.isArray(selected.reasons) && selected.reasons.length > 0 && (
            <div className="mb-4 rounded-xl bg-rose-100 px-4 py-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-rose-700">Hồ sơ còn thiếu:</p>
              <ul className="space-y-1">
                {selected.reasons.map((m, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-sm text-rose-700">
                    <span className="mt-0.5 shrink-0">•</span> {m}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => logEntry('in')}
              disabled={logging || !allowed}
              className="flex-1 rounded-xl bg-green-500 py-3 text-base font-bold text-white shadow disabled:opacity-40 active:bg-green-600"
            >
              {logging ? '…' : '↵ Ghi vào'}
            </button>
            <button
              onClick={() => logEntry('out')}
              disabled={logging}
              className="flex-1 rounded-xl bg-slate-700 py-3 text-base font-bold text-white shadow disabled:opacity-40 active:bg-slate-800"
            >
              {logging ? '…' : '↳ Ghi ra'}
            </button>
          </div>

          <button onClick={() => { setSelected(null); setQ(''); inputRef.current?.focus() }}
            className="mt-3 w-full rounded-xl py-2 text-sm text-slate-500 hover:bg-white/60">
            ← Tìm người khác
          </button>
        </div>
      )}

      {/* Card kết quả — Khách / NCC */}
      {visitor && (
        <div className={`rounded-2xl border-2 p-5 shadow ${visitor.eligible ? 'border-green-400 bg-green-50' : 'border-rose-400 bg-rose-50'}`}>
          <div className="mb-4 text-center">
            <p className={`text-5xl font-black tracking-wide ${visitor.eligible ? 'text-green-600' : 'text-rose-600'}`}>
              {visitor.eligible ? '✓ ĐƯỢC VÀO' : '✗ KHÔNG VÀO'}
            </p>
            <p className="mt-1 text-sm font-semibold text-indigo-600">{VISITOR_KIND_LABEL[visitor.kind] ?? 'Khách'}</p>
          </div>

          <div className="mb-4 rounded-xl bg-white/70 px-4 py-3">
            <p className="text-lg font-semibold text-slate-800">{visitor.full_name}</p>
            <p className="text-sm text-slate-500">{visitor.id_number ?? '—'}</p>
            {visitor.org_name && <p className="text-sm text-slate-600">{visitor.org_name}</p>}
            <div className="mt-2 flex items-center gap-2 border-t border-slate-200 pt-2">
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${visitor.presence === 'in' ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${visitor.presence === 'in' ? 'bg-green-500' : 'bg-slate-400'}`} />
                {visitor.presence === 'in' ? 'Đang trong công trường' : 'Đã ra / chưa vào'}
              </span>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-2 text-xs text-slate-500">
              <span>Hiệu lực: <strong className="text-slate-700">{fmtDate(visitor.valid_from)} → {fmtDate(visitor.valid_to)}</strong></span>
              <span>Vào gần nhất: <strong className="text-slate-700">{fmtTime(visitor.last_in_at)}</strong></span>
            </div>
          </div>

          {!visitor.eligible && visitor.reasons.length > 0 && (
            <div className="mb-4 rounded-xl bg-rose-100 px-4 py-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-rose-700">Lý do chặn:</p>
              <ul className="space-y-1">
                {visitor.reasons.map((m, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-sm text-rose-700"><span className="mt-0.5 shrink-0">•</span> {m}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => logVisitor('in')} disabled={logging || !visitor.eligible}
              className="flex-1 rounded-xl bg-green-500 py-3 text-base font-bold text-white shadow disabled:opacity-40 active:bg-green-600">
              {logging ? '…' : '↵ Ghi vào'}
            </button>
            <button onClick={() => logVisitor('out')} disabled={logging}
              className="flex-1 rounded-xl bg-slate-700 py-3 text-base font-bold text-white shadow disabled:opacity-40 active:bg-slate-800">
              {logging ? '…' : '↳ Ghi ra'}
            </button>
          </div>
          <button onClick={() => { setVisitor(null); setQ(''); inputRef.current?.focus() }}
            className="mt-3 w-full rounded-xl py-2 text-sm text-slate-500 hover:bg-white/60">← Quét mã khác</button>
        </div>
      )}

      {/* Thông báo log thành công */}
      {lastLog && (
        <div className={`rounded-xl p-4 text-center text-sm font-medium ${lastLog.ok ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'}`}>
          ✓ Đã ghi log <strong>{lastLog.dir}</strong> — <strong>{lastLog.name}</strong>
          <span className="ml-1 opacity-70">lúc {lastLog.time}</span>
          <button onClick={() => setLastLog(null)} className="ml-2 text-xs opacity-60 hover:opacity-100">×</button>
        </div>
      )}

      {/* Hướng dẫn khi chưa có gì */}
      {!selected && !visitor && results.length === 0 && q.trim().length < 2 && !err && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-6 text-center text-sm text-slate-400">
          <p className="mb-2 text-3xl">🔍</p>
          <p>Nhập ít nhất 2 ký tự hoặc quét QR để tra cứu</p>
          <p className="mt-1 text-xs">CCCD/CMND (NLĐ) hoặc QR khách/NCC</p>
        </div>
      )}

      {/* Lịch sử vào/ra hợp nhất — bảo vệ theo dõi */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <p className="text-sm font-semibold text-slate-700">📋 Lịch sử vào/ra gần đây</p>
          <button onClick={() => void loadHistory()} className="rounded-lg px-2 py-1 text-xs text-vicem-500 hover:bg-slate-100">↻ Làm mới</button>
        </div>
        <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
          {history.map((h) => (
            <li key={`${h.kind}-${h.id}`} className="flex items-center gap-3 px-4 py-2.5">
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${h.direction === 'in' ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
                {h.direction === 'in' ? 'VÀO' : 'RA'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-800">
                  {h.name ?? '—'}
                  <span className={`ml-1.5 rounded px-1 py-0.5 text-[10px] font-semibold ${h.kind === 'worker' ? 'bg-blue-50 text-blue-600' : 'bg-indigo-50 text-indigo-600'}`}>
                    {h.kind === 'worker' ? 'NLĐ' : 'Khách'}
                  </span>
                </span>
                <span className="block truncate text-xs text-slate-400">
                  {h.org ?? '—'}{h.result === 'blocked' && h.block_reason ? ` · ⚠ ${h.block_reason}` : ''}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className={`block text-xs font-semibold ${h.result === 'allowed' ? 'text-green-600' : 'text-rose-600'}`}>
                  {h.result === 'allowed' ? '✓' : '✗'} {fmtTime(h.logged_at)}
                </span>
                {h.guard_name && <span className="block text-[10px] text-slate-400">{h.guard_name}</span>}
              </span>
            </li>
          ))}
          {history.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">Chưa có lượt vào/ra nào.</li>}
        </ul>
      </div>

      {/* Modal quét QR CCCD / QR khách */}
      {scanOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-base font-bold text-slate-800">📷 Quét QR (CCCD / khách)</p>
              <button
                onClick={() => { void stopScanner(); setScanOpen(false) }}
                className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100"
              >✕</button>
            </div>
            <div id="qr-reader" className="overflow-hidden rounded-xl bg-slate-900" />
            {scanErr
              ? <p className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{scanErr}</p>
              : <p className="mt-3 text-center text-xs text-slate-400">Đưa QR thẻ CCCD (NLĐ) hoặc QR khách/NCC vào khung hình</p>}
            <button
              onClick={() => { void stopScanner(); setScanOpen(false) }}
              className="mt-3 w-full rounded-xl bg-slate-100 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-200"
            >Đóng</button>
          </div>
        </div>
      )}
    </>
  )
}
