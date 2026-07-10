import { CheckCircle2 } from 'lucide-react'

interface Props {
  intro: { heading: string; paragraphs: string[]; groups: string[] }
}

export default function About({ intro }: Props) {
  return (
    <section className="mt-10">
      <h2 className="text-2xl font-bold text-slate-800">{intro.heading}</h2>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div className="space-y-3 text-slate-600">
          {intro.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="font-semibold text-slate-800">6 nhóm đối tượng huấn luyện</h3>
          <ul className="mt-3 space-y-2">
            {intro.groups.map((g) => (
              <li key={g} className="flex items-start gap-2 text-sm text-slate-600">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                <span>{g}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
