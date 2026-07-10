# PRD - Website Huấn luyện An toàn lao động & Môi trường

> Product Requirements Document
> Phiên bản: 1.0 · Ngày: 2026-07-02

---

## 1. Tổng quan sản phẩm

### 1.1. Bối cảnh
Doanh nghiệp/tổ chức cần một nền tảng số hóa công tác **Huấn luyện An toàn, Vệ sinh lao động (ATVSLĐ)** và **Bảo vệ môi trường** theo quy định pháp luật Việt Nam (Nghị định 44/2016/NĐ-CP, sửa đổi bởi NĐ 140/2018/NĐ-CP; Luật ATVSLĐ 84/2015/QH13). Việc huấn luyện truyền thống (tập trung, giấy tờ thủ công) tốn chi phí, khó lưu vết và khó kiểm soát chất lượng.

### 1.2. Mục tiêu sản phẩm
- Số hóa quy trình huấn luyện ATLĐ: **học qua video → tóm tắt → trắc nghiệm → cấp chứng chỉ**.
- Quản lý tập trung **tài liệu, hồ sơ ATLĐ** với phân quyền upload/lưu trữ/tìm kiếm.
- Truyền thông nội bộ qua kênh **Tin tức**, hiển thị **thành tích, kế hoạch mục tiêu**.

### 1.3. Chỉ số thành công (KPI)
| Chỉ số | Mục tiêu |
|---|---|
| Tỷ lệ hoàn thành khóa huấn luyện | ≥ 90% |
| Tỷ lệ đạt trắc nghiệm lần đầu | ≥ 70% |
| Thời gian tìm 1 tài liệu hồ sơ | < 10 giây |
| Thời gian tải trang chủ (LCP) | < 2.5 giây |

---

## 2. Đối tượng người dùng & Phân quyền

| Vai trò | Mô tả | Quyền chính |
|---|---|---|
| **Khách (Guest)** | Chưa đăng nhập | Xem trang chủ, tin tức công khai |
| **Học viên (Trainee)** | Người lao động | Xem video huấn luyện, làm trắc nghiệm, nhận chứng chỉ, xem tài liệu được chia sẻ |
| **Cán bộ ATLĐ (Safety Officer)** | Phụ trách an toàn | Upload/quản lý tài liệu hồ sơ, tạo/sửa khóa huấn luyện, đăng tin tức |
| **Quản trị (Admin)** | Quản trị hệ thống | Toàn quyền: quản lý người dùng, phân quyền, cấu hình, duyệt nội dung |

**Nguyên tắc phân quyền:** RBAC (Role-Based Access Control). Upload tài liệu chỉ dành cho Safety Officer & Admin. Học viên chỉ đọc tài liệu được gán quyền.

---

## 3. Yêu cầu chức năng

### 3.1. Trang chủ (Homepage)
1. **Banner (Hero):** Slogan, hình ảnh chủ đề an toàn lao động, CTA "Bắt đầu huấn luyện".
2. **Giới thiệu hoạt động:** Đoạn giới thiệu về huấn luyện ATLĐ & Môi trường, các nhóm đối tượng huấn luyện (6 nhóm theo NĐ 44).
3. **Timeline thành tích:** Dòng thời gian các cột mốc/thành tích đạt được (số giờ huấn luyện, số chứng chỉ cấp, 0 tai nạn...).
4. **Kế hoạch mục tiêu Năm/Tháng:** Thẻ hiển thị mục tiêu năm và mục tiêu tháng kèm tiến độ (%).
5. **Tin tức mới nhất:** 3-4 tin mới nhất dạng card.

### 3.2. Huấn luyện An toàn lao động (quy trình 3 bước)
- **Bước 1 — Xem video:** Trình phát video clip bài huấn luyện.
- **Bước 2 — Tóm tắt nội dung:** Hiển thị tóm tắt các điểm chính buổi huấn luyện; học viên xác nhận đã đọc.
- **Bước 3 — Trắc nghiệm trực tuyến & cấp chứng chỉ:**
  - Bộ câu hỏi trắc nghiệm (nhiều lựa chọn).
  - Chấm điểm tự động, ngưỡng đạt (mặc định ≥ 80%).
  - Đạt → sinh **chứng chỉ** (hiển thị tên học viên, khóa học, ngày cấp, mã chứng chỉ); cho phép tải/in.
  - Không đạt → cho làm lại.

*Quy tắc mở khóa:* phải hoàn thành bước trước mới mở bước sau.

