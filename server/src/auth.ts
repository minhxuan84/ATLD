import jwt from 'jsonwebtoken'
import type { Request, Response, NextFunction } from 'express'

export type Role = 'trainee' | 'officer' | 'admin'

// Các mục CMS có thể phân quyền cho cán bộ (officer). Admin luôn toàn quyền.
export const CMS_SECTIONS = [
  'nguoi-dung', 'chi-nhanh', 'khoa-hoc', 'truong-trac-nghiem',
  'tin-tuc', 'tai-lieu', 'muc-tieu', 'menu', 'trang-tinh', 'an-toan',
  'an-toan:gate', 'an-toan:inspect', 'an-toan:approve',
] as const
export type CmsSection = (typeof CMS_SECTIONS)[number]

export interface AuthUser {
  id: number
  username: string
  fullName: string
  role: Role
  permissions: CmsSection[]
  siteId: number | null // Chi nhánh/nhà máy user phụ trách (null = admin/toàn quyền, xem mọi site)
}

// Phạm vi site của user cho việc lọc dữ liệu HSE.
// all=true (xem mọi site): admin, HOẶC user chưa được gán site (siteId=null).
// all=false: user đã gán site → chỉ thấy đúng site đó, kể cả khi có quyền 'an-toan'
//   (quyền 'an-toan' chỉ mở quyền truy cập module HSE, KHÔNG bỏ giới hạn site).
export function siteScope(user: AuthUser): { all: boolean; siteId: number | null } {
  if (user.role === 'admin') return { all: true, siteId: null }
  if (user.siteId == null) return { all: true, siteId: null }
  return { all: false, siteId: user.siteId }
}

// Mở rộng Request để mang thông tin user sau khi xác thực
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

const SECRET = process.env.JWT_SECRET || 'dev_secret'
const EXPIRES = process.env.JWT_EXPIRES || '8h'
// "Lưu đăng nhập": token sống lâu (mặc định 30 ngày) để giữ phiên qua nhiều ngày,
// thay vì hết hạn sau 8h khiến người dùng bị đăng xuất dù đã tích "Lưu đăng nhập".
const EXPIRES_REMEMBER = process.env.JWT_EXPIRES_REMEMBER || '30d'

export function signToken(user: AuthUser, remember = false): string {
  const expiresIn = (remember ? EXPIRES_REMEMBER : EXPIRES) as jwt.SignOptions['expiresIn']
  return jwt.sign(user, SECRET, { expiresIn })
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Chưa đăng nhập.' })
  }
  try {
    const payload = jwt.verify(header.slice(7), SECRET) as AuthUser
    req.user = {
      id: payload.id, username: payload.username, fullName: payload.fullName, role: payload.role,
      permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
      siteId: typeof payload.siteId === 'number' ? payload.siteId : null,
    }
    next()
  } catch {
    return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' })
  }
}

// RBAC được thực thi phía SERVER — client không thể bỏ qua.
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Chưa đăng nhập.' })
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này.' })
    }
    next()
  }
}

// Kiểm tra quyền theo mục CMS. Admin luôn được phép; officer cần được cấp ÍT NHẤT MỘT
// trong các mục liệt kê (dùng cho endpoint dùng chung, ví dụ danh sách chi nhánh cho form khóa học).
export function requireSection(...sections: CmsSection[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Chưa đăng nhập.' })
    if (req.user.role === 'admin' || sections.some((s) => req.user!.permissions.includes(s))) return next()
    return res.status(403).json({ error: 'Bạn không có quyền truy cập mục này.' })
  }
}

// Cho phép truy cập khu vực CMS nói chung: admin hoặc officer đã được cấp ít nhất 1 mục.
export function requireCms(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Chưa đăng nhập.' })
  if (req.user.role === 'admin' || req.user.permissions.length > 0) return next()
  return res.status(403).json({ error: 'Bạn không có quyền truy cập khu vực quản trị.' })
}

// Kiểm tra quyền HSE sub-section. Admin và user có 'an-toan' (toàn quyền) luôn được phép.
// Nếu không có 'an-toan', kiểm tra sub-key cụ thể (an-toan:gate / :inspect / :approve).
export function requireHse(...subKeys: ('gate' | 'inspect' | 'approve')[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Chưa đăng nhập.' })
    const p = req.user.permissions
    if (req.user.role === 'admin' || p.includes('an-toan')) return next()
    if (subKeys.some((k) => p.includes(`an-toan:${k}` as CmsSection))) return next()
    return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này.' })
  }
}
