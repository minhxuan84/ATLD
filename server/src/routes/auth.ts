import { Router } from 'express'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import { query } from '../db.js'
import { signToken, requireAuth, type Role, type AuthUser } from '../auth.js'
import { authenticateLdap } from '../lib/ldap.js'

export const authRouter = Router()

// Migration additive: thêm cột auth_provider nếu chưa có
export async function initAuthDb() {
  await query(`
    ALTER TABLE atld.users
      ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) NOT NULL DEFAULT 'local'
  `)
}

// Giới hạn số lần đăng nhập để chống dò mật khẩu
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Quá nhiều lần đăng nhập. Vui lòng thử lại sau ít phút.' },
})

interface UserRow {
  id: number
  username: string
  password_hash: string
  full_name: string
  role: Role
  permissions: string[]
  site_id: number | null
}

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body ?? {}
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Thiếu tên đăng nhập hoặc mật khẩu.' })
  }
  const { rows } = await query<UserRow>('SELECT id, username, password_hash, full_name, role, permissions, site_id FROM users WHERE username = $1', [username.trim()])
  const user = rows[0]
  // So sánh không lộ việc user có tồn tại hay không
  const ok = user ? await bcrypt.compare(password, user.password_hash) : false
  if (!user || !ok) {
    return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' })
  }
  const authUser: AuthUser = {
    id: user.id, username: user.username, fullName: user.full_name, role: user.role,
    permissions: (Array.isArray(user.permissions) ? user.permissions : []) as AuthUser['permissions'],
    siteId: user.site_id ?? null,
  }
  const token = signToken(authUser)
  res.json({ token, user: authUser })
})

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

// Giới hạn LDAP login giống local
const ldapLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Quá nhiều lần đăng nhập. Vui lòng thử lại sau ít phút.' },
})

/**
 * POST /api/auth/ldap-login
 * Đăng nhập bằng tài khoản Active Directory / LDAP công ty.
 * Khi thành công, upsert user vào atld.users (lần đầu: role=officer) rồi trả JWT giống local login.
 */
authRouter.post('/ldap-login', ldapLimiter, async (req, res) => {
  const { username, password } = req.body ?? {}
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    return res.status(400).json({ error: 'Thiếu tên đăng nhập hoặc mật khẩu.' })
  }

  // Kiểm tra LDAP có được cấu hình không
  if (!process.env.LDAP_URL) {
    return res.status(503).json({ error: 'Đăng nhập tài khoản công ty chưa được kích hoạt.' })
  }

  let ldapUser: Awaited<ReturnType<typeof authenticateLdap>>
  try {
    ldapUser = await authenticateLdap(username.trim(), password)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Xác thực thất bại.'
    // Không phân biệt "user không tồn tại" hay "sai mật khẩu" để tránh user enumeration
    const isNotFound = msg.includes('không tồn tại')
    return res.status(401).json({
      error: isNotFound ? 'Tài khoản không tồn tại hoặc mật khẩu không đúng.' : msg,
    })
  }

  // Upsert: tạo mới lần đầu đăng nhập, cập nhật full_name ở lần sau
  const { rows } = await query<UserRow>(
    `INSERT INTO atld.users (username, password_hash, full_name, role, permissions, auth_provider)
     VALUES ($1, '', $2, 'officer', '[]', 'ldap')
     ON CONFLICT (username) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           auth_provider = 'ldap'
     RETURNING id, username, full_name, role, permissions, site_id`,
    [ldapUser.username, ldapUser.fullName],
  )
  const user = rows[0]
  const authUser: AuthUser = {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    role: user.role,
    permissions: (Array.isArray(user.permissions) ? user.permissions : []) as AuthUser['permissions'],
    siteId: user.site_id ?? null,
  }
  const token = signToken(authUser)
  res.json({ token, user: authUser })
})

// Giới hạn đăng ký để tránh spam
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 giờ
  max: 5,
  message: { error: 'Quá nhiều lần tạo tài khoản. Vui lòng thử lại sau.' },
})

authRouter.post('/register', registerLimiter, async (req, res) => {
  const { username, fullName, password } = req.body ?? {}
  if (typeof username !== 'string' || typeof fullName !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Thiếu thông tin đăng ký.' })
  }
  const phone = username.replace(/\D/g, '')
  if (!/^0\d{9}$/.test(phone)) {
    return res.status(400).json({ error: 'Số điện thoại không hợp lệ.' })
  }
  const name = fullName.trim()
  if (!name || name.length > 150) {
    return res.status(400).json({ error: 'Họ và tên không hợp lệ.' })
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
    return res.status(400).json({ error: 'Mật khẩu cần 6–128 ký tự.' })
  }

  // Kiểm tra trùng số điện thoại
  const { rows: exist } = await query('SELECT id FROM atld.users WHERE username = $1', [phone])
  if (exist.length > 0) {
    return res.status(409).json({ error: 'Số điện thoại này đã có tài khoản. Vui lòng đăng nhập.' })
  }

  const hash = await bcrypt.hash(password, 12)
  await query(
    `INSERT INTO atld.users (username, password_hash, full_name, role, permissions)
     VALUES ($1, $2, $3, 'trainee', '[]')`,
    [phone, hash, name],
  )
  res.status(201).json({ ok: true })
})
