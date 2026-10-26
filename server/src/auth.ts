import jwt from 'jsonwebtoken'
import type { Request, Response, NextFunction } from 'express'
import { query } from './db.js'

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

// Production thiếu JWT_SECRET → dừng khởi động, không lặng lẽ ký token bằng khoá ai cũng biết.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET chưa được đặt — bắt buộc khi NODE_ENV=production.')
}
export const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret'
const SECRET = JWT_SECRET
const EXPIRES = process.env.JWT_EXPIRES || '8h'
// "Lưu đăng nhập": token sống lâu (mặc định 30 ngày) để giữ phiên qua nhiều ngày,
// thay vì hết hạn sau 8h khiến người dùng bị đăng xuất dù đã tích "Lưu đăng nhập".
const EXPIRES_REMEMBER = process.env.JWT_EXPIRES_REMEMBER || '30d'

export function signToken(user: AuthUser, remember = false): string {
  const expiresIn = (remember ? EXPIRES_REMEMBER : EXPIRES) as jwt.SignOptions['expiresIn']
  return jwt.sign(user, SECRET, { expiresIn })
}

// Quyền/site trong JWT có thể đã cũ (admin đổi site/quyền sau khi user đăng nhập, token sống tới 30 ngày).
// Vì vậy mỗi request nạp lại role/permissions/site_id từ DB, cache ngắn để không query mỗi lần.
type FreshUser = { role: Role; permissions: CmsSection[]; siteId: number | null; fullName: string }
const userCache = new Map<number, { at: number; u: FreshUser | null }>()
const USER_CACHE_MS = 30_000

// Gọi khi sửa/xoá user để thay đổi quyền/site có hiệu lực ngay.
export function invalidateUserCache(id?: number) {
  if (id == null) userCache.clear()
  else userCache.delete(id)
}

async function loadFreshUser(id: number): Promise<FreshUser | null> {
  const hit = userCache.get(id)
  if (hit && Date.now() - hit.at < USER_CACHE_MS) return hit.u
  const { rows } = await query<{ role: Role; permissions: unknown; site_id: number | null; full_name: string }>(
    'SELECT role, permissions, site_id, full_name FROM atld.users WHERE id = $1', [id],
  )
  const r = rows[0]
  const u: FreshUser | null = r
    ? {
        role: r.role,
        permissions: Array.isArray(r.permissions) ? (r.permissions as CmsSection[]) : [],
        siteId: typeof r.site_id === 'number' ? r.site_id : null,
        fullName: r.full_name,
      }
    : null
  userCache.set(id, { at: Date.now(), u })
  return u
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Chưa đăng nhập.' })
  }
  let payload: AuthUser
  try {
    payload = jwt.verify(header.slice(7), SECRET) as AuthUser
  } catch {
    return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' })
  }
  loadFreshUser(payload.id).then((fresh) => {
    // User đã bị xoá → token không còn giá trị
    if (!fresh) return res.status(401).json({ error: 'Tài khoản không còn tồn tại.' })
    req.user = {
      id: payload.id, username: payload.username, fullName: fresh.fullName,
      role: fresh.role, permissions: fresh.permissions, siteId: fresh.siteId,
    }
    next()
  }, (err) => next(err))
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
