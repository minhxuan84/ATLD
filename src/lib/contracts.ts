/**
 * Hợp đồng còn hiệu lực để chọn trong các form HSE (đình chỉ, phiếu phát hiện, link cổng).
 *
 * Hợp đồng mới tạo mặc định 'pending' (chờ duyệt) và nhiều nhà máy không bao giờ bấm
 * chuyển sang 'active'. Chỉ lọc 'active' thì ô chọn rỗng dù nhà thầu đang thi công thật.
 * Khớp với số "hợp đồng" trên dashboard (đếm cả active lẫn pending).
 */
export const OPEN_CONTRACT_STATUSES = ['active', 'pending'] as const

export function isOpenContract(c: { status: string }): boolean {
  return (OPEN_CONTRACT_STATUSES as readonly string[]).includes(c.status)
}

/** Hậu tố hiển thị trong <option> để cán bộ biết hợp đồng chưa được duyệt. */
export function contractStatusSuffix(c: { status: string }): string {
  return c.status === 'pending' ? ' · chờ duyệt' : ''
}
