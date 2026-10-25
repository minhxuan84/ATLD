---
name: multi-agent
description: Điều phối nhiều agent song song — khi nào dùng, patterns, pitfalls
tags: [policy, agents, parallelism, workflow]
---

# Multi-Agent Coordination

## Khi Nào Dùng Multi-Agent

**Nên dùng:**
- Tasks độc lập, không phụ thuộc kết quả nhau
- Research + implementation song song
- Review nhiều files cùng lúc
- Build + test song song

**Không nên dùng:**
- Tasks tuần tự (B phụ thuộc output A)
- Khi main context đủ handle (< 3 files nhỏ)
- Tasks cần shared state / coordination phức tạp

## Agent Types Có Sẵn (ATLD)

| Agent | Dùng khi |
|-------|---------|
| `Explore` | Tìm kiếm broad, nhiều files, read-only |
| `Plan` | Thiết kế implementation plan |
| `general-purpose` | Tasks phức tạp multi-step |
| `claude` | Catch-all |

## Pattern: Fan-Out Research

```
Main agent
├── Explore: "Tìm tất cả routes có site_id filter"
├── Explore: "Tìm tất cả components dùng fmtDate"
└── Explore: "Tìm tất cả migrations liên quan hse_*"
→ Tổng hợp kết quả → implement
```

## Pattern: Parallel Write (Worktree Isolation)

```
Khi nhiều agents cần ghi file cùng lúc:
→ Dùng isolation: 'worktree' để tránh conflict
→ Merge sau khi hoàn thành
```

## ATLD Multi-Agent Workflow

### Tính Năng Mới (Standard)

```
Phase 1 — Parallel Research:
  Agent A: Đọc schema DB liên quan
  Agent B: Đọc routes backend cần sửa
  Agent C: Đọc pages frontend liên quan

Phase 2 — Sequential Implementation:
  Backend routes → DB migration → Frontend pages

Phase 3 — Parallel Verify:
  Agent A: Build check (TypeScript errors)
  Agent B: Deploy DEV + smoke test
```

### Hotfix (Urgent)

```
1 agent — linear, nhanh:
Grep lỗi → Read section → Edit → Deploy DEV → Verify
```

## Pitfalls

- **Race condition**: Hai agents ghi cùng file → dùng worktree hoặc serialize
- **Context leak**: Subagent không biết decisions đã làm ở main context → pass context rõ ràng
- **Over-parallelism**: Spawn quá nhiều agents cho task đơn giản = tốn token, chậm hơn
- **Token budget**: `budget.remaining()` trước khi spawn nhiều agents

## Ví Dụ Thực Tế — ATLD

```typescript
// Workflow thêm module mới (vd: thêm module "Đào tạo")
export const meta = {
  name: 'add-training-module',
  phases: [
    { title: 'Research', detail: 'Explore schema + existing patterns' },
    { title: 'Backend', detail: 'Routes + migrations' },
    { title: 'Frontend', detail: 'Pages + components' },
    { title: 'Deploy', detail: 'DEV deploy + verify' },
  ]
}

phase('Research')
const [schema, patterns] = await parallel([
  () => agent('Tìm schema tables liên quan training trong atld'),
  () => agent('Tìm routing pattern trong server/src/routes/hse.ts'),
])

phase('Backend')
const backend = await agent('Tạo routes training dựa trên: ' + patterns)
// ...
```
