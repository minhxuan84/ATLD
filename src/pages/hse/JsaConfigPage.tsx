// Cấu hình danh mục công việc JSA (Job Safety Analysis) — Pha 1
import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'

interface WorkType {
  id: number
  code: string
  name: string
  description: string
  risk_level: string
  requires_permit: boolean
  is_active: boolean
  sort_order: number
}

interface PPEItem {
  id: number
  code: string
  name: string
  is_active: boolean
  sort_order: number
}

interface DocType {
  id: number
  code: string
  name: string
  scope: string
  is_mandatory: boolean
}

interface Course {
  id: string
  title: string
  pass_score: number
}

interface ChecklistItem {
  id?: number
  item_code: string
  category: string
  item_name: string
  requires_photo: boolean
  sort_order: number
}

interface Requirements {
  ppe: PPEItem[]
  docTypes: DocType[]
  courses: Course[]
  checklist: ChecklistItem[]
}

// Server chạy escapeText() trên mọi text nhận vào, nên '&' về DB thành '&amp;'.
// Checklist lưu bằng cách POST lại TOÀN BỘ danh sách, vì vậy nếu nạp nguyên văn
// rồi gửi lại thì mỗi lần sửa một mục sẽ escape thêm một lượt cho mọi mục
// ('&' → '&amp;' → '&amp;amp;'). Giải mã lúc nạp để vòng sửa–lưu bất biến.
function unescapeText(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')  // giải mã & sau cùng, tránh biến '&amp;lt;' thành '<'
}

const RISK_LABEL: Record<string, string> = { low: 'Thấp', medium: 'Trung bình', high: 'Cao' }
const SCOPE_LABEL: Record<string, string> = {
  contractor: 'Nhà thầu', worker: 'Người lao động', equipment: 'Thiết bị',
}

const EMPTY_WT = {
  code: '', name: '', description: '', risk_level: 'medium',
  requires_permit: true, sort_order: 0,
}
const EMPTY_PPE = { code: '', name: '', sort_order: 0 }

// Ba nhóm gán dùng chung một hộp thoại chọn nhiều — chỉ khác nguồn dữ liệu,
// khóa của mảng gửi lên và nhãn hiển thị.
type AssignKind = 'ppe' | 'docs' | 'courses'
const ASSIGN_META: Record<AssignKind, { title: string; noun: string; path: string; bodyKey: string }> = {
  ppe: { title: 'Gán thiết bị bảo hộ (PPE)', noun: 'thiết bị bảo hộ', path: 'ppe', bodyKey: 'ppe_ids' },
  docs: { title: 'Gán hồ sơ yêu cầu', noun: 'hồ sơ yêu cầu', path: 'docs', bodyKey: 'doc_type_ids' },
  courses: { title: 'Gán khóa học yêu cầu', noun: 'khóa học yêu cầu', path: 'courses', bodyKey: 'course_ids' },
}

