import { Card, Badge, ProgressBar } from '../ui'
import { Target } from 'lucide-react'

interface Props {
  goals: { scope: 'year' | 'month'; title: string; target: string; progress: number }[]
}

export default function Goals({ goals }: Props) {
  return (
    <section className="mt-10">
      <h2 className="text-2xl font-bold text-slate-800">Kế hoạch thực hiện mục tiêu</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {goals.map((g, i) => (
          <Card key={i} hover className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 text-vicem-500" aria-hidden />
                <h3 className="font-semibold text-slate-800">{g.title}</h3>
              </div>
              <Badge color={g.scope === 'year' ? 'vicem' : 'hatien'}>
                {g.scope === 'year' ? 'Năm' : 'Tháng'}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-slate-600">{g.target}</p>
            <div className="mt-3">
              <ProgressBar value={g.progress} />
              <p className="mt-1 text-right text-xs font-medium text-slate-500">{g.progress}%</p>
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
}
