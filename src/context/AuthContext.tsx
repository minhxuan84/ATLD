import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import type { Role, CmsSection } from '../types'
import { api, getToken, setToken } from '../lib/api'

export interface AuthUser {
  id: number
  username: string
  fullName: string
  role: Role
  permissions: CmsSection[]
}

// Tiện ích: user có quyền vào một mục CMS không (admin luôn có).
export function canAccess(user: AuthUser | null, section: CmsSection): boolean {
  if (!user) return false
  return user.role === 'admin' || user.permissions?.includes(section)
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

  const logout = () => {
    setToken(null)
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
