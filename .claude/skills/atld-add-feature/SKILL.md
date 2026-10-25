---
name: atld-add-feature
description: Use when building a new feature, API endpoint, CMS page or HSE tab in the ATLĐ app (React + Express + Postgres) — gives the end-to-end checklist from DB to UI so the change follows project conventions.
---

# Thêm tính năng end-to-end

Đọc `docs/ARCHITECTURE.md` để biết nên đặt code ở đâu, và `docs/CONVENTIONS.md` cho các quy tắc. Checklist:

## 1. DB

Theo skill `atld-db-migration`: chỉ dùng schema `atld`, chỉ thêm (additive), và migration nằm cùng router.

## 2. Server (`server/src/routes/*.ts`)

- Router nhỏ, tách theo miền. `hse.ts` đã rất lớn, nên tính năng HSE mới nên đặt ở file riêng (như `findings.ts`, `jsa.ts`).
- Mount trong `server/src/index.ts`. Nếu router phụ thuộc bảng hse thì mount sau `/api/hse`.
- Phân quyền và site scope theo skill `atld-permissions-site-scope`.
- Truy vấn qua `query()` của `db.ts`, luôn tham số hoá `$1..$n`.
- Thông báo lỗi trả cho người dùng viết bằng tiếng Việt, dạng `{ error: '...' }`, với status 400/403/404 phù hợp.
- Handler async không cần try/catch bao ngoài chỉ để chống sập process: `lib/async-errors.ts` đã vá Express 4. Chỉ bắt lỗi khi cần trả thông báo cụ thể.
- Ghi HSE thì gọi `audit()`. Nếu thay đổi ảnh hưởng điều kiện vào cổng, gọi `syncWorkerAccess` / `syncEquipmentAccess` (xem `docs/DOMAIN-HSE.md` mục 3).
- Upload: dùng multer có sẵn (UUID filename, `ALLOWED_EXT`, giới hạn dung lượng). File nhạy cảm phải tải qua endpoint có auth, không qua link `/uploads` trực tiếp.
- HTML do người dùng soạn phải qua `sanitizeHtml` trước khi lưu.
- PDF: theo skill `atld-pdf`.

## 3. Frontend (`src/`)

- Trang mới khai báo bằng `lazy(() => import(...))` trong `src/App.tsx`. Route CMS bọc trong `<SectionGuard section="...">`.
- Tab HSE: thêm vào mảng tab trong `src/pages/hse/HsePage.tsx`, với `show:` dựa trên `canHse(...)`.
- Gọi API bằng `api<T>('/path', { method, body })` (`src/lib/api.ts`). Tải file bằng `downloadFile` / `fetchBlobUrl` / `openFileInNewTab`. Không đặt JWT vào URL.
- Ngày hiển thị dùng `fmtDate` / `fmtDateTime` (`src/lib/date.ts`) theo định dạng dd/mm/yyyy. `.slice(0,10)` chỉ dùng cho `<input type="date">`.
- UI: dùng primitives trong `src/components/ui`, icon `lucide-react`, màu `vicem`/`eco`/`hatien` (chi tiết ở `.claude/brand.md`). Chữ hiển thị viết tiếng Việt có dấu.
- Cập nhật kiểu trong `src/types.ts` khớp với shape API trả về.

## 4. Kiểm chứng

1. Chạy `npm run build` (root) và `cd server && npm run build`.
2. Chạy preview `atld-web` (`.claude/launch.json`) với API ở cổng 4000, rồi thử luồng thật trên trình duyệt, xem console và network.
3. Thử với user officer gán một site để kiểm tra phân quyền và site scope.
4. Commit theo dạng `feat: ...` / `fix: ...`, tiếng Việt không dấu.
