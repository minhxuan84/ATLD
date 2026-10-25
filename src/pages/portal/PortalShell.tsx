/**
 * Khung chung cho 3 trang công khai của cổng khai báo (Pha D).
 *
 * Tự tải thông tin token rồi render form tương ứng. Không dùng Header/Footer của khu
 * đăng nhập: người mở link là nhà thầu, không có tài khoản, mọi liên kết đăng nhập
 * trong header chỉ gây nhiễu.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { ShieldCheck, AlertTriangle, Clock } from 'lucide-react'
import { fmtDateTime } from '../../lib/date'
import { portalApi, type PortalInfo } from './portalApi'

export function Field({
  label, required, children, hint,
}: { label: string; required?: boolean; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-rose-600">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100'

export function Notice({ kind, children }: { kind: 'error' | 'ok'; children: ReactNode }) {
  const cls = kind === 'error'
    ? 'border-rose-200 bg-rose-50 text-rose-800'
    : 'border-emerald-200 bg-emerald-50 text-emerald-800'
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`} role="alert">
      {children}
    </div>
  )
}

/**
 * Tải thông tin token và render children.
 * Mọi lỗi token (sai, hết hạn, đã thu hồi, hết lượt) server trả về cùng một thông
 * điệp — ở đây không suy đoán thêm lý do.
 */
export default function PortalShell({
  title, purpose, children,
}: {
  title: string
  purpose: PortalInfo['purpose']
  children: (info: PortalInfo, token: string) => ReactNode
}) {
  const { token = '' } = useParams()
  const [info, setInfo] = useState<PortalInfo | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    portalApi<PortalInfo>(`/${encodeURIComponent(token)}`)
      .then((d) => {
        if (d.purpose !== purpose) {
          setError('Đường dẫn này dùng cho việc khác. Kiểm tra lại link cán bộ ATVSLĐ đã gửi.')
          return
        }
        setInfo(d)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Không mở được đường dẫn.'))
      .finally(() => setLoading(false))
  }, [token, purpose])

  return (
    <div className="min-h-screen bg-slate-100 py-6">
      <div className="mx-auto w-full max-w-2xl px-4">
        <div className="mb-4 flex items-center gap-2 text-slate-700">
          <ShieldCheck className="h-6 w-6 text-sky-600" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">{title}</h1>
            <p className="text-xs text-slate-500">An toàn vệ sinh lao động</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          {loading && <p className="py-8 text-center text-sm text-slate-500">Đang tải…</p>}

          {!loading && error && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 text-rose-700">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
            </div>
          )}

          {!loading && info && (
            <div className="space-y-5">
              <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-700">
                {info.label && <p className="font-medium">{info.label}</p>}
                <dl className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {info.contractor_name && (
                    <div><dt className="inline">Nhà thầu: </dt><dd className="inline font-medium">{info.contractor_name}</dd></div>
                  )}
                  {info.contract_no && (
                    <div><dt className="inline">Hợp đồng: </dt><dd className="inline font-medium">{info.contract_no}</dd></div>
                  )}
                  {info.site_name && (
                    <div><dt className="inline">Nhà máy: </dt><dd className="inline font-medium">{info.site_name}</dd></div>
                  )}
                </dl>
                <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                  <Clock className="h-3.5 w-3.5" />
                  Link có hiệu lực đến {fmtDateTime(info.expires_at)}
                  {info.remaining_uses !== null && ` · còn ${info.remaining_uses} lượt gửi`}
                </p>
              </div>
              {children(info, token)}
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-slate-500">
          Thông tin gửi qua trang này được cán bộ ATVSLĐ kiểm tra trước khi có hiệu lực.
        </p>
      </div>
    </div>
  )
}
