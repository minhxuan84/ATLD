/**
 * Danh mục icon cho các thẻ "Lĩnh vực hoạt động" trên trang chủ.
 *
 * site_config chỉ lưu được chuỗi, nên CMS lưu KHÓA icon (vd 'GraduationCap') rồi
 * trang chủ tra ra component. Whitelist, không import động theo tên: khóa lạ trong DB
 * chỉ rơi về icon mặc định, không có đường nào nạp được thứ ngoài danh sách này.
 *
 * Dùng chung cho HomePage (render) và SiteSettings (ô chọn) để hai bên không lệch —
 * thêm icon ở đây là ô chọn trong CMS tự có.
 */
import {
  GraduationCap, FileText, Newspaper, Leaf, ShieldCheck, Award, Users,
  FileCheck, Target, HardHat, Flame, Recycle, Droplets, Wind, Siren,
  ClipboardCheck, BookOpen, Factory,
  type LucideIcon,
} from 'lucide-react'

export const FIELD_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  GraduationCap: { icon: GraduationCap, label: 'Mũ tốt nghiệp (huấn luyện)' },
  BookOpen: { icon: BookOpen, label: 'Sách mở (tài liệu học)' },
  FileText: { icon: FileText, label: 'Tài liệu' },
  FileCheck: { icon: FileCheck, label: 'Tài liệu đã duyệt' },
  ClipboardCheck: { icon: ClipboardCheck, label: 'Bảng kiểm tra' },
  Newspaper: { icon: Newspaper, label: 'Tin tức' },
  Leaf: { icon: Leaf, label: 'Lá (môi trường)' },
  Recycle: { icon: Recycle, label: 'Tái chế (chất thải)' },
  Droplets: { icon: Droplets, label: 'Giọt nước (nước thải)' },
  Wind: { icon: Wind, label: 'Gió (khí thải, bụi)' },
  ShieldCheck: { icon: ShieldCheck, label: 'Khiên (an toàn)' },
  HardHat: { icon: HardHat, label: 'Mũ bảo hộ' },
  Flame: { icon: Flame, label: 'Lửa (PCCC)' },
  Siren: { icon: Siren, label: 'Còi báo (ứng cứu)' },
  Factory: { icon: Factory, label: 'Nhà máy' },
  Users: { icon: Users, label: 'Người lao động' },
  Award: { icon: Award, label: 'Chứng chỉ' },
  Target: { icon: Target, label: 'Mục tiêu' },
}

/** Gradient cho dải màu + nền icon của thẻ. Khóa lạ rơi về tông xanh lá. */
export const FIELD_COLORS = [
  'from-vicem-500 to-vicem-700',
  'from-eco-500 to-eco-700',
  'from-teal-500 to-teal-700',
  'from-emerald-500 to-emerald-700',
] as const

/** Tra icon theo khóa; thiếu hoặc sai khóa thì trả về icon dự phòng của thẻ. */
export function resolveFieldIcon(key: string | undefined, fallback: LucideIcon): LucideIcon {
  if (!key) return fallback
  return FIELD_ICONS[key]?.icon ?? fallback
}

// ── Danh sách thẻ thêm/bớt được ──────────────────────────────────────────────

export interface FieldCard { title: string; desc: string; link: string; icon: string }

/** Giới hạn khớp với server (config.ts). */
export const MAX_FIELD_CARDS = 8

export const DEFAULT_FIELD_CARDS: FieldCard[] = [
  { icon: 'GraduationCap', title: 'Huấn luyện ATLĐ', desc: 'Học qua video, tóm tắt nội dung, trắc nghiệm và cấp chứng chỉ trực tuyến theo 6 nhóm đối tượng.', link: '/huan-luyen' },
  { icon: 'FileText', title: 'Tài liệu hồ sơ', desc: 'Lưu trữ, phân quyền và tìm kiếm tài liệu, hồ sơ an toàn lao động và môi trường.', link: '/tai-lieu' },
  { icon: 'Leaf', title: 'Bảo vệ môi trường', desc: 'Quản lý chất thải, quan trắc môi trường định kỳ, kiểm soát bụi và khí thải trong sản xuất.', link: '/huan-luyen' },
  { icon: 'Newspaper', title: 'Tin tức & Thông báo', desc: 'Cập nhật sự kiện, cảnh báo an toàn và thông báo mới nhất của VICEM Hà Tiên.', link: '/tin-tuc' },
]

/**
 * Đọc danh sách thẻ từ site_config.
 * - Có `fields_cards` (JSON) hợp lệ → dùng đúng danh sách đó.
 * - Chưa có (dữ liệu trước khi có tính năng thêm/bớt) → ghép 4 khóa cũ
 *   field_N_* lên mặc định, để nội dung đã sửa trong CMS không bị mất.
 */
export function readFieldCards(config: Record<string, string>): FieldCard[] {
  const raw = config.fields_cards
  if (raw) {
    try {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        const cards = arr
          .filter((c) => c && typeof c === 'object')
          .map((c) => ({
            title: String(c.title ?? ''), desc: String(c.desc ?? ''),
            link: String(c.link ?? ''), icon: String(c.icon ?? ''),
          }))
          .filter((c) => c.title.trim())
          .slice(0, MAX_FIELD_CARDS)
        if (cards.length) return cards
      }
    } catch { /* JSON hỏng → rơi về dữ liệu cũ */ }
  }
  return DEFAULT_FIELD_CARDS.map((d, i) => {
    const n = i + 1
    return {
      title: config[`field_${n}_title`]?.trim() || d.title,
      desc: config[`field_${n}_desc`]?.trim() || d.desc,
      link: config[`field_${n}_link`]?.trim() || d.link,
      icon: config[`field_${n}_icon`]?.trim() || d.icon,
    }
  })
}
