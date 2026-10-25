---
name: atld-permissions-site-scope
description: Use when adding or changing any ATLĐ API endpoint or CMS page that needs access control — CMS section permissions, HSE sub-permissions (gate/inspect/approve), officer site scoping (siteScope), or user role/permission editing.
---

# Phân quyền & phân công trường (site scoping)

Chi tiết đầy đủ nằm ở `docs/CONVENTIONS.md`, mục 2–3. Skill này là checklist khi viết code.

## Mô hình

- `users.role` có ba giá trị: `trainee`, `officer`, `admin`.
- `users.permissions` là mảng key lấy từ `CMS_SECTIONS` (`server/src/auth.ts`), **mirror** sang `src/types.ts`.
- HSE có sub-key `an-toan:gate`, `an-toan:inspect`, `an-toan:approve`. Có key `an-toan` là đủ toàn quyền HSE, **nhưng không đủ để thấy mọi site**.
- `siteScope(req.user)` trả `{ all, siteId }` với `all = role==='admin' || siteId==null`.

## Checklist endpoint mới (server)

1. Chọn middleware:
   - CMS thường: `requireAuth, requireSection('<key>')`.
   - HSE: dùng bộ sẵn ở đầu `routes/hse.ts`:
     ```ts
     const canWrite   = [requireAuth, requireSection('an-toan')]
     const canGate    = [requireAuth, requireHse('gate', 'inspect', 'approve')]
     const canInspect = [requireAuth, requireHse('inspect', 'approve')]
     const canApprove = [requireAuth, requireHse('approve')]
     ```
     Mẫu dùng: `hseRouter.post('/x', ...canInspect, async (req, res) => {...})`.
2. **Áp `siteScope` cho mọi đọc/ghi dữ liệu HSE**, kể cả `GET /:id`, `PATCH /:id` và tải file, để chặn IDOR chéo site:
   ```ts
   const { all, siteId } = siteScope(req.user!)
   await query(`... WHERE c.id = $1 AND ($2::boolean OR c.site_id = $3)`, [id, all, siteId])
   // bản ghi không thuộc site → 404 (đừng trả 403, để không lộ việc bản ghi tồn tại)
   ```
   - Site được suy ra qua `hse_contracts.site_id` (JOIN từ worker, equipment, inspection, suspension, commitment...).
   - Khách dùng `hse_visitors.site_id`.
   - Nhà thầu không có cột site. Officer thấy nhà thầu khi nhà thầu có hợp đồng tại site của mình **hoặc** chưa có hợp đồng nào.
3. Khi tạo bản ghi gắn site: nếu không phải `all` thì ép `site_id = req.user.siteId`, bỏ qua giá trị client gửi lên.
4. Mọi thao tác ghi trong HSE đều gọi `audit(req.user!, action, entity, id, oldVal, newVal, clientIp(req))`.

## Chống leo thang quyền

Trong POST/PUT `/admin/users`, chỉ **admin thật** mới được set `role`, `permissions` hoặc `site_id` của user khác. Officer có `nguoi-dung` chỉ tạo được trainee và sửa tên/mật khẩu. Đừng nới chốt này khi sửa `UsersManager`.

## Thêm section CMS mới

1. Thêm key vào `CMS_SECTIONS` (server).
2. Thêm vào `src/types.ts`.
3. Thêm nhãn trong UsersManager.
4. Thêm mục menu trong CmsLayout.
5. Gắn `requireSection` trên route server.
6. Bọc `<SectionGuard section="...">` trên route client trong `src/App.tsx`.

## Frontend

`AuthContext` cung cấp `canAccess`, `hasCmsAccess`, `canHse('gate'|'inspect'|'approve')` và `seesAllSites`. `seesAllSites` phải giữ **đúng** quy tắc của `siteScope`. Đây chỉ là lớp UX: ẩn nút trên UI không thay được việc chặn ở server.

## Kiểm thử nhanh

Đăng nhập bằng một officer gán site A, rồi gọi `GET /api/hse/<entity>/<id thuộc site B>`. Kết quả phải là 404, không phải 200.
