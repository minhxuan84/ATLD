import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth, hasCmsAccess, canAccess } from '../../context/AuthContext'
import Logo from '../Logo'
import { LogOut, LogIn, User, Settings, HardHat } from 'lucide-react'

const NAV = [
  { to: '/', label: 'Trang chủ', end: true },
  { to: '/huan-luyen', label: 'Huấn luyện ATLĐ' },
  { to: '/tai-lieu', label: 'Tài liệu hồ sơ' },
  { to: '/tin-tuc', label: 'Tin tức' },
]

const ROLE_LABEL: Record<string, string> = {
  trainee: 'Học viên',
  officer: 'Cán bộ ATLĐ',
  admin: 'Quản trị',
}

export default function Header() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <header className="sticky top-0 z-20 border-b-2 border-vicem-500 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2.5">
        <NavLink to="/" aria-label="Trang chủ VICEM Hà Tiên">
          <Logo />
        </NavLink>

        <nav className="order-3 w-full md:order-2 md:w-auto md:flex-1" aria-label="Điều hướng chính">
          <ul className="flex flex-wrap gap-1">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) =>
                    `block rounded-lg px-3 py-2 text-sm font-medium transition ${
                      isActive ? 'bg-vicem-100 text-vicem-700' : 'text-slate-600 hover:bg-slate-100'
                    }`
                  }
                >
                  {n.label}
                </NavLink>
              </li>
            ))}
            {/* Hiển thị link ATVSLĐ cho người dùng có quyền an-toan */}
            {user && canAccess(user, 'an-toan') && (
              <li>
                <NavLink
                  to="/cms/an-toan"
                  className={({ isActive }) =>
                    `flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      isActive ? 'bg-vicem-100 text-vicem-700' : 'text-slate-600 hover:bg-slate-100'
                    }`
                  }
                >
                  <HardHat className="h-4 w-4" /> ATVSLĐ
                </NavLink>
              </li>
            )}
          </ul>
        </nav>

        <div className="order-2 ml-auto flex items-center gap-3 text-sm md:order-3">
          {user ? (
            <>
              {hasCmsAccess(user) && (
                <NavLink to="/cms" className="inline-flex items-center gap-1.5 rounded-lg bg-hatien-500 px-3 py-1.5 font-semibold text-white hover:bg-hatien-600">
                  <Settings className="h-4 w-4" /> <span className="hidden sm:inline">CMS</span>
                </NavLink>
              )}
              <span className="hidden items-center gap-1.5 text-slate-600 sm:flex">
                <User className="h-4 w-4 text-vicem-500" />
                <span className="max-w-[160px] truncate">{user.fullName}</span>
                <span className="rounded bg-vicem-100 px-1.5 py-0.5 text-xs font-medium text-vicem-700">{ROLE_LABEL[user.role]}</span>
              </span>
              <button
                onClick={() => { logout(); navigate('/dang-nhap') }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-50"
              >
                <LogOut className="h-4 w-4" /> Đăng xuất
              </button>
            </>
          ) : (
            <NavLink to="/dang-nhap" className="inline-flex items-center gap-1.5 rounded-lg bg-vicem-500 px-4 py-1.5 font-semibold text-white hover:bg-vicem-600">
              <LogIn className="h-4 w-4" /> Đăng nhập
            </NavLink>
          )}
        </div>
      </div>
    </header>
  )
}
