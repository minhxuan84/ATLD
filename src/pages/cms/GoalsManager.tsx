import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'

interface Goal { id: number; scope: 'year' | 'month'; title: string; target: string; progress: number }
interface Milestone { id: number; year_label: string; title: string; detail: string }

export default function GoalsManager() {
  const [goals, setGoals] = useState<Goal[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [newGoal, setNewGoal] = useState({ scope: 'year', title: '', target: '', progress: 0 })
  const [newMs, setNewMs] = useState({ year_label: '', title: '', detail: '' })
  const [editGoal, setEditGoal] = useState<number | null>(null)
  const [goalDraft, setGoalDraft] = useState({ title: '', target: '' })
  const [editMs, setEditMs] = useState<number | null>(null)
  const [msDraft, setMsDraft] = useState({ year_label: '', title: '', detail: '' })

  const fetchAll = useCallback(() => {
    api<{ goals: Goal[] }>('/admin/goals').then((d) => setGoals(d.goals)).catch(() => {})
    api<{ milestones: Milestone[] }>('/admin/milestones').then((d) => setMilestones(d.milestones)).catch(() => {})
  }, [])
  useEffect(fetchAll, [fetchAll])

  // ---- Mục tiêu ----
  const addGoal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newGoal.title.trim()) return
    await api('/admin/goals', { method: 'POST', body: newGoal })
    setNewGoal({ scope: 'year', title: '', target: '', progress: 0 })
    fetchAll()
  }
  const updateProgress = async (g: Goal, progress: number) => {
    await api(`/admin/goals/${g.id}`, { method: 'PUT', body: { title: g.title, target: g.target, progress } })
    setGoals((gs) => gs.map((x) => (x.id === g.id ? { ...x, progress } : x)))
  }
  const startEditGoal = (g: Goal) => { setEditGoal(g.id); setGoalDraft({ title: g.title, target: g.target }) }
  const saveGoal = async (g: Goal) => {
    await api(`/admin/goals/${g.id}`, { method: 'PUT', body: { ...goalDraft, progress: g.progress } })
    setEditGoal(null)
    fetchAll()
  }
  const delGoal = async (id: number) => { await api(`/admin/goals/${id}`, { method: 'DELETE' }); fetchAll() }

  // ---- Timeline ----
  const addMs = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMs.year_label.trim() || !newMs.title.trim()) return
    await api('/admin/milestones', { method: 'POST', body: newMs })
    setNewMs({ year_label: '', title: '', detail: '' })
    fetchAll()
  }
  const startEditMs = (m: Milestone) => { setEditMs(m.id); setMsDraft({ year_label: m.year_label, title: m.title, detail: m.detail }) }
  const saveMs = async (id: number) => {
    await api(`/admin/milestones/${id}`, { method: 'PUT', body: msDraft })
    setEditMs(null)
    fetchAll()
  }
  const delMs = async (id: number) => { await api(`/admin/milestones/${id}`, { method: 'DELETE' }); fetchAll() }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Mục tiêu &amp; Timeline thành tích</h1>

      {/* Mục tiêu */}
      <section className="mt-5">
        <h2 className="font-semibold text-slate-700">Kế hoạch mục tiêu</h2>
        <div className="mt-3 space-y-2">
          {goals.map((g) => (
            <div key={g.id} className="rounded-xl border border-slate-200 bg-white p-3">
              {editGoal === g.id ? (
                <div className="space-y-2">
                  <input value={goalDraft.title} onChange={(e) => setGoalDraft({ ...goalDraft, title: e.target.value })} placeholder="Tiêu đề mục tiêu" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <input value={goalDraft.target} onChange={(e) => setGoalDraft({ ...goalDraft, target: e.target.value })} placeholder="Mô tả mục tiêu" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => saveGoal(g)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"><Check className="h-4 w-4" /> Lưu</button>
                    <button onClick={() => setEditGoal(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"><X className="h-4 w-4" /></button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${g.scope === 'year' ? 'bg-vicem-100 text-vicem-700' : 'bg-hatien-100 text-hatien-700'}`}>{g.scope === 'year' ? 'Năm' : 'Tháng'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-700">{g.title}</p>
                    <p className="text-xs text-slate-400">{g.target}</p>
                  </div>
                  <input type="range" min={0} max={100} value={g.progress} onChange={(e) => updateProgress(g, Number(e.target.value))} className="w-32 accent-vicem-500" aria-label={`Tiến độ ${g.title}`} />
                  <span className="w-10 text-right text-sm font-medium text-slate-600">{g.progress}%</span>
                  <button onClick={() => startEditGoal(g)} className="rounded p-1.5 text-slate-400 hover:bg-vicem-50 hover:text-vicem-600" aria-label={`Sửa ${g.title}`}><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => delGoal(g.id)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Xóa ${g.title}`}><Trash2 className="h-4 w-4" /></button>
                </div>
              )}
            </div>
          ))}
        </div>
        <form onSubmit={addGoal} className="mt-3 grid gap-2 rounded-xl border border-dashed border-slate-300 bg-white p-3 sm:grid-cols-2">
          <select value={newGoal.scope} onChange={(e) => setNewGoal({ ...newGoal, scope: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="year">Năm</option>
            <option value="month">Tháng</option>
          </select>
          <input type="number" min={0} max={100} value={newGoal.progress} onChange={(e) => setNewGoal({ ...newGoal, progress: Number(e.target.value) })} placeholder="Tiến độ %" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input value={newGoal.title} onChange={(e) => setNewGoal({ ...newGoal, title: e.target.value })} placeholder="Tiêu đề mục tiêu" className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <input value={newGoal.target} onChange={(e) => setNewGoal({ ...newGoal, target: e.target.value })} placeholder="Mô tả mục tiêu" className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <div className="sm:col-span-2"><button className="inline-flex items-center gap-1 rounded-lg bg-vicem-600 px-4 py-2 text-sm font-semibold text-white hover:bg-vicem-700"><Plus className="h-4 w-4" /> Thêm mục tiêu</button></div>
        </form>
      </section>

      {/* Timeline */}
      <section className="mt-8">
        <h2 className="font-semibold text-slate-700">Timeline thành tích</h2>
        <div className="mt-3 space-y-2">
          {milestones.map((m) => (
            <div key={m.id} className="rounded-xl border border-slate-200 bg-white p-3">
              {editMs === m.id ? (
                <div className="space-y-2">
                  <div className="grid gap-2 sm:grid-cols-4">
                    <input value={msDraft.year_label} onChange={(e) => setMsDraft({ ...msDraft, year_label: e.target.value })} placeholder="Năm" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <input value={msDraft.title} onChange={(e) => setMsDraft({ ...msDraft, title: e.target.value })} placeholder="Tiêu đề mốc" className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-3" />
                  </div>
                  <input value={msDraft.detail} onChange={(e) => setMsDraft({ ...msDraft, detail: e.target.value })} placeholder="Chi tiết" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => saveMs(m.id)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"><Check className="h-4 w-4" /> Lưu</button>
                    <button onClick={() => setEditMs(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"><X className="h-4 w-4" /></button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="rounded bg-vicem-100 px-2 py-0.5 text-sm font-semibold text-vicem-700">{m.year_label}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-700">{m.title}</p>
                    <p className="text-xs text-slate-400">{m.detail}</p>
                  </div>
                  <button onClick={() => startEditMs(m)} className="rounded p-1.5 text-slate-400 hover:bg-vicem-50 hover:text-vicem-600" aria-label={`Sửa ${m.title}`}><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => delMs(m.id)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Xóa ${m.title}`}><Trash2 className="h-4 w-4" /></button>
                </div>
              )}
            </div>
          ))}
        </div>
        <form onSubmit={addMs} className="mt-3 grid gap-2 rounded-xl border border-dashed border-slate-300 bg-white p-3 sm:grid-cols-4">
          <input value={newMs.year_label} onChange={(e) => setNewMs({ ...newMs, year_label: e.target.value })} placeholder="Năm" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input value={newMs.title} onChange={(e) => setNewMs({ ...newMs, title: e.target.value })} placeholder="Tiêu đề mốc" className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-3" />
          <input value={newMs.detail} onChange={(e) => setNewMs({ ...newMs, detail: e.target.value })} placeholder="Chi tiết" className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-4" />
          <div className="sm:col-span-4"><button className="inline-flex items-center gap-1 rounded-lg bg-vicem-600 px-4 py-2 text-sm font-semibold text-white hover:bg-vicem-700"><Plus className="h-4 w-4" /> Thêm mốc</button></div>
        </form>
      </section>
    </div>
  )
}
