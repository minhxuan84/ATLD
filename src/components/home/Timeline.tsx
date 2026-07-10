interface Props {
  milestones: { year_label: string; title: string; detail: string }[]
}

export default function Timeline({ milestones }: Props) {
  return (
    <section className="mt-10">
      <h2 className="text-2xl font-bold text-slate-800">Timeline thành tích đạt được</h2>
      <ol className="mt-6 relative border-l-2 border-vicem-100 pl-6">
        {milestones.map((m) => (
          <li key={m.year_label} className="mb-6 last:mb-0">
            <span className="absolute -left-[9px] mt-1 h-4 w-4 rounded-full border-2 border-white bg-vicem-500" aria-hidden />
            <div className="flex items-center gap-2">
              <span className="rounded bg-vicem-100 px-2 py-0.5 text-sm font-semibold text-vicem-700">{m.year_label}</span>
              <h3 className="font-semibold text-slate-800">{m.title}</h3>
            </div>
            <p className="mt-1 text-sm text-slate-600">{m.detail}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
