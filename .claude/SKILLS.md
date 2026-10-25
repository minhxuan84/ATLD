# .claude/ — ATLD Skills & Policies Library

Thư mục này chứa các skill files và policies để chia sẻ trong đội nhóm và tái sử dụng giữa các dự án.

## Cấu Trúc

```
.claude/
├── SKILLS.md                         # Index này
├── brand.md                          # Nhận diện thương hiệu ATLD / VICEM
├── policies/
│   └── write-guard.md               # Bảo vệ file quan trọng, quy tắc ghi/xóa
├── plans/
│   └── plan.md                      # Chính sách lên kế hoạch, checklist ATLD
├── token/
│   └── token.md                     # Kỷ luật token — tránh "đốt tiền" AI
├── multi-agent/
│   └── multi-agent.md               # Điều phối nhiều agent song song
├── monitoring/
│   └── monitoring.md                # Prometheus + Grafana metrics & alerts
├── prod-incident/
│   └── prod-incident.md             # Runbook xử lý sự cố production
│   └── YYYY-MM-DD-{slug}.md        # (post-mortems, tạo khi có incident)
├── rabbitmq/
│   └── rabbitmq.md                  # Worker, retry, DLQ patterns
└── skills/                          # Claude Code skills (tự nạp theo description)
    ├── atld-db-migration/SKILL.md
    ├── atld-permissions-site-scope/SKILL.md
    ├── atld-add-feature/SKILL.md
    ├── atld-deploy-dev/SKILL.md
    ├── atld-pdf/SKILL.md
    └── atld-portal-token/SKILL.md
```

## Quick Reference

| Skill | Dùng khi |
|-------|---------|
| [brand.md](brand.md) | Thiết kế UI, màu sắc, font, tone of voice |
| [policies/write-guard.md](policies/write-guard.md) | Trước khi ghi/xóa file nhạy cảm |
| [plans/plan.md](plans/plan.md) | Thiết kế tính năng mới, checklist ATLD |
| [token/token.md](token/token.md) | Tối ưu token, tránh context bloat |
| [multi-agent/multi-agent.md](multi-agent/multi-agent.md) | Tasks song song, fan-out research |
| [monitoring/monitoring.md](monitoring/monitoring.md) | ⚠️ Chưa áp dụng trong dự án — chỉ là định hướng |
| [prod-incident/prod-incident.md](prod-incident/prod-incident.md) | Xử lý sự cố production, rollback |
| [rabbitmq/rabbitmq.md](rabbitmq/rabbitmq.md) | ⚠️ Chưa áp dụng trong dự án — chỉ là định hướng |

## Skills (Claude Code tự nạp)

| Skill | Dùng khi |
|-------|---------|
| [atld-db-migration](skills/atld-db-migration/SKILL.md) | Thêm bảng/cột/CHECK, sửa dữ liệu live |
| [atld-permissions-site-scope](skills/atld-permissions-site-scope/SKILL.md) | Endpoint/trang cần phân quyền, siteScope |
| [atld-add-feature](skills/atld-add-feature/SKILL.md) | Checklist tính năng mới DB → API → UI |
| [atld-deploy-dev](skills/atld-deploy-dev/SKILL.md) | Deploy DEV (≈PROD), log, backup/restore |
| [atld-pdf](skills/atld-pdf/SKILL.md) | PDF PDFKit, font tiếng Việt, ràng buộc ký số |
| [atld-portal-token](skills/atld-portal-token/SKILL.md) | Portal không đăng nhập, purpose token |

## Tài liệu dự án (nguồn chính)

`CLAUDE.md` (gốc repo) và `docs/`: ARCHITECTURE, CONVENTIONS, SETUP, DEPLOY-OPS, DOMAIN-HSE, KNOWN-ISSUES.

## Chia Sẻ Cho Đội

Files này được track bởi git (trừ `.claude/settings.local.*`). Clone/pull về là Claude Code dùng được ngay. **Không ghi mật khẩu, token, key vào bất kỳ file nào ở đây.**

## Cập Nhật

- Pattern mới → thêm vào file tương ứng
- Lesson learned → update section liên quan
- Post-mortem → tạo `.claude/prod-incident/YYYY-MM-DD-{tên}.md`
