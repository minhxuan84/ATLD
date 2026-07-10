import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import Logo from '../components/Logo'
import { UserPlus, Eye, EyeOff } from 'lucide-react'

export default function RegisterPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [showCf, setShowCf] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Mật khẩu nhập lại không khớp.'); return }
    if (password.length < 6) { setError('Mật khẩu cần ít nhất 6 ký tự.'); return }
    const cleaned = phone.replace(/\D/g, '')
    if (!/^0\d{9}$/.test(cleaned)) { setError('Số điện thoại không hợp lệ (10 chữ số, bắt đầu bằng 0).'); return }
    setLoading(true)
    try {
      await api('/auth/register', {
        method: 'POST',
        body: { username: cleaned, fullName: fullName.trim(), password },
      })
      // Tự động đăng nhập sau khi tạo tài khoản
      await login(cleaned, password, true)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tạo tài khoản thất bại.')
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
        <h1 className="text-center text-xl font-bold text-slate-800">Tạo tài khoản</h1>
        <p className="mt-1 text-center text-sm text-slate-500">Huấn luyện An toàn lao động &amp; Môi trường</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {/* Số điện thoại */}
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-slate-700">
              Số điện thoại <span className="text-red-500">*</span>
            </label>
            <input
              id="phone"
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              placeholder="Vd: 0901234567"
              required
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
            />
            <p className="mt-1 text-xs text-slate-400">Dùng làm tên đăng nhập.</p>
          </div>

          {/* Họ và tên */}
          <div>
            <label htmlFor="fullName" className="block text-sm font-medium text-slate-700">
              Họ và tên <span className="text-red-500">*</span>
            </label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              placeholder="Nhập họ và tên đầy đủ"
              required
              maxLength={150}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
            />
          </div>

          {/* Mật khẩu */}
          <div>
            <label htmlFor="reg-password" className="block text-sm font-medium text-slate-700">
              Mật khẩu <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-1">
              <input
                id="reg-password"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Ít nhất 6 ký tự"
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

          {/* Nhập lại mật khẩu */}
          <div>
            <label htmlFor="confirm" className="block text-sm font-medium text-slate-700">
              Nhập lại mật khẩu <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-1">
              <input
                id="confirm"
                type={showCf ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                placeholder="Nhập lại mật khẩu"
                required
                className="w-full rounded-lg border border-slate-300 py-2.5 pl-3 pr-10 text-sm focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
              />
              <button
                type="button"
                onClick={() => setShowCf((v) => !v)}
                aria-label={showCf ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
              >
                {showCf ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-vicem-500 px-4 py-2.5 font-semibold text-white hover:bg-vicem-600 disabled:opacity-60"
          >
            <UserPlus className="h-5 w-5" />
            {loading ? 'Đang tạo tài khoản…' : 'Tạo tài khoản'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-500">
          Đã có tài khoản?{' '}
          <Link to="/dang-nhap" className="font-medium text-vicem-600 hover:underline">
            Đăng nhập
          </Link>
        </p>
      </div>
    </div>
  )
}
