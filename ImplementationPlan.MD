# Implementation Plan - Website Huấn luyện ATLĐ & Môi trường

> Kế hoạch triển khai · Phiên bản 1.0 · 2026-07-02
> Tham chiếu: [PRD.MD](./PRD.MD)

---

## 1. Lựa chọn công nghệ (Tech Stack)

| Lớp | Công nghệ | Lý do |
|---|---|---|
| Build tool | **Vite** | Khởi động nhanh, HMR tốt, build tối ưu |
| Framework | **React 18 + TypeScript** | Component hóa, type-safe, phổ biến |
| Định tuyến | **React Router v6** | SPA multi-page, code-split theo route |
| Style | **Tailwind CSS** | Nhất quán, responsive nhanh, dễ đạt WCAG |
| State | React Context + hooks | Đủ cho MVP (auth/role, dữ liệu) |
| Lưu trữ demo | localStorage | Giữ trạng thái tài liệu/tin tức/tiến độ qua reload |
| Icon | lucide-react | Nhẹ, đồng bộ |

> Không dùng backend ở MVP. Toàn bộ nghiệp vụ mô phỏng phía client (nêu rõ trong PRD mục 5).

---

## 2. Kiến trúc & Cấu trúc thư mục

```
ATLD/
├─ PRD.MD
├─ ImplementationPlan.MD
├─ index.html
├─ package.json
├─ vite.config.ts
├─ tailwind.config.js
├─ tsconfig.json
└─ src/
   ├─ main.tsx                 # entry, router
   ├─ App.tsx                  # layout + routes
   ├─ index.css                # tailwind + base
   ├─ types.ts                 # kiểu dữ liệu chung
   ├─ context/
   │   └─ AuthContext.tsx      # vai trò + phân quyền (RBAC demo)
   ├─ data/
   │   ├─ courses.ts           # khóa huấn luyện + video + quiz
   │   ├─ documents.ts         # tài liệu mẫu
   │   ├─ news.ts              # tin tức mẫu
   │   └─ home.ts              # timeline, mục tiêu, giới thiệu
   ├─ lib/
   │   ├─ storage.ts           # helper localStorage
   │   └─ security.ts          # escape/sanitize, validate upload
   ├─ components/
   │   ├─ layout/ (Header, Footer, RoleSwitcher)
   │   ├─ home/ (Hero, About, Timeline, Goals, LatestNews)
   │   └─ ui/ (Card, Badge, ProgressBar, Button)
   └─ pages/
       ├─ HomePage.tsx
       ├─ TrainingListPage.tsx
       ├─ TrainingDetailPage.tsx   # 3 bước
       ├─ CertificatePage.tsx
       ├─ DocumentsPage.tsx        # upload/lưu trữ/tìm kiếm
       ├─ NewsPage.tsx
       └─ NewsDetailPage.tsx
```

---

## 3. Mô hình dữ liệu (TypeScript)

- **Role**: `'guest' | 'trainee' | 'officer' | 'admin'`
- **Course**: `{ id, title, description, videoUrl, summary: string[], quiz: Question[], passScore }`
- **Question**: `{ id, text, options: string[], correctIndex }`
- **Progress**: `{ courseId, step, quizScore, passed, certId? }`
- **DocItem**: `{ id, name, category, description, sizeKb, uploadedBy, uploadedAt }`
- **NewsItem**: `{ id, title, category, excerpt, content, author, date }`
- **Goal**: `{ scope: 'year'|'month', title, target, progress }`
- **Milestone**: `{ date, title, detail }`

---

## 4. Ma trận phân quyền (RBAC)

| Hành động | guest | trainee | officer | admin |
|---|:--:|:--:|:--:|:--:|
| Xem trang chủ, tin tức | ✅ | ✅ | ✅ | ✅ |
| Học & làm trắc nghiệm | ❌ | ✅ | ✅ | ✅ |
| Xem tài liệu | ❌ | ✅ | ✅ | ✅ |
| Upload/xóa tài liệu | ❌ | ❌ | ✅ | ✅ |
| Đăng/sửa tin tức | ❌ | ❌ | ✅ | ✅ |
| Quản lý người dùng | ❌ | ❌ | ❌ | ✅ |

