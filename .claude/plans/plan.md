---
name: plan
description: Chính sách lên kế hoạch — khi nào plan, cấu trúc plan, approval workflow
tags: [policy, planning, workflow]
---

# Plan — Chính Sách Lên Kế Hoạch

## Khi Nào Cần Plan Trước Khi Code

**Cần plan (EnterPlanMode):**
- Tính năng mới ảnh hưởng ≥ 3 files
- Thay đổi architecture (schema DB, auth flow, multi-tenancy)
- Nhiều hướng giải quyết hợp lệ
- Tác động đến production / shared systems
- Yêu cầu chưa rõ ràng

**Không cần plan:**
- Fix typo, sửa lỗi nhỏ ≤ 3 dòng
- Thêm 1 function/route đơn giản với spec rõ ràng
- Formatting / cleanup

## Cấu Trúc Plan Chuẩn

```markdown
## Mục Tiêu
[Kết quả cần đạt, không phải cách làm]

## Scope
- Files sẽ thay đổi: [list]
- Files KHÔNG thay đổi: [list]
- Out of scope: [list]

## Các Bước
1. [Bước cụ thể + file/function target]
2. ...

## Rủi Ro & Tradeoffs
- [Rủi ro A] → [Mitigation]

## Kiểm Tra
- [ ] Unit test / manual test step
- [ ] Deploy DEV verify
```

## ATLD-Specific Checklist

Trước khi implement tính năng liên quan đến:

**Database:**
- [ ] Schema `atld`, không touch `public`
- [ ] Migration là additive (thêm, không xóa)
- [ ] DATE columns → chuỗi ISO, không Date object

**HSE / Multi-tenancy:**
- [ ] `siteScope()` applied cho officers
- [ ] `site_id` filter trên contracts/visitors
- [ ] Admin bypass không bị block bởi site scope

**Frontend:**
- [ ] Ngày hiển thị dd/mm/yyyy (`fmtDate`/`fmtDateTime`)
- [ ] Xử lý lỗi + loading state
- [ ] Responsive mobile

**Deploy:**
- [ ] Tạo tarball vào `os.tmpdir()` (Windows: `%TEMP%`, Linux/Mac: `/tmp`):
  ```bash
  tar czf "$(node -e "require('os').tmpdir()" 2>/dev/null || echo /tmp)/atld-src.tgz" \
    --exclude=node_modules --exclude=.git --exclude=uploads \
    --exclude=dist --exclude=server/dist .
  ```
- [ ] `node deploy-dev.mjs` sau khi tạo tarball
- [ ] Verify trên 172.16.1.246 sau deploy

## Approval Workflow

```
Plan → User review → Approve → Implement → Test → Deploy DEV → Verify → Done
```

Không nhảy từ Plan thẳng sang Production. Luôn qua DEV trước.
