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

// Tải file bất kỳ theo path API (kèm JWT), lấy tên từ Content-Disposition nếu có.
// Dùng cho xuất báo cáo Excel — không lộ token qua query param.
export async function downloadFile(path: string, fallbackName: string) {
  const token = getToken()
  const res = await fetch(`/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error((data as { error?: string })?.error ?? 'Không tải được tệp.')
  }
  const cd = res.headers.get('Content-Disposition') ?? ''
  const m = /filename="?([^"]+)"?/i.exec(cd)
  const name = m?.[1] ?? fallbackName
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

// Nạp file (kèm JWT) thành Blob URL để gắn vào <img src>. Thẻ <img> không gửi được
// header Authorization, nên ảnh từ endpoint có requireAuth buộc phải đi qua fetch.
// Người gọi tự thu hồi URL bằng URL.revokeObjectURL khi không dùng nữa.
export async function fetchBlobUrl(path: string): Promise<string> {
  const token = getToken()
  const res = await fetch(`/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error((data as { error?: string })?.error ?? 'Không tải được ảnh.')
  }
  return URL.createObjectURL(await res.blob())
}

// Mở file bất kỳ (kèm JWT) trong tab mới bằng Blob URL — không lộ token qua query param.
// LƯU Ý mobile: phải mở tab NGAY trong cử chỉ chạm (đồng bộ), trước await fetch —
// nếu window.open() chạy sau await, Safari/Chrome mobile sẽ chặn như popup.
export async function openFileInNewTab(path: string) {
  const win = window.open('', '_blank')
  const token = getToken()
  try {
    const res = await fetch(`/api${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error((data as { error?: string })?.error ?? 'Không mở được tệp.')
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    if (win) {
      win.location.href = url
    } else {
      // Popup bị chặn dù đã mở đồng bộ → fallback bằng thẻ <a> (một số máy vẫn cho tải).
      const a = document.createElement('a')
      a.href = url
      a.target = '_blank'
      a.rel = 'noopener'
      a.click()
    }
    // Thu hồi sau 1 phút để trình duyệt kịp render
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e) {
    win?.close()
    throw e
  }
}
