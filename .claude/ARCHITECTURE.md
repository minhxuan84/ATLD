> ⚠️ **Đã lỗi thời** — nguồn cập nhật: [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md). Giữ file này chỉ để tham khảo lịch sử.

# ATLĐ VICEM Hà Tiên — Sơ đồ kiến trúc hệ thống

> Cập nhật: 2026-07-24

---

## Tổng quan

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                        │
│  React 18 SPA  (Vite + TypeScript + Tailwind CSS)              │
│  face-api.js │ jsPDF/html2canvas │ TinyMCE │ html5-qrcode      │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS (8443) / HTTP (8080→redirect)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  nginx 1.27-alpine                                              │
│  • TLS termination (self-signed / vicemhatien cert)            │
│  • HTTP → HTTPS redirect                                        │
│  • proxy_pass http://app:4000  (tất cả traffic)                │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Docker internal network
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Express API + SPA Server  (node:20-alpine, port 4000)         │
│                                                                 │
│  /api/auth       /api/courses    /api/documents                 │
│  /api/news       /api/config     /api/media                     │
│  /api/admin      /api/hse        /api/health                    │
│                                                                 │
│  Middleware: helmet │ cors │ express-rate-limit │ JWT auth      │
│  Libs:       LDAP/AD │ SmartCA (VNPT) │ PDFKit │ ExcelJS       │
│              Anthropic SDK (AI course gen)                      │
└──────────────────────────┬──────────────────────────────────────┘
                           │ pg (host.docker.internal)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  PostgreSQL (ngoài Docker, trên host / server riêng)           │
│  Database: vicem_cms                                            │
│  ├── schema: public   ← CMS gốc (23 bảng, KHÔNG đụng vào)    │
│  └── schema: atld     ← Toàn bộ dữ liệu ATLĐ                  │
└─────────────────────────────────────────────────────────────────┘

Volumes Docker:
  atld-uploads  →  /app/server/uploads  (media, content, hse files)
```

---

## Cấu trúc thư mục

### Root

```
ATLD/
├── src/                    # React frontend
├── server/                 # Express backend
├── nginx/                  # nginx config + SSL certs
├── dist/                   # Vite build output (không commit)
├── Dockerfile              # Multi-stage build (3 stages)
├── docker-compose.yml      # 2 services: app + nginx
├── .env                    # HTTP_PORT/HTTPS_PORT cho compose
├── .env.docker             # Secrets runtime container (không commit)
├── .env.docker.example     # Template env container
├── vite.config.ts          # proxy /api → localhost:4000
├── deploy-dev.mjs          # Deploy lên DEV 172.16.1.246
├── restore-db-dev.mjs      # Restore DB atld từ localhost → DEV
└── _rebuild.mjs            # Rebuild nhanh (không upload lại)
```

### src/ (React frontend)

```
src/
├── App.tsx                 # Root router (React Router v6)
├── main.tsx
├── types.ts                # Shared TypeScript types
├── context/
│   ├── AuthContext.tsx     # JWT state (login/logout/me)
│   └── ConfigContext.tsx   # Site config (branding/menu/stats)
├── hooks/
│   └── useReveal.ts        # IntersectionObserver animation
├── lib/
│   ├── api.ts              # Fetch wrapper + auth headers
│   ├── date.ts             # fmtDate / fmtDateTime (dd/mm/yyyy)
│   ├── embedUrl.ts         # YouTube/Vimeo embed builder
│   ├── faceRecognition.ts  # face-api.js wrapper (browser)
│   └── formPdf.ts          # jsPDF certificate generator
├── components/
│   ├── ui/index.tsx        # Shared UI primitives
│   ├── home/               # Hero, About, Goals, Timeline, LatestNews
│   ├── hse/
│   │   ├── FaceEnrollModal.tsx  # Enroll face descriptor
│   │   └── SmartCAModal.tsx     # SmartCA digital signature
│   └── layout/
│       ├── Header.tsx      # App header (authenticated)
│       └── Footer.tsx
└── pages/
    ├── HomePage.tsx
    ├── LoginPage.tsx
    ├── RegisterPage.tsx
    ├── NewsPage.tsx / NewsDetailPage.tsx
    ├── DocumentsPage.tsx
    ├── TrainingListPage.tsx / TrainingDetailPage.tsx
    ├── cms/                # CMS back-office (admin/officer)
    │   ├── CmsLayout.tsx
    │   ├── Dashboard.tsx
    │   ├── UsersManager.tsx
    │   ├── CoursesManager.tsx
    │   ├── NewsManager.tsx
    │   ├── GoalsManager.tsx
    │   ├── BranchesManager.tsx
    │   ├── MenuManager.tsx
    │   ├── QuizFieldsManager.tsx
    │   ├── SiteSettings.tsx
    │   ├── LdapConfigPage.tsx
    │   └── SmartCAConfigPage.tsx
    └── hse/                # Module ATVSLĐ / PCCN / BVMT
        ├── HsePage.tsx         # Shell layout HSE
        ├── DashboardPage.tsx
        ├── ContractorsPage.tsx
        ├── DossiersPage.tsx
        ├── WorkersPage.tsx
        ├── EquipmentPage.tsx
        ├── GatePage.tsx        # Cổng ra/vào: QR + nhận diện khuôn mặt
        ├── InspectionsPage.tsx
        ├── SuspensionsPage.tsx
        ├── CommitmentsPage.tsx # Cam kết số (SmartCA)
        ├── EvaluationsPage.tsx
        ├── VisitorsPage.tsx
        └── DocTypesConfigPage.tsx
