import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { Plus, Trash2, Pencil, Check, X, GripVertical } from 'lucide-react'

type FieldType = 'text' | 'select' | 'image'
type FieldPurpose = 'none' | 'full_name' | 'id_number' | 'photo'

interface QuizField {
  id: number
  field_key: string
  label: string
  type: FieldType
  options: string[]
  required: boolean
  purpose: FieldPurpose
}

const TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Nhập tự do (text)' },
  { value: 'select', label: 'Danh sách chọn (select)' },
  { value: 'image', label: 'Tải ảnh lên (image)' },
]

// Vai trò quyết định trường nào được dùng ở đâu trong hồ sơ đào tạo. Mỗi vai trò chỉ
// gắn được cho đúng một trường; server trả 409 nếu gắn trùng.
const PURPOSES: { value: FieldPurpose; label: string; hint: string; needType?: FieldType }[] = [
  { value: 'none', label: '— Không —', hint: 'Chỉ lưu vào bài làm, không dùng ở chỗ nào khác.' },
  { value: 'full_name', label: 'Họ và tên trên chứng nhận', hint: 'Tên in trên chứng nhận lấy từ trường này, không lấy tên tài khoản đăng nhập.' },
  { value: 'id_number', label: 'Số CCCD', hint: 'Dùng để đếm số lần thi của học viên vào bằng QR. Không có trường này thì giới hạn số lần thi tính theo link QR, không theo từng người.' },
  { value: 'photo', label: 'Ảnh học viên', hint: 'Ảnh in bên trái chứng nhận, dấu PASSED đóng chồng lên. Phải là trường loại "Tải ảnh lên".', needType: 'image' },
]

const PURPOSE_LABEL = Object.fromEntries(PURPOSES.map((p) => [p.value, p.label])) as Record<FieldPurpose, string>

const EMPTY = {
  field_key: '', label: '', type: 'text' as FieldType, optionsText: '',
  required: true, purpose: 'none' as FieldPurpose,
}

/** Giải thích vai trò đang chọn dùng để làm gì — tên vai trò một mình không đủ rõ. */
function PurposeHint({ purpose }: { purpose: FieldPurpose }) {
  if (purpose === 'none') return null
  const hint = PURPOSES.find((p) => p.value === purpose)?.hint
  return hint ? <p className="text-xs text-slate-500">{hint}</p> : null
}

