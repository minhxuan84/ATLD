/**
 * Cổng khai báo nhà thầu (Pha D) — phía quản trị.
 *
 * Hai phần: tạo/thu hồi link có token, và duyệt hàng chờ bản khai NLĐ.
 * Token thô chỉ hiện đúng một lần ngay sau khi tạo — DB chỉ giữ SHA-256 nên không
 * lấy lại được. Giao diện nói rõ điều đó để cán bộ copy trước khi đóng.
 */
import { useEffect, useState, useCallback } from 'react'
import { api, downloadFile } from '../../lib/api'
import { fmtDate, fmtDateTime } from '../../lib/date'
import {
  Link2, Trash2, Copy, Check, Inbox, UserCheck, UserX, FileText, Plus, X,
} from 'lucide-react'

type Purpose = 'worker_declare' | 'field_report' | 'capa_response'

const PURPOSE_LABEL: Record<Purpose, string> = {
  worker_declare: 'Khai báo người lao động',
  field_report: 'Báo điều kiện không an toàn',
  capa_response: 'Phản hồi khắc phục',
}
/** Đường dẫn công khai tương ứng, khớp route trong App.tsx. */
const PURPOSE_PATH: Record<Purpose, string> = {
  worker_declare: '/khai-bao',
  field_report: '/bao-an-toan',
  capa_response: '/khac-phuc',
}

interface TokenRow {
  id: number
  purpose: Purpose
  label: string | null
  contractor_id: number | null
  contract_id: number | null
  finding_id: number | null
  expires_at: string
  max_uses: number | null
  used_count: number
  revoked_at: string | null
  created_at: string
  contractor_name: string | null
  contract_no: string | null
  finding_no: string | null
  created_by_name: string | null
  pending_count: number
}

interface SubmissionPayload {
  full_name?: string; id_number?: string; birth_date?: string | null
  gender?: string | null; job_title?: string | null; phone?: string | null
  email?: string | null; address?: string | null; blood_type?: string | null
  emergency_contact?: string | null; emergency_phone?: string | null; note?: string | null
}

interface SubmissionRow {
  id: number
  payload: SubmissionPayload
  status: 'pending' | 'approved' | 'rejected'
  review_note: string | null
  reviewed_at: string | null
  reviewed_by_name: string | null
  worker_id: number | null
  created_at: string
  submitted_ip: string | null
  purpose: Purpose
  label: string | null
  contractor_name: string | null
  contract_no: string | null
  file_count: number
  /** Hồ sơ NLĐ đã có cùng số CCCD — id_number không UNIQUE nên duyệt sẽ ra hồ sơ thứ hai. */
  dup_worker_name: string | null
  dup_worker_id: number | null
}

interface SubFile {
  id: number; doc_type_id: number | null; file_name: string
  uploaded_at: string; doc_type_name: string | null
}

interface Contractor { id: number; name: string; code: string }
interface Contract { id: number; contract_no: string; title: string; contractor_id: number; status: string }
interface Branch { id: number; name: string }
interface Finding { id: number; finding_no: string; description: string; status: string }

const GENDER_LABEL: Record<string, string> = { male: 'Nam', female: 'Nữ', other: 'Khác' }

export default function PortalPage() {
  const [tab, setTab] = useState<'links' | 'queue'>('links')
  const [err, setErr] = useState('')

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Cổng khai báo nhà thầu</h2>
        <p className="text-sm text-slate-500">
          Tạo link có hạn cho nhà thầu tự khai báo, báo hiện trường và phản hồi khắc phục.
          Mọi dữ liệu gửi về đều phải cán bộ duyệt mới có hiệu lực.
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {([['links', 'Link khai báo'], ['queue', 'Hàng chờ duyệt']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => { setTab(k); setErr('') }}
            className={`px-4 py-2 text-sm font-medium transition ${
              tab === k ? 'border-b-2 border-vicem-500 text-vicem-500' : 'text-slate-500 hover:text-slate-700'
            }`}>{l}</button>
        ))}
      </div>

      {err && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">
          {err}
        </div>
      )}

      {tab === 'links' ? <LinksTab onError={setErr} /> : <QueueTab onError={setErr} />}
    </div>
  )
}