```

### server/ (Express backend)

```
server/
├── src/
│   ├── index.ts            # Express app entry, route mounting
│   ├── auth.ts             # JWT sign/verify, requireAuth, requireCms, requireRole
│   ├── db.ts               # pg Pool wrapper
│   ├── ai.ts               # Anthropic SDK (AI course generation)
│   ├── seed.ts             # DB seed (dev only — TRUNCATE atld!)
│   ├── util.ts             # sanitize, escapeText, ALLOWED_EXT
│   ├── lib/
│   │   ├── ldap.ts         # LDAP/AD auth + sync
│   │   ├── pdf.ts          # PDFKit: commitment PDF
│   │   └── smartca.ts      # VNPT SmartCA digital signature API
│   └── routes/
│       ├── auth.ts         # /api/auth
│       ├── home.ts         # /api/home
│       ├── courses.ts      # /api/courses
│       ├── documents.ts    # /api/documents
│       ├── news.ts         # /api/news
│       ├── admin.ts        # /api/admin
│       ├── config.ts       # /api/config
│       ├── media.ts        # /api/media
│       └── hse.ts          # /api/hse
└── db/
    ├── schema.sql              # Schema gốc (atld.*)
    ├── migration-001-folders.sql
    └── migration-002-categories-permissions.sql
```

---

## Docker Build (3 stages)

```
Stage 1 — client-builder (node:20-alpine)
  WORKDIR /app
  npm ci → npm run build (tsc -b && vite build)
  Output: /app/dist  (SPA tĩnh)

Stage 2 — server-builder (node:20-alpine)
  WORKDIR /app/server
  npm ci → npm run build (tsc)
  Output: /app/server/dist  (JS compiled)

Stage 3 — runtime (node:20-alpine)
  WORKDIR /app/server
  npm ci --omit=dev
  COPY server/dist → ./dist
  COPY /app/dist  → /app/dist  (Express serve SPA)
  USER node  |  EXPOSE 4000
  CMD ["node", "dist/index.js"]
