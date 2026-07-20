// Trang cấu hình LDAP/AD trong CMS — chỉ admin.
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

interface LdapCfg {
  url: string
  base_dn: string
  bind_dn: string
  bind_password: string
  attr_username: string
  attr_fullname: string
  enabled: boolean
}

const EMPTY: LdapCfg = {
  url: '', base_dn: '', bind_dn: '', bind_password: '',
  attr_username: 'sAMAccountName', attr_fullname: 'displayName', enabled: false,
}

interface SyncResult { added: number; updated: number; skipped: number }

export default function LdapConfigPage() {
  const [form, setForm] = useState<LdapCfg>(EMPTY)
  const [showPw, setShowPw] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)

  useEffect(() => {
    api<{ config: LdapCfg }>('/admin/ldap-config').then((d) => setForm(d.config)).catch(() => {})
  }, [])

  const set = (k: keyof LdapCfg, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }))

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setSaved(false); setBusy(true)
    try {
      await api('/admin/ldap-config', { method: 'PUT', body: form })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const test = async () => {
    setTestResult(null); setBusy(true)
    try {
      const r = await api<{ ok: boolean; msg: string }>('/admin/ldap-test', { method: 'POST', body: form })
      setTestResult(r)
    } catch (e) { setTestResult({ ok: false, msg: (e as Error).message }) } finally { setBusy(false) }
  }

  const sync = async () => {
    if (!confirm('Đồng bộ sẽ tạo/cập nhật tài khoản từ AD. Tiếp tục?')) return
    setSyncResult(null); setBusy(true)
    try {
      const r = await api<SyncResult>('/admin/ldap-sync', { method: 'POST' })
      setSyncResult(r)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Cấu hình LDAP / Active Directory</h2>
        <p className="mt-1 text-sm text-slate-500">
          Kết nối với máy chủ AD để cho phép đăng nhập bằng tài khoản công ty và đồng bộ danh sách người dùng.
        </p>
      </div>

      <form onSubmit={save} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
        {/* Bật/tắt */}
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-vicem-500"
          />
          <span className="text-sm font-medium text-slate-700">Kích hoạt đăng nhập AD/SSO</span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-600">URL máy chủ LDAP *</label>
            <input
              value={form.url}
              onChange={(e) => set('url', e.target.value)}
              placeholder="ldap://192.168.1.10:389"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-600">Base DN *</label>
            <input
              value={form.base_dn}
              onChange={(e) => set('base_dn', e.target.value)}
              placeholder="DC=company,DC=local"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-600">Bind DN (tài khoản dịch vụ) *</label>
            <input
              value={form.bind_dn}
              onChange={(e) => set('bind_dn', e.target.value)}
              placeholder="CN=svc-atld,OU=Service Accounts,DC=company,DC=local"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-600">Mật khẩu Bind *</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={form.bind_password}
                onChange={(e) => set('bind_password', e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
              >
                {showPw ? 'Ẩn' : 'Hiện'}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Thuộc tính tên đăng nhập</label>
            <input
              value={form.attr_username}
              onChange={(e) => set('attr_username', e.target.value)}
              placeholder="sAMAccountName"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Thuộc tính họ tên</label>
            <input
              value={form.attr_fullname}
              onChange={(e) => set('attr_fullname', e.target.value)}
              placeholder="displayName"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
            />
          </div>
        </div>

        {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
        {saved && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-600">✓ Đã lưu cấu hình.</p>}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-vicem-500 px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Đang lưu…' : 'Lưu cấu hình'}
          </button>
          <button
            type="button"
            onClick={test}
            disabled={busy || !form.url || !form.bind_dn}
            className="rounded-lg border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            🔌 Kiểm tra kết nối
          </button>
        </div>

        {testResult && (
          <div className={`rounded-lg px-3 py-2 text-sm ${testResult.ok ? 'bg-green-50 text-green-700' : 'bg-rose-50 text-rose-700'}`}>
            {testResult.ok ? '✓' : '✗'} {testResult.msg}
          </div>
        )}
      </form>

      {/* Đồng bộ người dùng */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="mb-1 font-semibold text-slate-800">Đồng bộ người dùng từ AD</h3>
        <p className="mb-4 text-sm text-slate-500">
          Tìm kiếm tất cả tài khoản trong Base DN và tạo/cập nhật vào hệ thống với vai trò <strong>officer</strong>.
          Tài khoản đã tồn tại sẽ được cập nhật họ tên.
        </p>
        <button
          onClick={sync}
          disabled={busy || !form.enabled || !form.url}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          🔄 Đồng bộ ngay
        </button>
        {!form.enabled && (
          <p className="mt-2 text-xs text-slate-400">Cần kích hoạt AD/SSO trước khi đồng bộ.</p>
        )}
        {syncResult && (
          <div className="mt-3 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <p className="font-semibold">Đồng bộ hoàn tất</p>
            <p>Thêm mới: <strong>{syncResult.added}</strong> · Cập nhật: <strong>{syncResult.updated}</strong> · Bỏ qua: <strong>{syncResult.skipped}</strong></p>
          </div>
        )}
      </div>
    </div>
  )
}
