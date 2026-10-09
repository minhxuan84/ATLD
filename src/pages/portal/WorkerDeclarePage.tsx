/**
 * Trang khai báo người lao động cho nhà thầu (Pha D, bước 1 quy trình khai báo).
 *
 * Nộp xong KHÔNG tạo hồ sơ NLĐ ngay — bản khai vào hàng chờ, cán bộ ATVSLĐ duyệt mới
 * thành hồ sơ thật. Văn bản trên trang nói rõ điều này để nhà thầu không đưa người tới
 * cổng rồi bị chặn.
 */
import { useState } from 'react'
import { UserPlus, Upload, CheckCircle2, Trash2 } from 'lucide-react'
import PortalShell, { Field, Notice, inputCls } from './PortalShell'
import { portalApi, type DocType, type PortalInfo } from './portalApi'

interface Form {
  full_name: string
  id_number: string
  birth_date: string
  gender: string
  job_title: string
  phone: string
  email: string
  address: string
  blood_type: string
  emergency_contact: string
  emergency_phone: string
  note: string
}

const EMPTY: Form = {
  full_name: '', id_number: '', birth_date: '', gender: '', job_title: '',
  phone: '', email: '', address: '', blood_type: '',
  emergency_contact: '', emergency_phone: '', note: '',
}

interface Picked { docTypeId: number; file: File }

function DeclareForm({ info, token }: { info: PortalInfo; token: string }) {
  const [f, setF] = useState<Form>(EMPTY)
  const [picked, setPicked] = useState<Picked[]>([])
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))

  const pick = (dt: DocType, file: File | undefined) => {
    if (!file) return
    setPicked((p) => [...p.filter((x) => x.docTypeId !== dt.id), { docTypeId: dt.id, file }])
  }

  const mandatory = info.docTypes.filter((d) => d.is_mandatory)
  const missing = mandatory.filter((d) => !picked.some((p) => p.docTypeId === d.id))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const r = await portalApi<{ id: number; message: string }>(
        `/${encodeURIComponent(token)}/worker`,
        { method: 'POST', body: f },
      )
      // Gửi file sau khi đã có id bản khai. Một file lỗi không làm mất bản khai —
      // cán bộ vẫn thấy bản khai trong hàng chờ và có thể yêu cầu nộp bù.
      const failed: string[] = []
      for (const p of picked) {
        const fd = new FormData()
        fd.append('file', p.file)
        fd.append('doc_type_id', String(p.docTypeId))
        try {
          await portalApi(`/${encodeURIComponent(token)}/worker/${r.id}/file`, {
            method: 'POST', form: fd,
          })
        } catch {
          failed.push(p.file.name)
        }
      }
      setDone(failed.length
        ? `${r.message} Lưu ý: chưa tải lên được ${failed.join(', ')} — liên hệ cán bộ ATVSLĐ để nộp bù.`
        : r.message)
      setF(EMPTY)
      setPicked([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không gửi được bản khai.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <p className="text-sm text-emerald-800">{done}</p>
        </div>
        <button type="button" onClick={() => setDone('')}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Khai báo người tiếp theo
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Notice kind="error">{error}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Họ và tên" required>
          <input className={inputCls} value={f.full_name} required maxLength={200}
            onChange={(e) => set('full_name', e.target.value)} />
        </Field>
        <Field label="Số CCCD / hộ chiếu" required>
          <input className={inputCls} value={f.id_number} required maxLength={30}
            onChange={(e) => set('id_number', e.target.value)} />
        </Field>
        <Field label="Ngày sinh">
          <input type="date" className={inputCls} value={f.birth_date}
            onChange={(e) => set('birth_date', e.target.value)} />
        </Field>
        <Field label="Giới tính">
          <select className={inputCls} value={f.gender} onChange={(e) => set('gender', e.target.value)}>
            <option value="">— Chọn —</option>
            <option value="male">Nam</option>
            <option value="female">Nữ</option>
            <option value="other">Khác</option>
          </select>
        </Field>
        <Field label="Chức danh / công việc">
          <input className={inputCls} value={f.job_title} maxLength={120}
            onChange={(e) => set('job_title', e.target.value)} />
        </Field>
        <Field label="Số điện thoại">
          <input className={inputCls} value={f.phone} maxLength={30}
            onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Email">
          <input type="email" className={inputCls} value={f.email} maxLength={150}
            onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Nhóm máu">
          <input className={inputCls} value={f.blood_type} maxLength={10}
            onChange={(e) => set('blood_type', e.target.value)} />
        </Field>
        <Field label="Người liên hệ khi cấp cứu">
          <input className={inputCls} value={f.emergency_contact} maxLength={150}
            onChange={(e) => set('emergency_contact', e.target.value)} />
        </Field>
        <Field label="SĐT liên hệ khi cấp cứu">
          <input className={inputCls} value={f.emergency_phone} maxLength={30}
            onChange={(e) => set('emergency_phone', e.target.value)} />
        </Field>
      </div>

      <Field label="Địa chỉ">
        <input className={inputCls} value={f.address} onChange={(e) => set('address', e.target.value)} />
      </Field>
      <Field label="Ghi chú">
        <textarea className={inputCls} rows={2} value={f.note}
          onChange={(e) => set('note', e.target.value)} />
      </Field>

      {info.docTypes.length > 0 && (
        <fieldset className="rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-medium text-slate-700">Hồ sơ kèm theo</legend>
          <p className="mb-3 text-xs text-slate-500">
            Mục có dấu <span className="text-rose-600">*</span> là bắt buộc. Thiếu hồ sơ thì
            người lao động chưa được vào nhà máy.
          </p>
          <div className="space-y-2">
            {info.docTypes.map((dt) => {
              const got = picked.find((p) => p.docTypeId === dt.id)
              return (
                <div key={dt.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-48 flex-1 text-slate-700">
                    {dt.name}
                    {dt.is_mandatory && <span className="ml-0.5 text-rose-600">*</span>}
                  </span>
                  {got ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-700">
                      {got.file.name}
                      <button type="button" aria-label={`Bỏ tệp ${dt.name}`}
                        onClick={() => setPicked((p) => p.filter((x) => x.docTypeId !== dt.id))}
                        className="text-slate-400 hover:text-rose-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ) : (
                    <label className="flex cursor-pointer items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
                      <Upload className="h-3.5 w-3.5" /> Chọn tệp
                      {/* accept khớp ALLOWED_EXT của server; khác đi thì server lặng
                          lẽ bỏ file và nhà thầu không biết vì sao thiếu hồ sơ. */}
                      <input type="file" className="hidden"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                        onChange={(e) => pick(dt, e.target.files?.[0])} />
                    </label>
                  )}
                </div>
              )
            })}
          </div>
          {missing.length > 0 && (
            <p className="mt-3 text-xs text-amber-700">
              Chưa chọn: {missing.map((d) => d.name).join(', ')}. Vẫn gửi được, nhưng hồ sơ
              sẽ chưa đủ để duyệt.
            </p>
          )}
        </fieldset>
      )}

      <button type="submit" disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60">
        <UserPlus className="h-4 w-4" />
        {busy ? 'Đang gửi…' : 'Gửi bản khai'}
      </button>
    </form>
  )
}

export default function WorkerDeclarePage() {
  return (
    <PortalShell title="Khai báo người lao động" purpose="worker_declare">
      {(info, token) => <DeclareForm info={info} token={token} />}
    </PortalShell>
  )
}
