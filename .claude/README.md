> Bắt đầu từ [`CLAUDE.md`](../CLAUDE.md) và [`docs/SETUP.md`](../docs/SETUP.md) (cài đặt môi trường mới). Danh mục skill: [`SKILLS.md`](SKILLS.md).

# VICEM Hà Tiên — Hệ thống Huấn luyện ATLĐ & Môi trường

Web app full-stack: huấn luyện an toàn lao động trực tuyến (video → tóm tắt → trắc nghiệm → chứng chỉ), quản lý tài liệu hồ sơ, tin tức, và trang quản trị CMS.

## Kiến trúc
- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS + React Router
- **Backend:** Node.js + Express + TypeScript, xác thực JWT + bcrypt, RBAC phía server
- **Database:** PostgreSQL 17 — schema riêng `atld` trong database `vicem_cms` (không đụng schema `public`)
- **Nhận diện:** màu thương hiệu VICEM (xanh `#0055A4`) + Hà Tiên (đỏ `#E2231A`)

## Yêu cầu
- Node.js 18+
- PostgreSQL đang chạy, có user với quyền tạo schema trên database `vicem_cms`

## Cài đặt & chạy

### 1. Backend
```bash
cd server
npm install
# Cấu hình kết nối trong server/.env (PGUSER, PGPASSWORD, ...)
# Tạo schema + bảng:
psql -U <user> -h localhost -d vicem_cms -f db/schema.sql
# Nạp dữ liệu mẫu + tài khoản:
npm run seed
# Chạy API (cổng 4000):
npm run dev
```

### 2. Frontend
```bash
# tại thư mục gốc
npm install
npm run dev   # cổng 5173, tự proxy /api -> http://localhost:4000
```

Mở http://localhost:5173

## Tài khoản demo
| Vai trò | Đăng nhập | Mật khẩu |
|---|---|---|
| Quản trị (CMS) | `admin` | `Admin@123` |
| Cán bộ ATLĐ | `canbo` | `Canbo@123` |
| Học viên | `hocvien` | `Hocvien@123` |

## Chức năng chính
- **Trang chủ:** banner + thống kê, giới thiệu, timeline thành tích, mục tiêu năm/tháng, tin tức mới nhất.
- **Huấn luyện ATLĐ:** quy trình 3 bước, chấm điểm & cấp chứng chỉ **phía server**.
- **Tài liệu hồ sơ:** upload thật (multer), phân quyền, tìm kiếm, tải về.
- **Tin tức:** đăng/sửa/xóa theo quyền.
- **CMS (`/cms`, chỉ admin):** dashboard thống kê, quản lý người dùng, khóa học & câu hỏi, tin tức, tài liệu, mục tiêu & timeline.

## Bảo mật
- Mật khẩu băm bcrypt; JWT ký bằng secret trong `.env`.
- RBAC thực thi phía server (client không bypass được).
- Truy vấn tham số hóa (chống SQL injection); escape nội dung nhập (chống XSS).
- Validate upload (định dạng + ≤20MB), tên file lưu ngẫu nhiên (chống path traversal).
- helmet, CORS giới hạn origin, rate-limit đăng nhập.

> Đổi `JWT_SECRET` và mật khẩu DB trước khi triển khai production.
