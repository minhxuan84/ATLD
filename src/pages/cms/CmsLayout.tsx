import { useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth, canAccess } from '../../context/AuthContext'
import type { CmsSection } from '../../types'
import Logo from '../../components/Logo'
import {
  LayoutDashboard, Users, GraduationCap, FileText, Newspaper, Target,
  Home, LogOut, Palette, Building2, ClipboardList, ListTree, HardHat,
  ChevronLeft, ChevronRight, Server,
} from 'lucide-react'

// section = mục quyền tương ứng; undefined = luôn hiển thị (trang tổng quan).
const MENU: { to: string; label: string; icon: typeof Users; end?: boolean; section?: CmsSection; adminOnly?: boolean }[] = [
  { to: '/cms', label: 'Tổng quan', icon: LayoutDashboard, end: true },
  { to: '/cms/nguoi-dung', label: 'Người dùng', icon: Users, section: 'nguoi-dung' },
  { to: '/cms/chi-nhanh', label: 'Chi nhánh / đơn vị', icon: Building2, section: 'chi-nhanh' },
  { to: '/cms/khoa-hoc', label: 'Khóa học & câu hỏi', icon: GraduationCap, section: 'khoa-hoc' },
  { to: '/cms/truong-trac-nghiem', label: 'Trường trắc nghiệm', icon: ClipboardList, section: 'truong-trac-nghiem' },
  { to: '/cms/tin-tuc', label: 'Tin tức', icon: Newspaper, section: 'tin-tuc' },
  { to: '/cms/tai-lieu', label: 'Tài liệu', icon: FileText, section: 'tai-lieu' },
  { to: '/cms/muc-tieu', label: 'Mục tiêu & Timeline', icon: Target, section: 'muc-tieu' },
  { to: '/cms/menu', label: 'Quản lý menu', icon: ListTree, section: 'menu' },
  { to: '/cms/trang-tinh', label: 'Trang tĩnh & Nhận diện', icon: Palette, section: 'trang-tinh' },
  { to: '/cms/an-toan', label: 'ATVSLĐ / PCCN / BVMT', icon: HardHat, section: 'an-toan' },
  { to: '/cms/ldap', label: 'Cấu hình LDAP / AD', icon: Server, adminOnly: true },
]

