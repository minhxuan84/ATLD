# ATLĐ VICEM Hà Tiên — Hướng dẫn cho Claude / dev mới

Hệ thống số hoá huấn luyện An toàn lao động & quản lý an toàn nhà thầu (quy trình **QT111-07**)
cho VICEM Hà Tiên. Web full-stack: React + Express + PostgreSQL.

> File này + `docs/` + `.claude/skills/` được **track bằng git** — clone về máy/môi trường mới là có đủ
> kiến thức dự án. Bộ nhớ per-machine của Claude (`~/.claude/projects/...`) KHÔNG đi theo repo,
> nên mọi quy tắc quan trọng phải nằm ở đây.

## Đọc gì trước

| Tài liệu | Nội dung |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Dựng môi trường dev trên máy mới (Node, Postgres, .env, schema) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Cấu trúc code, route API, bảng DB, uploads, tích hợp ngoài |
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | Quy ước code bắt buộc (DB, quyền, site, ngày, PDF, UI) |
| [docs/DOMAIN-HSE.md](docs/DOMAIN-HSE.md) | Nghiệp vụ QT111-07: nhà thầu → hồ sơ → JSA/giấy phép → cổng → phát hiện/CAPA |
| [docs/DEPLOY-OPS.md](docs/DEPLOY-OPS.md) | Docker, deploy lên server DEV, backup/restore, kiểm tra sau deploy |
| [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) | Nợ kỹ thuật & rủi ro bảo mật đã biết |
| [.claude/skills/](.claude/skills/) | Skill cho Claude theo từng loại việc (migration, quyền, deploy, tính năng mới, PDF, portal) |

## Lệnh thường dùng

```bash
# Frontend (gốc repo) — cổng 5173, proxy /api -> localhost:4000
npm install && npm run dev
npm run build            # tsc -b && vite build  (dùng để type-check frontend)

# Backend
cd server && npm install && npm run dev     # tsx watch, cổng 4000
cd server && npm run build                  # tsc -> server/dist (type-check backend)

# Test duy nhất (cần build server trước, chạy trong BEGIN/ROLLBACK)
node --env-file=server/.env server/test/hse-training.mjs
```

## Quy tắc cứng (KHÔNG được vi phạm)

1. **DB chỉ dùng schema `atld`** trong database dùng chung `vicem_cms`. **Không bao giờ** đụng schema
   `public` (23 bảng CMS đang chạy thật). `search_path` đặt ở `server/src/db.ts`.
2. **Migration chỉ thêm (additive)**: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
   constraint qua `DO $$ ... $$`. Không DROP / RENAME trên dữ liệu thật. Migration chạy inline khi
   module route được import (IIFE trong `routes/hse.ts`, `news.ts`, `documents.ts`; `initAuthDb`/`initOAuthDb`).
3. **Không chạy `npm run seed` trên DB có dữ liệu thật** — nó `TRUNCATE` các bảng atld.
4. **Không in/commit secret.** Chỉ nhắc tên biến (`PGPASSWORD`, `JWT_SECRET`...). Script deploy
   (`deploy-dev.mjs`, ...) bị gitignore vì chứa credentials.
5. **Ngày hiển thị dd/mm/yyyy** qua `fmtDate`/`fmtDateTime` (`src/lib/date.ts`).
6. **Phân quyền thực thi ở server** (`requireSection`/`requireHse`/`requireRole`) và **lọc theo công
   trường** bằng `siteScope(user)`. Client chỉ ẩn/hiện.
7. **PDF cam kết (`buildCommitmentPdf`) phải giữ Helvetica** — hash SHA-256 của nó được ký số SmartCA.
8. Gọi API phía client luôn qua `api()` (`src/lib/api.ts`); không đặt token vào URL.
9. Tiếng Việt qua `psql`: ghi ra file UTF-8 rồi `psql -f`, không dùng `-c`.

## Kiến trúc tóm tắt

- `src/` — React 18 + Vite + TS + Tailwind. Trang công khai, `/cms/*` (quản trị), `/cms/an-toan/*` (HSE),
  portal không tài khoản `/khai-bao|/bao-an-toan|/khac-phuc|/thi/:token`.
- `server/src/` — Express + TS. `index.ts` mount route; `auth.ts` JWT + quyền; `routes/*` theo miền;
  `lib/*` logic dùng chung (hse-core, pdf, ldap, smartca, newsFetch, quiz-grade...).
- `server/db/schema.sql` — bảng lõi; phần còn lại do migration inline tạo.
- Production: Docker image (`Dockerfile`) + nginx HTTPS (`docker-compose.yml`), Postgres nằm ngoài container.

## Cách làm việc

- Sửa file lớn (`routes/hse.ts` ~3500 dòng) bằng Edit cục bộ, đọc đúng đoạn cần sửa.
- Sau khi sửa: `npm run build` (gốc) và `cd server && npm run build` để type-check.
- Thay đổi hiển thị được trên trình duyệt → kiểm tra bằng preview `atld-web` (`.claude/launch.json`).
- Commit message tiếng Việt không dấu, kiểu `feat:/fix:/chore:` (xem `git log`).
- Branch chính: `master`.
