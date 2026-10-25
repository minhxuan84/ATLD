---
name: rabbitmq
description: RabbitMQ — worker patterns, retry, Dead Letter Queue cho ATLD
tags: [rabbitmq, queue, async, worker]
---

# RabbitMQ — Async Workers, Retry, DLQ

## Khi Nào Dùng Queue (ATLD)

**Nên queue:**
- Gửi email/SMS thông báo (check-in alert, sắp hết hạn chứng chỉ)
- Export báo cáo lớn (PDF daily report)
- Sync dữ liệu sang hệ thống khác
- Tasks tốn > 500ms không cần response realtime

**Không nên queue:**
- Check-in validation (cần response ngay)
- Read queries
- Auth operations

## Setup (Node.js + amqplib)

```bash
npm install amqplib
npm install -D @types/amqplib
```

```typescript
// server/src/queue/connection.ts
import amqp from 'amqplib'

const AMQP_URL = process.env.AMQP_URL || 'amqp://localhost'

let connection: amqp.Connection | null = null
let channel: amqp.Channel | null = null

export async function getChannel(): Promise<amqp.Channel> {
  if (channel) return channel
  connection = await amqp.connect(AMQP_URL)
  channel = await connection.createChannel()
  return channel
}
```

## Exchange + Queue Pattern (ATLD)

```
atld.exchange (topic)
├── atld.notifications.*   → notifications queue
├── atld.reports.*         → reports queue
└── atld.sync.*            → sync queue
```

```typescript
// server/src/queue/setup.ts
export async function setupQueues() {
  const ch = await getChannel()
  
  // Exchange chính
  await ch.assertExchange('atld.exchange', 'topic', { durable: true })
  
  // Dead Letter Exchange
  await ch.assertExchange('atld.dlx', 'topic', { durable: true })
  
  // Queues với DLQ config
  await ch.assertQueue('atld.notifications', {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': 'atld.dlx',
      'x-dead-letter-routing-key': 'dead.notifications',
      'x-message-ttl': 24 * 60 * 60 * 1000,  // 24h TTL
    }
  })
  
  // Dead Letter Queue
  await ch.assertQueue('atld.notifications.dead', { durable: true })
  
  // Bindings
  await ch.bindQueue('atld.notifications', 'atld.exchange', 'atld.notifications.*')
  await ch.bindQueue('atld.notifications.dead', 'atld.dlx', 'dead.notifications')
}
```

## Publisher

```typescript
// server/src/queue/publisher.ts
import { getChannel } from './connection'

interface NotificationMsg {
  type: 'checkin_alert' | 'cert_expiry' | 'incident'
  site_id: number
  recipient: string
  payload: Record<string, unknown>
}

export async function publishNotification(msg: NotificationMsg): Promise<void> {
  const ch = await getChannel()
  ch.publish(
    'atld.exchange',
    `atld.notifications.${msg.type}`,
    Buffer.from(JSON.stringify(msg)),
    {
      persistent: true,              // Survive broker restart
      contentType: 'application/json',
      timestamp: Date.now(),
    }
  )
}
```

## Worker với Retry

```typescript
// server/src/workers/notifications.worker.ts
import { getChannel } from '../queue/connection'

const MAX_RETRIES = 3
const RETRY_DELAY_MS = [1000, 5000, 30000]  // exponential backoff

export async function startNotificationWorker() {
  const ch = await getChannel()
  await ch.prefetch(5)  // Process max 5 messages concurrently
  
  ch.consume('atld.notifications', async (msg) => {
    if (!msg) return
    
    const retryCount = (msg.properties.headers?.['x-retry-count'] as number) || 0
    
    try {
      const data = JSON.parse(msg.content.toString())
      await processNotification(data)
      ch.ack(msg)
      
    } catch (err) {
      console.error('[notifications worker] Error:', err)
      
      if (retryCount < MAX_RETRIES) {
        // Retry với delay
        const delay = RETRY_DELAY_MS[retryCount] || 30000
        setTimeout(() => {
          ch.publish(
            'atld.exchange',
            msg.fields.routingKey,
            msg.content,
            {
              persistent: true,
              headers: { 'x-retry-count': retryCount + 1 },
            }
          )
          ch.ack(msg)  // Ack original, publish retry
        }, delay)
      } else {
        // Max retries reached → nack → DLQ
        console.error('[notifications worker] Max retries, sending to DLQ')
        ch.nack(msg, false, false)  // false = không requeue → vào DLX
      }
    }
  })
  
  console.log('[notifications worker] Started')
}

async function processNotification(data: unknown) {
  // TODO: Implement actual notification (email/SMS/webhook)
}
```

## DLQ Monitor

```typescript
// server/src/workers/dlq-monitor.ts
// Định kỳ check DLQ và alert admin
export async function monitorDLQ() {
  const ch = await getChannel()
  const queueInfo = await ch.checkQueue('atld.notifications.dead')
  
  if (queueInfo.messageCount > 0) {
    console.warn(`[DLQ] ${queueInfo.messageCount} messages in dead letter queue`)
    // TODO: Alert admin via webhook/email
  }
}
```

## Lưu Ý ATLD

- **Site isolation**: Luôn include `site_id` trong message để worker có thể filter/route
- **Idempotency**: Worker phải handle duplicate messages (RabbitMQ guarantees at-least-once)
- **Connection retry**: Implement reconnect logic khi broker restart
- **Graceful shutdown**: `process.on('SIGTERM')` → drain queue trước khi exit

## Environment Variables

```env
AMQP_URL=amqp://atld_user:password@172.16.1.246:5672/atld_vhost
```