export default function CmsLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // Sidebar co giãn — lưu trạng thái vào localStorage
  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem('cms-sidebar-collapsed') === '1'
  )

  // Chỉ hiển thị mục user có quyền (admin thấy tất cả).
  const menu = MENU.filter((m) => {
    if (m.adminOnly) return user?.role === 'admin'
    return !m.section || canAccess(user, m.section)
  })

  // Trang ATVSLĐ cần full-width để bảng không bị tràn
  const isFullPage = pathname.startsWith('/cms/an-toan')

  const toggleCollapsed = () =>
    setCollapsed((v) => {
      const next = !v
      localStorage.setItem('cms-sidebar-collapsed', next ? '1' : '0')
      return next
    })

  return (
    <div className="flex min-h-screen">
      {/* ── Sidebar dọc ─────────────────────────────────────────── */}
      <aside
        className={`hidden shrink-0 flex-col bg-vicem-800 text-white transition-all duration-200 md:flex ${
          collapsed ? 'w-16' : 'w-[260px]'
        }`}
      >
        {/* Logo */}
        <div
          className={`flex items-center border-b border-white/10 bg-white ${
            collapsed ? 'justify-center px-2 py-3' : 'gap-2 px-4 py-3'
          }`}
        >
          {collapsed ? (
            /* Chỉ hiện biểu tượng SVG khi thu gọn */
            <svg width="32" height="32" viewBox="0 0 40 40" aria-hidden className="shrink-0">
              <rect width="40" height="40" rx="6" fill="#0055A4" />
              <path d="M8 10 L14 26 L17 26 L11 10 Z" fill="#fff" />
              <path d="M30 12 a8 8 0 1 0 0 16 a8 8 0 0 1 0 -16 Z" fill="#E2231A" />
              <path d="M16 10 L22 26 L25 26 L19 10 Z" fill="#fff" opacity="0.85" />
            </svg>
          ) : (
            <Logo />
          )}
        </div>

        {!collapsed && (
          <div className="px-4 py-3 text-xs uppercase tracking-wider text-vicem-100/60">
            Quản trị hệ thống
          </div>
        )}

        {/* Nav items */}
        <nav className="flex-1 space-y-0.5 px-2 py-2">
          {menu.map((m) => {
            const Icon = m.icon
            return (
              <NavLink
                key={m.to}
                to={m.to}
                end={m.end}
                title={collapsed ? m.label : undefined}
                className={({ isActive }) =>
                  `flex items-center rounded-lg px-2.5 py-2.5 text-sm font-medium transition ${
                    collapsed ? 'justify-center' : 'gap-3'
                  } ${
                    isActive
                      ? 'bg-white/15 text-white'
                      : 'text-vicem-100/80 hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden />
                {!collapsed && <span className="truncate">{m.label}</span>}
              </NavLink>
            )
          })}
        </nav>

        {/* Footer sidebar: user info + nút */}
        <div className="border-t border-white/10 p-2">
          {!collapsed && (
            <div className="px-2.5 py-2 text-sm">
              <p className="truncate font-medium">{user?.fullName}</p>
              <p className="text-xs text-vicem-100/60">Quản trị viên</p>
            </div>
          )}

          <NavLink
            to="/"
            title={collapsed ? 'Về trang chủ' : undefined}
            className={`flex items-center rounded-lg px-2.5 py-2 text-sm text-vicem-100/80 hover:bg-white/10 hover:text-white ${
              collapsed ? 'justify-center' : 'gap-3'
            }`}
          >
            <Home className="h-4 w-4 shrink-0" />
            {!collapsed && 'Về trang chủ'}
          </NavLink>

          <button
            onClick={() => { logout(); navigate('/dang-nhap') }}
            title={collapsed ? 'Đăng xuất' : undefined}
            className={`mt-0.5 flex w-full items-center rounded-lg px-2.5 py-2 text-sm text-vicem-100/80 hover:bg-white/10 hover:text-white ${
              collapsed ? 'justify-center' : 'gap-3'
            }`}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && 'Đăng xuất'}
          </button>

          {/* Toggle thu gọn / mở rộng */}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'}
            className={`mt-2 flex w-full items-center rounded-lg px-2.5 py-1.5 text-xs text-vicem-100/50 transition hover:bg-white/10 hover:text-vicem-100/90 ${
              collapsed ? 'justify-center' : 'gap-2'
            }`}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span>Thu gọn</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* ── Nội dung chính ──────────────────────────────────────── */}
      <div className="min-w-0 flex-1 bg-slate-100">
        {/* Thanh trên cùng cho mobile */}
        <div className="flex items-center justify-between bg-vicem-800 px-4 py-3 text-white md:hidden">
          <span className="font-semibold">CMS Quản trị</span>
          <NavLink to="/" className="text-sm underline">Trang chủ</NavLink>
        </div>
        {/* Menu mobile ngang */}
        <nav className="flex gap-1 overflow-x-auto bg-vicem-700 px-2 py-2 md:hidden">
          {menu.map((m) => (
            <NavLink
              key={m.to}
              to={m.to}
              end={m.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium ${
                  isActive ? 'bg-white/20 text-white' : 'text-vicem-100/80'
                }`
              }
            >
              {m.label}
            </NavLink>
          ))}
        </nav>

        {/* Outlet — fullpage cho ATVSLĐ, giới hạn chiều rộng cho các trang khác */}
        <div className={isFullPage ? 'p-4 md:p-6' : 'mx-auto max-w-5xl p-5 md:p-8'}>
          <Outlet />
        </div>
      </div>
    </div>
  )
}
