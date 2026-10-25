# Cài đặt môi trường phát triển (máy mới)

Tài liệu này dành cho người clone repo về một máy mới, kể cả một phiên Claude Code mới. Làm lần lượt từ trên xuống.

## 1. Yêu cầu

| Thành phần | Phiên bản | Ghi chú |
|---|---|---|
| Node.js | 20.x (tối thiểu 18) | Docker build dùng `node:20-alpine` |
| PostgreSQL | 17 | Windows: `psql` ở `C:\Program Files\PostgreSQL\17\bin` (thêm vào PATH) |
| Git | bất kỳ | Trên Windows dùng Git Bash cho các script `.sh`/`tar` |

Database dùng chung là **`vicem_cms`**. Ứng dụng chỉ ghi vào schema **`atld`**; schema `public` thuộc hệ thống CMS khác, không được động vào. Xem [CONVENTIONS.md](CONVENTIONS.md) mục 1.

User DB cần quyền `CREATE` trên database `vicem_cms` (để tạo schema `atld`), hoặc schema `atld` đã được tạo sẵn và user là owner.

## 2. Cấu hình `server/.env`

File này **không có trong git**. Tạo mới với các biến dưới đây và điền giá trị của môi trường mình. Không commit, không dán giá trị thật vào docs hay chat.

```dotenv
# PostgreSQL
PGHOST=localhost
PGPORT=5432
PGUSER=
PGPASSWORD=
PGDATABASE=vicem_cms
PGSCHEMA=atld

# JWT: production bắt buộc (thiếu thì server không khởi động); dev để trống sẽ dùng 'dev_secret'
JWT_SECRET=
JWT_EXPIRES=8h
JWT_EXPIRES_REMEMBER=30d

# Server
NODE_ENV=development
PORT=4000
CORS_ORIGIN=http://localhost:5173   # production thiếu biến này → chặn mọi cross-origin
```

Các biến tùy chọn sau chỉ cần khi dùng tính năng tương ứng:

| Nhóm | Biến | Tính năng |
|---|---|---|
| AI | `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` (hoặc `ANTHROPIC_API_KEY`), `ANTHROPIC_MODEL` | "Tạo nội dung bằng AI" trong khoá học, đi qua LLM Gateway |
| OAuth | `MICROSOFT_*`, `GOOGLE_*` | Đăng nhập Microsoft / Google |
| LDAP | `LDAP_*` | Chỉ là **dự phòng**. Cấu hình chính lưu trong DB tại `/cms/ldap` (bảng `site_config`, key `ldap.*`) |
| LDAP TLS | `LDAP_TLS_CA_FILE` (đường dẫn PEM CA nội bộ) hoặc `LDAP_TLS_REJECT_UNAUTHORIZED=true` | Bật kiểm chứng chỉ cho `ldaps://`. Không đặt thì bỏ qua kiểm tra và log cảnh báo |
| SmartCA | `SMARTCA_*` | Ký số VNPT cho cam kết và phê duyệt NLĐ |

Danh sách biến đầy đủ, kèm chú thích, nằm ở `.env.docker.example` (bản dùng cho Docker; cùng tên biến).

## 3. Khởi tạo DB

```bash
psql -h localhost -U <user> -d vicem_cms -f server/db/schema.sql
```

- `schema.sql` tạo schema `atld` cùng các bảng lõi (users, branches, courses...).
- `server/db/migration-*.sql` là migration lịch sử cho thư viện tài liệu. Chạy theo thứ tự số **nếu DB cũ chưa có**; các câu đều idempotent.
- Phần lớn bảng còn lại (`hse_*`, `jsa_*`, `quiz_*`, `news_sources`, `doc_*`...) **tự tạo khi server khởi động lần đầu**, nhờ khối migration trong `routes/hse.ts`, `routes/news.ts`, `routes/documents.ts` và `initAuthDb`/`initOAuthDb`.

Nạp dữ liệu mẫu (**chỉ dùng cho DB trống**):

```bash
cd server && npm run seed
```

> ⚠️ `seed` chạy TRUNCATE. Trên DB đã có dữ liệu thật, nó xoá sạch tiến độ học và chứng chỉ. Tuyệt đối không chạy trên DEV/PROD.

Seed tạo 3 tài khoản demo: `admin`, `canbo` (officer), `hocvien` (trainee). Mật khẩu demo nằm trong `server/src/seed.ts`; đổi ngay nếu DB được dùng chung.

## 4. Chạy

```bash
cd server && npm install && npm run dev
```

```bash
npm install && npm run dev
```

- API chạy ở `http://localhost:4000`. Kiểm tra bằng `GET /api/health`.
- Web chạy ở `http://localhost:5173`. Vite proxy `/api` sang cổng 4000 (`vite.config.ts`).
- Trong Claude Code desktop, cấu hình preview là `atld-web` trong `.claude/launch.json`.
- TinyMCE (`public/tinymce`) và model nhận diện khuôn mặt (`public/models`) đã có sẵn trong repo, không cần tải.

## 5. Kiểm tra trước khi commit

```bash
npm run build
```

```bash
cd server && npm run build
```

Lệnh build ở root chạy `tsc` và `vite build`, nên đây cũng là bước type-check. Test tích hợp cho phần đào tạo HSE cần DB thật:

```bash
node --env-file=server/.env server/test/hse-training.mjs
```

## 6. Sự cố hay gặp

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| Tiếng Việt thành `?` khi chèn qua psql | Do `psql -c "..."` trong Git Bash. Ghi câu lệnh ra file `.sql` UTF-8, rồi chạy `psql -f` |
| Bảng `hse_*` không có cột mới sau khi pull | Một câu migration trước đó lỗi làm bỏ qua phần còn lại (try/catch chung). Xem log khởi động server, dòng `[hse migration]` |
| PDF mất dấu | Máy không có OpenSans/DejaVu/Arial. Xem [CONVENTIONS.md](CONVENTIONS.md) mục 5 |
| Đăng nhập LDAP trả 503 | Chưa cấu hình tại `/cms/ldap` (env `LDAP_*` chỉ là dự phòng) |
| `tar` báo `Cannot connect to C:` khi deploy | Xem [DEPLOY-OPS.md](DEPLOY-OPS.md), mục "Windows /tmp" |
