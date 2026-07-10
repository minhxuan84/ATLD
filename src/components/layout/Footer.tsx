import { useConfig } from '../../context/ConfigContext'

export default function Footer() {
  const { config } = useConfig()
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-slate-500">
        <p className="font-semibold text-vicem-700">{config.brand_name_top} {config.brand_name_bottom} · Huấn luyện An toàn lao động &amp; Môi trường</p>
        <p className="mt-1">{config.footer_note}</p>
        <p className="mt-3">{config.footer_text}</p>
      </div>
    </footer>
  )
}
