import { lazy, type ReactNode } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Header from './components/layout/Header'
import Footer from './components/layout/Footer'
import { useAuth, canAccess, hasCmsAccess } from './context/AuthContext'
import type { CmsSection } from './types'

const HomePage = lazy(() => import('./pages/HomePage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const OAuthCallbackPage = lazy(() => import('./pages/OAuthCallbackPage'))
const TrainingListPage = lazy(() => import('./pages/TrainingListPage'))
const TrainingDetailPage = lazy(() => import('./pages/TrainingDetailPage'))
const DocumentsPage = lazy(() => import('./pages/DocumentsPage'))
const HsePage = lazy(() => import('./pages/hse/HsePage'))
const GatePage = lazy(() => import('./pages/hse/GatePage'))
const NewsPage = lazy(() => import('./pages/NewsPage'))
const NewsDetailPage = lazy(() => import('./pages/NewsDetailPage'))
const CmsLayout = lazy(() => import('./pages/cms/CmsLayout'))
const Dashboard = lazy(() => import('./pages/cms/Dashboard'))
const UsersManager = lazy(() => import('./pages/cms/UsersManager'))
const CoursesManager = lazy(() => import('./pages/cms/CoursesManager'))
const GoalsManager = lazy(() => import('./pages/cms/GoalsManager'))
const SiteSettings = lazy(() => import('./pages/cms/SiteSettings'))
const NewsManager = lazy(() => import('./pages/cms/NewsManager'))
const BranchesManager = lazy(() => import('./pages/cms/BranchesManager'))
const QuizFieldsManager = lazy(() => import('./pages/cms/QuizFieldsManager'))
const MenuManager = lazy(() => import('./pages/cms/MenuManager'))
const LdapConfigPage = lazy(() => import('./pages/cms/LdapConfigPage'))
const SmartCAConfigPage = lazy(() => import('./pages/cms/SmartCAConfigPage'))
const WorkerDeclarePage = lazy(() => import('./pages/portal/WorkerDeclarePage'))
const FieldReportPage = lazy(() => import('./pages/portal/FieldReportPage'))
const CapaResponsePage = lazy(() => import('./pages/portal/CapaResponsePage'))

function Protected({ children, role }: { children: ReactNode; role?: 'admin' }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="py-20 text-center text-slate-500">Đang tải…</div>
  if (!user) return <Navigate to="/dang-nhap" state={{ from: location.pathname }} replace />
  if (role && user.role !== role) return <Navigate to="/" replace />
  return <>{children}</>
}

// Cổng vào khu vực CMS: cho phép admin hoặc cán bộ đã được cấp ít nhất 1 mục.
function CmsProtected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="py-20 text-center text-slate-500">Đang tải…</div>
  if (!user) return <Navigate to="/dang-nhap" state={{ from: location.pathname }} replace />
  if (!hasCmsAccess(user)) return <Navigate to="/" replace />
  return <>{children}</>
}

// Bảo vệ từng mục CMS theo quyền; thiếu quyền → quay về tổng quan CMS.
function SectionGuard({ section, children }: { section: CmsSection; children: ReactNode }) {
  const { user } = useAuth()
  if (!canAccess(user, section)) return <Navigate to="/cms" replace />
  return <>{children}</>
}

function PublicShell() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Routes>
          <Route path="/dang-nhap" element={<LoginPage />} />
          <Route path="/dang-ky" element={<RegisterPage />} />
          <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
          <Route path="/tin-tuc" element={<NewsPage />} />
          <Route path="/tin-tuc/:id" element={<NewsDetailPage />} />
          <Route path="/huan-luyen" element={<Protected><TrainingListPage /></Protected>} />
          <Route path="/huan-luyen/:id" element={<Protected><TrainingDetailPage /></Protected>} />
          <Route path="/tai-lieu" element={<Protected><DocumentsPage /></Protected>} />
          <Route path="/cong-kiem-soat" element={<Protected><GatePage /></Protected>} />
          <Route path="*" element={<div className="py-20 text-center text-slate-500">Không tìm thấy trang.</div>} />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      {/* Trang chủ fullpage - tự quản header/footer, chiếm toàn màn hình */}
      <Route path="/" element={<HomePage />} />

      {/* Khu vực CMS quản trị (chỉ admin) - bố cục riêng, không dùng Header/Footer công khai */}
      <Route path="/cms" element={<CmsProtected><CmsLayout /></CmsProtected>}>
        <Route index element={<Dashboard />} />
        <Route path="nguoi-dung" element={<SectionGuard section="nguoi-dung"><UsersManager /></SectionGuard>} />
        <Route path="chi-nhanh" element={<SectionGuard section="chi-nhanh"><BranchesManager /></SectionGuard>} />
        <Route path="khoa-hoc" element={<SectionGuard section="khoa-hoc"><CoursesManager /></SectionGuard>} />
        <Route path="truong-trac-nghiem" element={<SectionGuard section="truong-trac-nghiem"><QuizFieldsManager /></SectionGuard>} />
        <Route path="tin-tuc" element={<SectionGuard section="tin-tuc"><NewsManager /></SectionGuard>} />
        <Route path="tai-lieu" element={<SectionGuard section="tai-lieu"><DocumentsPage /></SectionGuard>} />
        <Route path="an-toan/*" element={<SectionGuard section="an-toan"><HsePage /></SectionGuard>} />
        <Route path="muc-tieu" element={<SectionGuard section="muc-tieu"><GoalsManager /></SectionGuard>} />
        <Route path="menu" element={<SectionGuard section="menu"><MenuManager /></SectionGuard>} />
        <Route path="trang-tinh" element={<SectionGuard section="trang-tinh"><SiteSettings /></SectionGuard>} />
        <Route path="ldap" element={<LdapConfigPage />} />
        <Route path="smartca" element={<SmartCAConfigPage />} />
      </Route>

      {/* Cổng khai báo cho nhà thầu — mở bằng link có token, KHÔNG cần đăng nhập.
          Đặt ngoài PublicShell: người mở là nhà thầu không có tài khoản, Header với
          các liên kết nội bộ và nút đăng nhập chỉ gây nhiễu. */}
      <Route path="/khai-bao/:token" element={<WorkerDeclarePage />} />
      <Route path="/bao-an-toan/:token" element={<FieldReportPage />} />
      <Route path="/khac-phuc/:token" element={<CapaResponsePage />} />

      {/* Toàn bộ trang công khai */}
      <Route path="/*" element={<PublicShell />} />
    </Routes>
  )
}
