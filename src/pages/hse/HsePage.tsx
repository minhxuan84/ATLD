// Trang quản lý ATVSLĐ / PCCN / BVMT (QT111-07) — bố cục tab + sub-router.
import { lazy, Suspense } from 'react'
import { NavLink, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth, canHse } from '../../context/AuthContext'

const ContractorsPage = lazy(() => import('./ContractorsPage'))
const WorkersPage = lazy(() => import('./WorkersPage'))
const EquipmentPage = lazy(() => import('./EquipmentPage'))
const DossiersPage = lazy(() => import('./DossiersPage'))
const CommitmentsPage = lazy(() => import('./CommitmentsPage'))
const InspectionsPage = lazy(() => import('./InspectionsPage'))
const SuspensionsPage = lazy(() => import('./SuspensionsPage'))
const GatePage = lazy(() => import('./GatePage'))
const VisitorsPage = lazy(() => import('./VisitorsPage'))
const EvaluationsPage = lazy(() => import('./EvaluationsPage'))
const DashboardPage = lazy(() => import('./DashboardPage'))
const DocTypesConfigPage = lazy(() => import('./DocTypesConfigPage'))
const JsaConfigPage = lazy(() => import('./JsaConfigPage'))
const PermitsPage = lazy(() => import('./PermitsPage'))
const AuditLogPage = lazy(() => import('./AuditLogPage'))

export default function HsePage() {
  const { user } = useAuth()
  // Cấu hình chỉ dành cho 'an-toan' toàn quyền hoặc admin.
  const isHseAdmin = user?.role === 'admin' || !!user?.permissions?.includes('an-toan')
  // Hiển thị tab theo sub-permission; admin và 'an-toan' toàn quyền thấy tất cả.
  const tabs = [
    { to: 'dashboard', label: 'Tổng quan', show: canHse(user, 'inspect', 'approve') },
    { to: 'nha-thau', label: 'Nhà thầu & Hợp đồng', show: canHse(user, 'inspect', 'approve') },
    { to: 'ho-so', label: 'Đánh giá hồ sơ', show: canHse(user, 'inspect', 'approve') },
    { to: 'nguoi-lao-dong', label: 'Người lao động', show: canHse(user, 'inspect', 'approve') },
    { to: 'thiet-bi', label: 'Thiết bị', show: canHse(user, 'inspect', 'approve') },
    { to: 'cam-ket', label: 'Bản cam kết', show: canHse(user, 'inspect', 'approve') },
    { to: 'khach', label: 'Khách & NCC', show: canHse(user, 'gate', 'inspect', 'approve') },
    { to: 'danh-gia', label: 'Đánh giá định kỳ', show: canHse(user, 'inspect', 'approve') },
    { to: 'kiem-tra', label: 'Kiểm tra ATMT', show: canHse(user, 'inspect', 'approve') },
    { to: 'dinh-chi', label: 'Đình chỉ công việc', show: canHse(user, 'approve') },
    { to: 'giay-phep', label: 'Giấy phép làm việc', show: canHse(user, 'inspect', 'approve') },
    { to: 'cong', label: 'Cổng kiểm soát', show: canHse(user, 'gate', 'inspect', 'approve') },
    { to: 'cong-viec', label: 'Danh mục công việc', show: isHseAdmin },
    { to: 'nhat-ky', label: 'Nhật ký hoạt động', show: isHseAdmin },
    { to: 'cau-hinh', label: 'Cấu hình hồ sơ', show: isHseAdmin },
  ].filter((t) => t.show)
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Quản lý ATVSLĐ / PCCN / BVMT</h1>
        <p className="text-sm text-slate-500">Kiểm soát an toàn cho nhà thầu, nhà cung cấp và khách bên ngoài (QT111-07).</p>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to}
            className={({ isActive }) =>
              `rounded-t-md px-5 py-2.5 text-base font-medium transition ${
                isActive ? 'border-b-2 border-vicem-500 text-vicem-500' : 'text-slate-500 hover:text-slate-700'
              }`}
          >{t.label}</NavLink>
        ))}
      </nav>

      <Suspense fallback={<div className="py-10 text-center text-slate-400">Đang tải…</div>}>
        <Routes>
          <Route index element={<Navigate to={tabs[0]?.to ?? 'cong'} replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="nha-thau" element={<ContractorsPage />} />
          <Route path="ho-so" element={<DossiersPage />} />
          <Route path="nguoi-lao-dong" element={<WorkersPage />} />
          <Route path="thiet-bi" element={<EquipmentPage />} />
          <Route path="cam-ket" element={<CommitmentsPage />} />
          <Route path="khach" element={<VisitorsPage />} />
          <Route path="danh-gia" element={<EvaluationsPage />} />
          <Route path="kiem-tra" element={<InspectionsPage />} />
          <Route path="dinh-chi" element={<SuspensionsPage />} />
          <Route path="giay-phep" element={<PermitsPage />} />
          <Route path="cong" element={<GatePage embedded />} />
          <Route path="cong-viec" element={<JsaConfigPage />} />
          <Route path="nhat-ky" element={<AuditLogPage />} />
          <Route path="cau-hinh" element={<DocTypesConfigPage />} />
        </Routes>
      </Suspense>
    </div>
  )
}
