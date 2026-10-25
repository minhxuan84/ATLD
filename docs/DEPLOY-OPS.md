# Triển khai & vận hành

> Không ghi mật khẩu, token hay private key vào file này. Credential nằm ở password manager của đội hoặc trong biến môi trường trên máy người deploy.

## 1. Các môi trường

| Môi trường | Nơi chạy | Ghi chú |
|---|---|---|
| LOCAL | Máy dev: `npm run dev` (web :5173, API :4000) | DB Postgres 17 local, schema `atld` |
| DEV, **đang dùng như PROD** | Server nội bộ `172.16.1.246`, thư mục `/home/dungpv/atld` | Domain `atld.vicemhatien.com.vn`. Có người dùng thật, nên mọi thao tác cần thận trọng như production |

Trên server DEV:

| Container | Vai trò |
|---|---|
| `atld-app` | Node API, đồng thời phục vụ SPA đã build. `expose 4000`, `env_file: .env.docker`, volume `atld-uploads` → `/app/server/uploads` |
| `atld-nginx` | Reverse proxy TLS. Cổng 80/443 và 8080/8443. Mount `nginx/nginx.conf` và `nginx/certs/` |
| `vicem-postgres-dev` | Postgres dùng chung, nằm **ngoài** compose của dự án. App kết nối qua `PGHOST` trong `.env.docker` |

SSH vào bằng user `xuanvm`, còn source thuộc owner `dungpv`, nên các lệnh ghi file chạy dưới `sudo -u dungpv`.

## 2. Docker

- `Dockerfile` build 3 stage trên `node:20-alpine`: build web → build server → runtime.
  - Runtime cài `font-opensans` (để PDF có dấu tiếng Việt) và chạy dưới user `node`.
  - Thư mục upload là `/app/server/uploads/{media,content,videos,...}`.
- `.dockerignore` loại trừ `.claude`, `*.md` và các file `.env*`.
- Tạo `.env.docker` trên server bằng cách copy `.env.docker.example` rồi điền giá trị. **File này không bao giờ bị deploy ghi đè.**
- Cert TLS đặt ở `nginx/certs/` (gitignored `*.key`, `*.crt`).

`DOCKER_DEPLOY.md` ở thư mục gốc là bản cũ. Tài liệu này mới là nguồn chính.

## 3. Quy trình deploy (`deploy-dev.mjs`)

Script `deploy-dev.mjs` **gitignored**. Credential đọc từ file `.env.deploy` (gitignored, gồm `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PASS`, và `OPS_USER`/`OPS_PASS` cho các script ops khác) qua `process.loadEnvFile`. Máy mới: tạo `.env.deploy` rồi dựng lại script theo các bước dưới. Đừng hardcode lại.

Trước lần deploy đầu sau đợt vá bảo mật: kiểm tra `.env.docker` trên server có `JWT_SECRET` (nếu không, app sẽ không khởi động) và `CORS_ORIGIN` nếu cần cross-origin.

0. Build và kiểm tra ở local: `npm run build` (root) và `cd server && npm run build`.
1. **Tạo tarball** của source trong `os.tmpdir()`, loại trừ `node_modules`, `server/node_modules`, `auto-video-gen`, `.git`, `.claude`, mọi file `.env*`, các script ops, `_*`, `backups`, `dist`:
   ```js
   execSync(`tar -czf - ${EXCLUDES} . > "${LOCAL_TGZ}"`)
   ```
   Ghi qua stdout redirect, **không** truyền đường dẫn có ổ đĩa (`C:\...`) cho tar. Xem mục 6.
2. Upload qua SFTP lên `/tmp/atld-src.tgz` trên server.
3. Giải nén đè lên `/home/dungpv/atld` dưới quyền `dungpv`. Lệnh này giữ nguyên `.env.docker`, `uploads` và `node_modules` trên server.
4. (Tuỳ chọn) Nếu máy deploy có `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` trong env, ghi hoặc cập nhật hai key này vào `.env.docker`.
5. `docker compose build` → `docker compose up -d` → `docker compose ps`.
6. Health check trên server: `curl -sk https://localhost:8443/api/health` phải trả `{"ok":true,...}`.

Sau deploy, migration trong code tự chạy khi `atld-app` khởi động. Kiểm tra log bằng:

```bash
docker logs atld-app --tail 100
```

Tìm dòng `[hse migration]`. Nếu có dòng này, một câu migration đã lỗi và các câu sau nó bị bỏ qua.

