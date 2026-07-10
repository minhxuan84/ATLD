import { useRef, useState } from 'react'
import { api } from '../../lib/api'
import { Upload, Trash2, Loader2, ImageOff } from 'lucide-react'

interface Props {
  configKey: string
  label: string
  hint?: string
  currentUrl: string
  onChange: () => void // gọi reload config sau khi tải/xóa
  aspect?: string // vd 'aspect-[16/9]' cho banner, mặc định vuông
}

const MAX_MB = 4
const ACCEPT = 'image/png,image/jpeg,image/webp'

export default function ImageUpload({ configKey, label, hint, currentUrl, onChange, aspect = 'aspect-video' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const pick = () => inputRef.current?.click()

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // cho phép chọn lại cùng file
    if (!file) return
    setError('')
    if (!ACCEPT.split(',').includes(file.type)) {
      setError('Chỉ chấp nhận ảnh PNG, JPG hoặc WEBP.')
      return
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`Ảnh vượt quá ${MAX_MB}MB.`)
      return
    }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('key', configKey)
      fd.append('file', file)
      await api('/media', { method: 'POST', body: fd, isForm: true })
      onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tải ảnh thất bại.')
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true); setError('')
    try {
      // DELETE có body -> dùng fetch trực tiếp (api không nhận body cho DELETE ở đây vẫn ok)
      await api('/media', { method: 'DELETE', body: { key: configKey } })
      onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xóa ảnh thất bại.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
      <div className="mt-2 flex items-center gap-4">
        {/* Xem trước */}
        <div className={`${aspect} w-40 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50`}>
          {currentUrl ? (
            <img src={currentUrl} alt={label} className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-300">
              <ImageOff className="h-6 w-6" />
              <span className="text-[11px]">Chưa có ảnh</span>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input ref={inputRef} type="file" accept={ACCEPT} onChange={handleFile} className="hidden" />
          <button
            type="button" onClick={pick} disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-vicem-600 px-4 py-2 text-sm font-semibold text-white hover:bg-vicem-700 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {currentUrl ? 'Thay ảnh' : 'Tải ảnh lên'}
          </button>
          {currentUrl && (
            <button
              type="button" onClick={clear} disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" /> Gỡ ảnh
            </button>
          )}
          <span className="text-[11px] text-slate-400">PNG / JPG / WEBP · tối đa {MAX_MB}MB</span>
        </div>
      </div>
      {error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
    </div>
  )
}
