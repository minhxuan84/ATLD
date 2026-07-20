import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import type { Role, CmsSection } from '../types'
import { api, getToken, setToken } from '../lib/api'

export interface AuthUser {
  id: number
  username: string
  fullName: string
  role: Role
  permissions: CmsSection[]
  siteId: number | null // Chi nhánh/nhà máy phụ trách (null = xem mọi site)
}

// user xem được mọi site (admin, hoặc chưa gán site) hay bị giới hạn theo siteId.
// Lưu ý: quyền 'an-toan' chỉ mở truy cập module HSE, KHÔNG bỏ giới hạn site — phải khớp siteScope() ở backend.
export function seesAllSites(user: AuthUser | null): boolean {
  if (!user) return false
  return user.role === 'admin' || user.siteId == null
}

// Tiện ích: user có quyền vào một mục CMS không (admin luôn có).
export function canAccess(user: AuthUser | null, section: CmsSection): boolean {
  if (!user) return false
  return user.role === 'admin' || user.permissions?.includes(section)
}
// Kiểm tra sub-permission HSE. Admin và 'an-toan' toàn quyền luôn pass.
export function canHse(user: AuthUser | null, ...subKeys: ('gate' | 'inspect' | 'approve')[]): boolean {
  if (!user) return false
  if (user.role === 'admin' || user.permissions?.includes('an-toan')) return true
  return subKeys.some((k) => user.permissions?.includes(`an-toan:${k}` as CmsSection))
}
// user có được vào khu vực CMS nói chung không (admin hoặc có ít nhất 1 quyền).
export function hasCmsAccess(user: AuthUser | null): boolean {
  if (!user) return false
  return user.role === 'admin' || (user.permissions?.length ?? 0) > 0
}

interface AuthState {
  user: AuthUser | null
  loading: boolean
  login: (username: string, password: string, remember?: boolean) => Promise<void>
  ldapLogin: (username: string, password: string, remember?: boolean) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  // Khôi phục phiên từ token đã lưu
  useEffect(() => {
    const token = getToken()
    if (!token) {
      setLoading(false)
      return
    }
    api<{ user: AuthUser }>('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
  }, [])

  const login = async (username: string, password: string, remember = true) => {
    const d = await api<{ token: string; user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: { username, password },
    })
    setToken(d.token, remember)
    setUser(d.user)
  }

  const ldapLogin = async (username: string, password: string, remember = true) => {
    const d = await api<{ token: string; user: AuthUser }>('/auth/ldap-login', {
      method: 'POST',
      body: { username, password },
    })
    setToken(d.token, remember)
    setUser(d.user)
  }

  const logout = () => {
    setToken(null)
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, loading, login, ldapLogin, logout }}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
