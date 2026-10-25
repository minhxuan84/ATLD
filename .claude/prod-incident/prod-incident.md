---
name: prod-incident
description: Xử lý sự cố production — quy trình, triage, rollback, post-mortem
tags: [incident, production, ops, runbook]
---

# Production Incident Response

## Severity Levels

| Level | Mô tả | SLA Response | Ví dụ |
|-------|-------|-------------|-------|
| P1 — Critical | System down, toàn bộ users bị ảnh hưởng | < 15 phút | Server crash, DB down |
| P2 — High | Tính năng chính bị lỗi | < 1 giờ | Check-in không hoạt động |
| P3 — Medium | Tính năng phụ bị lỗi | < 4 giờ | Report sai, UI bug |
| P4 — Low | Cosmetic, minor | Next sprint | Typo, màu sai |

## Quy Trình Triage (ATLD)

```
1. PHÁT HIỆN
   └── Nguồn: User report / Prometheus alert / Server logs

2. XÁC NHẬN
   ├── Truy cập 172.16.1.246 (DEV) → kiểm tra
   ├── Xem logs: server logs, browser console
   └── Xác định scope: 1 user / 1 site / tất cả?

3. TRIAGE
   ├── P1/P2 → escalate ngay, bắt đầu fix
   └── P3/P4 → log, schedule fix

4. FIX
   ├── Hotfix trực tiếp nếu < 30 phút fix time
   └── Feature branch nếu cần > 30 phút

5. DEPLOY
   ├── Build: npm run build
   ├── Tarball: tar -czf /c/Users/minhx/AppData/Local/Temp/atld-src.tgz ...
   └── Deploy: node deploy-dev.mjs

6. VERIFY
   └── Smoke test: đăng nhập, check-in 1 worker, check report

7. POST-MORTEM (P1/P2)
   └── Ghi vào .claude/prod-incident/YYYY-MM-DD-incident-name.md
```

## Runbooks Thường Gặp

### DB Connection Pool Exhausted

```bash
# Kiểm tra connections
SELECT count(*), state FROM pg_stat_activity 
WHERE datname = 'atld_db'
GROUP BY state;

# Kill idle connections
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity
WHERE state = 'idle' AND query_start < now() - interval '10 minutes'
AND datname = 'atld_db';
```

**Nguyên nhân thường gặp:** Connection leak, transaction không commit/rollback.
**Fix dài hạn:** Ensure `pool.query()` không bị bypass; dùng `try/finally` với `client.release()`.

### Server Không Phản Hồi

```bash
# SSH vào server
ssh user@172.16.1.246

# Kiểm tra process
pm2 status
pm2 logs atld --lines 50

# Restart nếu cần
pm2 restart atld

# Kiểm tra disk / memory
df -h
free -m
```

### Check-in Trả Về Lỗi 500

```bash
# Xem error log
pm2 logs atld --err --lines 100

# Thường gặp:
# - DB query syntax error → check migration mới nhất
# - Null pointer → kiểm tra optional fields
# - Type mismatch DATE → kiểm tra pg.types.setTypeParser(1082)
```

### Sai Dữ Liệu (Data Inconsistency)

1. **KHÔNG xóa/update trực tiếp** — document vấn đề trước
2. Xác định scope: bao nhiêu records bị ảnh hưởng?
3. Viết query SELECT để verify trước khi UPDATE
4. Backup bảng trước khi sửa: `CREATE TABLE atld.hse_workers_backup_YYYYMMDD AS SELECT * FROM atld.hse_workers`
5. Chạy trong transaction với `BEGIN; ... ROLLBACK;` trước, rồi `COMMIT` khi chắc chắn

## Rollback Procedure

### Code Rollback

```bash
# Xem history
git log --oneline -10

# Revert commit cuối
git revert HEAD --no-edit

# Build + redeploy
npm run build
tar -czf /c/Users/minhx/AppData/Local/Temp/atld-src.tgz ...
node deploy-dev.mjs
```

### DB Rollback

```sql
-- Nếu migration có DROP / ALTER gây lỗi
-- Chỉ có thể rollback nếu đã backup trước

-- Restore từ backup table
INSERT INTO atld.hse_workers 
SELECT * FROM atld.hse_workers_backup_20260720
WHERE id NOT IN (SELECT id FROM atld.hse_workers);
```

## Post-Mortem Template

Tạo file `.claude/prod-incident/YYYY-MM-DD-{slug}.md`:

```markdown
# Incident: {Tên ngắn gọn}
**Date:** YYYY-MM-DD  
**Severity:** P1/P2/P3  
**Duration:** X giờ Y phút  

## Timeline
- HH:MM — Phát hiện
- HH:MM — Bắt đầu điều tra
- HH:MM — Xác định root cause
- HH:MM — Deploy fix
- HH:MM — Xác nhận resolved

## Root Cause
[Mô tả kỹ thuật]

## Impact
[Users/features bị ảnh hưởng]

## Fix
[Code/config thay đổi]

## Prevention
[Để không xảy ra lại]
```

## Contacts (ATLD)

| Vai trò | Contact |
|---------|---------|
| Dev lead | minhxuan84 |
| Server admin | (điền) |
| DB admin | (điền) |