```

---

## API Endpoints

### /api/auth
| Method | Path | Auth |
|--------|------|------|
| POST | /api/auth/login | public (rate-limit 10/15min) |
| POST | /api/auth/ldap-login | public (rate-limit 10/15min) |
| POST | /api/auth/register | public (rate-limit 5/hr) |
| GET  | /api/auth/me | requireAuth |

### /api/courses
| Method | Path | Auth |
|--------|------|------|
| GET  | /api/courses | requireAuth |
| GET  | /api/courses/meta/quiz-fields | requireAuth |
| GET  | /api/courses/:id | requireAuth |
| POST | /api/courses/:id/step | requireAuth |
| POST | /api/courses/:id/submit | requireAuth |

### /api/documents
| Method | Path | Auth |
|--------|------|------|
| GET/POST | /api/documents/categories | requireAuth |
| PATCH/DELETE | /api/documents/categories/:id | section:tai-lieu |
| GET  | /api/documents/tree | requireAuth |
| GET/POST | /api/documents | requireAuth / section:tai-lieu |
| GET  | /api/documents/:id/view | requireAuth |
| GET  | /api/documents/:id/download | requireAuth |
| PATCH/DELETE | /api/documents/:id | section:tai-lieu |
| POST/PATCH/DELETE | /api/documents/folders/* | section:tai-lieu |

### /api/news
| Method | Path | Auth |
|--------|------|------|
| GET  | /api/news | public |
| GET  | /api/news/:id | public |
| POST/PUT/DELETE | /api/news/* | section:tin-tuc |

### /api/admin (tất cả requireCms)
| Nhóm | Path | Permission |
|------|------|-----------|
| Stats | /api/admin/stats | requireCms |
| Users | /api/admin/users/* | section:nguoi-dung |
| Courses | /api/admin/courses/* | section:khoa-hoc |
| Questions | /api/admin/questions/* | section:khoa-hoc |
| Certificates | /api/admin/courses/:id/certificates | section:khoa-hoc |
| AI Gen | /api/admin/courses/ai-generate | section:khoa-hoc |
| Goals | /api/admin/goals/* | section:muc-tieu |
| Milestones | /api/admin/milestones/* | section:muc-tieu |
| Branches | /api/admin/branches/* | section:chi-nhanh |
| Quiz fields | /api/admin/quiz-fields/* | section:truong-trac-nghiem |
| Menu | /api/admin/menu/* | section:menu |
| LDAP config | /api/admin/ldap-* | requireRole:admin |
| SmartCA config | /api/admin/smartca-* | requireRole:admin |

### /api/hse (tất cả requireAuth)
| Nhóm | Path | Permission |
|------|------|-----------|
| Doc types | /api/hse/doc-types/* | canWrite |
| Contractors | /api/hse/contractors/* | canInspect |
| Contracts | /api/hse/contracts/* | canInspect |
| Workers | /api/hse/workers/* | canInspect |
| Gate log | /api/hse/gate/log | canGate |
| Gate lookup | /api/hse/gate/lookup | all auth |
| Gate history | /api/hse/gate/history | site-scoped |
| Inspections | /api/hse/inspections/* | canInspect |
| Suspensions | /api/hse/suspensions/* | canApprove |
| Commitments | /api/hse/commitments/* | canInspect |
| Evaluations | /api/hse/evaluations/* | canInspect |
| Visitors | /api/hse/visitors/* | canGate |

---

## Schema Database: `atld`

> Rule cứng: **KHÔNG BAO GIỜ đụng schema `public`** (CMS gốc VICEM Hà Tiên).  
> Mọi migration phải là **additive** (không DROP table/column đang dùng).

### Bảng core (schema.sql)

| Bảng | Mục đích |
|------|---------|
| `atld.users` | Users, RBAC, `permissions JSONB`, `site_id`, `auth_provider` |
| `atld.branches` | Chi nhánh / nhà máy |
| `atld.courses` | Khoá đào tạo (id dạng slug) |
| `atld.questions` | Câu hỏi trắc nghiệm (correct_index không gửi về client) |
| `atld.progress` | Tiến độ học, điểm thi, chứng chỉ |
| `atld.quiz_fields` | Cấu hình trường form trắc nghiệm |
| `atld.documents` | Metadata tài liệu, file trên disk |
| `atld.doc_folders` | Cây thư mục tài liệu (self-ref) |
| `atld.doc_categories` | Danh mục tài liệu |
| `atld.news` | Tin tức / thông báo |
| `atld.milestones` | Timeline trang chủ |
| `atld.goals` | Mục tiêu năm/tháng |
| `atld.site_config` | Key-value cấu hình site |
| `atld.menu_items` | Menu điều hướng |

### Bảng HSE (migration inline trong hse.ts)

| Bảng | Mục đích |
|------|---------|
| `atld.hse_contractors` | Nhà thầu / đơn vị thi công |
| `atld.hse_contracts` | Hợp đồng (contractor + site + risk_level) |
| `atld.hse_doc_types` | Loại hồ sơ cấu hình (nhà thầu/công nhân/thiết bị) |
| `atld.hse_dossiers` | Bộ hồ sơ theo hợp đồng |
| `atld.hse_contractor_docs` | File đính kèm hồ sơ nhà thầu |
| `atld.hse_workers` | Công nhân (access_status, face_descriptor) |
| `atld.hse_contract_workers` | N-N: công nhân ↔ hợp đồng |
| `atld.hse_worker_docs` | Hồ sơ an toàn công nhân |
| `atld.hse_equipments` | Thiết bị (access_status) |
| `atld.hse_contract_equipments` | N-N: thiết bị ↔ hợp đồng |
| `atld.hse_equipment_docs` | Hồ sơ thiết bị |
| `atld.hse_inspections` | Biên bản kiểm tra (BM111-07.03/04) |
| `atld.hse_inspection_items` | Chi tiết từng mục kiểm tra |
| `atld.hse_suspensions` | Lệnh tạm dừng thi công (R6) |
| `atld.hse_access_logs` | Log cổng ra/vào bất biến |
| `atld.hse_visitors` | Khách/nhà cung cấp (QR, face_descriptor) |
| `atld.hse_visitor_logs` | Log cổng khách |
| `atld.hse_evaluations` | Đánh giá định kỳ nhà thầu (BM111-07.05) |
| `atld.hse_commitments` | Cam kết an toàn số (chữ ký SmartCA) |
| `atld.hse_audit_logs` | Audit trail bất biến cho mọi thao tác HSE |

---

## RBAC & Site Scoping

### Roles
| Role | Quyền |
|------|-------|
| `admin` | Toàn quyền, cấu hình LDAP/SmartCA |
| `officer` | CMS theo `permissions` JSONB, HSE theo site |
| `trainee` | Học khoá, thi, xem tài liệu |

### Sections (CMS permissions)
`tin-tuc` · `tai-lieu` · `nguoi-dung` · `khoa-hoc` · `muc-tieu`  
`chi-nhanh` · `trang-tinh` · `menu` · `truong-trac-nghiem` · `an-toan`

### HSE permission helpers (server/routes/hse.ts)
| Helper | Điều kiện |
|--------|-----------|
| `canWrite` | admin hoặc officer có section `an-toan` |
| `canInspect` | admin hoặc officer có section `an-toan` |
| `canApprove` | admin hoặc officer có section `an-toan` |
| `canGate` | admin hoặc officer có section `an-toan` |

### Site scoping
- `users.site_id → branches.id`
- Officer chỉ thấy dữ liệu HSE của site mình (`siteScope()`)
- Admin thấy tất cả sites

---

## Dependencies chính

### Client
| Package | Version | Mục đích |
|---------|---------|---------|
| react / react-dom | ^18.3.1 | UI |
| react-router-dom | ^6.24.0 | Routing |
| face-api.js | ^0.22.2 | Nhận diện khuôn mặt |
| html5-qrcode | ^2.3.8 | Quét QR cổng |
| qrcode | ^1.5.4 | Tạo QR |
| jspdf + html2canvas | ^4.2.1 / ^1.4.1 | Chứng chỉ PDF |
| @tinymce/tinymce-react | ^5.1.1 | Rich text editor |
| lucide-react | ^0.400.0 | Icons |
| tailwindcss | dev | Styling |

### Server
| Package | Version | Mục đích |
|---------|---------|---------|
| express | ^4.19.2 | HTTP server |
| pg | ^8.12.0 | PostgreSQL client |
| jsonwebtoken | ^9.0.2 | JWT |
| bcryptjs | ^2.4.3 | Password hashing |
| helmet + cors + express-rate-limit | latest | Security |
| multer | ^2.2.0 | File upload |
| @anthropic-ai/sdk | ^0.32.1 | AI course gen (Claude) |
| ldapjs | ^3.0.7 | LDAP/AD auth |
| pdfkit | ^0.15.0 | PDF commitment |
| exceljs | ^4.4.0 | Excel report |

---

## Quy tắc bắt buộc

1. **DB schema**: chỉ dùng `atld.*`, không bao giờ đụng `public.*`
2. **Migration**: additive only — không DROP table/column đang dùng
3. **Date format**: luôn hiển thị `dd/mm/yyyy` → dùng `fmtDate`/`fmtDateTime` từ `src/lib/date.ts`
4. **Site scoping**: officer chỉ thấy dữ liệu site mình → `siteScope()` trong query HSE
5. **CMS permissions**: kiểm tra `section` trước khi ghi — không escalate qua các section khác
6. **Deploy**: tạo tarball tại `os.tmpdir()` (không hardcode `/tmp`) trước khi chạy `deploy-dev.mjs`
