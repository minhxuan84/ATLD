/**
 * Bắt lỗi của route handler async cho Express 4.
 *
 * Express 4 không theo dõi Promise mà handler trả về: một `await query()` ném lỗi
 * (vi phạm NOT NULL, sai kiểu…) thành unhandledRejection, và Node 20 mặc định giết
 * process. Container khởi động lại, nginx trả 502 cho người dùng mà không có thông
 * điệp nào — khớp với lỗi 502 khi đăng bài viết.
 *
 * Cách làm: bọc mọi handler đăng ký qua Route (app.get, router.post… đều đi qua đây)
 * để Promise bị reject được chuyển sang next(err) → error handler tập trung trong
 * index.ts trả JSON. Handler 4 tham số (error handler) giữ nguyên, không bọc.
 *
 * Import file này MỘT LẦN, trước khi khai báo bất kỳ router nào.
 */
import { createRequire } from 'node:module'
import type { NextFunction, Request, Response } from 'express'

const require = createRequire(import.meta.url)
// express/lib không có type; chỉ cần prototype của Route.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Route = require('express/lib/router/route') as { prototype: Record<string, any> }

type Handler = (req: Request, res: Response, next: NextFunction) => unknown

function wrap(fn: unknown): unknown {
  if (typeof fn !== 'function' || fn.length >= 4) return fn
  const h = fn as Handler
  return function wrapped(req: Request, res: Response, next: NextFunction) {
    try {
      const out = h(req, res, next)
      if (out && typeof (out as Promise<unknown>).catch === 'function') {
        (out as Promise<unknown>).catch(next)
      }
    } catch (e) {
      next(e)
    }
  }
}

const deepWrap = (args: unknown[]): unknown[] =>
  args.map((a) => (Array.isArray(a) ? deepWrap(a) : wrap(a)))

for (const method of ['all', 'get', 'post', 'put', 'patch', 'delete']) {
  const original = Route.prototype[method]
  if (typeof original !== 'function') continue
  Route.prototype[method] = function patched(this: unknown, ...handlers: unknown[]) {
    return original.apply(this, deepWrap(handlers))
  }
}

// Lưới an toàn cho Promise nằm ngoài request (setInterval, IIFE migration…): ghi log
// thay vì để process chết.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})
