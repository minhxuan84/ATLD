import { Link } from 'react-router-dom'
import { ShieldCheck, PlayCircle, Award, Users, FileCheck } from 'lucide-react'

const STATS = [
  { icon: Award, value: '1.200+', label: 'Chứng chỉ đã cấp' },
  { icon: Users, value: '5.000+', label: 'Giờ huấn luyện' },
  { icon: FileCheck, value: '92%', label: 'Tỷ lệ đạt' },
]

export default function Hero() {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-vicem-800 via-vicem-600 to-vicem-500 text-white shadow-xl">
      {/* Khối trang trí động */}
      <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-hatien-500/20 blur-2xl animate-float-slow" aria-hidden />
      <div className="pointer-events-none absolute -bottom-20 left-1/3 h-56 w-56 rounded-full bg-white/10 blur-2xl" aria-hidden />

      <div className="relative grid items-center gap-6 px-6 py-14 md:grid-cols-2 md:px-12 md:py-20">
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm backdrop-blur">
            <ShieldCheck className="h-4 w-4" aria-hidden /> An toàn là trên hết
          </span>
          <h1 className="mt-4 text-3xl font-extrabold leading-tight md:text-5xl">
            Huấn luyện <span className="text-hatien-100">An toàn lao động</span> &amp; Bảo vệ môi trường
          </h1>
          <p className="mt-4 max-w-xl text-vicem-50/90">
            VICEM Hà Tiên số hóa công tác huấn luyện: học qua video, nắm nội dung cốt lõi, làm trắc nghiệm và nhận chứng chỉ — mọi lúc, mọi nơi.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              to="/huan-luyen"
              className="group inline-flex items-center gap-2 rounded-xl bg-hatien-500 px-6 py-3 font-semibold text-white shadow-lg shadow-hatien-500/30 transition hover:bg-hatien-600 hover:shadow-hatien-500/50"
            >
              <PlayCircle className="h-5 w-5 transition group-hover:scale-110" aria-hidden /> Bắt đầu huấn luyện
            </Link>
            <Link
              to="/tai-lieu"
              className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-6 py-3 font-semibold backdrop-blur transition hover:bg-white/25"
            >
              Tài liệu hồ sơ
            </Link>
          </div>
        </div>

        <div className="animate-fade-in md:justify-self-end">
          <div className="grid gap-3">
            {STATS.map((s) => {
              const Icon = s.icon
              return (
                <div key={s.label} className="flex items-center gap-4 rounded-2xl bg-white/10 px-5 py-4 backdrop-blur transition hover:bg-white/15">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15">
                    <Icon className="h-6 w-6" aria-hidden />
                  </span>
                  <div>
                    <p className="text-2xl font-bold leading-none">{s.value}</p>
                    <p className="mt-1 text-sm text-vicem-50/80">{s.label}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
