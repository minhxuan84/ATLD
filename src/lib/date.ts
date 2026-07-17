// Định dạng ngày chuẩn dự án: luôn dd/mm/yyyy (không phụ thuộc locale runtime).
// Input nhận ISO string / Date / null. Trả '—' khi rỗng hoặc không hợp lệ.
export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return '—'
  const d = typeof v === 'string' ? new Date(v) : v
  if (Number.isNaN(d.getTime())) return '—'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

// dd/mm/yyyy HH:mm — dùng cho log vào/ra, thời điểm ký...
export function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return '—'
  const d = typeof v === 'string' ? new Date(v) : v
  if (Number.isNaN(d.getTime())) return '—'
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${fmtDate(d)} ${hh}:${min}`
}
