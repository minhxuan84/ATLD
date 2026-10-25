# Kiến trúc hệ thống ATLĐ

> Cập nhật: 25/10/2026, rà soát từ source. Thay thế `.claude/ARCHITECTURE.md` cũ (07/2026).
> Khi thêm route/bảng/trang mới, cập nhật file này.

## 1. Stack

| Lớp | Công nghệ |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind 3, React Router 6 (lazy route), lucide-react |
| Soạn thảo | TinyMCE 7 self-host tại `public/tinymce` (`licenseKey="gpl"`, không gọi cloud) |
| Nhận diện khuôn mặt | face-api.js, weights tại `public/models` (so khớp chạy trên trình duyệt) |
| QR | html5-qrcode (quét), qrcode (sinh) |
| PDF/Excel client | jsPDF + html2canvas (`src/lib/formPdf.ts`) |
| Backend | Express + TypeScript (tsx dev / tsc build), pg, jsonwebtoken, bcryptjs, helmet, cors, express-rate-limit, multer |
| PDF/Excel server | pdfkit, exceljs |
| Tích hợp | ldapjs (AD), VNPT SmartCA (ký số), OAuth Microsoft/Google, @anthropic-ai/sdk (sinh khoá học), fast-xml-parser (RSS) |
| DB | PostgreSQL 17, database `vicem_cms`, **schema `atld`** |
| Hạ tầng | Docker (node:20-alpine + font-opensans), nginx 1.27 HTTPS |

## 2. Cấu trúc thư mục

```
/                         Frontend Vite (package.json gốc)
├── src/
│   ├── App.tsx           Định nghĩa route (lazy)
│   ├── types.ts          Kiểu dùng chung + CMS_SECTIONS (mirror server/src/auth.ts)
│   ├── context/          AuthContext (user, token, canAccess/canHse...)
│   ├── lib/              api.ts, date.ts, contracts.ts, embedUrl.ts, faceRecognition.ts, fieldIcons.ts, formPdf.ts
│   ├── components/       ui/ (Card, Badge, ProgressBar...), layout/, home/, hse/, Certificate, RichText...
│   └── pages/            trang công khai | cms/ | hse/ | portal/
├── public/               tinymce/, models/ (face-api), ảnh tĩnh
├── server/
│   ├── src/index.ts      Bootstrap Express
│   ├── src/auth.ts       JWT, quyền, siteScope
│   ├── src/db.ts         Pool pg (search_path = PGSCHEMA, DATE trả string)
│   ├── src/routes/       auth, oauth, home, courses, documents, hse, findings, portal, jsa, news, admin, config, media
│   ├── src/lib/          hse-core, hse-training, pdf, cert-store, quiz-grade, quiz-record, trainee-photo, ldap, smartca, newsFetch, async-errors
│   ├── src/ai.ts, util.ts, seed.ts
│   ├── db/               schema.sql + migration-001/002 (lịch sử; đã lặp lại inline)
│   ├── test/             hse-training.mjs
│   └── uploads/          File người dùng (gitignored, volume Docker)
├── nginx/                nginx.conf, certs/ (chỉ openssl.cnf được track)
├── Dockerfile, docker-compose.yml, .env.docker.example
└── docs/                 Tài liệu này
```

## 3. Backend

### 3.1 Bootstrap (`server/src/index.ts`)

Thứ tự quan trọng:
1. `dotenv/config` → `./lib/async-errors.js` (patch Express để lỗi async → `next(err)`; phải import trước mọi router).
2. `trust proxy = 1`, `helmet` (CSP chỉ khi `NODE_ENV=production`; cho phép iframe YouTube/Vimeo), `cors(CORS_ORIGIN)`, `express.json({limit:'1mb'})`.
3. `GET /api/health` → `{ok:true, service:'atld-api'}`.
4. Mount router (thứ tự có ý nghĩa: `findings` và `portal` phải sau `hse` vì bảng của chúng do IIFE trong hse.ts tạo).
5. `/uploads` static (**không auth** — xem KNOWN-ISSUES), production phục vụ `../../dist` + SPA fallback.
6. Error handler: 413 cho file/body quá lớn; lỗi Postgres → 500 chung chung (không lộ tên bảng); còn lại 400.
7. `listen(PORT||4000)` → `initAuthDb()`, `initOAuthDb()`, `startNewsFetcher()` (30s đầu, sau đó 15 phút/lần).

