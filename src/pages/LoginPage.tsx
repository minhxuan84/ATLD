import { useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Logo from '../components/Logo'
import { LogIn, Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const from = (location.state as { from?: string })?.from ?? '/'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username.trim(), password, remember)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <div className="mb-6 flex justify-center">
        <Logo className="scale-125" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-xl font-bold text-slate-800">Đăng nhập hệ thống</h1>
        <p className="mt-1 text-center text-sm text-slate-500">Huấn luyện An toàn lao động &amp; Môi trường</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {/* Số điện thoại / tên đăng nhập */}
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-slate-700">
              Số điện thoại
            </label>
            <input
              id="username"
              type="tel"
              inputMode="numeric"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username tel"
              placeholder="Nhập số điện thoại"
              required
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
            />
          </div>

          {/* Mật khẩu + icon con mắt */}
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

        <p className="mt-5 text-center text-sm text-slate-500">
          Chưa có tài khoản?{' '}
          <Link to="/dang-ky" className="font-medium text-vicem-600 hover:underline">
            Tạo tài khoản
          </Link>
        </p>
      </div>
    </div>
  )
}
