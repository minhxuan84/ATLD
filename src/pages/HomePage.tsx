import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { fmtDate } from '../lib/date'
import { useReveal } from '../hooks/useReveal'
import { useConfig } from '../context/ConfigContext'
import LandingHeader from '../components/home/LandingHeader'
import CountUp from '../components/CountUp'
import { FIELD_COLORS, resolveFieldIcon, readFieldCards } from '../lib/fieldIcons'
import {
  ShieldCheck, PlayCircle, ChevronDown, Leaf,
  Award, Users, FileCheck, Target, ArrowRight, MapPin, Mail, Phone,
} from 'lucide-react'

interface HomeData {
  intro: { heading: string; paragraphs: string[]; groups: string[] }
  milestones: { year_label: string; title: string; detail: string }[]
  goals: { scope: 'year' | 'month'; title: string; target: string; progress: number }[]
}
interface NewsRow { id: number; title: string; category: string; excerpt: string; date: string }

// Ảnh nền hero mặc định (dùng khi CMS chưa tải ảnh riêng) — chủ đề nhà máy, an toàn, môi trường
const HERO_FALLBACK = [
  'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=1920&q=80',
  'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?auto=format&fit=crop&w=1920&q=80',
  'https://images.unsplash.com/photo-1466611653911-95081537e5b7?auto=format&fit=crop&w=1920&q=80',
]

const SECTIONS = [
  { id: 'home', label: 'Trang chủ' },
  { id: 'gioi-thieu', label: 'Giới thiệu' },
  { id: 'linh-vuc', label: 'Lĩnh vực' },
  { id: 'nang-luc', label: 'Năng lực' },
  { id: 'tin-tuc', label: 'Tin tức' },
  { id: 'lien-he', label: 'Liên hệ' },
]

// Icon cố định cho 4 chỉ số; giá trị & nhãn lấy từ cấu hình (CMS chỉnh được).
const STAT_ICONS = [Award, Users, FileCheck, ShieldCheck]

// Tách chuỗi chỉ số "1.200+", "92%", "0" thành phần đầu/số/đuôi để đếm từ 0.
// group = có dấu phân tách hàng nghìn (hiển thị lại kiểu 1.200 khi đếm xong).
function parseStat(raw: string): { prefix: string; end: number; suffix: string; group: boolean } {
  const s = String(raw ?? '').trim()
  const m = s.match(/^(\D*)([\d.,]*\d)?(\D*)$/)
  if (!m || !m[2]) return { prefix: s, end: 0, suffix: '', group: false }
  const digits = m[2].replace(/[.,]/g, '')
  const end = Number(digits) || 0
  return { prefix: m[1] ?? '', end, suffix: m[3] ?? '', group: /[.,]/.test(m[2]) || end >= 1000 }
}

const NEWS_COLOR: Record<string, string> = {
  'Thông báo': 'bg-vicem-100 text-vicem-700',
  'Sự kiện': 'bg-eco-100 text-eco-700',
  'Cảnh báo an toàn': 'bg-amber-100 text-amber-700',
}