// ═══════════════ Tab link ═══════════════
function LinksTab({ onError }: { onError: (m: string) => void }) {
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [showForm, setShowForm] = useState(false)
  const [fresh, setFresh] = useState<{ url: string; purpose: Purpose } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await api<{ tokens: TokenRow[] }>('/findings/portal-tokens/list')
      setTokens(d.tokens)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Không tải được danh sách link.')
    }
  }, [onError])

  useEffect(() => { load() }, [load])

  const revoke = async (t: TokenRow) => {
    if (!confirm(`Thu hồi link "${t.label ?? PURPOSE_LABEL[t.purpose]}"? Nhà thầu sẽ không mở được nữa.`)) return
    try {
      await api(`/findings/portal-tokens/${t.id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Không thu hồi được link.')
    }
  }

  const copy = async () => {
    if (!fresh) return
    try {
      await navigator.clipboard.writeText(fresh.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      onError('Trình duyệt không cho copy tự động. Hãy chọn và copy thủ công đoạn link ở trên.')
    }
  }

  const isExpired = (t: TokenRow) => new Date(t.expires_at).getTime() < Date.now()
  const isUsedUp = (t: TokenRow) => t.max_uses !== null && t.used_count >= t.max_uses

  return (
    <div className="space-y-4">
      {fresh && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-emerald-900">
                Đã tạo link {PURPOSE_LABEL[fresh.purpose]}
              </p>
              <p className="mt-0.5 text-xs text-emerald-800">
                Copy và gửi cho nhà thầu ngay. Hệ thống chỉ lưu bản mã hoá nên
                <strong> không xem lại được link này</strong>; mất thì phải tạo link mới.
              </p>
              <code className="mt-2 block break-all rounded bg-white px-3 py-2 text-xs text-slate-800">
                {fresh.url}
              </code>
            </div>
            <button type="button" onClick={() => setFresh(null)} aria-label="Đóng"
              className="text-emerald-700 hover:text-emerald-900">
              <X className="h-4 w-4" />
            </button>
          </div>
          <button type="button" onClick={copy}
            className="mt-3 flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Đã copy' : 'Copy link'}
          </button>
        </div>
      )}

      <button type="button" onClick={() => setShowForm((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg bg-vicem-500 px-4 py-2 text-sm font-medium text-white hover:brightness-110">
        <Plus className="h-4 w-4" /> Tạo link mới
      </button>

      {showForm && (
        <CreateTokenForm
          onError={onError}
          onDone={(url, purpose) => {
            setFresh({ url, purpose })
            setShowForm(false)
            load()
          }}
        />
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Mục đích</th>
              <th className="px-3 py-2">Gắn với</th>
              <th className="px-3 py-2">Hiệu lực đến</th>
              <th className="px-3 py-2">Lượt dùng</th>
              <th className="px-3 py-2">Trạng thái</th>
              <th className="px-3 py-2">Người tạo</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tokens.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                Chưa có link nào.
              </td></tr>
            )}
            {tokens.map((t) => {
              const dead = !!t.revoked_at || isExpired(t) || isUsedUp(t)
              return (
                <tr key={t.id} className={dead ? 'text-slate-400' : ''}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <Link2 className="h-3.5 w-3.5 shrink-0" />
                      <span>{PURPOSE_LABEL[t.purpose]}</span>
                    </div>
                    {t.label && <div className="text-xs text-slate-500">{t.label}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {t.contractor_name && <div>{t.contractor_name}</div>}
                    {t.contract_no && <div className="text-slate-500">HĐ {t.contract_no}</div>}
                    {t.finding_no && <div className="text-slate-500">Phiếu {t.finding_no}</div>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(t.expires_at)}</td>
                  <td className="px-3 py-2">
                    {t.used_count}{t.max_uses !== null ? ` / ${t.max_uses}` : ' (không giới hạn)'}
                    {t.pending_count > 0 && (
                      <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                        {t.pending_count} chờ duyệt
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {t.revoked_at ? (
                      <span className="rounded bg-slate-200 px-2 py-0.5 text-xs">Đã thu hồi</span>
                    ) : isExpired(t) ? (
                      <span className="rounded bg-slate-200 px-2 py-0.5 text-xs">Hết hạn</span>
                    ) : isUsedUp(t) ? (
                      <span className="rounded bg-slate-200 px-2 py-0.5 text-xs">Hết lượt</span>
                    ) : (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        Còn hiệu lực
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {t.created_by_name ?? '—'}
                    <div className="text-slate-400">{fmtDate(t.created_at)}</div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!dead && (
                      <button type="button" onClick={() => revoke(t)}
                        className="flex items-center gap-1 text-xs text-rose-600 hover:underline">
                        <Trash2 className="h-3.5 w-3.5" /> Thu hồi
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CreateTokenForm({
  onDone, onError,
}: { onDone: (url: string, p: Purpose) => void; onError: (m: string) => void }) {
  const [purpose, setPurpose] = useState<Purpose>('worker_declare')
  const [label, setLabel] = useState('')
  const [contractorId, setContractorId] = useState('')
  const [contractId, setContractId] = useState('')
  const [siteId, setSiteId] = useState('')
  const [findingId, setFindingId] = useState('')
  const [days, setDays] = useState('14')
  const [maxUses, setMaxUses] = useState('')
  const [busy, setBusy] = useState(false)

  const [contractors, setContractors] = useState<Contractor[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [findings, setFindings] = useState<Finding[]>([])

  useEffect(() => {
    api<{ contractors: Contractor[] }>('/hse/contractors')
      .then((d) => setContractors(d.contractors)).catch(() => {})
    api<{ contracts: Contract[] }>('/hse/contracts')
      .then((d) => setContracts(d.contracts.filter((c) => c.status === 'active'))).catch(() => {})
    api<{ branches: Branch[] }>('/admin/branches')
      .then((d) => setBranches(d.branches)).catch(() => {})
    // Chỉ phiếu đang chờ khắc phục mới cần link phản hồi.
    api<{ findings: Finding[] }>('/findings?status=capa_assigned')
      .then((d) => setFindings(d.findings)).catch(() => {})
  }, [])

  // Hợp đồng lọc theo nhà thầu đã chọn để không gắn lệch nhà thầu / hợp đồng.
  const shownContracts = contractorId
    ? contracts.filter((c) => c.contractor_id === Number(contractorId))
    : contracts

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    onError('')
    try {
      const d = await api<{ token: string }>('/findings/portal-tokens', {
        method: 'POST',
        body: {
          purpose, label,
          contractor_id: contractorId || null,
          contract_id: contractId || null,
          finding_id: purpose === 'capa_response' ? findingId || null : null,
          site_id: siteId || null,
          days: Number(days) || 14,
          max_uses: maxUses === '' ? null : Number(maxUses),
        },
      })
      onDone(`${window.location.origin}${PURPOSE_PATH[purpose]}/${d.token}`, purpose)
    } catch (e2) {
      onError(e2 instanceof Error ? e2.message : 'Không tạo được link.')
    } finally {
      setBusy(false)
    }
  }

  const cls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Mục đích *</span>
          <select className={cls} value={purpose}
            onChange={(e) => setPurpose(e.target.value as Purpose)}>
            {(Object.keys(PURPOSE_LABEL) as Purpose[]).map((p) => (
              <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Tên gợi nhớ</span>
          <input className={cls} value={label} maxLength={200}
            placeholder="VD: Khai báo đợt bảo trì lò 2 tháng 10"
            onChange={(e) => setLabel(e.target.value)} />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Nhà thầu {purpose === 'worker_declare' && '*'}
          </span>
          <select className={cls} value={contractorId}
            onChange={(e) => { setContractorId(e.target.value); setContractId('') }}>
            <option value="">— Chọn nhà thầu —</option>
            {contractors.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
            ))}
          </select>
          {purpose === 'worker_declare' && (
            <span className="mt-1 block text-xs text-slate-500">
              Bắt buộc: hồ sơ NLĐ luôn thuộc một nhà thầu.
            </span>
          )}
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Hợp đồng</span>
          <select className={cls} value={contractId} onChange={(e) => setContractId(e.target.value)}>
            <option value="">— Không gắn hợp đồng —</option>
            {shownContracts.map((c) => (
              <option key={c.id} value={c.id}>{c.contract_no} — {c.title}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Nhà máy / chi nhánh</span>
          <select className={cls} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">— Theo hợp đồng / site của bạn —</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>

        {purpose === 'capa_response' && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Phiếu phát hiện *</span>
            <select className={cls} value={findingId} onChange={(e) => setFindingId(e.target.value)}>
              <option value="">— Chọn phiếu đang chờ khắc phục —</option>
              {findings.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.finding_no} — {f.description.slice(0, 60)}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Số ngày hiệu lực</span>
          <input type="number" min={1} max={180} className={cls} value={days}
            onChange={(e) => setDays(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Giới hạn số lượt gửi</span>
          <input type="number" min={1} className={cls} value={maxUses}
            placeholder="Để trống = không giới hạn"
            onChange={(e) => setMaxUses(e.target.value)} />
          <span className="mt-1 block text-xs text-slate-500">
            Khai báo nhiều người thì mỗi người là một lượt.
          </span>
        </label>
      </div>

      <button type="submit" disabled={busy}
        className="rounded-lg bg-vicem-500 px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60">
        {busy ? 'Đang tạo…' : 'Tạo link'}
      </button>
    </form>
  )
}

// ═══════════════ Tab hàng chờ ═══════════════
function QueueTab({ onError }: { onError: (m: string) => void }) {
  const [rows, setRows] = useState<SubmissionRow[]>([])
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending')
  const [open, setOpen] = useState<SubmissionRow | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await api<{ submissions: SubmissionRow[] }>(`/findings/submissions/list?status=${status}`)
      setRows(d.submissions)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Không tải được hàng chờ.')
    }
  }, [status, onError])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {([['pending', 'Chờ duyệt'], ['approved', 'Đã duyệt'],
           ['rejected', 'Từ chối'], ['all', 'Tất cả']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatus(k)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              status === k ? 'bg-vicem-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}>{l}</button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-300 py-12 text-slate-400">
          <Inbox className="h-8 w-8" />
          <p className="text-sm">Không có bản khai nào.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Người lao động</th>
                <th className="px-3 py-2">Nhà thầu</th>
                <th className="px-3 py-2">Hồ sơ</th>
                <th className="px-3 py-2">Gửi lúc</th>
                <th className="px-3 py-2">Trạng thái</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{s.payload.full_name ?? '—'}</div>
                    <div className="text-xs text-slate-500">
                      {s.payload.id_number ?? 'chưa có CCCD'}
                      {s.payload.job_title && ` · ${s.payload.job_title}`}
                    </div>
                    {s.status === 'pending' && s.dup_worker_name && (
                      <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                        CCCD đã có hồ sơ
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {s.contractor_name ?? '—'}
                    {s.contract_no && <div className="text-slate-500">HĐ {s.contract_no}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {s.file_count > 0
                      ? <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" />{s.file_count} tệp</span>
                      : <span className="text-amber-700">chưa có tệp</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{fmtDateTime(s.created_at)}</td>
                  <td className="px-3 py-2">
                    {s.status === 'pending' && (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Chờ duyệt</span>
                    )}
                    {s.status === 'approved' && (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Đã duyệt</span>
                    )}
                    {s.status === 'rejected' && (
                      <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">Từ chối</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => setOpen(s)}
                      className="text-xs font-medium text-vicem-500 hover:underline">
                      Xem chi tiết
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <SubmissionModal sub={open} onError={onError}
          onClose={() => setOpen(null)}
          onDone={() => { setOpen(null); load() }} />
      )}
    </div>
  )
}

function SubmissionModal({
  sub, onClose, onDone, onError,
}: {
  sub: SubmissionRow
  onClose: () => void
  onDone: () => void
  onError: (m: string) => void
}) {
  const [files, setFiles] = useState<SubFile[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const p = sub.payload

  useEffect(() => {
    api<{ files: SubFile[] }>(`/findings/submissions/${sub.id}/files`)
      .then((d) => setFiles(d.files)).catch(() => {})
  }, [sub.id])

  const review = async (decision: 'approved' | 'rejected', allowDuplicate = false) => {
    if (decision === 'rejected' && !note.trim()) {
      onError('Ghi lý do từ chối để nhà thầu biết phải sửa gì.')
      return
    }
    setBusy(true)
    try {
      const r = await api<{ worker_id?: number; access_status?: string }>(
        `/findings/submissions/${sub.id}/review`,
        {
          method: 'PATCH',
          body: { decision, review_note: note, allow_duplicate: allowDuplicate },
        },
      )
      if (decision === 'approved') {
        // Nói rõ kết quả: tạo hồ sơ xong NLĐ thường vẫn 'blocked' vì chưa đủ hồ sơ.
        alert(r.access_status === 'allowed'
          ? 'Đã tạo hồ sơ NLĐ. Hồ sơ đủ điều kiện, người lao động được vào nhà máy.'
          : 'Đã tạo hồ sơ NLĐ. Người lao động CHƯA được vào nhà máy vì hồ sơ còn thiếu — '
            + 'xem chi tiết ở tab Người lao động.')
      }
      onDone()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Không xử lý được bản khai.'
      // Server trả 409 khi CCCD đã có hồ sơ. Chỉ tạo hồ sơ thứ hai nếu cán bộ xác
      // nhận có chủ ý — mặc định là nhà thầu khai trùng, không phải người khác.
      if (decision === 'approved' && !allowDuplicate && /Đã có hồ sơ NLĐ với CCCD/.test(msg)) {
        setBusy(false)
        if (confirm(`${msg}\n\nVẫn tạo hồ sơ mới cho người này?`)) {
          await review('approved', true)
        }
        return
      }
      onError(msg)
    } finally {
      setBusy(false)
    }
  }

  const rows: [string, string | null | undefined][] = [
    ['Họ và tên', p.full_name],
    ['Số CCCD / hộ chiếu', p.id_number],
    ['Ngày sinh', p.birth_date ? fmtDate(p.birth_date) : null],
    ['Giới tính', p.gender ? GENDER_LABEL[p.gender] ?? p.gender : null],
    ['Chức danh', p.job_title],
    ['Điện thoại', p.phone],
    ['Email', p.email],
    ['Địa chỉ', p.address],
    ['Nhóm máu', p.blood_type],
    ['Liên hệ cấp cứu', p.emergency_contact],
    ['SĐT cấp cứu', p.emergency_phone],
    ['Ghi chú', p.note],
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-800">Bản khai người lao động</h3>
            <p className="text-xs text-slate-500">
              {sub.contractor_name ?? '—'} · gửi {fmtDateTime(sub.created_at)}
              {sub.submitted_ip && ` · IP ${sub.submitted_ip}`}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng"
            className="text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        {sub.status === 'pending' && sub.dup_worker_name && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-medium">Đã có hồ sơ với số CCCD này</p>
            <p className="mt-0.5 text-xs">
              {sub.dup_worker_name} (mã {sub.dup_worker_id}). Nếu đúng là cùng một người,
              hãy từ chối bản khai và cập nhật hồ sơ sẵn có ở tab Người lao động — hai hồ
              sơ cho một người sẽ làm trạng thái ra/vào cổng sai.
            </p>
          </div>
        )}

        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          {rows.filter(([, v]) => v).map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-slate-500">{k}</dt>
              <dd className="text-slate-800">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-4">
          <p className="mb-1 text-sm font-medium text-slate-700">Tệp kèm theo</p>
          {files.length === 0 ? (
            <p className="text-xs text-amber-700">
              Nhà thầu chưa nộp tệp nào. Duyệt vẫn tạo được hồ sơ, nhưng NLĐ sẽ bị chặn
              ở cổng cho tới khi đủ hồ sơ.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {files.map((f) => (
                <li key={f.id} className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="text-xs text-slate-500">
                    {f.doc_type_name ?? 'Không rõ loại'}:
                  </span>
                  {/* Qua downloadFile, không dùng <a href>: endpoint có requireAuth mà
                      thẻ <a> không gửi được header Authorization → sẽ 401. */}
                  <button type="button"
                    onClick={() => downloadFile(
                      `/findings/submission-files/${f.id}/download`, f.file_name,
                    ).catch((e: unknown) => onError(
                      e instanceof Error ? e.message : 'Không tải được tệp.'))}
                    className="truncate text-vicem-500 hover:underline">{f.file_name}</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {sub.status === 'pending' ? (
          <>
            <label className="mt-4 block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Ghi chú duyệt / lý do từ chối
              </span>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => review('approved')}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
                <UserCheck className="h-4 w-4" /> Duyệt, tạo hồ sơ NLĐ
              </button>
              <button type="button" disabled={busy} onClick={() => review('rejected')}
                className="flex items-center gap-1.5 rounded-lg border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60">
                <UserX className="h-4 w-4" /> Từ chối
              </button>
            </div>
          </>
        ) : (
          <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {sub.status === 'approved' ? 'Đã duyệt' : 'Đã từ chối'}
            {sub.reviewed_by_name && ` bởi ${sub.reviewed_by_name}`}
            {sub.reviewed_at && ` lúc ${fmtDateTime(sub.reviewed_at)}`}
            {sub.review_note && <p className="mt-1 text-xs text-slate-600">{sub.review_note}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