### 3.3. Tài liệu hồ sơ An toàn lao động
- **Upload có phân quyền:** chỉ Safety Officer/Admin. Hỗ trợ PDF, DOCX, XLSX, ảnh.
- **Lưu trữ:** phân loại theo danh mục (Nội quy, Quy trình, Biên bản, Kết quả quan trắc môi trường, Hồ sơ pháp lý...).
- **Tìm kiếm:** theo tên, danh mục, ngày, người tải lên; lọc & sắp xếp.
- **Metadata:** tên tài liệu, mô tả, loại, kích thước, người tải, thời điểm.

### 3.4. Tin tức
- Danh sách tin, trang chi tiết tin.
- Safety Officer/Admin đăng, sửa, gỡ tin.
- Phân loại theo chuyên mục (Thông báo, Sự kiện, Cảnh báo an toàn).

---

## 4. Yêu cầu phi chức năng

| Nhóm | Yêu cầu |
|---|---|
| **Hiệu năng** | LCP < 2.5s; code-split theo route; lazy-load video/tài liệu |
| **Bảo mật** | RBAC; validate input; chống XSS; giới hạn loại/kích thước file upload; sanitize tên file |
| **Khả dụng** | Responsive (mobile/tablet/desktop); tương phản màu đạt WCAG AA |
| **Truy cập** | Semantic HTML, alt cho ảnh, focus rõ ràng, điều hướng bàn phím |
| **Bảo trì** | Cấu trúc component rõ ràng, dữ liệu mẫu tách riêng, TypeScript |
| **Đa ngôn ngữ** | Tiếng Việt (mặc định) |

---

## 5. Giả định & Phạm vi

**Trong phạm vi (MVP demo):**
- Frontend SPA với dữ liệu mẫu (mock) mô phỏng đầy đủ luồng nghiệp vụ.
- Xác thực & phân quyền mô phỏng phía client (chọn vai trò để demo).
- Trắc nghiệm chấm điểm & sinh chứng chỉ phía client.
- Quản lý tài liệu/tin tức lưu trạng thái trong phiên (in-memory/localStorage).

**Ngoài phạm vi (giai đoạn sau):**
- Backend thật (API, cơ sở dữ liệu, xác thực JWT/OAuth).
- Lưu trữ file thật trên cloud (S3/Blob).
- Ký số chứng chỉ, tích hợp SSO doanh nghiệp.

*Lưu ý bảo mật:* MVP dùng phân quyền phía client chỉ để demo trải nghiệm — **không dùng cho production** vì có thể bị bỏ qua. Giai đoạn sau bắt buộc kiểm soát phân quyền phía server.

---

## 6. Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| Phân quyền client bị bypass | Ghi rõ chỉ demo; roadmap có backend |
| File upload độc hại | Giới hạn định dạng/kích thước; không thực thi file |
| Nội dung tin tức chứa mã độc (XSS) | Không render HTML thô; sanitize/escape |

---

# PHỤ LỤC — Phiên bản 2.0 (Full-stack + CMS)

> Nâng cấp từ demo client-only lên web app thật, kèm database và trang quản trị.

## A1. Thay đổi kiến trúc
- Bổ sung **backend thật** (Express + TypeScript) và **PostgreSQL** (schema riêng `atld` trong DB `vicem_cms`, không đụng schema `public`).
- **Xác thực & phân quyền chuyển hẳn về phía server**: JWT + bcrypt, RBAC bằng middleware. Client không thể bypass.
- **Chấm điểm trắc nghiệm & cấp chứng chỉ thực hiện phía server** — đáp án đúng (`correct_index`) không gửi ra client.
- **Upload tài liệu thật** bằng multer, lưu file trên đĩa, tải về có kiểm quyền.

## A2. Nhận diện thương hiệu VICEM Hà Tiên
- Màu chủ đạo: xanh dương VICEM `#0055A4`, đỏ Hà Tiên `#E2231A`.
- Logo (SVG), favicon, tông màu áp dụng toàn hệ thống.
- Giao diện hiện đại: gradient tinh tế, đổ bóng mềm, hover/animation nhẹ.

## A3. Trang quản trị CMS (`/cms`, chỉ Admin)
- **Dashboard:** thống kê người dùng/khóa học/tài liệu/tin tức/chứng chỉ, phân bố vai trò, chứng chỉ gần đây.
- **Người dùng:** thêm/sửa/xóa, đổi vai trò, đổi mật khẩu (chặn tự xóa/hạ quyền admin cuối).
- **Khóa học & câu hỏi:** CRUD khóa học, thêm/xóa câu hỏi trắc nghiệm.
- **Tin tức, Tài liệu, Mục tiêu & Timeline:** quản lý tập trung.

## A4. Bảo mật (đã kiểm thử)
- bcrypt, JWT secret trong `.env`; truy vấn tham số hóa; escape input; validate upload; tên file ngẫu nhiên; helmet; CORS; rate-limit đăng nhập.
- Đã xác minh RBAC server: học viên gọi API admin → 403; không token → 401.