Enforce qua helper `can(role, action)` + ẩn/hiện UI + chặn hành động.

---

## 5. Luồng nghiệp vụ chính

**Huấn luyện 3 bước:** Video (B1) → Tóm tắt + xác nhận (B2) → Trắc nghiệm (B3). Bước sau khóa đến khi hoàn thành bước trước. Đạt ≥ passScore → sinh chứng chỉ (mã `ATLD-{courseId}-{timestamp}`), lưu localStorage, cho in/tải.

**Tài liệu:** officer/admin upload (validate định dạng: pdf/doc/docx/xls/xlsx/ảnh; ≤ 20MB; sanitize tên) → lưu metadata → danh sách có tìm kiếm/lọc/sắp xếp.

**Tin tức:** danh sách → chi tiết; officer/admin thêm/sửa/xóa. Nội dung render dạng text an toàn (không HTML thô).

---

## 6. Kế hoạch bảo mật & performance

- **Bảo mật:** escape mọi nội dung do người dùng nhập; validate upload; không dùng `dangerouslySetInnerHTML`; giới hạn kích thước/định dạng file; nêu rõ RBAC client chỉ để demo.
- **Performance:** `React.lazy` + `Suspense` code-split theo route; ảnh/iframe video `loading="lazy"`; component nhẹ; build minify của Vite.

---

## 7. Roadmap thực hiện (khớp 6 bước)
1. ✅ Research → PRD.MD
2. ✅ Kế hoạch → ImplementationPlan.MD
3. ⏳ Deploy: init dự án, cài deps, dựng layout + trang chủ + 3 module chức năng
4. ⏳ Kiểm thử: chạy dev, test golden path + edge case từng luồng
5. ⏳ Kiểm tra bảo mật & performance
6. ⏳ Build production

## 8. Tiêu chí hoàn thành (Definition of Done)
- Đủ trang chủ 5 khối; 3 module menu hoạt động; RBAC demo đúng ma trận; responsive; build production không lỗi; đã kiểm thử luồng chính.

---

# PHỤ LỤC — Kế hoạch v2.0 (Full-stack + CMS)

## B1. Stack bổ sung
- Backend: Node.js + Express + TypeScript, `pg`, `bcryptjs`, `jsonwebtoken`, `multer`, `helmet`, `express-rate-limit`.
- DB: PostgreSQL 17, schema `atld` trong `vicem_cms`.

## B2. Cấu trúc thư mục
```
ATLD/
├─ src/                      # frontend React
│   ├─ lib/api.ts            # gọi API + gắn JWT
│   ├─ context/AuthContext   # đăng nhập thật (JWT)
│   ├─ components/Logo.tsx   # logo VICEM Hà Tiên
│   └─ pages/cms/            # CmsLayout, Dashboard, UsersManager, CoursesManager, GoalsManager
└─ server/                   # backend Express
    ├─ db/schema.sql         # migration schema atld
    └─ src/
        ├─ db.ts             # pool pg (search_path=atld)
        ├─ auth.ts           # signToken, requireAuth, requireRole
        ├─ seed.ts           # seed dữ liệu + 3 tài khoản bcrypt
        └─ routes/           # auth, home, courses, documents, news, admin
```

## B3. Mô hình dữ liệu (schema atld)
users, courses, questions, progress, documents, news, milestones, goals — xem `server/db/schema.sql`.

## B4. Bảo mật server
- JWT (8h) + bcrypt(10). RBAC qua `requireRole`. Tham số hóa truy vấn. Escape input. multer validate + tên file ngẫu nhiên. helmet + CORS + rate-limit login.

## B5. Kết quả kiểm thử & build
- Đăng nhập 3 vai trò OK; RBAC server chặn đúng (403/401); chấm điểm & cấp chứng chỉ server OK; CRUD người dùng end-to-end OK; CMS dashboard/khóa học OK.
- `npm run build` frontend & backend: **thành công**. TypeScript typecheck sạch cả hai.
- Rà soát: không có `dangerouslySetInnerHTML`/`innerHTML`/`eval`; `npm audit` backend 0 lỗ hổng.
