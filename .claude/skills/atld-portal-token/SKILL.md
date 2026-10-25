---
name: atld-portal-token
description: Use when working on ATLĐ's no-login public portal (/api/portal, portalApi) — contractor worker declarations, field reports, CAPA responses, quiz links — or adding a new portal token purpose.
---

# Portal không cần đăng nhập

Cổng cho người ngoài (nhà thầu, học viên ngoài, người ở hiện trường) truy cập bằng token trong URL. Bảng `atld.hse_portal_tokens`; router `server/src/routes/portal.ts`; client dùng `portalApi`.

## Purpose hiện có

| purpose | Ràng buộc | Kết quả ghi |
|---|---|---|
| `worker_declare` | gắn `contractor_id` / `contract_id` | `hse_worker_submissions` (`pending → approved/rejected`), cán bộ duyệt trong CMS |
| `field_report` | thường gắn `site_id` | `hse_findings` mới, kèm ảnh |
| `capa_response` | bắt buộc `finding_id` | Bằng chứng khắc phục cho finding đó |
| `quiz` | bắt buộc `course_id` (CHECK) | `quiz_attempts`, `quiz_certificates` (`source='portal'`) |

## Quy tắc

- Token được kiểm `expires_at`, `max_uses`/`used_count`, và **đúng purpose** cho từng endpoint. Dùng helper tra token sẵn có trong `portal.ts`, không tự viết lại.
- Không bao giờ nhận hoặc gửi JWT trên portal. Không tin `site_id`/`contract_id` do client gửi: lấy các giá trị này từ token.
- Endpoint portal đã có `portalLimiter` (express-rate-limit). App đặt `trust proxy 1`, nên IP lấy được là IP thật sau nginx.
- File upload qua portal dùng multer có giới hạn đuôi file và dung lượng.
- Ghi dữ liệu thì gọi `audit()` (actor là hệ thống/portal) khi phù hợp. Nếu ảnh hưởng điều kiện vào cổng thì gọi `syncWorkerAccess`.
- Danh tính NLĐ và học viên được so khớp theo **CCCD** (`resolveWorkerIdentity`), không theo họ tên.

## Thêm purpose mới

1. Nới CHECK `hse_portal_tokens_purpose_chk` theo mẫu **DROP IF EXISTS rồi ADD** (xem skill `atld-db-migration`). Chỉ ADD sẽ không có tác dụng.
2. Thêm cột tham chiếu nếu cần (`ADD COLUMN IF NOT EXISTS`) và một CHECK bảo đảm cột đó không null với purpose mới.
3. Thêm nhánh vào hàm tra token và endpoint trong `portal.ts`, cùng trang client tương ứng.
4. Thêm lựa chọn vào UI tạo token trong CMS, chỉ cho người có quyền phù hợp tạo.