export default function JsaConfigPage() {
  const [workTypes, setWorkTypes] = useState<WorkType[]>([])
  const [ppeItems, setPpeItems] = useState<PPEItem[]>([])
  const [docTypes, setDocTypes] = useState<DocType[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedWorkType, setSelectedWorkType] = useState<number | null>(null)
  const [requirements, setRequirements] = useState<Requirements | null>(null)

  const [wtForm, setWtForm] = useState<{ open: boolean; editId: number | null; data: typeof EMPTY_WT }>(
    { open: false, editId: null, data: { ...EMPTY_WT } },
  )
  const [ppeForm, setPpeForm] = useState<{ open: boolean; editId: number | null; data: typeof EMPTY_PPE }>(
    { open: false, editId: null, data: { ...EMPTY_PPE } },
  )
  // Lựa chọn giữ dạng string cho cả ba nhóm vì course_id là VARCHAR, PPE/hồ sơ là số.
  const [assign, setAssign] = useState<{ kind: AssignKind; selected: string[] } | null>(null)
  const [clEdit, setClEdit] = useState<ChecklistItem[] | null>(null)

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  // Giải mã ngay khi nạp — xem unescapeText ở đầu file. Làm ở đây một lần thì
  // cả phần hiển thị và các ô nhập đều đúng, không phải rải lời gọi khắp JSX.
  const loadWorkTypes = useCallback(async () => {
    const d = await api<{ workTypes: WorkType[] }>('/jsa/work-types?all=1')
    setWorkTypes(d.workTypes.map((w) => ({
      ...w, name: unescapeText(w.name), description: unescapeText(w.description ?? ''),
    })))
  }, [])
  const loadPPE = useCallback(async () => {
    const d = await api<{ ppeItems: PPEItem[] }>('/jsa/ppe-items?all=1')
    setPpeItems(d.ppeItems.map((p) => ({ ...p, name: unescapeText(p.name) })))
  }, [])

  useEffect(() => {
    // Danh mục hồ sơ và khóa học chỉ để chọn khi gán — nạp một lần cùng trang.
    void (async () => {
      try {
        const [dt, cs] = await Promise.all([
          api<{ docTypes: DocType[] }>('/hse/doc-types'),
          api<{ courses: Course[] }>('/courses'),
        ])
        setDocTypes(dt.docTypes.map((d) => ({ ...d, name: unescapeText(d.name) })))
        setCourses(cs.courses.map((c) => ({ ...c, title: unescapeText(c.title) })))
      } catch (e) {
        setErr((e as Error).message)
      }
    })()
    void loadWorkTypes()
    void loadPPE()
  }, [loadWorkTypes, loadPPE])

  const loadRequirements = useCallback(async (workTypeId: number) => {
    const d = await api<Requirements>(`/jsa/work-types/${workTypeId}/requirements`)
    setRequirements({
      ppe: d.ppe.map((p) => ({ ...p, name: unescapeText(p.name) })),
      docTypes: d.docTypes.map((x) => ({ ...x, name: unescapeText(x.name) })),
      courses: d.courses.map((c) => ({ ...c, title: unescapeText(c.title) })),
      checklist: d.checklist.map((c) => ({
        ...c,
        item_code: unescapeText(c.item_code ?? ''),
        category: unescapeText(c.category ?? ''),
        item_name: unescapeText(c.item_name ?? ''),
      })),
    })
  }, [])

  const handleSelectWorkType = (id: number) => {
    setSelectedWorkType(id)
    void loadRequirements(id)
    setErr('')
    setMsg('')
  }

  // ── Loại công việc ────────────────────────────────────────────────────────
  const openWtNew = () => {
    setWtForm({ open: true, editId: null, data: { ...EMPTY_WT } })
    setErr('')
  }
  const openWtEdit = (wt: WorkType) => {
    setWtForm({
      open: true,
      editId: wt.id,
      data: {
        code: wt.code, name: wt.name, description: wt.description ?? '',
        risk_level: wt.risk_level, requires_permit: wt.requires_permit, sort_order: wt.sort_order,
      },
    })
    setErr('')
  }

  const submitWorkType = async () => {
    const d = wtForm.data
    if (!d.code.trim() || !d.name.trim()) return setErr('Thiếu mã hoặc tên công việc.')
    setBusy(true)
    setErr('')
    try {
      if (wtForm.editId) {
        // Mã là khóa duy nhất và được dùng để nạp checklist — không cho sửa.
        await api(`/jsa/work-types/${wtForm.editId}`, {
          method: 'PATCH',
          body: {
            name: d.name.trim(), description: d.description.trim(), risk_level: d.risk_level,
            requires_permit: d.requires_permit, sort_order: Number(d.sort_order) || 0,
          },
        })
        setMsg('Đã cập nhật loại công việc.')
      } else {
        await api('/jsa/work-types', {
          method: 'POST',
          body: { ...d, code: d.code.trim().toUpperCase(), name: d.name.trim(), sort_order: Number(d.sort_order) || 0 },
        })
        setMsg('Đã tạo loại công việc.')
      }
      setWtForm({ open: false, editId: null, data: { ...EMPTY_WT } })
      await loadWorkTypes()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleToggleWorkType = async (id: number, isActive: boolean) => {
    try {
      await api(`/jsa/work-types/${id}`, { method: 'PATCH', body: { is_active: !isActive } })
      setMsg(isActive ? 'Đã vô hiệu hóa.' : 'Đã kích hoạt.')
      await loadWorkTypes()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  // ── PPE ───────────────────────────────────────────────────────────────────
  const submitPPE = async () => {
    const d = ppeForm.data
    if (!d.code.trim() || !d.name.trim()) return setErr('Thiếu mã hoặc tên PPE.')
    setBusy(true)
    setErr('')
    try {
      if (ppeForm.editId) {
        await api(`/jsa/ppe-items/${ppeForm.editId}`, {
          method: 'PATCH',
          body: { name: d.name.trim(), sort_order: Number(d.sort_order) || 0 },
        })
        setMsg('Đã cập nhật thiết bị bảo hộ.')
      } else {
        await api('/jsa/ppe-items', {
          method: 'POST',
          body: { code: d.code.trim().toUpperCase(), name: d.name.trim(), sort_order: Number(d.sort_order) || 0 },
        })
        setMsg('Đã tạo thiết bị bảo hộ.')
      }
      setPpeForm({ open: false, editId: null, data: { ...EMPTY_PPE } })
      await loadPPE()
      // PPE đổi tên thì cột yêu cầu đang mở cũng phải đổi theo.
      if (selectedWorkType) await loadRequirements(selectedWorkType)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleTogglePPE = async (id: number, isActive: boolean) => {
    try {
      await api(`/jsa/ppe-items/${id}`, { method: 'PATCH', body: { is_active: !isActive } })
      setMsg(isActive ? 'Đã vô hiệu hóa.' : 'Đã kích hoạt.')
      await loadPPE()
      if (selectedWorkType) await loadRequirements(selectedWorkType)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  // ── Gán PPE / hồ sơ / khóa học ────────────────────────────────────────────
  const openAssign = (kind: AssignKind) => {
    if (!requirements) return
    const selected =
      kind === 'ppe' ? requirements.ppe.map((p) => String(p.id))
        : kind === 'docs' ? requirements.docTypes.map((d) => String(d.id))
          : requirements.courses.map((c) => c.id)
    setAssign({ kind, selected })
    setErr('')
  }

  const toggleAssign = (value: string) => {
    setAssign((a) => {
      if (!a) return a
      const has = a.selected.includes(value)
      return { ...a, selected: has ? a.selected.filter((v) => v !== value) : [...a.selected, value] }
    })
  }

  const submitAssign = async () => {
    if (!assign || !selectedWorkType) return
    const meta = ASSIGN_META[assign.kind]
    // Server đợi số cho PPE/hồ sơ, chuỗi cho khóa học.
    const values = assign.kind === 'courses' ? assign.selected : assign.selected.map(Number)
    setBusy(true)
    setErr('')
    try {
      await api(`/jsa/work-types/${selectedWorkType}/${meta.path}`, {
        method: 'POST',
        body: { [meta.bodyKey]: values },
      })
      setMsg(`Đã lưu ${meta.noun} cho ${selectedName}.`)
      setAssign(null)
      await loadRequirements(selectedWorkType)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // ── Checklist ─────────────────────────────────────────────────────────────
  const openChecklist = () => {
    if (!requirements) return
    // requirements đã được giải mã trong loadRequirements.
    setClEdit(requirements.checklist.map((c) => ({ ...c })))
    setErr('')
  }

  const patchClRow = (i: number, patch: Partial<ChecklistItem>) => {
    setClEdit((rows) => rows?.map((r, j) => (j === i ? { ...r, ...patch } : r)) ?? rows)
  }
  const addClRow = () => {
    setClEdit((rows) => [
      ...(rows ?? []),
      { item_code: '', category: '', item_name: '', requires_photo: false, sort_order: (rows?.length ?? 0) + 1 },
    ])
  }
  const removeClRow = (i: number) => {
    setClEdit((rows) => rows?.filter((_, j) => j !== i) ?? rows)
  }
  const moveClRow = (i: number, dir: -1 | 1) => {
    setClEdit((rows) => {
      if (!rows) return rows
      const j = i + dir
      if (j < 0 || j >= rows.length) return rows
      const next = [...rows]
      const a = next[i]
      const b = next[j]
      if (!a || !b) return rows
      next[i] = b
      next[j] = a
      return next
    })
  }

  const submitChecklist = async () => {
    if (!clEdit || !selectedWorkType) return
    if (clEdit.some((r) => !r.item_name.trim())) return setErr('Mọi mục checklist phải có tên.')
    setBusy(true)
    setErr('')
    try {
      // POST thay toàn bộ danh sách; sort_order đánh lại theo thứ tự đang hiển thị.
      await api(`/jsa/work-types/${selectedWorkType}/checklist`, {
        method: 'POST',
        body: {
          items: clEdit.map((r, i) => ({
            item_code: r.item_code.trim(),
            category: r.category.trim(),
            item_name: r.item_name.trim(),
            requires_photo: r.requires_photo,
            sort_order: i + 1,
          })),
        },
      })
      setMsg('Đã lưu checklist.')
      setClEdit(null)
      await loadRequirements(selectedWorkType)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const selectedName = workTypes.find((w) => w.id === selectedWorkType)?.name ?? ''

  // Nút "Sửa" ở đầu mỗi nhóm yêu cầu — dùng lại cho cả 4 nhóm.
  const groupHeader = (label: string, count: number, onEdit: () => void) => (
    <div className="flex items-center justify-between">
      <div className="text-sm font-medium text-slate-600">{label} ({count})</div>
      <button onClick={onEdit} className="rounded px-2 py-0.5 text-xs text-vicem-500 hover:bg-slate-100">Sửa</button>
    </div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-800">Danh mục công việc JSA</h2>
        <p className="text-sm text-slate-500">
          Cấu hình loại công việc, PPE bắt buộc, hồ sơ và checklist kiểm tra.
        </p>
      </div>

      {err && <div className="rounded bg-red-50 p-3 text-sm text-red-700">{err}</div>}
      {msg && <div className="rounded bg-green-50 p-3 text-sm text-green-700">{msg}</div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Cột 1: Loại công việc */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-slate-700">Loại công việc</h3>
            <button onClick={openWtNew} className="rounded bg-vicem-500 px-3 py-1 text-sm text-white hover:bg-vicem-600">
              + Thêm
            </button>
          </div>

          <div className="space-y-2">
            {workTypes.map((wt) => (
              <div
                key={wt.id}
                onClick={() => handleSelectWorkType(wt.id)}
                className={`cursor-pointer rounded border p-3 text-sm transition ${
                  selectedWorkType === wt.id
                    ? 'border-vicem-500 bg-vicem-50'
                    : 'border-slate-200 hover:border-slate-300'
                } ${!wt.is_active ? 'opacity-50' : ''}`}
              >
                <div className="font-medium text-slate-800">{wt.name}</div>
                <div className="text-xs text-slate-500">{wt.code}</div>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span className={`rounded px-2 py-0.5 ${wt.risk_level === 'high' ? 'bg-red-100 text-red-700' : wt.risk_level === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                    {RISK_LABEL[wt.risk_level] ?? wt.risk_level}
                  </span>
                  {!wt.requires_permit && <span className="text-slate-400">không cần phép</span>}
                  <button
                    onClick={(e) => { e.stopPropagation(); openWtEdit(wt) }}
                    className="ml-auto text-vicem-500 hover:underline"
                  >
                    Sửa
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); void handleToggleWorkType(wt.id, wt.is_active) }}
                    className="text-slate-500 hover:text-slate-700"
                  >
                    {wt.is_active ? 'Vô hiệu' : 'Kích hoạt'}
                  </button>
                </div>
              </div>
            ))}
            {workTypes.length === 0 && (
              <div className="py-6 text-center text-sm text-slate-400">Chưa có loại công việc.</div>
            )}
          </div>
        </div>

        {/* Cột 2: PPE */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-slate-700">Thiết bị bảo hộ (PPE)</h3>
            <button
              onClick={() => { setPpeForm({ open: true, editId: null, data: { ...EMPTY_PPE } }); setErr('') }}
              className="rounded bg-vicem-500 px-3 py-1 text-sm text-white hover:bg-vicem-600"
            >
              + Thêm
            </button>
          </div>

          <div className="space-y-2">
            {ppeItems.map((ppe) => (
              <div key={ppe.id} className={`rounded border border-slate-200 p-3 text-sm ${!ppe.is_active ? 'opacity-50' : ''}`}>
                <div className="font-medium text-slate-800">{ppe.name}</div>
                <div className="text-xs text-slate-500">{ppe.code}</div>
                <div className="mt-1 flex items-center gap-3 text-xs">
                  <button
                    onClick={() => { setPpeForm({ open: true, editId: ppe.id, data: { code: ppe.code, name: ppe.name, sort_order: ppe.sort_order } }); setErr('') }}
                    className="text-vicem-500 hover:underline"
                  >
                    Sửa
                  </button>
                  <button onClick={() => void handleTogglePPE(ppe.id, ppe.is_active)} className="text-slate-500 hover:text-slate-700">
                    {ppe.is_active ? 'Vô hiệu' : 'Kích hoạt'}
                  </button>
                </div>
              </div>
            ))}
            {ppeItems.length === 0 && (
              <div className="py-6 text-center text-sm text-slate-400">Chưa có thiết bị bảo hộ.</div>
            )}
          </div>
        </div>

        {/* Cột 3: Yêu cầu cho loại công việc đã chọn */}
        <div className="space-y-4">
          {selectedWorkType && requirements ? (
            <>
              <h3 className="font-medium text-slate-700">Yêu cầu cho: {selectedName}</h3>
              <div className="space-y-4">
                <div>
                  {groupHeader('PPE bắt buộc', requirements.ppe.length, () => openAssign('ppe'))}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {requirements.ppe.map((p) => (
                      <span key={p.id} className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-700">{p.name}</span>
                    ))}
                    {requirements.ppe.length === 0 && <span className="text-xs text-slate-400">Chưa gán.</span>}
                  </div>
                </div>

                <div>
                  {groupHeader('Hồ sơ yêu cầu', requirements.docTypes.length, () => openAssign('docs'))}
                  <div className="mt-2 space-y-1">
                    {requirements.docTypes.map((dt) => (
                      <div key={dt.id} className="text-xs text-slate-600">
                        • {dt.name} <span className="text-slate-400">({SCOPE_LABEL[dt.scope] ?? dt.scope})</span>
                      </div>
                    ))}
                    {requirements.docTypes.length === 0 && <div className="text-xs text-slate-400">Chưa gán.</div>}
                  </div>
                </div>

                <div>
                  {groupHeader('Khóa học yêu cầu', requirements.courses.length, () => openAssign('courses'))}
                  <div className="mt-2 space-y-1">
                    {requirements.courses.map((c) => (
                      <div key={c.id} className="text-xs text-slate-600">
                        • {c.title} <span className="text-slate-400">(Đạt: {c.pass_score}%)</span>
                      </div>
                    ))}
                    {requirements.courses.length === 0 && <div className="text-xs text-slate-400">Chưa gán.</div>}
                  </div>
                </div>

                <div>
                  {groupHeader('Checklist kiểm tra', requirements.checklist.length, openChecklist)}
                  <div className="mt-2 space-y-1">
                    {requirements.checklist.map((cl, i) => (
                      <div key={cl.id ?? i} className="text-xs text-slate-600">
                        • {cl.item_code ? `[${cl.item_code}] ` : ''}{cl.item_name}
                        {cl.requires_photo && <span className="ml-1 text-amber-600">(cần ảnh)</span>}
                      </div>
                    ))}
                    {requirements.checklist.length === 0 && <div className="text-xs text-slate-400">Chưa có mục nào.</div>}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="py-10 text-center text-sm text-slate-400">
              Chọn một loại công việc bên trái để xem và sửa yêu cầu
            </div>
          )}
        </div>
      </div>

      {/* Hộp thoại loại công việc */}
      {wtForm.open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setWtForm({ ...wtForm, open: false })}>
          <div className="w-full max-w-lg rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold">{wtForm.editId ? 'Sửa loại công việc' : 'Thêm loại công việc'}</h3>
            {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
            <div className="space-y-2">
              <input
                placeholder="Mã (VD: HOT_WORK) *" value={wtForm.data.code} disabled={!!wtForm.editId}
                onChange={(e) => setWtForm({ ...wtForm, data: { ...wtForm.data, code: e.target.value } })}
                className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-100"
              />
              <input
                placeholder="Tên công việc *" value={wtForm.data.name}
                onChange={(e) => setWtForm({ ...wtForm, data: { ...wtForm.data, name: e.target.value } })}
                className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
              />
              <textarea
                placeholder="Mô tả" rows={2} value={wtForm.data.description}
                onChange={(e) => setWtForm({ ...wtForm, data: { ...wtForm.data, description: e.target.value } })}
                className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-500">Mức rủi ro</label>
                  <select
                    value={wtForm.data.risk_level}
                    onChange={(e) => setWtForm({ ...wtForm, data: { ...wtForm.data, risk_level: e.target.value } })}
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    <option value="low">Thấp</option>
                    <option value="medium">Trung bình</option>
                    <option value="high">Cao</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500">Thứ tự</label>
                  <input
                    type="number" value={wtForm.data.sort_order}
                    onChange={(e) => setWtForm({ ...wtForm, data: { ...wtForm.data, sort_order: Number(e.target.value) } })}
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox" checked={wtForm.data.requires_permit}
                  onChange={(e) => setWtForm({ ...wtForm, data: { ...wtForm.data, requires_permit: e.target.checked } })}
                />
                Yêu cầu giấy phép làm việc
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setWtForm({ ...wtForm, open: false })} className="rounded px-3 py-1.5 text-sm text-slate-500">Hủy</button>
              <button
                onClick={submitWorkType} disabled={busy || !wtForm.data.code.trim() || !wtForm.data.name.trim()}
                className="rounded bg-vicem-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? 'Đang lưu…' : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hộp thoại PPE */}
      {ppeForm.open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setPpeForm({ ...ppeForm, open: false })}>
          <div className="w-full max-w-sm rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold">{ppeForm.editId ? 'Sửa thiết bị bảo hộ' : 'Thêm thiết bị bảo hộ'}</h3>
            {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
            <div className="space-y-2">
              <input
                placeholder="Mã (VD: HELMET) *" value={ppeForm.data.code} disabled={!!ppeForm.editId}
                onChange={(e) => setPpeForm({ ...ppeForm, data: { ...ppeForm.data, code: e.target.value } })}
                className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-100"
              />
              <input
                placeholder="Tên PPE *" value={ppeForm.data.name}
                onChange={(e) => setPpeForm({ ...ppeForm, data: { ...ppeForm.data, name: e.target.value } })}
                className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
              />
              <div>
                <label className="text-xs text-slate-500">Thứ tự</label>
                <input
                  type="number" value={ppeForm.data.sort_order}
                  onChange={(e) => setPpeForm({ ...ppeForm, data: { ...ppeForm.data, sort_order: Number(e.target.value) } })}
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setPpeForm({ ...ppeForm, open: false })} className="rounded px-3 py-1.5 text-sm text-slate-500">Hủy</button>
              <button
                onClick={submitPPE} disabled={busy || !ppeForm.data.code.trim() || !ppeForm.data.name.trim()}
                className="rounded bg-vicem-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? 'Đang lưu…' : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hộp thoại gán PPE / hồ sơ / khóa học */}
      {assign && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setAssign(null)}>
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-lg font-semibold">{ASSIGN_META[assign.kind].title}</h3>
            <p className="mb-3 text-xs text-slate-500">{selectedName} — đã chọn {assign.selected.length}</p>
            {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}

            <div className="flex-1 space-y-1 overflow-y-auto rounded border border-slate-200 p-2">
              {assign.kind === 'ppe' && ppeItems.filter((p) => p.is_active).map((p) => (
                <label key={p.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={assign.selected.includes(String(p.id))} onChange={() => toggleAssign(String(p.id))} />
                  <span className="text-slate-700">{p.name}</span>
                  <span className="text-xs text-slate-400">{p.code}</span>
                </label>
              ))}
              {assign.kind === 'docs' && docTypes.map((dt) => (
                <label key={dt.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={assign.selected.includes(String(dt.id))} onChange={() => toggleAssign(String(dt.id))} />
                  <span className="text-slate-700">{dt.name}</span>
                  <span className="text-xs text-slate-400">{SCOPE_LABEL[dt.scope] ?? dt.scope}</span>
                </label>
              ))}
              {assign.kind === 'courses' && courses.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={assign.selected.includes(c.id)} onChange={() => toggleAssign(c.id)} />
                  <span className="text-slate-700">{c.title}</span>
                </label>
              ))}
              {((assign.kind === 'ppe' && ppeItems.filter((p) => p.is_active).length === 0)
                || (assign.kind === 'docs' && docTypes.length === 0)
                || (assign.kind === 'courses' && courses.length === 0)) && (
                <p className="py-4 text-center text-sm text-slate-400">Chưa có mục nào để chọn.</p>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setAssign(null)} className="rounded px-3 py-1.5 text-sm text-slate-500">Hủy</button>
              <button onClick={submitAssign} disabled={busy}
                className="rounded bg-vicem-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                {busy ? 'Đang lưu…' : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hộp thoại checklist */}
      {clEdit && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setClEdit(null)}>
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-lg font-semibold">Checklist kiểm tra</h3>
            <p className="mb-3 text-xs text-slate-500">
              {selectedName} — lưu sẽ thay toàn bộ danh sách. Mục đánh “cần ảnh” sẽ bắt buộc chụp minh chứng khi kiểm tra.
            </p>
            {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                    <th className="px-2 py-2 text-left">Mã</th>
                    <th className="px-2 py-2 text-left">Nhóm</th>
                    <th className="px-2 py-2 text-left">Nội dung kiểm tra *</th>
                    <th className="px-2 py-2 text-center">Cần ảnh</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {clEdit.map((r, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1">
                        <input value={r.item_code} onChange={(e) => patchClRow(i, { item_code: e.target.value })}
                          className="w-24 rounded border border-slate-300 px-2 py-1 text-xs" />
                      </td>
                      <td className="px-2 py-1">
                        <input value={r.category} onChange={(e) => patchClRow(i, { category: e.target.value })}
                          className="w-28 rounded border border-slate-300 px-2 py-1 text-xs" />
                      </td>
                      <td className="px-2 py-1">
                        <input value={r.item_name} onChange={(e) => patchClRow(i, { item_name: e.target.value })}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs" />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <input type="checkbox" checked={r.requires_photo}
                          onChange={(e) => patchClRow(i, { requires_photo: e.target.checked })} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-right text-xs">
                        <button onClick={() => moveClRow(i, -1)} disabled={i === 0}
                          className="px-1 text-slate-500 hover:text-slate-700 disabled:opacity-30" title="Lên">↑</button>
                        <button onClick={() => moveClRow(i, 1)} disabled={i === clEdit.length - 1}
                          className="px-1 text-slate-500 hover:text-slate-700 disabled:opacity-30" title="Xuống">↓</button>
                        <button onClick={() => removeClRow(i)} className="px-1 text-rose-500 hover:underline">Xóa</button>
                      </td>
                    </tr>
                  ))}
                  {clEdit.length === 0 && (
                    <tr><td colSpan={5} className="py-6 text-center text-slate-400">Chưa có mục nào.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <button onClick={addClRow} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                + Thêm mục
              </button>
              <div className="flex gap-2">
                <button onClick={() => setClEdit(null)} className="rounded px-3 py-1.5 text-sm text-slate-500">Hủy</button>
                <button onClick={submitChecklist} disabled={busy}
                  className="rounded bg-vicem-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                  {busy ? 'Đang lưu…' : 'Lưu checklist'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
