// Trang cấu hình SmartCA VNPT trong CMS — chỉ admin.
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

interface SmartCACfg {
  api_url: string
  client_id: string
  client_secret: string
  webhook_secret: string
  enabled: boolean
}

const EMPTY: SmartCACfg = {
  api_url: '', client_id: '', client_secret: '', webhook_secret: '', enabled: false,
}

export default function SmartCAConfigPage() {
  const [form, setForm] = useState<SmartCACfg>(EMPTY)
  const [showSecret, setShowSecret] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    api<{ config: SmartCACfg }>('/admin/smartca-config').then((d) => setForm(d.config)).catch(() => {})
  }, [])

  const set = (k: keyof SmartCACfg, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }))

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setSaved(false); setBusy(true)
    try {
      await api('/admin/smartca-config', { method: 'PUT', body: form })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const test = async () => {
    setTestResult(null); setBusy(true)
    try {
      const r = await api<{ ok: boolean; msg: string }>('/admin/smartca-test', { method: 'POST', body: form })
      setTestResult(r)
    } catch (e) { setTestResult({ ok: false, msg: (e as Error).message }) } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Chữ ký số SmartCA VNPT</h2>
        <p className="mt-1 text-sm text-slate-500">
          Kết nối với dịch vụ SmartCA VNPT để ký số điện tử bản cam kết ATVSLĐ/PCCN/BVMT.
          Đăng ký tại <a href="https://smartca.vnpt.vn/developer" target="_blank" rel="noreferrer" className="text-vicem-500 underline">smartca.vnpt.vn/developer</a>.
        </p>
      </div>

      <form onSubmit={save} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-vicem-500"
          />
          <span className="text-sm font-medium text-slate-700">Kích hoạt chữ ký số SmartCA</span>
        </label>

        <div className="grid gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">API URL *</label>
            <input
              value={form.api_url}
              onChange={(e) => set('api_url', e.target.value)}
              placeholder="https://api-cld.vnpt.vn/smartca"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Client ID *</label>
            <input
              value={form.client_id}
              onChange={(e) => set('client_id', e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Client Secret *</label>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                value={form.client_secret}
                onChange={(e) => set('client_secret', e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm font-mono focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
              />
              <button type="button" onClick={() => setShowSecret((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600">
                {showSecret ? 'Ẩn' : 'Hiện'}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Webhook Secret</label>
            <input
              type="password"
              value={form.webhook_secret}
              onChange={(e) => set('webhook_secret', e.target.value)}
              placeholder="Dùng để xác minh callback từ VNPT"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
            />
          </div>
        </div>

        {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
        {saved && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-600">✓ Đã lưu cấu hình.</p>}

        <div className="flex flex-wrap gap-2 pt-1">
          <button type="submit" disabled={busy}
            className="rounded-lg bg-vicem-500 px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {busy ? 'Đang lưu…' : 'Lưu cấu hình'}
          </button>
          <button type="button" onClick={test} disabled={busy || !form.api_url || !form.client_id}
            className="rounded-lg border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            🔌 Kiểm tra kết nối
          </button>
        </div>

        {testResult && (
          <div className={`rounded-lg px-3 py-2 text-sm ${testResult.ok ? 'bg-green-50 text-green-700' : 'bg-rose-50 text-rose-700'}`}>
            {testResult.ok ? '✓' : '✗'} {testResult.msg}
          </div>
        )}
      </form>
    </div>
  )
}
