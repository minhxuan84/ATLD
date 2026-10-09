import { useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Logo from '../components/Logo'
import { LogIn, Eye, EyeOff, Building2, User } from 'lucide-react'

type LoginMode = 'local' | 'ldap'

// SVG logo Microsoft (4 ô màu)
function MicrosoftIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" className="h-4 w-4" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}

// SVG logo Google
function GoogleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

export default function LoginPage() {
  const { login, ldapLogin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState<LoginMode>('local')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const from = (location.state as { from?: string })?.from ?? '/'

  // Lấy error từ query string (từ OAuth callback)
  const qpError = new URLSearchParams(location.search).get('error')

  const handleModeChange = (next: LoginMode) => {
    setMode(next)
    setUsername('')
    setPassword('')
    setError('')
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'ldap') {
        await ldapLogin(username.trim(), password, remember)
      } else {
        await login(username.trim(), password, remember)
      }
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại.')
    } finally {
      setLoading(false)
    }
  }

  // Chuyển hướng sang OAuth provider; truyền trang đích để server redirect đúng sau callback
  const handleOAuth = (provider: 'microsoft' | 'google') => {
    const dest = encodeURIComponent(from)
    window.location.href = `/api/auth/oauth/${provider}?from=${dest}`
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <div className="mb-6 flex justify-center">
        <Logo className="scale-125" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-xl font-bold text-slate-800">Đăng nhập hệ thống</h1>
        <p className="mt-1 text-center text-sm text-slate-500">Huấn luyện An toàn lao động &amp; Môi trường</p>

        {/* Thông báo lỗi OAuth từ server redirect */}
        {qpError && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">
            {qpError === 'state_invalid'
              ? 'Phiên đăng nhập đã hết hạn. Vui lòng thử lại.'
              : qpError === 'oauth_failed'
                ? 'Đăng nhập xã hội thất bại. Vui lòng thử lại.'
                : qpError}
          </p>
        )}

        {/* Tab chọn phương thức đăng nhập */}
        <div className="mt-5 flex rounded-lg border border-slate-200 p-1 gap-1">
          <button
            type="button"
            onClick={() => handleModeChange('local')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors ${
              mode === 'local'
                ? 'bg-vicem-500 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <User className="h-4 w-4" />
            Tài khoản cá nhân
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('ldap')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors ${
              mode === 'ldap'
                ? 'bg-vicem-500 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Building2 className="h-4 w-4" />
            Tài khoản công ty
          </button>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          {/* Username — label thay đổi theo mode */}
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-slate-700">
              {mode === 'ldap' ? 'Tên đăng nhập (Windows)' : 'Tên đăng nhập'}
            </label>
            {/* type="text", KHÔNG phải "tel": username không chỉ là số điện thoại — tài
                khoản tạo qua Google/Microsoft lấy email làm username (xem oauth.ts), nên
                inputMode="numeric" khóa bàn phím số trên điện thoại và không gõ nổi email. */}
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={mode === 'ldap' ? 'vd: nguyen.van.a' : 'Số điện thoại hoặc email'}
              required
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
            />
          </div>

          {/* Mật khẩu */}
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
              Mật khẩu
            </label>
            <div className="relative mt-1">
              <input
                id="password"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Nhập mật khẩu"
                required
                className="w-full rounded-lg border border-slate-300 py-2.5 pl-3 pr-10 text-sm focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Lưu đăng nhập */}
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-vicem-600 focus:ring-vicem-500"
            />
            <span className="text-sm text-slate-600">Lưu đăng nhập</span>
          </label>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-vicem-500 px-4 py-2.5 font-semibold text-white hover:bg-vicem-600 disabled:opacity-60"
          >
            <LogIn className="h-5 w-5" />
            {loading ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </form>

        {/* OAuth — chỉ hiện khi ở mode local */}
        {mode === 'local' && (
          <>
            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-3 text-xs text-slate-400">hoặc đăng nhập bằng</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleOAuth('microsoft')}
                className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <MicrosoftIcon />
                Microsoft
              </button>
              <button
                type="button"
                onClick={() => handleOAuth('google')}
                className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <GoogleIcon />
                Google
              </button>
            </div>
          </>
        )}

        {mode === 'local' && (
          <p className="mt-5 text-center text-sm text-slate-500">
            Chưa có tài khoản?{' '}
            <Link to="/dang-ky" className="font-medium text-vicem-600 hover:underline">
              Tạo tài khoản
            </Link>
          </p>
        )}
        {mode === 'ldap' && (
          <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-center text-xs text-blue-700">
            Dùng tên đăng nhập và mật khẩu Windows của bạn trong hệ thống nội bộ công ty.
          </p>
        )}
      </div>
    </div>
  )
}