export default function QuizFieldsManager() {
  const [fields, setFields] = useState<QuizField[]>([])
  const [adding, setAdding] = useState({ ...EMPTY })
  const [editId, setEditId] = useState<number | null>(null)
  const [draft, setDraft] = useState({ ...EMPTY })
  const [error, setError] = useState('')

  const fetchAll = useCallback(() => {
    api<{ fields: QuizField[] }>('/admin/quiz-fields').then((d) => setFields(d.fields)).catch(() => {})
  }, [])
  useEffect(fetchAll, [fetchAll])

  const toBody = (f: typeof EMPTY) => ({
    field_key: f.field_key,
    label: f.label,
    type: f.type,
    required: f.required,
    purpose: f.purpose,
    options: f.type === 'select' ? f.optionsText.split('\n').map((s) => s.trim()).filter(Boolean) : [],
  })

  // Đổi loại trường có thể làm vai trò đang chọn không còn hợp lệ (vd: vai trò "Ảnh học
  // viên" chỉ gắn được cho trường ảnh). Gỡ vai trò ngay tại đây thay vì để server trả
  // 400 sau khi người dùng đã bấm Lưu.
  const changeType = (f: typeof EMPTY, type: FieldType): typeof EMPTY => {
    const need = PURPOSES.find((p) => p.value === f.purpose)?.needType
    return { ...f, type, purpose: need && need !== type ? 'none' : f.purpose }
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await api('/admin/quiz-fields', { method: 'POST', body: toBody(adding) })
      setAdding({ ...EMPTY })
      fetchAll()
    } catch (err) { setError(err instanceof Error ? err.message : 'Thêm thất bại.') }
  }

  const startEdit = (f: QuizField) => {
    setEditId(f.id)
    setDraft({
      field_key: f.field_key, label: f.label, type: f.type,
      optionsText: f.options.join('\n'), required: f.required, purpose: f.purpose ?? 'none',
    })
  }
  const saveEdit = async (id: number) => {
    setError('')
    try {
      await api(`/admin/quiz-fields/${id}`, { method: 'PUT', body: toBody(draft) })
      setEditId(null)
      fetchAll()
    } catch (err) { setError(err instanceof Error ? err.message : 'Lưu thất bại.') }
  }
  const remove = async (id: number) => {
    if (!confirm('Xóa trường này?')) return
    await api(`/admin/quiz-fields/${id}`, { method: 'DELETE' })
    fetchAll()
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Trường thông tin trắc nghiệm</h1>
      <p className="mt-1 text-slate-500">Các trường học viên phải khai báo trước khi làm bài (Họ tên, Số CCCD, Nhóm...). Áp dụng cho mọi khóa học.</p>

      <div className="mt-5 space-y-2">
        {fields.map((f) => (
          <div key={f.id} className="rounded-xl border border-slate-200 bg-white p-3">
            {editId === f.id ? (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-3">
                  <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Nhãn hiển thị" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <select value={draft.type} onChange={(e) => setDraft(changeType(draft, e.target.value as FieldType))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <select value={draft.purpose} onChange={(e) => setDraft({ ...draft, purpose: e.target.value as FieldPurpose })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    {PURPOSES.filter((p) => !p.needType || p.needType === draft.type)
                      .map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <PurposeHint purpose={draft.purpose} />
                {draft.type === 'select' && (
                  <textarea value={draft.optionsText} onChange={(e) => setDraft({ ...draft, optionsText: e.target.value })} placeholder="Mỗi dòng 1 lựa chọn" rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                )}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" checked={draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.checked })} /> Bắt buộc
                  </label>
                  <div className="flex gap-2">
                    <button onClick={() => saveEdit(f.id)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"><Check className="h-4 w-4" /> Lưu</button>
                    <button onClick={() => setEditId(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"><X className="h-4 w-4" /></button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <GripVertical className="h-4 w-4 shrink-0 text-slate-300" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800">
                    {f.label}
                    {f.required && <span className="ml-1 text-eco-600">*</span>}
                  </p>
                  <p className="text-xs text-slate-400">
                    <code className="rounded bg-slate-100 px-1">{f.field_key}</code> ·{' '}
                    {f.type === 'select' ? `Chọn: ${f.options.join(', ')}`
                      : f.type === 'image' ? 'Tải ảnh lên' : 'Nhập tự do'}
                    {f.purpose && f.purpose !== 'none' && (
                      <span className="ml-2 rounded bg-eco-100 px-1.5 py-0.5 font-medium text-eco-700">
                        {PURPOSE_LABEL[f.purpose]}
                      </span>
                    )}
                  </p>
                </div>
                <button onClick={() => startEdit(f)} className="rounded-lg p-1.5 text-slate-400 hover:bg-vicem-50 hover:text-vicem-600" aria-label={`Sửa ${f.label}`}><Pencil className="h-4 w-4" /></button>
                <button onClick={() => remove(f.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Xóa ${f.label}`}><Trash2 className="h-4 w-4" /></button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Thêm trường mới */}
      <form onSubmit={add} className="mt-4 space-y-2 rounded-xl border border-dashed border-slate-300 bg-white p-4">
        <p className="text-sm font-semibold text-slate-700">Thêm trường mới</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={adding.field_key} onChange={(e) => setAdding({ ...adding, field_key: e.target.value })} placeholder="Mã (vd: cccd)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input value={adding.label} onChange={(e) => setAdding({ ...adding, label: e.target.value })} placeholder="Nhãn hiển thị" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <select value={adding.type} onChange={(e) => setAdding(changeType(adding, e.target.value as FieldType))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select value={adding.purpose} onChange={(e) => setAdding({ ...adding, purpose: e.target.value as FieldPurpose })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {PURPOSES.filter((p) => !p.needType || p.needType === adding.type)
              .map((p) => <option key={p.value} value={p.value}>{p.value === 'none' ? 'Vai trò: — Không —' : `Vai trò: ${p.label}`}</option>)}
          </select>
        </div>
        <PurposeHint purpose={adding.purpose} />
        {adding.type === 'select' && (
          <textarea value={adding.optionsText} onChange={(e) => setAdding({ ...adding, optionsText: e.target.value })} placeholder="Mỗi dòng 1 lựa chọn (vd: Nhóm 1)" rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        )}
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={adding.required} onChange={(e) => setAdding({ ...adding, required: e.target.checked })} /> Bắt buộc
          </label>
          <button className="inline-flex items-center gap-1 rounded-lg bg-vicem-600 px-4 py-2 text-sm font-semibold text-white hover:bg-vicem-700"><Plus className="h-4 w-4" /> Thêm trường</button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  )
}
