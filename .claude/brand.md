---
name: brand
description: Nhận diện thương hiệu ATLD / VICEM — màu sắc, font, logo, tone of voice
tags: [brand, design, ui, vicem]
---

# Brand — Nhận Diện Thương Hiệu ATLD / VICEM

## Tổ Chức

**ATLD** = An Toàn Lao Động — hệ thống quản lý HSE (Health, Safety, Environment) cho VICEM Hà Tiên.

## Màu Sắc

| Token | Hex | Dùng cho |
|-------|-----|---------|
| `primary` | `#1a56db` | Nút chính, links, active state |
| `primary-dark` | `#1e40af` | Hover trên primary |
| `success` | `#057a55` | Check-in thành công, trạng thái hợp lệ |
| `warning` | `#c27803` | Cảnh báo, sắp hết hạn |
| `danger` | `#c81e1e` | Lỗi, từ chối, hết hạn |
| `neutral-900` | `#111928` | Text chính |
| `neutral-500` | `#6b7280` | Text phụ, placeholder |
| `neutral-100` | `#f3f4f6` | Background rows, cards |

> Màu chính của VICEM Hà Tiên: xanh dương `#1a56db` (corporate blue)

## Typography

| Vai trò | Font | Size | Weight |
|---------|------|------|--------|
| Heading H1 | Inter / system-ui | 24px | 700 |
| Heading H2 | Inter / system-ui | 20px | 600 |
| Body text | Inter / system-ui | 14px | 400 |
| Label | Inter / system-ui | 12px | 500 |
| Monospace (code/ID) | `font-mono` | 13px | 400 |

## Logo & Icon

- Logo chính: chứa trong `public/` hoặc `src/assets/`
- Icon set: **Heroicons** (outline mặc định, solid cho active/selected)
- Favicon: hình khiên / mũ bảo hộ (phản ánh HSE)

## Tone of Voice (UI Text)

**Tiếng Việt** — ngắn gọn, rõ ràng, nghiêm túc nhưng không lạnh lùng.

| Tình huống | ✅ Nên dùng | ❌ Tránh |
|------------|------------|---------|
| Check-in thành công | "Đã vào ca" | "Success!" |
| Từ chối check-in | "Không đủ điều kiện vào cổng" | "Error 403" |
| Loading | "Đang xử lý..." | "Loading..." |
| Lỗi mạng | "Không kết nối được. Thử lại?" | "Network error" |
| Xác nhận xóa | "Xóa hồ sơ này không thể hoàn tác" | "Are you sure?" |

## Component Conventions

### Status Badges

```tsx
// ✅ Consistent status colors
const statusColor = {
  active:   'bg-green-100 text-green-800',
  inactive: 'bg-gray-100 text-gray-600',
  expired:  'bg-red-100 text-red-800',
  pending:  'bg-yellow-100 text-yellow-800',
}
```

### Date Display

**Luôn dùng `dd/mm/yyyy`** — xem `.claude/skills/db/schema-policy.md`

```tsx
import { fmtDate, fmtDateTime } from '@/lib/date'
// fmtDate("2026-07-20") → "20/07/2026"
// fmtDateTime("2026-07-20T09:00:00") → "20/07/2026 09:00"
```

### Tables

- Stripe rows: dòng chẵn `bg-gray-50`
- Hover: `hover:bg-blue-50`
- Selected: `bg-blue-100 border-l-2 border-blue-500`

## Trang Chủ (Planned — #15)

Phong cách: Fullpage scroll kiểu VICEM Hà Tiên
- Hero section: background ảnh nhà máy xi măng
- Section 2: Tính năng nổi bật (checkin, báo cáo, quản lý)
- Section 3: Số liệu (workers, sites, incidents)
- Footer: Logo VICEM + thông tin liên hệ
