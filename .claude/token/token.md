---
name: token
description: Kỷ luật token — tránh đốt tiền AI, tối ưu context window
tags: [policy, tokens, efficiency, cost]
---

# Token Discipline — Tránh "Đốt Tiền" AI

## Nguyên Tắc Cốt Lõi

> **Đọc đúng, đủ, không thừa.** Mỗi token là tiền. Mỗi file đọc thừa là lãng phí.

## Quy Tắc Đọc File

### ✅ Hiệu Quả
```
# Đọc section cụ thể khi biết dòng
Read file offset=1700 limit=50

# Dùng Grep trước khi đọc cả file
Grep pattern="valid_from" path="server/src/routes/hse.ts"
→ thấy dòng 1717 → Read offset=1715 limit=30

# Glob để tìm file, không cat cả directory
Glob pattern="**/*.ts" path="server/src"
```

### ❌ Lãng Phí
```
# Đọc file 1800 dòng để tìm 5 dòng
Read file_path="server/src/routes/hse.ts"  # full read

# Cat nhiều file lớn liên tiếp không cần thiết
Read db.ts → Read auth.ts → Read hse.ts → Read ...
```

## Khi Nào Dùng Subagent

Delegate sang subagent khi task có thể tách độc lập:
- Tìm kiếm trên nhiều files (Explore agent)
- Tác vụ song song không phụ thuộc nhau
- Research / web search không liên quan code chính

**Giữ main context** cho implementation logic.

## Context Budget (ATLD)

| Model | Context | Guideline |
|-------|---------|-----------|
| Opus 4.8 | ~200k tokens | Budget ~150k cho conversation + code |
| Haiku 4.5 | ~200k tokens | Dùng cho tasks đơn giản, tiết kiệm hơn |

## Tối Ưu Prompt

```markdown
# ✅ Tốt — cụ thể, có context đủ
"Fix validation check-in visitor tại hse.ts:1717–1739, 
valid_from/valid_to là DATE PostgreSQL"

# ❌ Kém — buộc agent phải explore nhiều
"Fix lỗi check-in"  → agent đọc 10 files để hiểu
```

## ATLD Hotspots — Files Lớn, Đọc Có Chọn Lọc

| File | Dòng | Ghi chú |
|------|------|---------|
| `server/src/routes/hse.ts` | ~1800 | Dùng Grep trước |
| `src/pages/hse/*.tsx` | ~300–600/file | Đọc per-component |
| `server/src/auth.ts` | ~200 | Đọc toàn bộ khi cần auth |
| `server/src/db.ts` | ~30 | Nhỏ, đọc toàn bộ OK |

## Red Flags — Context Bloat

- Đọc >5 files lớn trong 1 lượt mà không cần
- Paste toàn bộ stack trace 200 dòng khi chỉ cần message lỗi
- Lặp lại code đã biết trong conversation
- Re-derive facts đã establish trong session
