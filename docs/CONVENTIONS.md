# Quy ước code bắt buộc

Mỗi quy tắc dưới đây xuất phát từ một sự cố hoặc yêu cầu thật của dự án. Hãy giữ phần **Lý do** khi sửa.

## 1. Cơ sở dữ liệu

- **Chỉ dùng schema `atld`.** Database `vicem_cms` dùng chung, schema `public` chứa 23 bảng CMS đang chạy thật.
  Không bao giờ CREATE/ALTER/DROP trong `public`. `search_path` được đặt trong `server/src/db.ts` (`PGSCHEMA`, mặc định `atld`).
  *Lý do:* yêu cầu gốc là "Không ghi đè, tạo schema mới", và hỏng CMS thì không khôi phục được.
- **Migration chỉ thêm (additive), idempotent:**
  - Dùng `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.
  - Thêm CHECK/UNIQUE trong khối `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$`.
  - Seed dữ liệu tham chiếu bằng `INSERT ... ON CONFLICT DO NOTHING` / `WHERE NOT EXISTS`.
  - Không DROP/RENAME cột trên DB thật. Cột bỏ đi thì để nguyên và ngừng dùng.
- **Migration nằm ở đâu:**
  - Bảng HSE/JSA/quiz: IIFE đầu file `server/src/routes/hse.ts`. Cả khối nằm trong **một try/catch**, nên một câu lỗi sẽ bỏ qua toàn bộ các câu phía sau.
  - Tính năng mới, tách hẳn khỏi phần trên: theo mẫu `NEWS_MIGRATIONS` trong `routes/news.ts`, tức một mảng câu lệnh, mỗi câu try/catch riêng.
  - Router nào phụ thuộc bảng do hse.ts tạo thì phải mount **sau** `/api/hse` trong `index.ts`.
- **Kiểu DATE** được trả về dưới dạng chuỗi `yyyy-mm-dd`, nhờ type parser 1082 trong `db.ts`. Đừng bọc lại bằng `new Date()` để so sánh.
- **Không chạy `npm run seed` trên DB có dữ liệu.** Seed sẽ TRUNCATE và xoá sạch tiến độ, chứng chỉ. Muốn chỉnh dữ liệu thật thì dùng `UPDATE ... WHERE` hoặc `INSERT ... WHERE NOT EXISTS` qua psql.
- **Tiếng Việt qua psql:** ghi câu lệnh ra file `.sql` UTF-8 rồi chạy `psql -f file.sql`. Không dùng `psql -c "..."`, vì Git Bash trên Windows làm hỏng mã hoá.
- **Truy vấn luôn tham số hoá** (`$1, $2...`) qua `query()` trong `db.ts`. Không nối chuỗi SQL.
- Khi thêm cột, phải đồng bộ cả shape trả về của API lẫn kiểu dữ liệu ở frontend. Đã từng gặp lỗi lệch field gây trang trắng.

## 2. Phân quyền CMS

- `users.role`: `trainee` (không vào CMS), `officer` (theo permissions), `admin` (toàn quyền).
- `users.permissions` (JSONB) là mảng section key. Key được định nghĩa ở **`CMS_SECTIONS` trong `server/src/auth.ts`** và **phải mirror sang `src/types.ts`**.

| Key | Mở quyền |
|---|---|
| `nguoi-dung` | Người dùng (officer chỉ tạo được trainee, sửa tên/mật khẩu) |
| `chi-nhanh` | Chi nhánh / công trường |
| `khoa-hoc` | Khoá học, câu hỏi, kết quả, quiz token |
| `truong-trac-nghiem` | Trường thông tin học viên khi thi |
| `tin-tuc` | Tin tức, nguồn RSS, ảnh bài viết |
| `tai-lieu` | Thư viện tài liệu (ghi) |
| `muc-tieu` | Mục tiêu & mốc thành tích |
| `menu` | Menu site |
| `trang-tinh` | Cấu hình site, ảnh thương hiệu |
| `an-toan` | Toàn bộ module HSE |
| `an-toan:gate` | HSE con: bảo vệ cổng |
| `an-toan:inspect` | HSE con: kiểm tra, nhà thầu, NLĐ, phát hiện, giấy phép |
| `an-toan:approve` | HSE con: duyệt, đình chỉ, kích hoạt giấy phép |

Sub-key `an-toan:*` cũng mở được section cha `an-toan` để vào module.

- **Middleware ở server** (`auth.ts`):
  - `requireAuth`
  - `requireRole(...)`
  - `requireSection(...)`: chỉ cần có một trong các key.
  - `requireCms`: có ít nhất một permission.
  - `requireHse('gate'|'inspect'|'approve')`: admin hoặc người có `an-toan` luôn qua.
  - Bộ sẵn cho HSE: `canWrite`, `canGate`, `canInspect`, `canApprove`.
- **Chống leo thang quyền:** chỉ admin thật mới được set `role`/`permissions` trong POST/PUT user. Mọi thay đổi ở UsersManager phải giữ nguyên chốt này.
- **Frontend** (`AuthContext`): `canAccess`, `hasCmsAccess`, `canHse`, `seesAllSites`, cùng `SectionGuard` và `CmsProtected` trong `App.tsx`. Đây chỉ là lớp UX; server mới là chốt chặn.
- Thêm section mới gồm các bước sau:
  1. `CMS_SECTIONS` (server)
  2. `src/types.ts`
  3. Nhãn hiển thị trong UsersManager
  4. Menu CmsLayout
  5. `requireSection` trên route
  6. `SectionGuard` trên route client

## 3. Phân công trường (site scoping)

- Mỗi user có một công trường: `users.site_id` → `branches.id`. Giá trị `null` nghĩa là thấy tất cả.
- `siteScope(user)` trả về `{ all, siteId }` với **`all = role==='admin' || siteId == null`**.
  Quyền `an-toan` **không** cho thấy mọi site. *Lý do:* đây là lỗi 17/07/2026. Mọi cán bộ HSE đều có `an-toan`, nên nếu dựa vào quyền này thì việc gán site trở nên vô nghĩa.
- Mỏ neo dữ liệu là **`hse_contracts.site_id`**:
  - NLĐ, thiết bị, kiểm tra, đình chỉ, cam kết suy ra site qua JOIN tới hợp đồng.
  - Khách có `hse_visitors.site_id` riêng.
  - Nhà thầu không có site. Officer thấy một nhà thầu khi nhà thầu đó có hợp đồng tại site của mình, **hoặc** chưa có hợp đồng nào.
- Mẫu truy vấn: `WHERE ($N::boolean OR c.site_id = $M)` với tham số `[..., all, siteId]`, hoặc `EXISTS (... JOIN hse_contracts c ... AND c.site_id=$M)`.
- Chỉ user có `all` mới được đặt/đổi `site_id` của hợp đồng. Hợp đồng do officer tạo sẽ tự gán `req.user.siteId`.
- Frontend `seesAllSites` phải mirror y hệt quy tắc server.
- **Mọi endpoint HSE mới đọc hoặc ghi dữ liệu phải áp `siteScope`**, kể cả GET theo `:id`, để tránh IDOR chéo site.

## 4. Ngày giờ

- Hiển thị **dd/mm/yyyy** và **dd/mm/yyyy HH:mm** ở mọi nơi: UI, PDF, Excel, thẻ in. Đây là yêu cầu cố định từ 16/07/2026.
- Frontend dùng `fmtDate` / `fmtDateTime` trong `src/lib/date.ts`. Không dùng `toLocaleDateString` hay `.slice(0,10)` để hiển thị.
- `.slice(0,10)` chỉ dùng khi giá trị đi vào `<input type="date">` hoặc để so sánh chuỗi ISO.
- Hai ngoại lệ có chủ đích:
  - `GatePage` có `fmtTime` riêng (dd/MM HH:mm), để log trên mobile gọn hơn.
  - `server/src/lib/pdf.ts` có `d()` / `dt()` cục bộ, vì server không import được `src/lib/date.ts`.

## 5. PDF phía server (`server/src/lib/pdf.ts`)

- Font có sẵn của PDFKit (Helvetica...) **không có dấu tiếng Việt**. PDF dành cho người đọc phải nhúng TTF.
- `VN_FONT_CANDIDATES` tìm font theo thứ tự OpenSans (`/usr/share/fonts/opensans`, do `font-opensans` trong Dockerfile cung cấp), rồi DejaVu, rồi Arial Windows. Nếu không tìm thấy font nào thì dùng Helvetica và `stripTones()`, tức mất dấu nhưng không ra ký tự rác.
- Sửa Dockerfile thì phải kiểm tra `/usr/share/fonts/opensans/` vẫn còn trong container.
- **`buildCommitmentPdf` bắt buộc giữ Helvetica.** Bytes của nó được hash SHA-256 để ký SmartCA; đổi font sẽ làm hỏng xác minh các cam kết đã ký.

## 6. LDAP / AD

- Cấu hình nằm trong `site_config` với các key `ldap.*` (lưu từ `/cms/ldap`). Đọc qua `getConfigFromDb()`, env `LDAP_*` chỉ là dự phòng. Login và sync **phải dùng cùng nguồn** cấu hình. *Lý do:* lỗi cũ là login đọc env nên luôn trả 503.
- Thuộc tính username phải là **`sAMAccountName`**.
- Bắt buộc paged search (`paged: { pageSize: 900 }`). Thiếu nó, AD (khoảng 1257 user ở OU=HaTien) sẽ ném `SizeLimitExceededError`, và nginx trả 502.
- Phiên bản ldapjs đang dùng có `entry.object` undefined. Đọc dữ liệu từ `entry.attributes[].values`.

## 7. Frontend

- Gọi API qua `api()` trong `src/lib/api.ts`. File cần auth thì dùng `downloadFile` / `openFileInNewTab` / `fetchBlobUrl`. **Không bao giờ đặt JWT vào query string.**
- Trang portal dùng `portalApi` và không gửi JWT.
- Route mới dùng `lazy()` trong `App.tsx`.
- UI primitives nằm ở `src/components/ui` (Card, Badge, ProgressBar...). Icon chỉ dùng **lucide-react**.
- Màu Tailwind (`tailwind.config.js`), chi tiết xem `.claude/brand.md`:
  - `vicem` xanh `#0055A4`: màu chính.
  - `eco` xanh lá `#16A34A`: accent ưu tiên.
  - `hatien` đỏ `#E2231A`: chỉ dùng cho nhận diện thương hiệu, không dùng cho trạng thái lỗi thông thường.
