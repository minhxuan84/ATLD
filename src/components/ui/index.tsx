import type { ReactNode } from 'react'

export function Card({ children, className = '', hover = false }: { children: ReactNode; className?: string; hover?: boolean }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${hover ? 'card-hover' : ''} ${className}`}>
      {children}
    </div>
  )
}

export function Badge({ children, color = 'vicem' }: { children: ReactNode; color?: 'vicem' | 'hatien' | 'green' | 'red' | 'slate' | 'safety' }) {
  const map = {
    vicem: 'bg-vicem-100 text-vicem-700',
    hatien: 'bg-hatien-100 text-hatien-700',
    safety: 'bg-amber-100 text-amber-700',
    green: 'bg-emerald-100 text-emerald-700',
    red: 'bg-red-100 text-red-700',
    slate: 'bg-slate-100 text-slate-600',
  }
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${map[color]}`}>{children}</span>
}

export function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={`h-full rounded-full ${v === 100 ? 'bg-emerald-500' : 'bg-vicem-500'}`}
        style={{ width: `${v}%` }}
      />
    </div>
  )
}
