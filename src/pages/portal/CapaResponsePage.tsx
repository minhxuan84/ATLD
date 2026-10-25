/**
 * Trang nhà thầu phản hồi khắc phục (Pha D, bước 5 quy trình kiểm tra).
 *
 * Gửi xong phiếu chuyển sang 'capa_done' — chờ cán bộ xác minh tại hiện trường, KHÔNG
 * tự thành 'verified'. Người khắc phục không được tự xác nhận mình đã xong (ràng buộc
 * ở cả endpoint và CHECK trong DB).
 */
import { useState } from 'react'
import { Send, CheckCircle2, Camera, Trash2, AlertTriangle } from 'lucide-react'
import PortalShell, { Field, Notice, inputCls } from './PortalShell'
import { fmtDateTime } from '../../lib/date'
import { portalApi, type PortalInfo } from './portalApi'

function CapaForm({ info, token }: { info: PortalInfo; token: string }) {
  const [action, setAction] = useState('')
  const [rootCause, setRootCause] = useState('')
  const [preventive, setPreventive] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)

  const f = info.finding
  const overdue = !!f?.capa_due_at && new Date(f.capa_due_at).getTime() < Date.now()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      // Nội dung gửi trước, ảnh sau: endpoint /capa chỉ nhận khi phiếu còn ở
      // 'capa_assigned', nên phải chiếm chỗ bước đó trước khi mất thời gian tải ảnh.
      // Ảnh lỗi thì phản hồi vẫn được ghi, cán bộ xác minh tại hiện trường.
      const failed: string[] = []
      const r = await portalApi<{ finding_id: number; message: string }>(
        `/${encodeURIComponent(token)}/capa`,
        {
          method: 'POST',
          body: { capa_action: action, root_cause: rootCause, preventive_action: preventive },
        },
      )
      for (const p of photos) {
        const fd = new FormData()
        fd.append('file', p)
        try {
          await portalApi(`/${encodeURIComponent(token)}/finding/${r.finding_id}/photo`, {
            method: 'POST', form: fd,
          })
        } catch {
          failed.push(p.name)
        }
      }
      setDone(failed.length
        ? `${r.message} Chưa tải lên được ảnh: ${failed.join(', ')}.`
        : r.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không gửi được phản hồi.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        <p className="text-sm text-emerald-800">{done}</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {f && (
        <div className="rounded-lg border border-slate-200 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-800">{f.finding_no}</span>
            {f.risk_level === 'high' && (
              <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
                Rủi ro cao
              </span>
            )}
          </div>
          {f.area && <p className="mt-1 text-xs text-slate-500">Khu vực: {f.area}</p>}
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{f.description}</p>
          {f.capa_requirement && (
            <div className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="font-medium">Yêu cầu khắc phục</p>
              <p className="mt-0.5 whitespace-pre-wrap">{f.capa_requirement}</p>
            </div>
          )}
          {f.capa_due_at && (
            <p className={`mt-2 flex items-center gap-1 text-xs ${overdue ? 'font-medium text-rose-700' : 'text-slate-600'}`}>
              {overdue && <AlertTriangle className="h-3.5 w-3.5" />}
              Hạn khắc phục: {fmtDateTime(f.capa_due_at)}{overdue && ' — đã quá hạn'}
            </p>
          )}
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        {error && <Notice kind="error">{error}</Notice>}

        <Field label="Nội dung đã khắc phục" required
          hint="Ghi cụ thể đã làm gì, ai làm, xong lúc nào.">
          <textarea className={inputCls} rows={5} value={action} required
            onChange={(e) => setAction(e.target.value)} />
        </Field>

        <Field label="Nguyên nhân gốc"
          hint="Vì sao xảy ra. Không chỉ nêu hiện tượng.">
          <textarea className={inputCls} rows={3} value={rootCause}
            onChange={(e) => setRootCause(e.target.value)} />
        </Field>

        <Field label="Biện pháp phòng ngừa tái diễn">
          <textarea className={inputCls} rows={3} value={preventive}
            onChange={(e) => setPreventive(e.target.value)} />
        </Field>

        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Ảnh sau khắc phục
          </span>
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <Camera className="h-4 w-4" /> Chụp / chọn ảnh
            {/* accept hẹp theo ALLOWED_EXT của server: image/* cho iPhone gửi .heic
                và server sẽ lặng lẽ bỏ file. */}
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

        <p className="rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Gửi xong, cán bộ ATVSLĐ sẽ xác minh tại hiện trường. Công việc bị đình chỉ chỉ
          được làm tiếp sau khi có duyệt làm tiếp.
        </p>

        <button type="submit" disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60">
          <Send className="h-4 w-4" />
          {busy ? 'Đang gửi…' : 'Gửi phản hồi khắc phục'}
        </button>
      </form>
    </div>
  )
}

export default function CapaResponsePage() {
  return (
    <PortalShell title="Phản hồi khắc phục" purpose="capa_response">
      {(info, token) => <CapaForm info={info} token={token} />}
    </PortalShell>
  )
}
