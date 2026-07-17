// Quản lý nhà thầu + hợp đồng gắn với từng nhà thầu.
import { useEffect, useState, useCallback, useRef } from 'react'
import { api, openFileInNewTab, downloadFile } from '../../lib/api'
import { useAuth, seesAllSites } from '../../context/AuthContext'
import { fmtDate } from '../../lib/date'

interface Branch { id: number; name: string; location: string }

interface Contractor {
  id: number; code: string; name: string; tax_id: string | null
  phone: string | null; email: string | null; rep_name: string | null
  rep_title: string | null; address: string | null; status: string
}
interface Contract {
  id: number; contract_no: string; title: string; work_location: string | null
  start_date: string; end_date: string; status: string; contractor_id: number
  contract_file_name: string | null; site_id: number | null; site_name: string | null
}

const CT_STATUS_LABEL: Record<string, string> = {
  pending: 'Chờ duyệt', active: 'Đang thực hiện', completed: 'Hoàn thành',
  suspended: 'Đình chỉ', cancelled: 'Hủy',
}
const CT_STATUS_COLOR: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  suspended: 'bg-rose-100 text-rose-700',
  completed: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-slate-100 text-slate-400',
}

const EMPTY_CTR = { code: '', name: '', tax_id: '', phone: '', email: '', rep_name: '', rep_title: '', address: '' }
const EMPTY_HD  = { contract_no: '', title: '', work_location: '', start_date: '', end_date: '', site_id: '' }

export default function ContractorsPage() {
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Contractor | null>(null)
  const [contracts, setContracts] = useState<Contract[]>([])

  // Thêm nhà thầu
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState(EMPTY_CTR)
  const [addErr, setAddErr] = useState('')
  const [addBusy, setAddBusy] = useState(false)

  // Sửa nhà thầu
  const [editTarget, setEditTarget] = useState<Contractor | null>(null)
  const [editForm, setEditForm] = useState({ ...EMPTY_CTR, status: 'active' })
  const [editErr, setEditErr] = useState('')
  const [editBusy, setEditBusy] = useState(false)

  const load = useCallback(async () => {
    const d = await api<{ contractors: Contractor[] }>('/hse/contractors?q=' + encodeURIComponent(q))
    setContractors(d.contractors)
  }, [q])

  useEffect(() => { load() }, [load])

  const openContractor = async (c: Contractor) => {
    setSelected(c)
    const d = await api<{ contracts: Contract[] }>('/hse/contracts?contractorId=' + c.id)
    setContracts(d.contracts)
  }

  const openEdit = (c: Contractor, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditTarget(c)
    setEditForm({ code: c.code, name: c.name, tax_id: c.tax_id ?? '', phone: c.phone ?? '',
      email: c.email ?? '', rep_name: c.rep_name ?? '', rep_title: c.rep_title ?? '',
      address: c.address ?? '', status: c.status })
    setEditErr('')
  }

  const submitAdd = async () => {
    setAddErr(''); setAddBusy(true)
    try {
      await api('/hse/contractors', { method: 'POST', body: addForm })
      setShowAdd(false); setAddForm(EMPTY_CTR); await load()
    } catch (e) { setAddErr((e as Error).message) } finally { setAddBusy(false) }
  }

  const submitEdit = async () => {
    if (!editTarget) return
    setEditErr(''); setEditBusy(true)
    try {
      await api('/hse/contractors/' + editTarget.id, { method: 'PATCH', body: editForm })
      setEditTarget(null); await load()
    } catch (e) { setEditErr((e as Error).message) } finally { setEditBusy(false) }
  }

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1.3fr]">
      {/* Danh sách nhà thầu */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm nhà thầu…"
            className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm" />
          <button onClick={() => { setShowAdd(true); setAddErr('') }}
            className="shrink-0 rounded bg-vicem-500 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
            + Thêm
          </button>
        </div>
        <ul className="divide-y divide-slate-100">
          {contractors.map((c) => (
            <li key={c.id}
              className={`group flex items-center ${selected?.id === c.id ? 'bg-slate-50' : 'hover:bg-slate-50'}`}>
              <button onClick={() => openContractor(c)}
                className="flex min-w-0 flex-1 items-center justify-between px-2 py-2 text-left text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800">{c.name}</span>
                  <span className="text-xs text-slate-400">{c.code}{c.rep_name ? ` · ${c.rep_name}` : ''}</span>
                </span>
                {c.status !== 'active' && (
                  <span className="ml-1 shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-500">ngừng</span>
                )}
              </button>
              <button onClick={(e) => openEdit(c, e)} title="Sửa nhà thầu"
                className="mr-2 shrink-0 rounded p-1.5 text-slate-300 opacity-0 transition-opacity hover:bg-slate-100 hover:text-vicem-500 group-hover:opacity-100">
                ✏
              </button>
            </li>
          ))}
          {contractors.length === 0 && (
            <li className="py-6 text-center text-sm text-slate-400">Chưa có nhà thầu.</li>
          )}
        </ul>
      </section>

      {/* Panel hợp đồng */}
      <ContractPanel contractor={selected} contracts={contracts}
        onReload={() => selected && openContractor(selected)} />

      {/* Modal Thêm nhà thầu */}
      {showAdd && (
        <ModalWrap onClose={() => setShowAdd(false)} title="Thêm nhà thầu">
          {addErr && <ErrBox msg={addErr} />}
          <CtrFields form={addForm} onChange={setAddForm} showCode />
          <BtnRow onCancel={() => setShowAdd(false)} onSave={submitAdd} busy={addBusy} />
        </ModalWrap>
      )}

      {/* Modal Sửa nhà thầu */}
      {editTarget && (
        <ModalWrap onClose={() => setEditTarget(null)} title={`Sửa — ${editTarget.code}`}>
          {editErr && <ErrBox msg={editErr} />}
          <CtrFields form={editForm} onChange={(f) => setEditForm({ ...f, status: editForm.status })} showCode={false} />
          <div className="mt-2">
            <label className="text-xs text-slate-500">Trạng thái</label>
            <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm">
              <option value="active">Đang hoạt động</option>
              <option value="inactive">Ngừng hoạt động</option>
            </select>
          </div>
          <BtnRow onCancel={() => setEditTarget(null)} onSave={submitEdit} busy={editBusy} label="Cập nhật" />
        </ModalWrap>
      )}
    </div>
  )
}

