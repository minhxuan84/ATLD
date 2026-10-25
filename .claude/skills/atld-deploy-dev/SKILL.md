---
name: atld-deploy-dev
description: Use when deploying ATLĐ to the DEV server (which is effectively production), checking server health, viewing container logs, backing up/restoring the atld schema, or recreating deploy scripts on a new machine.
---

# Deploy & vận hành DEV (≈ PROD)

Tài liệu đầy đủ ở `docs/DEPLOY-OPS.md`. DEV có người dùng thật, nên **hỏi người dùng trước khi deploy, restore, hoặc chạy bất kỳ lệnh ghi nào trên server**.

## Trước khi deploy

1. Chạy `npm run build` (root) và `cd server && npm run build`. Cả hai phải sạch lỗi.
2. Đảm bảo migration mới tuân theo skill `atld-db-migration`.
3. Nếu thay đổi có migration rủi ro, backup DB trên server trước (mục "Backup").

## Deploy

```bash
node deploy-dev.mjs
```

Script này gitignored; credential đọc từ `.env.deploy` (gitignored: `DEPLOY_HOST/USER/PASS`, `OPS_USER/PASS`). Production bắt buộc `JWT_SECRET` trong `.env.docker` trên server, thiếu thì app không khởi động. Các bước script làm:

1. Tạo tarball trong `os.tmpdir()` qua `tar -czf - <excludes> . > file`, loại trừ `node_modules`, `.git`, `.claude`, mọi `.env*`, các script ops có credential, `_*`, `backups`, `dist`. Không bao giờ để file credential lọt vào tarball.
2. Upload lên `/tmp/atld-src.tgz`.
3. Giải nén đè vào `/home/dungpv/atld` dưới quyền `dungpv`. Bước này giữ nguyên `.env.docker`, uploads và node_modules.
4. Đồng bộ `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` từ env local vào `.env.docker` (nếu có).
5. Chạy `docker compose build && docker compose up -d && docker compose ps`.
6. Chạy `curl -sk https://localhost:8443/api/health`.

**Máy mới không có script:** dựng lại theo 6 bước trên bằng `ssh2`/`ssh2-sftp-client`. Đọc host/user/mật khẩu từ biến môi trường hoặc dùng SSH key. **Không hardcode, không commit.**

### Bẫy Windows

- Không truyền đường dẫn `C:\...` cho `tar`: GNU tar hiểu nhầm thành host từ xa, còn bsdtar không có `--force-local`.
- Không dùng `/tmp` trong Node. Dùng `os.tmpdir()`.
- Tạo tarball **trước** khi upload, đừng upload file cũ còn sót lại.

## Sau deploy: xác minh

```bash
docker compose ps
```

```bash
docker logs atld-app --tail 100
```

Trong log, tìm dòng `[hse migration]`/`[news migration]` báo lỗi. Một câu migration HSE lỗi sẽ làm bỏ qua các câu sau nó. Sau đó mở `https://atld.vicemhatien.com.vn` và kiểm tra luồng vừa sửa.

## Backup

Trên server, trong thư mục dự án:

```bash
./atld-backup-db.sh
```

Script chạy `pg_dump -n atld` qua container `postgres:16-alpine` và ghi ra `backups/atld_backup_<ts>.sql.gz`. Cron chạy lúc 02:00 hằng ngày và giữ 7 ngày.

File upload **không** nằm trong backup DB. Backup riêng volume `atld-uploads` (lệnh ở DEPLOY-OPS mục 4).

## Restore: phá huỷ

`atld-restore-script.js` chạy `DROP SCHEMA atld CASCADE`. Chỉ chạy khi người dùng xác nhận rõ ràng và đã có bản backup mới nhất. Lưu ý thêm: `restore-db-dev.mjs` ghi đè toàn bộ crontab.

## Rollback

Checkout commit cũ ở local rồi deploy lại. Migration chỉ thêm, nên code cũ vẫn chạy trên schema mới.