- Nội dung HTML do người dùng soạn (TinyMCE) phải đi qua `sanitizeHtml` ở server trước khi lưu.
- TinyMCE dùng bản self-host `public/tinymce`. Không chuyển sang cloud vì cần API key và có thể bị chặn mạng nội bộ.

## 8. Upload file

- Dùng multer có sẵn: `upload` (hse-core, 20MB), `traineePhotoUpload`, upload của documents/media. Tên lưu là UUID, ngoài ra kiểm tra đuôi file (`ALLOWED_EXT`) và giới hạn dung lượng.
- Đường dẫn tải file đi qua endpoint có auth và kiểm tra site, không dựa vào `/uploads` static.
- Thư mục `uploads/` gitignored. Trong Docker nó là volume `atld-uploads`.

## 9. Audit

- Mọi thao tác ghi trong HSE (tạo, duyệt, đình chỉ, ký, mở cổng...) gọi `audit()` (lib/hse-core) để ghi vào `hse_audit_logs`. Màn "Nhật ký" (`/cms/an-toan/nhat-ky`) đọc từ bảng này.

## 10. Git

- Message dạng `feat: ...`, `fix: ...`, `chore: ...`, tiếng Việt không dấu.
- Không commit: `.env*` (trừ `.env.docker.example`), script deploy, `server/uploads`, cert/key, `.claude/settings.local.json`.
- File nháp kiểm thử đặt tên `server/_*.mjs` (đã gitignore).