// ── Shared UI primitives ──────────────────────────────────────────
function ModalWrap({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-lg font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  )
}
function ErrBox({ msg }: { msg: string }) {
  return <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{msg}</p>
}
function BtnRow({ onCancel, onSave, busy, label = 'Lưu' }: {
  onCancel: () => void; onSave: () => void; busy: boolean; label?: string
}) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button onClick={onCancel} className="rounded px-3 py-1.5 text-sm text-slate-500">Hủy</button>
      <button onClick={onSave} disabled={busy}
        className="rounded bg-vicem-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
        {busy ? 'Đang lưu…' : label}
      </button>
    </div>
  )
}
function CtrFields({ form, onChange, showCode }: {
  form: typeof EMPTY_CTR & { status?: string }
  onChange: (f: typeof EMPTY_CTR) => void
  showCode: boolean
}) {
  type K = keyof typeof EMPTY_CTR
  const fields: [K, string][] = [
    ...(showCode ? [['code', 'Mã nhà thầu *'] as [K, string]] : []),
    ['name', 'Tên nhà thầu *'], ['tax_id', 'Mã số thuế'], ['rep_name', 'Người đại diện'],
    ['rep_title', 'Chức vụ đại diện'], ['phone', 'Điện thoại'], ['email', 'Email'], ['address', 'Địa chỉ'],
  ]
  return (
    <div className="space-y-2">
      {fields.map(([k, label]) => (
        <input key={k} placeholder={label} value={form[k] ?? ''}
          onChange={(e) => onChange({ ...form, [k]: e.target.value } as typeof EMPTY_CTR)}
          className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" />
      ))}
    </div>
  )
}

