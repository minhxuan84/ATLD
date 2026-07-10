// Lớp gọi API tới backend. Tự động gắn JWT vào header.
const TOKEN_KEY = 'atld_token'

// "Lưu đăng nhập": localStorage giữ qua các phiên; sessionStorage chỉ trong phiên hiện tại.
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY)
}
export function setToken(t: string | null, remember = true) {
  localStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
  if (t) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t)
}

interface ApiOptions {
  method?: string
  body?: unknown
  isForm?: boolean
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  let body: BodyInit | undefined
  if (opts.isForm) {
    body = opts.body as FormData
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }

  const res = await fetch(`/api${path}`, { method: opts.method ?? 'GET', headers, body })
  const data = res.status === 204 ? null : await res.json().catch(() => null)

  if (!res.ok) {
    const message = (data as { error?: string })?.error ?? `Lỗi ${res.status}`
    if (res.status === 401) setToken(null)
    throw new Error(message)
  }
  return data as T
}

// Tải file có kèm JWT (không dùng thẻ <a href> trực tiếp vì cần header)
export async function downloadDoc(id: number, fileName: string) {
  const token = getToken()
  const res = await fetch(`/api/documents/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error('Không tải được tài liệu.')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}
