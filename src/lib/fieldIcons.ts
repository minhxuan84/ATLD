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
