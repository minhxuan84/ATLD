import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setToken, api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import type { AuthUser } from '../context/AuthContext'
import Logo from '../components/Logo'

/**
 * Trang xử lý redirect sau OAuth.
 * Server chuyển hướng về /oauth/callback#token=...&from=...
 * Trang này đọc token từ fragment, lưu vào storage, rồi điều hướng về trang gốc.
 */
export default function OAuthCallbackPage() {
  const navigate = useNavigate()
  const { setUserFromToken } = useAuth()
  const [error, setError] = useState('')

  useEffect(() => {
    // Đọc params từ URL fragment (#token=...&from=...)
    const hash = window.location.hash.slice(1)
    const params = new URLSearchParams(hash)
    const token = params.get('token')
    const from  = params.get('from') || '/'

    if (!token) {
      // Kiểm tra query param ?error= từ server (lỗi OAuth)
      const qp  = new URLSearchParams(window.location.search)
      const err = qp.get('error')
      setError(err ? `Đăng nhập thất bại: ${err}` : 'Không nhận được token đăng nhập.')
      return
    }

    // Lưu token và lấy thông tin user
    setToken(token, true)
    api<{ user: AuthUser }>('/auth/me')
      .then((d) => {
        setUserFromToken(d.user)
        // Xóa fragment khỏi URL rồi điều hướng
        window.history.replaceState(null, '', window.location.pathname)
        navigate(from, { replace: true })
      })
      .catch(() => {
        setToken(null)
        setError('Phiên đăng nhập không hợp lệ. Vui lòng thử lại.')
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <div className="mb-6 flex justify-center">
        <Logo className="scale-125" />
      </div>
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6">
          <p className="text-sm font-medium text-red-700">{error}</p>
          <a
            href="/dang-nhap"
            className="mt-4 inline-block rounded-lg bg-vicem-500 px-4 py-2 text-sm font-semibold text-white hover:bg-vicem-600"
          >
            Quay lại đăng nhập
          </a>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-3 flex justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-vicem-500 border-t-transparent" />
          </div>
          <p className="text-sm text-slate-600">Đang hoàn tất đăng nhập…</p>
        </div>
      )}
    </div>
  )
}
