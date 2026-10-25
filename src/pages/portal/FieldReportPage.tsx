/**
 * Trang báo điều kiện/hành vi không an toàn từ hiện trường (Pha D).
 *
 * Phiếu vào hse_findings với source='field_report', trạng thái 'new'. Người ngoài
 * KHÔNG đặt được mức rủi ro — bước đánh giá là của cán bộ ATVSLĐ, nên form này không
 * có trường rủi ro.
 */
import { useState } from 'react'
import { Send, CheckCircle2, Camera, Trash2 } from 'lucide-react'
import PortalShell, { Field, Notice, inputCls } from './PortalShell'
import { portalApi } from './portalApi'

const TYPES = [
  { v: 'unsafe_condition', l: 'Điều kiện không an toàn (vật, thiết bị, môi trường)' },
  { v: 'unsafe_act', l: 'Hành vi không an toàn (cách làm việc)' },
  { v: 'near_miss', l: 'Suýt xảy ra tai nạn' },
]

function ReportForm({ token }: { token: string }) {
  const [findingType, setFindingType] = useState('unsafe_condition')
  const [area, setArea] = useState('')
  const [description, setDescription] = useState('')
  const [reporter, setReporter] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ no: string; msg: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const r = await portalApi<{ id: number; finding_no: string; message: string }>(
        `/${encodeURIComponent(token)}/finding`,
        {
          method: 'POST',
          body: { finding_type: findingType, area, description, reporter_name: reporter },
        },
      )
      const failed: string[] = []
      for (const p of photos) {
        const fd = new FormData()
        fd.append('file', p)
        try {
          await portalApi(`/${encodeURIComponent(token)}/finding/${r.id}/photo`, {
            method: 'POST', form: fd,
          })
        } catch {
          failed.push(p.name)
        }
      }
      setDone({
        no: r.finding_no,
        msg: failed.length
          ? `${r.message} Chưa tải lên được ảnh: ${failed.join(', ')}.`
          : r.message,
      })
      setDescription('')
      setArea('')
      setPhotos([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không gửi được thông tin.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div className="text-sm text-emerald-800">
            <p className="font-medium">Số phiếu: {done.no}</p>
            <p className="mt-0.5">{done.msg}</p>
          </div>
        </div>
        <button type="button" onClick={() => setDone(null)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Báo nội dung khác
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Notice kind="error">{error}</Notice>}

      <Field label="Loại phát hiện" required>
        <select className={inputCls} value={findingType} onChange={(e) => setFindingType(e.target.value)}>
          {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
        </select>
      </Field>

      <Field label="Khu vực" hint="Ví dụ: Lò 2 — sàn tầng 3, cổng xuất clinker…">
        <input className={inputCls} value={area} maxLength={200}
          onChange={(e) => setArea(e.target.value)} />
      </Field>

      <Field label="Nội dung phát hiện" required
        hint="Mô tả cụ thể: thấy gì, ở đâu, lúc nào, nguy hiểm thế nào.">
        <textarea className={inputCls} rows={5} value={description} required
          onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <Field label="Người báo" hint="Ghi tên để cán bộ liên hệ lại khi cần. Có thể để trống.">
        <input className={inputCls} value={reporter} maxLength={200}
          onChange={(e) => setReporter(e.target.value)} />
      </Field>

      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">Ảnh hiện trường</span>
        <label className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          <Camera className="h-4 w-4" /> Chụp / chọn ảnh
          {/* capture="environment": trên điện thoại mở thẳng camera sau, đúng tình huống
              người đang ở hiện trường. Máy tính vẫn hiện hộp chọn tệp như thường.
              accept hẹp theo đúng ALLOWED_EXT của server — để image/* thì iPhone gửi
              .heic và server lặng lẽ bỏ file. */}
          <input type="file" accept=".png,.jpg,.jpeg" capture="environment" multiple className="hidden"
            onChange={(e) => setPhotos((p) => [...p, ...Array.from(e.target.files ?? [])])} />
        </label>
        {photos.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {photos.map((p, i) => (
              <li key={`${p.name}-${i}`} className="flex items-center gap-2">
                <span className="truncate">{p.name}</span>
                <button type="button" aria-label={`Bỏ ảnh ${p.name}`}
                  onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))}
                  className="text-slate-400 hover:text-rose-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button type="submit" disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60">
        <Send className="h-4 w-4" />
        {busy ? 'Đang gửi…' : 'Gửi thông tin'}
      </button>
    </form>
  )
}

export default function FieldReportPage() {
  return (
    <PortalShell title="Báo điều kiện không an toàn" purpose="field_report">
      {(_info, token) => <ReportForm token={token} />}
    </PortalShell>
  )
}
