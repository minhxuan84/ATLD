import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth, canAccess } from '../../context/AuthContext'
import type { CmsSection } from '../../types'
import Logo from '../../components/Logo'
import { LayoutDashboard, Users, GraduationCap, FileText, Newspaper, Target, Home, LogOut, Palette, Building2, ClipboardList, ListTree } from 'lucide-react'

// section = mục quyền tương ứng; undefined = luôn hiển thị (trang tổng quan).
const MENU: { to: string; label: string; icon: typeof Users; end?: boolean; section?: CmsSection }[] = [
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
]

export default function CmsLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  // Chỉ hiển thị mục user có quyền (admin thấy tất cả).
  const menu = MENU.filter((m) => !m.section || canAccess(user, m.section))

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[260px_1fr]">
      {/* Sidebar */}
      <aside className="hidden flex-col bg-vicem-800 text-white md:flex">
        <div className="flex items-center gap-2 border-b border-white/10 bg-white px-4 py-3">
          <Logo />
        </div>
        <div className="px-4 py-3 text-xs uppercase tracking-wider text-vicem-100/60">Quản trị hệ thống</div>
        <nav className="flex-1 space-y-1 px-3">
          {menu.map((m) => {
            const Icon = m.icon
            return (
              <NavLink
                key={m.to}
                to={m.to}
                end={m.end}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    isActive ? 'bg-white/15 text-white' : 'text-vicem-100/80 hover:bg-white/10'
                  }`
                }
              >
                <Icon className="h-5 w-5" aria-hidden /> {m.label}
              </NavLink>
            )
          })}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="px-3 py-2 text-sm">
            <p className="font-medium">{user?.fullName}</p>
            <p className="text-xs text-vicem-100/60">Quản trị viên</p>
          </div>
          <NavLink to="/" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-vicem-100/80 hover:bg-white/10">
            <Home className="h-4 w-4" /> Về trang chủ
          </NavLink>
          <button
            onClick={() => { logout(); navigate('/dang-nhap') }}
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-vicem-100/80 hover:bg-white/10"
          >
            <LogOut className="h-4 w-4" /> Đăng xuất
          </button>
        </div>
      </aside>

      {/* Nội dung */}
      <div className="bg-slate-100">
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
                `whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium ${isActive ? 'bg-white/20 text-white' : 'text-vicem-100/80'}`
              }
            >
              {m.label}
            </NavLink>
          ))}
        </nav>

        <div className="mx-auto max-w-5xl p-5 md:p-8">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
