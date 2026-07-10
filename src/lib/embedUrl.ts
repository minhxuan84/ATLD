/**
 * Chuyển đổi bất kỳ dạng URL YouTube nào thành embed URL (youtube-nocookie.com)
 * để tránh lỗi CSP frame-src và tracking cookie.
 * Hỗ trợ: youtu.be/ID, youtube.com/watch?v=ID, youtube.com/embed/ID, youtube.com/shorts/ID
 */
export function toEmbedUrl(url: string): string {
  if (!url?.trim()) return url

  // Đã là embed URL — chuẩn hóa domain nếu cần
  const embedMatch = url.match(/youtube(?:-nocookie)?\.com\/embed\/([a-zA-Z0-9_-]{11})/)
  if (embedMatch) {
    return `https://www.youtube-nocookie.com/embed/${embedMatch[1]}`
  }

  // Trích video ID từ các dạng URL phổ biến
  const patterns = [
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,                        // https://youtu.be/ID
    /youtube\.com\/watch[?&]v=([a-zA-Z0-9_-]{11})/,          // youtube.com/watch?v=ID
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,             // youtube.com/shorts/ID
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,                  // youtube.com/v/ID
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,               // youtube.com/live/ID
  ]

  for (const pattern of patterns) {
    const m = url.match(pattern)
    if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`
  }

  return url // Không phải YouTube — trả nguyên (Vimeo, Drive, v.v.)
}

/** Trả true nếu url là video YouTube hợp lệ (share hoặc embed) */
export function isYouTubeUrl(url: string): boolean {
  return /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch|embed|shorts|v|live))[/?]/.test(url)
}