Các lần deploy **trước** đợt vá đã upload `.claude/`, `.env`, các script ops (có mật khẩu) vào `/home/dungpv/atld` trên server. Tar giải nén đè không xoá chúng — cần xoá tay sau khi xác nhận (xem [KNOWN-ISSUES.md](KNOWN-ISSUES.md)).

### Rollback

Không có registry image, nên rollback bằng cách checkout commit cũ ở local và deploy lại. Migration chỉ thêm (additive), nên code cũ vẫn chạy được trên schema mới.

## 4. Backup / restore DB

- `atld-backup-db.sh` (gitignored) đặt trong thư mục dự án trên server.
  - Script đọc `PG*` từ `.env.docker`, rồi chạy container tạm `postgres:16-alpine` (`--add-host=host.docker.internal:host-gateway`) để thực hiện `pg_dump -n atld --clean --if-exists`.
  - File ra là `backups/atld_backup_YYYYMMDD_HHMMSS.sql.gz`. Script báo lỗi nếu dump rỗng.
- Cron chạy hằng ngày lúc 02:00 và giữ 7 ngày. Cron được cài bởi `restore-db-dev.mjs`, và script này **ghi đè toàn bộ crontab** của user. Trước khi chạy lại, kiểm tra `crontab -l` để không làm mất job khác.
- Restore (`atld-restore-script.js`) **DROP SCHEMA atld CASCADE** rồi nạp lại. Thao tác này phá huỷ dữ liệu: phải backup ngay trước khi chạy và xác nhận với người phụ trách.
- **File upload KHÔNG nằm trong backup DB.** Backup volume upload riêng:
  ```bash
  docker run --rm -v atld_atld-uploads:/data -v "$PWD/backups":/b alpine tar czf /b/uploads_$(date +%F).tgz -C /data .
  ```
  Tên volume thực tế có prefix theo tên project compose; xem bằng `docker volume ls`.

## 5. Các script vận hành (local, gitignored)

| Script | Việc làm | Trạng thái |
|---|---|---|
| `deploy-dev.mjs` | Deploy source lên DEV (mục 3) | Đang dùng |
| `restore-db-dev.mjs` | Restore DB và cài cron backup | Dùng khi cần; có thao tác phá huỷ |
| `atld-backup-db.sh` | Backup schema `atld` | Chạy trên server |
| `atld-restore-script.js` | Drop rồi nạp lại schema `atld` | Phá huỷ |
| `atld-create-admin.mjs` | Tạo tài khoản admin | Đọc `ADMIN_PASSWORD` (≥ 12 ký tự) từ env |
| `dev-exec.mjs`, `push-proxy.mjs` | Chạy lệnh từ xa / proxy | Tiện ích |
| `_rebuild.mjs`, `_upload.mjs`, `upload-dev.mjs`, `check-server.mjs`, `fix-docker-perm.mjs`, `_ssh_diag_tmp.js` | Bản cũ, đã được thay bằng `deploy-dev.mjs` | Có thể xoá |

Khi chuyển máy, hãy copy các script này qua kênh an toàn (không qua git), hoặc dựng lại theo mục 3. Credential nằm ở `.env.deploy` — copy file này qua kênh an toàn. **Đổi mật khẩu SSH** nếu script cũ từng bị lộ.

## 6. Windows: đường dẫn `/tmp` và tar

- Trong Node trên Windows, `/tmp/x` thành `C:\tmp\x`, còn `/tmp` trong Git Bash lại là `%LOCALAPPDATA%\Temp`. Dùng `os.tmpdir()` cho file tạm của script.
- `tar` của Git for Windows (GNU) hiểu `C:\...` là host từ xa (`Cannot connect to C:`), còn `tar.exe` của System32 (bsdtar) không có `--force-local`. Cách chạy được với cả hai là ghi tarball qua `-f -` và shell redirect.
- Tarball phải được **tạo trước** bước upload. Script cũ từng upload một file tarball cũ còn sót lại.

## 7. Kiểm tra nhanh sau sự cố

```bash
docker compose ps
```

```bash
curl -sk https://localhost:8443/api/health
```

```bash
docker logs atld-app --tail 200
```

```bash
docker logs atld-nginx --tail 100
```

Nếu nginx trả 502, kiểm tra theo thứ tự: `atld-app` có restart liên tục không (lỗi async làm sập process đã được chặn bởi `lib/async-errors.ts`); kết nối DB; và truy vấn LDAP thiếu paged search.