### 3.2 Bảng route

Ký hiệu middleware: `auth` = requireAuth; `sec(x)` = requireSection; `hse(...)` = requireHse.
`canWrite = auth+sec('an-toan')`, `canGate = auth+hse(gate,inspect,approve)`,
`canInspect = auth+hse(inspect,approve)`, `canApprove = auth+hse(approve)`.

| Mount | File | Nội dung chính |
|---|---|---|
| `/api/auth` | auth.ts | `POST /login` (10/15ph), `GET /me`, `POST /ldap-login`, `POST /register` (5/giờ) |
| `/api/auth/oauth` | oauth.ts | `/microsoft`, `/google` + `/callback`; state HMAC 10 phút; thiếu client id → 503 |
| `/api/home` | home.ts | Nội dung trang chủ (public) |
| `/api/courses` | courses.ts | Danh sách/chi tiết khoá học, bước học, nộp bài, lịch sử; PDF bài làm/chứng chỉ qua `?k=download_key` hoặc cán bộ `khoa-hoc` |
| `/api/documents` | documents.ts | Thư viện tài liệu: cây thư mục, danh mục, upload (20MB), xem/tải; ghi cần `tai-lieu` |
| `/api/hse` | hse.ts | Toàn bộ HSE: doc-types, nhà thầu, hợp đồng (+file, NLĐ, báo cáo Excel), NLĐ (+hồ sơ, duyệt vào cổng, SmartCA), cổng (lookup/log/history/descriptors), kiểm tra hiện trường (+ảnh), đình chỉ, audit, thiết bị, hồ sơ dossier, cam kết (+ký SmartCA), khách, đánh giá nhà thầu, `sync-access`, dashboard |
| `/api/findings` | findings.ts | Phát hiện/CAPA 8 bước: tạo → assess → assign → capa → verify → close; suspend/resume/cancel (approve); quản lý portal token & duyệt hồ sơ tự khai |
| `/api/portal` | portal.ts | **Public**, token trong URL (60 req/15ph): khai báo NLĐ + file, báo cáo an toàn + ảnh, phản hồi CAPA, thi trắc nghiệm tại chỗ |
| `/api/jsa` | jsa.ts | Loại công việc, PPE, checklist, yêu cầu (doc/khoá học); giấy phép làm việc e-Permit: tạo → submit → approve → activate → close/cancel, PDF |
| `/api/news`, `/api/news-sources` | news.ts | Tin tức (public chỉ bản published), quản lý cần `tin-tuc`; nguồn RSS + `fetch-now` |
| `/api/admin` | admin.ts | Thống kê, người dùng, khoá học (+AI generate, câu hỏi, kết quả, quiz token), mục tiêu/mốc, chi nhánh, trường trắc nghiệm, menu; LDAP & SmartCA config chỉ `admin` |
| `/api/config` | config.ts | `GET /` & `/menu` public; `PUT /` cần `trang-tinh` (whitelist key) |
| `/api/media` | media.ts | Ảnh thương hiệu (`uploads/media`) & ảnh bài viết (`uploads/content`), chỉ raster ≤4MB |

Danh sách endpoint chi tiết: đọc trực tiếp file route (mỗi handler khai báo middleware ngay tại chỗ).

### 3.3 Xác thực & phân quyền (`server/src/auth.ts`)