// ── ContractPanel ─────────────────────────────────────────────────
function ContractPanel({ contractor, contracts, onReload }: {
  contractor: Contractor | null; contracts: Contract[]; onReload: () => void
}) {
  const { user } = useAuth()
  const canPickSite = seesAllSites(user) // admin/an-toàn chọn site; officer bị khóa theo site của mình
  const [branches, setBranches] = useState<Branch[]>([])
  useEffect(() => {
    if (canPickSite) api<{ branches: Branch[] }>('/admin/branches').then((d) => setBranches(d.branches)).catch(() => {})
  }, [canPickSite])

  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState(EMPTY_HD)
  const [addErr, setAddErr] = useState('')
  const [addBusy, setAddBusy] = useState(false)

  const [editTarget, setEditTarget] = useState<Contract | null>(null)
  const [editForm, setEditForm] = useState({ title: '', work_location: '', start_date: '', end_date: '', status: 'pending', site_id: '' })
  const [editErr, setEditErr] = useState('')
  const [editBusy, setEditBusy] = useState(false)

  // Upload file HĐ (PDF): dùng input ẩn, bấm icon 📎 để chọn file cho từng hợp đồng.
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploadFor, setUploadFor] = useState<number | null>(null)
  const [uploadBusy, setUploadBusy] = useState<number | null>(null)

  // Xuất báo cáo hồ sơ kiểm soát an toàn (Excel) cho từng hợp đồng.
  const [reportBusy, setReportBusy] = useState<number | null>(null)
  const exportReport = async (c: Contract) => {
    setReportBusy(c.id)
    try {
      await downloadFile(`/hse/contracts/${c.id}/report`, `HoSoATLD_${c.contract_no}.xlsx`)
    } catch (err) { alert((err as Error).message) }
    finally { setReportBusy(null) }
  }

  const pickFile = (contractId: number) => { setUploadFor(contractId); fileRef.current?.click() }
  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = '' // reset để chọn lại cùng file được
    if (!f || uploadFor == null) return
    setUploadBusy(uploadFor)
    try {
      const fd = new FormData()
      fd.append('file', f)
      await api(`/hse/contracts/${uploadFor}/file`, { method: 'POST', body: fd, isForm: true })
      onReload()
    } catch (err) { alert((err as Error).message) }
    finally { setUploadBusy(null); setUploadFor(null) }
  }

  if (!contractor) return (
    <section className="flex items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-sm text-slate-400">
      Chọn nhà thầu để xem hợp đồng.
    </section>
  )

  const openEdit = (c: Contract, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditTarget(c)
    setEditForm({ title: c.title, work_location: c.work_location ?? '',
      start_date: c.start_date?.slice(0, 10) ?? '', end_date: c.end_date?.slice(0, 10) ?? '',
      status: c.status, site_id: c.site_id ? String(c.site_id) : '' })
    setEditErr('')
  }

  const submitAdd = async () => {
    setAddErr(''); setAddBusy(true)
    try {
      const body = { ...addForm, contractor_id: contractor.id,
        site_id: addForm.site_id ? Number(addForm.site_id) : undefined }
      await api('/hse/contracts', { method: 'POST', body })
      setShowAdd(false); setAddForm(EMPTY_HD); onReload()
    } catch (e) { setAddErr((e as Error).message) } finally { setAddBusy(false) }
  }

  const submitEdit = async () => {
    if (!editTarget) return
    setEditErr(''); setEditBusy(true)
    try {
      const body = { ...editForm, site_id: editForm.site_id ? Number(editForm.site_id) : null }
      await api('/hse/contracts/' + editTarget.id, { method: 'PATCH', body })
      setEditTarget(null); onReload()
    } catch (e) { setEditErr((e as Error).message) } finally { setEditBusy(false) }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-800">{contractor.name}</p>
          <p className="text-xs text-slate-400">{contractor.code}{contractor.rep_name ? ` · ${contractor.rep_name}` : ''}</p>
        </div>
        <button onClick={() => { setShowAdd(true); setAddErr('') }}
          className="shrink-0 rounded bg-vicem-500 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
          + Hợp đồng
        </button>
      </div>

      {/* input file ẩn dùng chung cho mọi hàng */}
      <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={onFileChosen} />

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs text-slate-400">
            <th className="py-1.5 text-left">Số HĐ</th>
            <th className="py-1.5 text-left">Tiêu đề</th>
            {canPickSite && <th className="py-1.5 text-left">Site</th>}
            <th className="py-1.5 text-left">Từ</th>
            <th className="py-1.5 text-left">Đến</th>
            <th className="py-1.5 text-left">TT</th>
            <th className="py-1.5 text-left">File</th>
            <th className="py-1.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {contracts.map((c) => (
            <tr key={c.id} className="group hover:bg-slate-50">
              <td className="py-2 font-mono text-xs text-slate-600">{c.contract_no}</td>
              <td className="py-2 text-slate-700">{c.title}</td>
              {canPickSite && <td className="py-2 text-xs text-slate-500">{c.site_name ?? '—'}</td>}
              <td className="py-2 text-xs text-slate-500">{fmtDate(c.start_date)}</td>
              <td className="py-2 text-xs text-slate-500">{fmtDate(c.end_date)}</td>
              <td className="py-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CT_STATUS_COLOR[c.status] ?? 'bg-slate-100 text-slate-600'}`}>
                  {CT_STATUS_LABEL[c.status] ?? c.status}
                </span>
              </td>
              <td className="py-2 text-xs">
                {uploadBusy === c.id ? (
                  <span className="text-slate-400">Đang tải…</span>
                ) : c.contract_file_name ? (
                  <div className="flex items-center gap-1">
                    <button onClick={() => openFileInNewTab(`/hse/contracts/${c.id}/file`).catch((e) => alert((e as Error).message))}
                      title={`Xem ${c.contract_file_name}`}
                      className="max-w-[110px] truncate text-vicem-500 hover:underline">📄 Xem</button>
                    <button onClick={() => pickFile(c.id)} title="Thay file khác"
                      className="rounded p-0.5 text-slate-300 hover:text-vicem-500">🔁</button>
                  </div>
                ) : (
                  <button onClick={() => pickFile(c.id)} title="Đính kèm file hợp đồng"
                    className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-vicem-500">📎 Tải lên</button>
                )}
              </td>
              <td className="py-2 pr-1 text-right whitespace-nowrap">
                <button onClick={() => exportReport(c)} disabled={reportBusy === c.id}
                  title="Xuất báo cáo hồ sơ kiểm soát an toàn (Excel)"
                  className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-green-600 disabled:opacity-50">
                  {reportBusy === c.id ? '⏳' : '📊'}
                </button>
                <button onClick={(e) => openEdit(c, e)} title="Sửa hợp đồng"
                  className="rounded p-1.5 text-slate-300 opacity-0 hover:bg-slate-100 hover:text-vicem-500 group-hover:opacity-100">
                  ✏
                </button>
              </td>
            </tr>
          ))}
          {contracts.length === 0 && (
            <tr><td colSpan={canPickSite ? 8 : 7} className="py-6 text-center text-slate-400">Chưa có hợp đồng.</td></tr>
          )}
        </tbody>
      </table>

      {/* Modal Thêm HĐ */}
      {showAdd && (
        <ModalWrap onClose={() => setShowAdd(false)} title={`Thêm hợp đồng — ${contractor.name}`}>
          {addErr && <ErrBox msg={addErr} />}
          <HDFields form={addForm} onChange={setAddForm} showNo branches={branches} canPickSite={canPickSite} />
          <BtnRow onCancel={() => setShowAdd(false)} onSave={submitAdd} busy={addBusy} />
        </ModalWrap>
      )}

      {/* Modal Sửa HĐ */}
      {editTarget && (
        <ModalWrap onClose={() => setEditTarget(null)} title={`Sửa HĐ ${editTarget.contract_no}`}>
          {editErr && <ErrBox msg={editErr} />}
          <HDFields
            form={{ contract_no: editTarget.contract_no, title: editForm.title,
              work_location: editForm.work_location, start_date: editForm.start_date,
              end_date: editForm.end_date, site_id: editForm.site_id }}
            onChange={(f) => setEditForm({ ...editForm, title: f.title,
              work_location: f.work_location, start_date: f.start_date,
              end_date: f.end_date, site_id: f.site_id })}
            showNo={false} branches={branches} canPickSite={canPickSite}
          />
          <div className="mt-2">
            <label className="text-xs text-slate-500">Trạng thái</label>
            <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm">
              {Object.entries(CT_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <BtnRow onCancel={() => setEditTarget(null)} onSave={submitEdit} busy={editBusy} label="Cập nhật" />
        </ModalWrap>
      )}
    </section>
  )
}

