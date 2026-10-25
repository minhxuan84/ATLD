---
name: write-guard
description: Bảo vệ file quan trọng — quy tắc trước khi ghi/xóa file nhạy cảm
tags: [policy, safety, files]
---

# Write Guard — Bảo Vệ File Quan Trọng

## Nguyên Tắc

Trước khi ghi đè hoặc xóa file, agent **phải đọc file trước** và xác nhận nội dung khớp với mô tả. Nếu nội dung khác → dừng, báo cáo thay vì tiến hành.

## Files Cần Bảo Vệ (ATLD)

| File | Lý do | Hành động an toàn |
|------|-------|-------------------|
| `server/src/db.ts` | Pool PG + type parser DATE | Đọc trước, patch additive |
| `server/src/auth.ts` | JWT / session logic | Confirm trước khi sửa auth flow |
| `.env` / `.env.production` | Credentials thật | KHÔNG đọc/echo, chỉ tham chiếu bằng key name |
| `server/src/routes/hse.ts` | Business logic HSE lớn | Đọc section cụ thể, không overwrite toàn bộ |
| `migrations/*.sql` | Schema DB production | Additive only, review trước |
| `deploy-dev.mjs` | Script deploy | Confirm trước khi chạy |

## Quy Tắc Thực Hành

```
1. Read → 2. Verify → 3. Edit (patch, không overwrite) → 4. Verify lại
```

### ✅ An toàn
```bash
# Patch một section cụ thể
Edit file_path="server/src/db.ts" old_string="..." new_string="..."

# Tạo file mới (không ghi đè)
Write file_path="server/src/routes/new-feature.ts" content="..."
```

### ❌ Nguy hiểm — cần confirm
```bash
# Overwrite toàn bộ file lớn đã có logic
Write file_path="server/src/routes/hse.ts" content="..."  # hse.ts ~1800 dòng!

# Xóa migrations
rm -rf migrations/

# Force push
git push --force
```

## Destructive Operations — Luôn Confirm

- `git reset --hard` / `git push --force`
- `DROP TABLE` / `TRUNCATE`
- Xóa file không phải do agent tạo trong session hiện tại
- Deploy production (non-DEV)

## Secrets

Không bao giờ echo/print nội dung `.env`. Tham chiếu bằng key:
> "Biến `PGPASSWORD` đã được set" — KHÔNG in ra giá trị.