- Role: `trainee | officer | admin`.
- JWT payload `AuthUser {id, username, fullName, role, permissions[], siteId}`; hết hạn `JWT_EXPIRES` (8h) hoặc `JWT_EXPIRES_REMEMBER` (30d).
- `users.permissions` (JSONB) = mảng section key; xem bảng key ở [CONVENTIONS.md](CONVENTIONS.md#2-phân-quyền-cms).
- Nguồn đăng nhập: local (bcrypt), LDAP/AD, OAuth Microsoft/Google (`users.auth_provider`).

### 3.4 Thư viện dùng chung (`server/src/lib`)

| File | Vai trò |
|---|---|
| hse-core.ts | `upload` multer (uploads/hse, 20MB), `audit()`, `clientIp`, `evalWorkerEligibility`, `evalEquipmentEligibility`, `evalWorkerAccess`, `syncWorkerAccess`, `syncEquipmentAccess`, `activeSuspensionReason`, `resolveWorkerIdentity` |
| hse-training.ts | Đối chiếu khoá học bắt buộc của JSA với chứng chỉ **theo CCCD** (không theo tên) |
| pdf.ts | `buildCommitmentPdf` (Helvetica, có hash), `buildPermitPdf`, `buildAttemptPdf`, `buildCertificatePdf` (OpenSans), `hashPdf` |
| cert-store.ts | Lưu PDF bài làm/chứng chỉ ở `uploads/certs` |
| quiz-grade.ts | Phát đề & chấm thống nhất cho courses.ts và portal.ts (seed xáo đáp án) |
| quiz-record.ts | Validate thông tin học viên, sinh PDF (lỗi chỉ log) |
| trainee-photo.ts | Ảnh học viên `uploads/trainee` (raster, 4MB) |
| ldap.ts | Cấu hình từ `site_config ldap.*` (fallback env), đăng nhập, đồng bộ user |
| smartca.ts | VNPT SmartCA: init sign, status, verify webhook HMAC |
| newsFetch.ts | Lấy RSS an toàn (HTTPS, chống SSRF, ≤3 redirect, 10s, 300KB), luôn lưu dạng draft |
| async-errors.ts | Bắt lỗi async toàn cục |

## 4. Cơ sở dữ liệu (schema `atld`)

Nguồn tạo bảng:
- `server/db/schema.sql` — lõi: users, branches, courses, questions, progress, quiz_fields, documents, news, milestones, goals, site_config, menu_items.
- `documents.ts` IIFE — doc_folders, doc_categories, documents.folder_id...
- `news.ts` NEWS_MIGRATIONS — news_sources, các cột RSS của news (mỗi câu chạy độc lập).
- `auth.ts initAuthDb` / `oauth.ts initOAuthDb` — cột auth_provider, email, oauth_provider_*.
- `hse.ts` IIFE (dòng ~35–1100) — toàn bộ bảng HSE/JSA/quiz:
  - Nhà thầu: hse_contractors, hse_contracts (`site_id` = mỏ neo phân site), hse_doc_types, hse_dossiers, hse_contractor_docs
  - NLĐ: hse_workers, hse_contract_workers, hse_worker_docs, hse_worker_submissions, hse_submission_files
  - Thiết bị: hse_equipments, hse_contract_equipments, hse_equipment_docs
  - Kiểm tra: hse_inspections, hse_inspection_items, hse_inspection_photos
  - Kiểm soát: hse_suspensions, hse_access_logs, hse_audit_logs, hse_commitments, hse_evaluations
  - Khách: hse_visitors (`site_id` riêng), hse_visitor_logs
  - JSA: jsa_work_types, jsa_ppe_items, jsa_work_type_ppe, jsa_work_type_docs, jsa_work_type_courses, jsa_checklist_items
  - Giấy phép: jsa_permits, jsa_permit_workers, jsa_permit_hazards, jsa_permit_controls, jsa_permit_approvals
  - Phát hiện: hse_findings, hse_finding_photos
  - Portal: hse_portal_tokens (chỉ lưu SHA-256 token, `expires_at`, `max_uses`)
  - Thi: quiz_attempts, quiz_certificates
  - ALTER bảng lõi: users.site_id, users.id_number (CCCD), courses.questions_per_attempt/validity_months/randomize_options/max_attempts, progress.expires_at, quiz_fields.purpose
- Dữ liệu cấu hình: `site_config` (key/value) chứa cả `ldap.*`, `smartca.*` và nội dung trang tĩnh.

## 5. Frontend

### 5.1 Route (`src/App.tsx`)

| Nhóm | Route |
|---|---|
| Công khai | `/`, `/dang-nhap`, `/dang-ky`, `/oauth/callback`, `/tin-tuc`, `/tin-tuc/:id` |
| Cần đăng nhập | `/huan-luyen`, `/huan-luyen/:id`, `/tai-lieu`, `/cong-kiem-soat` (GatePage) |
| CMS (`CmsProtected` + `SectionGuard`) | `/cms/nguoi-dung`, `chi-nhanh`, `khoa-hoc`, `truong-trac-nghiem`, `tin-tuc`, `tai-lieu`, `an-toan/*`, `muc-tieu`, `menu`, `trang-tinh`, `ldap`, `smartca` |
| Portal (không tài khoản) | `/khai-bao/:token`, `/bao-an-toan/:token`, `/khac-phuc/:token`, `/thi/:token` |

`/cms/ldap` và `/cms/smartca` không có guard client — server chặn bằng `requireRole('admin')`.

### 5.2 HSE (`/cms/an-toan/*`, `src/pages/hse/HsePage.tsx`)

Tab: `dashboard`, `nha-thau`, `ho-so`, `nguoi-lao-dong`, `thiet-bi`, `cam-ket`, `danh-gia`, `kiem-tra`,
`phat-hien`, `cong-khai-bao` (PortalPage – tạo link token), `giay-phep`, `dinh-chi`, `khach`, `cong`,
`cong-viec` (JSA config), `nhat-ky` (audit), `cau-hinh` (doc types). Tab bị ẩn theo `canHse()`;
route con không chặn — server là chốt chặn thật.

### 5.3 Gọi API

- `src/lib/api.ts`: `api()` tự gắn `Authorization: Bearer` (token `atld_token` trong localStorage/sessionStorage); `downloadFile`, `openFileInNewTab`, `fetchBlobUrl` cho file cần auth.
- Portal: `src/pages/portal/portalApi.ts` (không JWT, token nằm trong path).

## 6. File upload (`server/uploads`, volume `atld-uploads` trong Docker)

| Thư mục | Nội dung | Nguồn |
|---|---|---|
| `uploads/` (gốc) | Tài liệu thư viện | documents.ts |
| `uploads/hse/` | Hồ sơ HSE, ảnh kiểm tra/phát hiện, file portal | lib/hse-core.ts |
| `uploads/media/` | Ảnh thương hiệu | media.ts |
| `uploads/content/` | Ảnh trong bài viết | media.ts |
| `uploads/trainee/` | Ảnh học viên khi thi | lib/trainee-photo.ts |
| `uploads/certs/` | PDF bài làm/chứng chỉ | lib/cert-store.ts |
| `uploads/videos/` | Video cũ (tính năng render video đã bỏ) | — |

Tên file = UUID + đuôi. **Không có trong backup DB** — xem DEPLOY-OPS.

## 7. Tích hợp ngoài

| Hệ thống | Cấu hình | Ghi chú |
|---|---|---|
| LDAP/AD | `site_config ldap.*` (UI `/cms/ldap`), fallback `LDAP_*` env | `sAMAccountName`, paged search |
| VNPT SmartCA | `site_config smartca.*` (UI `/cms/smartca`), fallback `SMARTCA_*` | Webhook `POST /api/hse/smartca/callback` (HMAC `x-smartca-signature`) |
| OAuth | env `MICROSOFT_*`, `GOOGLE_*` | Redirect URI `{proto}://{host}/api/auth/oauth/{provider}/callback` — phải đăng ký đúng domain |
| Anthropic | env `ANTHROPIC_*` | Sinh khoá học/câu hỏi; hỗ trợ gateway qua `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` |
| RSS | bảng `news_sources` | 15 phút/lần, luôn lưu nháp |
| Email/SMTP | — | **Chưa có** |
| RabbitMQ, Prometheus | — | **Chưa áp dụng** (tài liệu trong `.claude/` chỉ là định hướng) |