// Contract form fields
function HDFields({ form, onChange, showNo, branches = [], canPickSite = false }: {
  form: typeof EMPTY_HD; onChange: (f: typeof EMPTY_HD) => void; showNo: boolean
  branches?: Branch[]; canPickSite?: boolean
}) {
  return (
    <div className="space-y-2">
      {showNo && (
        <input placeholder="Số hợp đồng *" value={form.contract_no}
          onChange={(e) => onChange({ ...form, contract_no: e.target.value })}
          className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" />
      )}
      <input placeholder="Tiêu đề *" value={form.title}
        onChange={(e) => onChange({ ...form, title: e.target.value })}
        className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" />
      <input placeholder="Địa điểm thi công" value={form.work_location}
        onChange={(e) => onChange({ ...form, work_location: e.target.value })}
        className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-slate-500">Ngày bắt đầu *</label>
          <input type="date" value={form.start_date}
            onChange={(e) => onChange({ ...form, start_date: e.target.value })}
            className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="text-xs text-slate-500">Ngày kết thúc *</label>
          <input type="date" value={form.end_date}
            onChange={(e) => onChange({ ...form, end_date: e.target.value })}
            className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
      </div>
      {canPickSite && branches.length > 0 && (
        <div>
          <label className="text-xs text-slate-500">Chi nhánh / site</label>
          <select value={form.site_id} onChange={(e) => onChange({ ...form, site_id: e.target.value })}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm">
            <option value="">— Chọn site —</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}