export default function HomePage() {
  const [solid, setSolid] = useState(false)
  const [active, setActive] = useState('home')
  const [data, setData] = useState<HomeData | null>(null)
  const [news, setNews] = useState<NewsRow[]>([])
  const [slide, setSlide] = useState(0)
  const [statsVisible, setStatsVisible] = useState(false)
  const { config } = useConfig()

  // Ảnh hero: ưu tiên ảnh tải lên từ CMS, thiếu ô nào thì dùng ảnh mặc định
  const heroSlides = [
    config.hero_image_1 || HERO_FALLBACK[0],
    config.hero_image_2 || HERO_FALLBACK[1],
    config.hero_image_3 || HERO_FALLBACK[2],
  ]

  // Chỉ số "biết nói": giá trị + nhãn từ CMS, kèm icon cố định; tách sẵn để đếm từ 0.
  const stats = STAT_ICONS.map((icon, i) => ({
    icon,
    label: config[`stat_${i + 1}_label`] ?? '',
    ...parseStat(config[`stat_${i + 1}_value`] ?? ''),
  }))

  // Thẻ "Lĩnh vực hoạt động": danh sách thêm/bớt được trong CMS (xem readFieldCards).
  // Đường dẫn đã được server kiểm là đường dẫn nội bộ trước khi lưu (xem config.ts);
  // thiếu đường dẫn thì về trang chủ thay vì ra <Link to=""> hỏng.
  const fields = readFieldCards(config).map((c, i) => ({
    title: c.title,
    desc: c.desc,
    to: c.link || '/',
    icon: resolveFieldIcon(c.icon, Leaf),
    color: FIELD_COLORS[i % FIELD_COLORS.length],
  }))

  useEffect(() => {
    api<HomeData>('/home').then(setData).catch(() => {})
    api<{ news: NewsRow[] }>('/news').then((d) => setNews(d.news)).catch(() => {})
  }, [])

  useReveal([data, news])

  // Slideshow hero: tự chuyển ảnh sau mỗi 5s
  useEffect(() => {
    const t = setInterval(() => setSlide((s) => (s + 1) % heroSlides.length), 5000)
    return () => clearInterval(t)
  }, [heroSlides.length])

  // Kích hoạt hoạt ảnh số liệu + thanh tiến độ khi cuộn tới khu "Năng lực".
  // Quan sát riêng khối mục tiêu (nằm cuối section) để hiệu ứng chạy đúng lúc nhìn thấy.
  useEffect(() => {
    const target = document.getElementById('stats-block') ?? document.getElementById('nang-luc')
    if (!target) return
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { setStatsVisible(true); io.disconnect() } }),
      { rootMargin: '0px 0px -15% 0px', threshold: 0.1 },
    )
    io.observe(target)
    return () => io.disconnect()
  }, [data])

  // Theo dõi cuộn cửa sổ để đổi header + dot active
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      setSolid(y > 80)
      const mid = y + window.innerHeight / 2
      for (const s of SECTIONS) {
        const sec = document.getElementById(s.id)
        if (sec && sec.offsetTop <= mid && sec.offsetTop + sec.offsetHeight > mid) {
          setActive(s.id)
          break
        }
      }
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [data])

  return (
    <>
      <LandingHeader solid={solid} />

      {/* Dot navigation */}
      <nav className="fixed right-5 top-1/2 z-40 hidden -translate-y-1/2 flex-col gap-3 md:flex" aria-label="Điều hướng nhanh">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            aria-label={s.label}
            className={`group relative h-3 w-3 rounded-full border-2 transition ${
              active === s.id ? 'scale-125 border-vicem-500 bg-vicem-500' : 'border-slate-400 bg-transparent hover:border-vicem-500'
            }`}
          >
            <span className="pointer-events-none absolute right-6 top-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-xs text-white opacity-0 transition group-hover:opacity-100">
              {s.label}
            </span>
          </a>
        ))}
      </nav>

      <div className="fullpage bg-slate-50">
        {/* ===== HERO (slideshow ảnh) ===== */}
        <section id="home" className="snap-section relative flex items-center justify-center overflow-hidden pt-20 sm:pt-0">
          {/* Các lớp ảnh crossfade */}
          {heroSlides.map((src, i) => (
            <div
              key={`${i}-${src}`}
              className={`hero-slide ${i === slide ? 'is-active' : ''}`}
              style={{ backgroundImage: `url(${src})` }}
              aria-hidden
            />
          ))}
          {/* Lớp phủ nhận diện. Trước đây là /90 /80 /60 nên ảnh banner gần như bị
              nhuộm kín, trông tối; hạ xuống /55 /45 /35 để thấy được ảnh nhà máy. */}
          <div className="absolute inset-0 bg-gradient-to-br from-eco-800/55 via-vicem-800/45 to-eco-600/35" aria-hidden />
          {/* Scrim cục bộ sau khối chữ: hạ lớp phủ chung thì chữ trắng trên ảnh sáng
              mất tương phản. Tối cục bộ ở giữa thay vì làm tối lại cả banner — giữ
              được ảnh sáng mà chữ vẫn đọc được. */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_50%_at_50%_45%,rgba(2,20,12,0.55),transparent_70%)]" aria-hidden />
          <div className="pointer-events-none absolute inset-0 bg-grid-white [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" aria-hidden />
          <div className="pointer-events-none absolute -right-24 top-16 h-96 w-96 rounded-full bg-eco-600/25 blur-3xl animate-aurora" aria-hidden />
          <div className="pointer-events-none absolute bottom-10 -left-16 h-80 w-80 rounded-full bg-vicem-400/20 blur-3xl animate-float-slower" aria-hidden />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-slate-50 to-transparent" aria-hidden />

          <div className="relative mx-auto max-w-4xl px-4 text-center text-white">
            <span className="glass inline-flex items-center gap-2 rounded-full px-5 py-2 text-base font-medium shadow-glow">
              <ShieldCheck className="h-5 w-5 text-eco-200" /> {config.hero_badge}
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight sm:mt-7 sm:text-5xl md:text-7xl">
              <span className="text-gradient">{config.hero_title}</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-xl text-vicem-50/90 md:text-2xl">
              {config.hero_subtitle}
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-4">
              <Link to="/huan-luyen" className="group inline-flex items-center gap-2 rounded-xl bg-eco-600 px-8 py-4 text-lg font-semibold shadow-glow-green transition hover:-translate-y-0.5 hover:bg-eco-700">
                <PlayCircle className="h-6 w-6 transition group-hover:scale-110" /> Bắt đầu huấn luyện
              </Link>
              <a href="#gioi-thieu" className="glass inline-flex items-center gap-2 rounded-xl px-8 py-4 text-lg font-semibold transition hover:-translate-y-0.5 hover:bg-white/25">
                Tìm hiểu thêm
              </a>
            </div>
            {/* Dải tin cậy */}
            <div className="mx-auto mt-12 flex max-w-2xl flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-vicem-50/80">
              {stats.map((s) => (
                <span key={s.label} className="inline-flex items-center gap-2">
                  <s.icon className="h-4 w-4 text-eco-200" />
                  <b className="font-bold text-white">{s.prefix}{s.group ? s.end.toLocaleString('vi-VN') : s.end}{s.suffix}</b> {s.label}
                </span>
              ))}
            </div>
          </div>
          {/* Chấm chỉ báo slide */}
          <div className="absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 gap-2.5">
            {heroSlides.map((_, i) => (
              <button
                key={i}
                onClick={() => setSlide(i)}
                aria-label={`Ảnh ${i + 1}`}
                className={`h-2.5 rounded-full transition-all ${i === slide ? 'w-8 bg-eco-600' : 'w-2.5 bg-white/50 hover:bg-white/80'}`}
              />
            ))}
          </div>
          <a href="#gioi-thieu" className="absolute bottom-7 right-8 text-white/80 hover:text-white" aria-label="Cuộn xuống">
            <ChevronDown className="h-8 w-8 animate-bounce" />
          </a>
        </section>

        {/* ===== GIỚI THIỆU ===== */}
        <section id="gioi-thieu" className="snap-section flex items-center bg-white py-20">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 md:grid-cols-2 md:items-center">
            <div className="reveal">
              <span className="eyebrow text-sm font-semibold uppercase tracking-wider text-eco-600">Về chúng tôi</span>
              <h2 className="mt-3 text-4xl font-bold tracking-tight text-slate-900 md:text-5xl">{data?.intro.heading ?? 'Huấn luyện An toàn lao động & Môi trường'}</h2>
              <div className="mt-4 space-y-3 text-slate-600">
                {(data?.intro.paragraphs ?? []).map((p, i) => <p key={i}>{p}</p>)}
              </div>
              <Link to="/huan-luyen" className="mt-6 inline-flex items-center gap-2 font-semibold text-vicem-600 hover:gap-3 transition-all">
                Khám phá chương trình <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="reveal relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-7 shadow-glow" style={{ transitionDelay: '120ms' }}>
              <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-vicem-100 blur-2xl" aria-hidden />
              <h3 className="relative flex items-center gap-2 text-lg font-bold text-slate-900">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-vicem-500 to-vicem-700 text-white"><Users className="h-5 w-5" /></span>
                6 nhóm đối tượng huấn luyện
              </h3>
              <ul className="relative mt-5 space-y-3">
                {(data?.intro.groups ?? []).map((g) => (
                  <li key={g} className="flex items-start gap-2.5 text-slate-600">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" /> <span>{g}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ===== LĨNH VỰC ===== */}
        <section id="linh-vuc" className="snap-section flex items-center bg-slate-100 py-20">
          <div className="mx-auto max-w-6xl px-4">
            <div className="reveal text-center">
              <span className="eyebrow text-sm font-semibold uppercase tracking-wider text-eco-600">
                {config.fields_eyebrow?.trim() || 'Lĩnh vực hoạt động'}
              </span>
              <h2 className="mt-3 text-4xl font-bold tracking-tight text-slate-900 md:text-5xl">
                {config.fields_heading?.trim() || 'Các chức năng chính của hệ thống'}
              </h2>
            </div>
            {/* Số cột theo số thẻ (tối đa 4/hàng) để 1–3 thẻ vẫn cân giữa, không lệch trái. */}
            <div className={`mt-12 grid gap-6 ${
              ({
                1: 'mx-auto max-w-sm',
                2: 'mx-auto max-w-3xl sm:grid-cols-2',
                3: 'sm:grid-cols-2 lg:grid-cols-3',
              } as Record<number, string>)[fields.length] ?? 'sm:grid-cols-2 lg:grid-cols-4'}`}>
              {fields.map((f, i) => {
                const Icon = f.icon
                return (
                  <Link
                    key={`${i}-${f.title}`} to={f.to}
                    className="reveal card-hover group relative flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white p-6"
                    style={{ transitionDelay: `${i * 80}ms` }}
                  >
                    <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${f.color}`} aria-hidden />
                    <span className={`inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${f.color} text-white shadow-lg transition group-hover:scale-105`}>
                      <Icon className="h-8 w-8" />
                    </span>
                    <h3 className="mt-5 text-lg font-bold text-slate-900">{f.title}</h3>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">{f.desc}</p>
                    <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-vicem-600 transition-all group-hover:gap-2">
                      Xem chi tiết <ArrowRight className="h-4 w-4" />
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>
        </section>

        {/* ===== NĂNG LỰC (số liệu + timeline + mục tiêu) ===== */}
        <section id="nang-luc" className="snap-section relative flex items-center overflow-hidden bg-vicem-900 bg-gradient-to-br from-vicem-900 via-vicem-800 to-vicem-700 py-20 text-white">
          <div className="pointer-events-none absolute inset-0 bg-grid-white [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" aria-hidden />
          <div className="pointer-events-none absolute -left-20 top-1/4 h-72 w-72 rounded-full bg-eco-600/20 blur-3xl animate-aurora" aria-hidden />
          <div className="relative mx-auto max-w-6xl px-4">
            <div className="reveal text-center">
              <span className="eyebrow text-sm font-semibold uppercase tracking-wider text-eco-200">Năng lực &amp; Thành tích</span>
              <h2 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">Những con số biết nói</h2>
            </div>

            <div id="stats-block" className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {stats.map((s, i) => {
                const Icon = s.icon
                return (
                  <div key={s.label} className="reveal glass rounded-3xl p-6 text-center transition hover:-translate-y-1 hover:bg-white/15" style={{ transitionDelay: `${i * 80}ms` }}>
                    <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
                      <Icon className="h-6 w-6 text-eco-200" />
                    </span>
                    <p className="mt-4 text-4xl font-extrabold tracking-tight">
                      <CountUp end={s.end} run={statsVisible} prefix={s.prefix} suffix={s.suffix} group={s.group} />
                    </p>
                    <p className="mt-1 text-sm text-vicem-50/80">{s.label}</p>
                  </div>
                )
              })}
            </div>

            <div className="mt-12 grid gap-8 lg:grid-cols-2">
              {/* Timeline */}
              <div className="reveal">
                <h3 className="flex items-center gap-2 text-lg font-semibold"><Award className="h-5 w-5 text-eco-200" /> Cột mốc thành tích</h3>
                <ol className="mt-4 space-y-3">
                  {(data?.milestones ?? []).map((m) => (
                    <li key={m.year_label} className="flex gap-3 rounded-xl bg-white/5 p-3">
                      <span className="shrink-0 rounded-lg bg-eco-600 px-2.5 py-1 text-sm font-bold">{m.year_label}</span>
                      <div>
                        <p className="font-medium">{m.title}</p>
                        <p className="text-sm text-vicem-50/70">{m.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
              {/* Mục tiêu: gom nhóm theo Năm/Tháng, có nút xổ ra / thu vào */}
              <div id="goals-block" className="reveal" style={{ transitionDelay: '120ms' }}>
                <h3 className="flex items-center gap-2 text-lg font-semibold"><Target className="h-5 w-5 text-eco-200" /> Kế hoạch mục tiêu</h3>
                <div className="mt-4 space-y-3">
                  <GoalGroup
                    scope="year" title="Mục tiêu năm"
                    goals={(data?.goals ?? []).filter((g) => g.scope === 'year')}
                    defaultOpen={config.goals_year_open !== '0'}
                    statsVisible={statsVisible}
                  />
                  <GoalGroup
                    scope="month" title="Mục tiêu tháng"
                    goals={(data?.goals ?? []).filter((g) => g.scope === 'month')}
                    defaultOpen={config.goals_month_open === '1'}
                    statsVisible={statsVisible}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ===== TIN TỨC ===== */}
        <section id="tin-tuc" className="snap-section flex items-center bg-white py-20">
          <div className="mx-auto max-w-6xl px-4">
            <div className="reveal flex items-end justify-between">
              <div>
                <span className="eyebrow text-sm font-semibold uppercase tracking-wider text-eco-600">Tin tức</span>
                <h2 className="mt-3 text-4xl font-bold tracking-tight text-slate-900 md:text-5xl">Cập nhật mới nhất</h2>
              </div>
              <Link to="/tin-tuc" className="hidden items-center gap-1 font-semibold text-vicem-600 hover:gap-2 transition-all sm:inline-flex">
                Tất cả tin <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {news.slice(0, 4).map((n, i) => (
                <Link
                  key={n.id} to={`/tin-tuc/${n.id}`}
                  className="reveal card-hover group flex flex-col rounded-3xl border border-slate-200 bg-white p-5"
                  style={{ transitionDelay: `${i * 80}ms` }}
                >
                  <span className={`inline-block w-fit rounded-full px-2.5 py-0.5 text-xs font-medium ${NEWS_COLOR[n.category] ?? 'bg-slate-100 text-slate-600'}`}>{n.category}</span>
                  <h3 className="mt-3 font-semibold text-slate-900 line-clamp-2 transition group-hover:text-vicem-600">{n.title}</h3>
                  <p className="mt-1.5 flex-1 text-sm text-slate-600 line-clamp-3">{n.excerpt}</p>
                  <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
                    {fmtDate(n.date)}
                    <ArrowRight className="h-3.5 w-3.5 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ===== LIÊN HỆ + FOOTER ===== */}
        <section id="lien-he" className="snap-section flex flex-col">
          <div className="flex flex-1 items-center bg-slate-100 py-20">
            <div className="mx-auto grid max-w-6xl gap-10 px-4 md:grid-cols-2">
              <div className="reveal">
                <span className="eyebrow text-sm font-semibold uppercase tracking-wider text-eco-600">Liên hệ</span>
                <h2 className="mt-3 text-4xl font-bold tracking-tight text-slate-900 md:text-5xl">Kết nối với chúng tôi</h2>
                <p className="mt-3 text-slate-600">Mọi thắc mắc về công tác huấn luyện an toàn lao động và môi trường, vui lòng liên hệ Ban ATLĐ.</p>
                <ul className="mt-6 space-y-4 text-slate-700">
                  <li className="flex items-center gap-3"><span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-vicem-50 text-vicem-600"><MapPin className="h-5 w-5" /></span> {config.contact_address}</li>
                  <li className="flex items-center gap-3"><span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-vicem-50 text-vicem-600"><Phone className="h-5 w-5" /></span> {config.contact_phone}</li>
                  <li className="flex items-center gap-3"><span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-vicem-50 text-vicem-600"><Mail className="h-5 w-5" /></span> {config.contact_email}</li>
                </ul>
              </div>
              <form className="reveal rounded-3xl border border-slate-200 bg-white p-7 shadow-glow" style={{ transitionDelay: '120ms' }} onSubmit={(e) => e.preventDefault()}>
                <h3 className="text-lg font-bold text-slate-900">Gửi liên hệ</h3>
                <div className="mt-5 space-y-3">
                  <input placeholder="Họ tên" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm transition focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100" />
                  <input placeholder="Email" type="email" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm transition focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100" />
                  <textarea placeholder="Nội dung" rows={3} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm transition focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100" />
                  <button className="w-full rounded-xl bg-vicem-600 px-4 py-3 font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:bg-vicem-700">Gửi liên hệ</button>
                </div>
              </form>
            </div>
          </div>
          <footer className="bg-vicem-800 py-8 text-vicem-50/80">
            <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm md:flex-row">
              <p>{config.footer_text}</p>
              <p>{config.footer_note}</p>
            </div>
          </footer>
        </section>
      </div>
    </>
  )
}

type Goal = HomeData['goals'][number]

// Nhóm mục tiêu (Năm hoặc Tháng) có thể xổ ra / thu vào. Trạng thái mở mặc định do CMS cấu hình.
function GoalGroup({ scope, title, goals, defaultOpen, statsVisible }: {
  scope: 'year' | 'month'
  title: string
  goals: Goal[]
  defaultOpen: boolean
  statsVisible: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  // Khi dữ liệu/cấu hình tải xong, đồng bộ trạng thái mở mặc định.
  useEffect(() => { setOpen(defaultOpen) }, [defaultOpen])

  const isYear = scope === 'year'
  const headTint = isYear ? 'text-vicem-100' : 'text-eco-100'
  if (goals.length === 0) return null

  return (
    <div className="overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition hover:bg-white/5"
      >
        <span className={`flex items-center gap-2 text-sm font-semibold ${headTint}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${isYear ? 'bg-vicem-300' : 'bg-eco-400'}`} />
          {title}
          <span className="text-xs font-normal text-white/40">({goals.length})</span>
        </span>
        <ChevronDown className={`h-4 w-4 text-white/60 transition-transform duration-300 ${open ? 'rotate-0' : '-rotate-90'}`} />
      </button>
      {/* Nội dung xổ ra / thu vào bằng grid-rows để có hiệu ứng mượt */}
      <div className={`grid transition-all duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="space-y-5 px-4 pb-4 pt-1">
            {goals.map((g, i) => {
              const barColor = g.progress === 100 ? 'bg-emerald-400' : isYear ? 'bg-vicem-300' : 'bg-eco-400'
              const run = statsVisible && open
              return (
                <div key={i}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-medium">{g.title}</span>
                    <span className="shrink-0 font-bold tabular-nums"><CountUp end={g.progress} run={run} suffix="%" /></span>
                  </div>
                  {g.target && <p className="mt-1 pl-0.5 text-xs text-vicem-50/60">{g.target}</p>}
                  <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-white/15">
                    <div
                      className={`h-full rounded-full ${barColor} transition-[width] duration-[1200ms] ease-out`}
                      style={{ width: run ? `${g.progress}%` : '0%' }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
