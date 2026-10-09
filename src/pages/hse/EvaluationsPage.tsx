// Đánh giá định kỳ nhà thầu (Phase F — BM111-07.05). Chấm 6 tiêu chí có trọng số.
import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import { fmtDate } from '../../lib/date'

interface Criterion { key: string; label: string; weight: number }
interface Contractor { id: number; name: string; is_offsite?: boolean; iso45001?: boolean }
interface WorkerOption { id: number; full_name: string; job_title: string | null; contractor_id: number | null }
interface Evaluation {
  id: number; contractor_id: number; contract_id: number | null; period: string
  eval_date: string | null; total_score: number; rating: string; note: string | null
  contractor_name: string; evaluator_name: string | null
  // Pha E5: phiếu đánh giá từng NLĐ (worker_id khác null) dùng chung bảng với phiếu nhà thầu.
  worker_id: number | null; worker_name: string | null; worker_job_title: string | null
}
const RATING_COLOR: Record<string, string> = {
  'Tốt': 'bg-green-100 text-green-700', 'Khá': 'bg-blue-100 text-blue-700',
  'Đạt': 'bg-amber-100 text-amber-700', 'Không đạt': 'bg-rose-100 text-rose-700',
}

export default function EvaluationsPage() {
  const [criteria, setCriteria] = useState<Criterion[]>([])
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [workers, setWorkers] = useState<WorkerOption[]>([])
  const [evals, setEvals] = useState<Evaluation[]>([])
  const [filterCt, setFilterCt] = useState('')
  const [filterTarget, setFilterTarget] = useState('')
  const [showForm, setShowForm] = useState(false)
  // target quyết định gửi contractor_id hay worker_id; server tự suy nhà thầu từ NLĐ.
  const [form, setForm] = useState({ target: 'contractor', contractor_id: '', worker_id: '', period: '', eval_date: '', note: '' })
  const [scores, setScores] = useState<Record<string, number>>({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const qs = new URLSearchParams()
    if (filterCt) qs.set('contractorId', filterCt)
    if (filterTarget) qs.set('target', filterTarget)
    const p = qs.toString() ? `?${qs}` : ''
    const d = await api<{ evaluations: Evaluation[] }>(`/hse/evaluations${p}`)
    setEvals(d.evaluations)
  }, [filterCt, filterTarget])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    api<{ criteria: Criterion[] }>('/hse/eval-criteria').then((d) => setCriteria(d.criteria))
    api<{ contractors: Contractor[] }>('/hse/contractors').then((d) => setContractors(d.contractors))
    api<{ workers: WorkerOption[] }>('/hse/workers?type=contractor').then((d) => setWorkers(d.workers)).catch(() => {})
  }, [])

  const preview = criteria.reduce((sum, c) => sum + (Math.max(0, Math.min(100, scores[c.key] ?? 0)) * c.weight) / 100, 0)
  const openNew = () => {
    setForm({ target: 'contractor', contractor_id: filterCt || '', worker_id: '', period: '', eval_date: '', note: '' })
    setScores({}); setErr(''); setShowForm(true)
  }
  const submit = async () => {
    setErr(''); setBusy(true)
    try {
      // Chỉ gửi đúng một trong hai: gửi cả hai mà lệch nhau thì phiếu gắn sai nhà thầu.
      const body = form.target === 'worker'
        ? { worker_id: form.worker_id, period: form.period, eval_date: form.eval_date, note: form.note, scores }
        : { contractor_id: form.contractor_id, period: form.period, eval_date: form.eval_date, note: form.note, scores }
      await api('/hse/evaluations', { method: 'POST', body })
      setShowForm(false); await load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const fmt = (s: string | null) => fmtDate(s)
  // Chọn nhà thầu trước thì chỉ liệt kê NLĐ của nhà thầu đó — danh sách toàn nhà máy quá dài.
  const workerOptions = form.contractor_id
    ? workers.filter((w) => String(w.contractor_id) === form.contractor_id)
    : workers
  const formValid = form.period.trim() !== ''
    && (form.target === 'worker' ? form.worker_id !== '' : form.contractor_id !== '')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <select value={filterCt} onChange={(e) => setFilterCt(e.target.value)}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm">
            <option value="">-- Tất cả nhà thầu --</option>
            {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={filterTarget} onChange={(e) => setFilterTarget(e.target.value)}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm">
            <option value="">-- Nhà thầu và NLĐ --</option>
            <option value="contractor">Chỉ phiếu nhà thầu</option>
            <option value="worker">Chỉ phiếu người lao động</option>
          </select>
        </div>
        <button onClick={openNew} className="rounded bg-vicem-500 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">+ Phiếu đánh giá</button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
            <th className="px-3 py-2 text-left">Đối tượng</th><th className="px-3 py-2 text-left">Kỳ</th>
            <th className="px-3 py-2 text-center">Ngày ĐG</th><th className="px-3 py-2 text-center">Điểm</th>
            <th className="px-3 py-2 text-center">Xếp loại</th><th className="px-3 py-2 text-left">Người đánh giá</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {evals.map((e) => (
              <tr key={e.id} className="text-xs hover:bg-slate-50">
                <td className="px-3 py-2 font-medium text-slate-700">
                  {e.worker_id ? (
                    <>
                      <span className="mr-1 rounded bg-sky-100 px-1 text-xs font-medium text-sky-700">NLĐ</span>
                      {e.worker_name}
                      <span className="block text-xs font-normal text-slate-400">
                        {[e.worker_job_title, e.contractor_name].filter(Boolean).join(' · ')}
                      </span>
                    </>
                  ) : e.contractor_name}
                </td>
                <td className="px-3 py-2 text-slate-500">{e.period}</td>
                <td className="px-3 py-2 text-center text-slate-500">{fmt(e.eval_date)}</td>
                <td className="px-3 py-2 text-center font-semibold text-slate-700">{Number(e.total_score).toFixed(1)}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${RATING_COLOR[e.rating] ?? 'bg-slate-100 text-slate-600'}`}>{e.rating}</span></td>
                <td className="px-3 py-2 text-slate-500">{e.evaluator_name ?? '—'}</td>
              </tr>
            ))}
            {evals.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-400">Chưa có phiếu đánh giá.</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold">
              Phiếu đánh giá định kỳ {form.target === 'worker' ? 'người lao động' : 'nhà thầu'}
            </h3>
            {err && <p className="mb-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</p>}
            <div className="mb-2 flex gap-1 text-xs">
              {([['contractor', 'Đánh giá nhà thầu'], ['worker', 'Đánh giá từng NLĐ']] as const).map(([v, label]) => (
                <button key={v} type="button" onClick={() => setForm({ ...form, target: v, worker_id: '' })}
                  className={`rounded px-2 py-1 font-medium ${form.target === v ? 'bg-vicem-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={form.contractor_id} onChange={(e) => setForm({ ...form, contractor_id: e.target.value, worker_id: '' })}
                className="col-span-2 rounded border border-slate-300 px-3 py-1.5 text-sm">
                <option value="">
                  {form.target === 'worker' ? '-- Lọc theo nhà thầu (không bắt buộc) --' : '-- Chọn nhà thầu * --'}
                </option>
                {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {form.target === 'worker' && (
                <select value={form.worker_id} onChange={(e) => setForm({ ...form, worker_id: e.target.value })}
                  className="col-span-2 rounded border border-slate-300 px-3 py-1.5 text-sm">
                  <option value="">-- Chọn người lao động * --</option>
                  {workerOptions.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.full_name}{w.job_title ? ` — ${w.job_title}` : ''}
                    </option>
                  ))}
                </select>
              )}
              <input placeholder="Kỳ (VD: Q3/2026) *" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
              <input type="date" value={form.eval_date} onChange={(e) => setForm({ ...form, eval_date: e.target.value })}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm" />
            </div>
            <div className="mt-3 space-y-2">
              {criteria.map((c) => (
                <div key={c.key} className="flex items-center gap-3">
                  <div className="flex-1"><p className="text-sm text-slate-700">{c.label}</p>
                    <p className="text-xs text-slate-400">Trọng số {c.weight}%</p></div>
                  <input type="range" min={0} max={100} step={5} value={scores[c.key] ?? 0}
                    onChange={(e) => setScores({ ...scores, [c.key]: Number(e.target.value) })} className="w-40" />
                  <span className="w-10 text-right text-sm font-medium text-slate-700">{scores[c.key] ?? 0}</span>
                </div>
              ))}
            </div>
            <textarea placeholder="Ghi chú / kiến nghị" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="mt-3 w-full rounded border border-slate-300 px-3 py-1.5 text-sm" rows={2} />
            <div className="mt-3 flex items-center justify-between">
              <p className="text-sm text-slate-600">Điểm tổng dự kiến: <span className="text-lg font-bold text-vicem-500">{preview.toFixed(1)}</span></p>
              <div className="flex gap-2">
                <button onClick={() => setShowForm(false)} className="rounded px-3 py-1.5 text-sm text-slate-500">Hủy</button>
                <button onClick={submit} disabled={busy || !formValid}
                  className="rounded bg-vicem-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                  {busy ? 'Đang lưu…' : 'Lưu phiếu'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
