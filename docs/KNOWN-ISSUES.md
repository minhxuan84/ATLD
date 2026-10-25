# Vấn đề đã biết & nợ kỹ thuật

Kết quả rà soát source ngày 25/10/2026. Mỗi mục ghi vị trí và hướng xử lý. Làm xong mục nào thì xoá mục đó (hoặc chuyển xuống phần "Đã xử lý").

## Bảo mật (ưu tiên cao)

Đợt S1–S8 đã xử lý trên branch `fix/security-hardening` (25/10/2026):

| # | Vấn đề | Đã xử lý |
|---|---|---|
| S1 | `/uploads` static không auth, lộ `hse/`, `trainee/`, `certs/`, tài liệu | `index.ts`: chỉ còn `/uploads/media` và `/uploads/content` là static; mọi đường dẫn `/uploads/*` khác trả 404. File nhạy cảm chỉ tải qua endpoint có auth và `siteScope` |
| S2 | Webhook SmartCA tính HMAC trên `JSON.stringify(req.body)` | `express.json({ verify })` giữ raw body cho `/api/hse/smartca/callback`; HMAC tính trên raw bytes. Secret rỗng thì từ chối |
| S3 | CORS phản chiếu mọi origin khi thiếu `CORS_ORIGIN` | Production thiếu `CORS_ORIGIN` → `origin: false` (same-origin qua nginx vẫn chạy) |
| S4 | `JWT_SECRET` rơi về `'dev_secret'` | `auth.ts` export `JWT_SECRET`; production thiếu biến thì **throw khi khởi động**. `oauth.ts` dùng chung |
| S5 | LDAP `rejectUnauthorized: false` | `ldapTlsOptions()` trong `lib/ldap.ts`: `LDAP_TLS_CA_FILE` hoặc `LDAP_TLS_REJECT_UNAUTHORIZED=true` để bật kiểm chứng chỉ. Mặc định vẫn tắt (tương thích AD nội bộ) và log cảnh báo — **nên bật khi có CA** |
| S6 | `/cms/ldap`, `/cms/smartca` không guard ở client | `AdminGuard` trong `src/App.tsx` |
| S7 | Script ops hardcode mật khẩu SSH / admin | Các script đọc từ `.env.deploy` (gitignored) qua `need('...')`; `atld-create-admin.mjs` đọc `ADMIN_PASSWORD`. **Mật khẩu cũ vẫn cần đổi** vì đã từng nằm trong file và tarball |
| S8 | Tarball deploy mang `.claude/`, `.env`, `server/_*` lên server | `EXCLUDES` của `deploy-dev.mjs` loại thêm `.claude`, `.env*`, script ops, `_*`, `backups`, `dist`, `*.tsbuildinfo` |

Còn lại: bật kiểm chứng chỉ LDAP (S5) khi có CA nội bộ; xoá các bản copy script/`.env` đã bị upload lên server ở các lần deploy trước (xem DEPLOY-OPS mục 3).

## Độ tin cậy

| # | Vấn đề | Vị trí | Hướng xử lý |
|---|---|---|---|
| R1 | Migration HSE nằm trong **một try/catch**. Một câu lỗi làm bỏ qua toàn bộ các câu sau, và chỉ log `[hse migration]` | `server/src/routes/hse.ts` (IIFE đầu file, catch ~dòng 1099) | Tính năng mới dùng mẫu `NEWS_MIGRATIONS`. Về lâu dài nên tách khối hse.ts thành mảng câu lệnh |
| R2 | Comment trong portal.ts nói "chưa đặt trust proxy", nhưng `index.ts:27` đã đặt `trust proxy 1` | `server/src/routes/portal.ts:38` | Sửa comment |
| R3 | Backup DB không gồm file upload | `atld-backup-db.sh` | Thêm bước tar volume `atld-uploads` (xem DEPLOY-OPS mục 4) |
| R4 | `restore-db-dev.mjs` ghi đè toàn bộ crontab | Script local | Chỉ thêm hoặc thay đúng dòng của ATLD |
| R5 | `atld-restore-script.js` chạy `DROP SCHEMA atld CASCADE` mà không hỏi xác nhận | Script local | Thêm bước xác nhận và backup tự động trước khi drop |

## Tài liệu lỗi thời

- `DOCKER_DEPLOY.md` (thư mục gốc) đã cũ. Dùng [DEPLOY-OPS.md](DEPLOY-OPS.md).
- `.claude/ARCHITECTURE.md` là bản cũ. Dùng [ARCHITECTURE.md](ARCHITECTURE.md).
- `.claude/monitoring/` (Prometheus/Grafana) và `.claude/rabbitmq/` mô tả kiến trúc **chưa áp dụng**: code không có metrics endpoint, cũng không có queue.

## Dọn dẹp

- `auto-video-gen/` là clone riêng, không còn dùng sau commit `ab559fb` (bỏ tính năng render video).
- File nháp: `server/_*.mjs`, `server/_h5out/`, `_g.pdf`, `*.tsbuildinfo` lạc chỗ (nay đã gitignore).
- `server/uploads/New folder` là thư mục rỗng tạo nhầm.
- Các script deploy cũ, xem bảng ở [DEPLOY-OPS.md](DEPLOY-OPS.md) mục 5.
