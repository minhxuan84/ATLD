// Quản lý khách & nhà cung cấp bên ngoài (Phase E — BM111-07.06).
import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { useConfig } from '../../context/ConfigContext'
import { fmtDate } from '../../lib/date'
import FaceEnrollModal from '../../components/hse/FaceEnrollModal'

interface Visitor {
  id: number; kind: string; full_name: string; id_number: string | null
  org_name: string | null; phone: string | null; purpose: string | null
  host_name: string | null; valid_from: string | null; valid_to: string | null
  access_status: string; presence: string; qr_code: string | null
  last_in_at: string | null; last_out_at: string | null
}
const KIND_LABEL: Record<string, string> = {
  guest: 'Khách tham quan', supplier: 'Nhà cung cấp',
  contractor_visitor: 'Thăm NLĐ', authority: 'Cơ quan kiểm tra',
}
const EMPTY = {
  kind: 'guest', full_name: '', id_number: '', org_name: '',
  phone: '', purpose: '', host_name: '', valid_from: '', valid_to: '',
}

export default function VisitorsPage() {
  const { config } = useConfig()
  const [items, setItems] = useState<Visitor[]>([])
  const [kind, setKind] = useState('')
  const [q, setQ] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showScan, setShowScan] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [editId, setEditId] = useState<number | null>(null)
  const [scanQr, setScanQr] = useState('')
  const [scanDir, setScanDir] = useState<'in' | 'out'>('in')
  const [scanResult, setScanResult] = useState<null | { result: string; reason?: string; visitor?: { full_name: string; kind: string } }>(null)
  const [qrView, setQrView] = useState<null | { visitor: Visitor; dataUrl: string }>(null)
  const [faceTarget, setFaceTarget] = useState<{ id: number; name: string } | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // Sinh ảnh QR từ chuỗi qr_code đã lưu (dynamic import để không phình bundle).
  const showQr = async (v: Visitor) => {
    if (!v.qr_code) { setErr('Khách này chưa có mã QR.'); return }
    const { default: QRCode } = await import('qrcode')
    const dataUrl = await QRCode.toDataURL(v.qr_code, { margin: 1, width: 240 })
    setQrView({ visitor: v, dataUrl })
  }
  // In thẻ QR ra cửa sổ mới (khổ thẻ đeo) để phát cho khách.
  const printQr = () => {
    if (!qrView) return
    const v = qrView.visitor
    const w = window.open('', '_blank', 'width=420,height=560')
    if (!w) return
    const brand = `${config.brand_name_top} ${config.brand_name_bottom}`
    const logoAbs = config.logo_url && config.logo_url.startsWith('/') ? window.location.origin + config.logo_url : config.logo_url
    const logoImg = logoAbs ? `<img class="logo" src="${logoAbs}" alt=""/>` : ''
    w.document.write(`<html><head><title>Thẻ khách - ${v.full_name}</title>
      <style>body{font-family:sans-serif;text-align:center;padding:24px}
      h2{margin:4px 0}img{width:240px;height:240px}.logo{width:auto;height:44px;margin-bottom:4px}
      .brand{color:#0055A4;font-weight:700;font-size:13px;margin-bottom:8px}
      .k{color:#555;font-size:14px;margin:2px 0}.tag{background:#eef;color:#334;
      border-radius:8px;padding:2px 10px;display:inline-block;font-size:12px;margin:6px 0}</style></head>
      <body>${logoImg}<div class="brand">${brand}</div>
      <h2>THẺ RA VÀO CÔNG TRƯỜNG</h2><div class="tag">${KIND_LABEL[v.kind] ?? v.kind}</div>
      <img src="${qrView.dataUrl}"/><h2>${v.full_name}</h2>
      ${v.org_name ? `<p class="k">${v.org_name}</p>` : ''}
      ${v.id_number ? `<p class="k">CCCD/CMND: ${v.id_number}</p>` : ''}
      <p class="k">Hiệu lực: ${fmt(v.valid_from)} → ${fmt(v.valid_to)}</p>
      <script>window.onload=function(){window.print()}</script></body></html>`)
    w.document.close()
  }

  const load = useCallback(async () => {
    const p = new URLSearchParams()
    if (kind) p.set('kind', kind)
    if (q) p.set('q', q)
    const d = await api<{ visitors: Visitor[] }>(`/hse/visitors?${p}`)
    setItems(d.visitors)
  }, [kind, q])
  useEffect(() => { load() }, [load])

  const openNew = () => { setForm({ ...EMPTY }); setEditId(null); setErr(''); setShowForm(true) }
  const openEdit = (v: Visitor) => {
    setForm({ kind: v.kind, full_name: v.full_name, id_number: v.id_number ?? '',
      org_name: v.org_name ?? '', phone: v.phone ?? '', purpose: v.purpose ?? '',
      host_name: v.host_name ?? '', valid_from: v.valid_from?.slice(0,10) ?? '',
      valid_to: v.valid_to?.slice(0,10) ?? '' })
    setEditId(v.id); setErr(''); setShowForm(true)
  }
  const submit = async () => {
    setErr(''); setBusy(true)
    try {
      if (editId) { await api(`/hse/visitors/${editId}`, { method: 'PATCH', body: form }); setShowForm(false); await load() }
      else {
        const r = await api<{ id: number; qr_code: string }>('/hse/visitors', { method: 'POST', body: form })
        setShowForm(false); await load()
        // Hiện QR ngay để phát/in cho khách vừa đăng ký.
        await showQr({ id: r.id, qr_code: r.qr_code, full_name: form.full_name, kind: form.kind,
          org_name: form.org_name || null, id_number: form.id_number || null,
          valid_from: form.valid_from || null, valid_to: form.valid_to || null,
          phone: null, purpose: null, host_name: null, access_status: 'allowed', presence: 'out',
          last_in_at: null, last_out_at: null })
      }
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const doScan = async () => {
    setErr(''); setBusy(true); setScanResult(null)
    try {
      const r = await api<{ result: string; reason?: string; visitor?: { full_name: string; kind: string } }>(
        '/hse/visitors/scan', { method: 'POST', body: { qr_code: scanQr.trim(), direction: scanDir } })
      setScanResult(r); await load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const fmt = (s: string | null) => fmtDate(s)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value)}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm">
            <option value="">-- Tất cả loại --</option>
            {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input placeholder="Tìm tên / tổ chức…" value={q} onChange={(e) => setQ(e.target.value)}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setScanQr(''); setScanResult(null); setErr(''); setShowScan(true) }}
            className="rounded bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">Quét QR cổng</button>
          <button onClick={openNew} className="rounded bg-vicem-500 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">+ Đăng ký khách</button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
            <th className="px-3 py-2 text-left">Họ tên</th><th className="px-3 py-2 text-left">Loại</th>
            <th className="px-3 py-2 text-left">Tổ chức</th><th className="px-3 py-2 text-left">Người tiếp</th>
            <th className="px-3 py-2 text-center">Hiệu lực</th><th className="px-3 py-2 text-center">Hiện diện</th>
            <th className="px-3 py-2 text-center">Trạng thái</th><th className="px-3 py-2" />
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((v) => (
              <tr key={v.id} className="text-xs hover:bg-slate-50">
                <td className="px-3 py-2 font-medium text-slate-700">{v.full_name}
                  {v.id_number && <span className="ml-1 text-slate-400">({v.id_number})</span>}</td>
                <td className="px-3 py-2 text-slate-500">{KIND_LABEL[v.kind] ?? v.kind}</td>
                <td className="px-3 py-2 text-slate-500">{v.org_name ?? '—'}</td>
                <td className="px-3 py-2 text-slate-500">{v.host_name ?? '—'}</td>
                <td className="px-3 py-2 text-center text-slate-500">{fmt(v.valid_from)} → {fmt(v.valid_to)}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${v.presence === 'in' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                    {v.presence === 'in' ? 'Trong CS' : 'Ngoài'}</span></td>
                <td className="px-3 py-2 text-center">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${v.access_status === 'allowed' ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'}`}>
                    {v.access_status === 'allowed' ? 'Cho phép' : 'Chặn'}</span></td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => showQr(v)} className="rounded px-2 py-0.5 text-indigo-600 hover:bg-slate-100">QR</button>
                  <button onClick={() => openEdit(v)} className="rounded px-2 py-0.5 text-vicem-500 hover:bg-slate-100">Sửa</button>
                  <button onClick={() => setFaceTarget({ id: v.id, name: v.full_name })}
                    className="rounded px-2 py-0.5 text-slate-500 hover:bg-slate-100" title="Đăng ký khuôn mặt">📷</button></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-slate-400">Chưa có khách nào.</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-lg rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold">{editId ? 'Sửa thông tin khách' : 'Đăng ký khách / NCC'}</h3>
            {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
            <div className="grid grid-cols-2 gap-2">
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm">
                {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <input placeholder="Họ tên *" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
              <input placeholder="CCCD / CMND" value={form.id_number} onChange={(e) => setForm({ ...form, id_number: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
              <input placeholder="Số điện thoại" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
              <input placeholder="Tổ chức / công ty" value={form.org_name} onChange={(e) => setForm({ ...form, org_name: e.target.value })}
                className="col-span-2 rounded border border-slate-300 px-3 py-1.5 text-sm" />
              <input placeholder="Người tiếp / phụ trách" value={form.host_name} onChange={(e) => setForm({ ...form, host_name: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
              <input placeholder="Mục đích" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
              <div><label className="text-xs text-slate-500">Hiệu lực từ</label>
                <input type="date" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" /></div>
              <div><label className="text-xs text-slate-500">Đến ngày</label>
                <input type="date" value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })}
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" /></div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="rounded px-3 py-1.5 text-sm text-slate-500">Hủy</button>
              <button onClick={submit} disabled={busy || !form.full_name}
                className="rounded bg-vicem-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                {busy ? 'Đang lưu…' : 'Lưu'}</button>
            </div>
          </div>
        </div>
      )}

      {showScan && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowScan(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold">Quét QR khách tại cổng</h3>
            {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
            <div className="flex gap-1">
              <button onClick={() => setScanDir('in')}
                className={`flex-1 rounded px-3 py-1.5 text-sm font-medium ${scanDir === 'in' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600'}`}>Vào</button>
              <button onClick={() => setScanDir('out')}
                className={`flex-1 rounded px-3 py-1.5 text-sm font-medium ${scanDir === 'out' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'}`}>Ra</button>
            </div>
            <input autoFocus placeholder="Dán / nhập mã QR (ATLD|VIS|…)" value={scanQr}
              onChange={(e) => setScanQr(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && scanQr.trim()) doScan() }}
              className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono" />
            {scanResult && (
              <div className={`mt-3 rounded-lg p-3 text-sm ${scanResult.result === 'allowed' ? 'bg-green-50 text-green-700' : 'bg-rose-50 text-rose-700'}`}>
                <p className="font-semibold">{scanResult.result === 'allowed' ? '✓ Cho phép' : '✗ Từ chối'} — {scanDir === 'in' ? 'Vào' : 'Ra'}</p>
                {scanResult.visitor && <p>{scanResult.visitor.full_name} · {KIND_LABEL[scanResult.visitor.kind] ?? scanResult.visitor.kind}</p>}
                {scanResult.reason && <p className="text-xs">{scanResult.reason}</p>}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowScan(false)} className="rounded px-3 py-1.5 text-sm text-slate-500">Đóng</button>
              <button onClick={doScan} disabled={busy || !scanQr.trim()}
                className="rounded bg-vicem-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                {busy ? 'Đang xử lý…' : 'Xác nhận'}</button>
            </div>
          </div>
        </div>
      )}

      {faceTarget && (
        <FaceEnrollModal
          id={faceTarget.id}
          type="visitor"
          name={faceTarget.name}
          onClose={() => setFaceTarget(null)}
          onSuccess={() => { setFaceTarget(null); void load() }}
        />
      )}

      {qrView && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setQrView(null)}>
          <div className="w-full max-w-xs rounded-lg bg-white p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-indigo-600">{KIND_LABEL[qrView.visitor.kind] ?? qrView.visitor.kind}</p>
            <h3 className="mb-3 text-lg font-semibold text-slate-800">{qrView.visitor.full_name}</h3>
            <img src={qrView.dataUrl} alt="QR khách" className="mx-auto h-56 w-56" />
            <p className="mt-2 break-all font-mono text-[10px] text-slate-400">{qrView.visitor.qr_code}</p>
            <p className="mt-1 text-xs text-slate-500">Hiệu lực: {fmt(qrView.visitor.valid_from)} → {fmt(qrView.visitor.valid_to)}</p>
            <div className="mt-4 flex justify-center gap-2">
              <button onClick={() => setQrView(null)} className="rounded px-3 py-1.5 text-sm text-slate-500">Đóng</button>
              <button onClick={printQr} className="rounded bg-vicem-500 px-4 py-1.5 text-sm font-medium text-white hover:opacity-90">🖨 In thẻ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
