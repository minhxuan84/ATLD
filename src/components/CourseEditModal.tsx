import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { X, Check } from 'lucide-react'

interface Branch { id: number; name: string }
interface CourseDraft {
  title: string; description: string; grp: string; branch_id: string
  video_url: string; duration: string; pass_score: number; summary: string
}

interface CourseEditModalProps {
  courseId: string
  initial: {
    title: string; description: string; grp: string; branch_id: number | null
    video_url: string; duration: string; pass_score: number; summary: string[]
  }
  onSaved: () => void
  onClose: () => void
}

export default function CourseEditModal({ courseId, initial, onSaved, onClose }: CourseEditModalProps) {
  const [draft, setDraft] = useState<CourseDraft>({
    title: initial.title, description: initial.description, grp: initial.grp,
    branch_id: initial.branch_id ? String(initial.branch_id) : '',
    video_url: initial.video_url, duration: initial.duration,
    pass_score: initial.pass_score, summary: (initial.summary ?? []).join('\n'),
  })
  const [branches, setBranches] = useState<Branch[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api<{ branches: Branch[] }>('/admin/branches').then((d) => setBranches(d.branches)).catch(() => {})
  }, [])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      await api(`/admin/courses/${courseId}`, {
        method: 'PUT',
        body: { ...draft, summary: draft.summary.split('\n').map((s) => s.trim()).filter(Boolean) },
      })
      onSaved()
      onClose()
    } catch (err) { setError(err instanceof Error ? err.message : 'Lưu thất bại.') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-bold text-slate-800">Sửa khóa học</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Đóng"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={save} className="max-h-[75vh] overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              required value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Tên khóa học" className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2"
            />
            <input value={draft.grp} onChange={(e) => setDraft({ ...draft, grp: e.target.value })}
              placeholder="Nhóm đối tượng" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <select value={draft.branch_id} onChange={(e) => setDraft({ ...draft, branch_id: e.target.value })}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">— Chi nhánh —</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <input value={draft.duration} onChange={(e) => setDraft({ ...draft, duration: e.target.value })}
              placeholder="Thời lượng (vd: 25 phút)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input type="number" value={draft.pass_score} onChange={(e) => setDraft({ ...draft, pass_score: Number(e.target.value) })}
              placeholder="Điểm đạt (%)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input value={draft.video_url} onChange={(e) => setDraft({ ...draft, video_url: e.target.value })}
              placeholder="URL video (YouTube, embed, v.v.)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
            <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="Mô tả" rows={2} className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
            <textarea value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
              placeholder="Tóm tắt nội dung (mỗi dòng 1 ý)" rows={3} className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Hủy</button>
            <button type="submit" disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-vicem-600 px-4 py-2 text-sm font-semibold text-white hover:bg-vicem-700 disabled:opacity-60">
              <Check className="h-4 w-4" /> {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
