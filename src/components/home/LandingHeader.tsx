import { Link } from 'react-router-dom'
import { useAuth, hasCmsAccess } from '../../context/AuthContext'
import { useConfig } from '../../context/ConfigContext'
import Logo from '../Logo'
import { LogIn, Settings, LayoutGrid } from 'lucide-react'

export default function LandingHeader({ solid }: { solid: boolean }) {
  const { user } = useAuth()
  const { menu } = useConfig()

  return (
    <header className={`fixed inset-x-0 top-0 z-40 transition-all duration-300 ${solid ? 'bg-white/95 shadow-md backdrop-blur' : 'bg-transparent'}`}>
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 sm:gap-4 sm:px-5 sm:py-4">
        <a href="#home" className={`rounded ${solid ? '' : 'rounded-lg bg-white/90 px-2 py-1 sm:px-2.5 sm:py-1.5'}`} aria-label="VICEM Hà Tiên">
          <Logo size="lg" />
        </a>

        <nav className="ml-auto hidden items-center gap-2 lg:flex" aria-label="Điều hướng">
          {menu.map((n) => (
            <a
              key={n.id}
              href={n.href}
              className={`rounded-lg px-4 py-2.5 text-base font-semibold transition ${
                solid ? 'text-slate-700 hover:bg-slate-100 hover:text-vicem-700' : 'text-white hover:bg-white/15'
              }`}
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2 lg:ml-0">
          <Link
            to="/huan-luyen"
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition sm:px-4 sm:py-2.5 sm:text-base ${
              solid ? 'text-vicem-700 hover:bg-vicem-50' : 'text-white hover:bg-white/15'
            }`}
          >
            <LayoutGrid className="h-5 w-5" /> <span className="hidden sm:inline">Hệ thống huấn luyện</span>
          </Link>
          {hasCmsAccess(user) && (
            <Link to="/cms" className="inline-flex items-center gap-2 rounded-lg bg-hatien-500 px-3 py-2 text-sm font-semibold text-white hover:bg-hatien-600 sm:px-4 sm:py-2.5 sm:text-base">
              <Settings className="h-5 w-5" /> <span className="hidden sm:inline">CMS</span>
            </Link>
          )}
          {!user && (
            <Link to="/dang-nhap" className="inline-flex items-center gap-2 rounded-lg bg-vicem-600 px-3 py-2 text-sm font-semibold text-white hover:bg-vicem-700 sm:px-5 sm:py-2.5 sm:text-base">
              <LogIn className="h-5 w-5" /> Đăng nhập
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
