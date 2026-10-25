---
name: monitoring
description: Prometheus + Grafana — metrics, alerts, dashboards cho ATLD
tags: [monitoring, prometheus, grafana, ops]
---

# Monitoring — Prometheus + Grafana

## Stack

| Component | Role |
|-----------|------|
| Prometheus | Thu thập metrics, alerting |
| Grafana | Dashboards, visualization |
| Node.js `prom-client` | Expose `/metrics` endpoint |
| PostgreSQL exporter | DB metrics |

## Metrics Quan Trọng (ATLD)

### Application Metrics

```typescript
// server/src/metrics.ts (nếu chưa có, tạo mới)
import { Registry, Counter, Histogram, Gauge } from 'prom-client'

export const registry = new Registry()

// HTTP requests
export const httpRequests = new Counter({
  name: 'atld_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
})

// Check-in latency
export const checkinDuration = new Histogram({
  name: 'atld_checkin_duration_seconds',
  help: 'HSE check-in processing time',
  labelNames: ['site_id', 'type'],  // worker/visitor/vehicle
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [registry],
})

// Active sessions
export const activeSessions = new Gauge({
  name: 'atld_active_sessions',
  help: 'Currently active user sessions',
  labelNames: ['role'],
  registers: [registry],
})
```

### Endpoint `/metrics`

```typescript
// Thêm vào server/src/index.ts hoặc app.ts
app.get('/metrics', async (req, res) => {
  // Chỉ cho phép internal network
  const ip = req.ip || req.socket.remoteAddress || ''
  if (!ip.startsWith('172.16.') && !ip.startsWith('127.')) {
    return res.status(403).end()
  }
  res.set('Content-Type', registry.contentType)
  res.end(await registry.metrics())
})
```

## Prometheus Config

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'atld-server'
    static_configs:
      - targets: ['172.16.1.246:3000']
    metrics_path: '/metrics'

  - job_name: 'postgres'
    static_configs:
      - targets: ['172.16.1.246:9187']
```

## Grafana Dashboards

### Dashboard: HSE Operations

Panels đề xuất:
1. **Check-in rate** (counter/rate) — check-in/phút theo site
2. **Check-in latency p95** — histogram_quantile(0.95)
3. **Active sessions by role** — gauge
4. **Error rate** — 5xx / tổng requests

### Dashboard: DB Health

1. Connection pool usage
2. Query latency
3. Slow queries (> 1s)
4. Lock waits

## Alerts Quan Trọng

```yaml
# alerts.yml
groups:
  - name: atld
    rules:
      - alert: HighErrorRate
        expr: rate(atld_http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "ATLD error rate > 5%"

      - alert: SlowCheckin
        expr: histogram_quantile(0.95, atld_checkin_duration_seconds) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Check-in P95 > 2s"

      - alert: DBConnectionPoolExhausted
        expr: pg_stat_activity_count > 9
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "DB pool gần đầy (max=10)"
```

## Lưu Ý ATLD

- DB pool `max: 10` — alert khi connections > 9
- Site scope: tag metrics với `site_id` để phân biệt traffic giữa các site
- Deploy DEV: 172.16.1.246 — không expose metrics ra ngoài LAN
