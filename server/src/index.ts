import 'dotenv/config'
// Phải đứng trước mọi import router: vá Express để lỗi async đi vào error handler
// thay vì làm sập process (nguyên nhân 502).
import './lib/async-errors.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { authRouter, initAuthDb } from './routes/auth.js'
import { oauthRouter, initOAuthDb } from './routes/oauth.js'
import { homeRouter } from './routes/home.js'
import { coursesRouter } from './routes/courses.js'
import { documentsRouter } from './routes/documents.js'
import { hseRouter } from './routes/hse.js'
import { findingsRouter } from './routes/findings.js'
import { portalRouter } from './routes/portal.js'
import { jsaRouter } from './routes/jsa.js'
import { newsRouter, newsSourcesRouter } from './routes/news.js'
import { adminRouter } from './routes/admin.js'
import { configRouter } from './routes/config.js'
import { mediaRouter } from './routes/media.js'

const app = express()
// Tin tưởng 1 cấp reverse proxy (nginx) để req.ip trả IP thực của client
// thay vì 127.0.0.1 — cần thiết cho rate-limiter (portalLimiter, authLimiter).
app.set('trust proxy', 1)
const isProd = process.env.NODE_ENV === 'production'

// Ở production ta phục vụ luôn bản build React từ cùng origin nên nới CSP để
// cho phép asset nội bộ (img data:, style inline của Tailwind). API và web cùng cổng.
app.use(
  helmet({
    // YouTube từ chối nhúng (Error 153) khi không nhận được Referer.
    // Mặc định của Helmet là 'no-referrer' → gửi origin để trình phát hoạt động.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            // Camera và ảnh minh chứng tải kèm JWT dùng URL.createObjectURL().
            imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            connectSrc: ["'self'"],
            frameSrc: [
              "'self'",
              'https://www.youtube.com',
              'https://www.youtube-nocookie.com',
              'https://youtu.be',
              'https://player.vimeo.com',
            ],
          },
        }
      : false,
  }),
)
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }))
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'atld-api' }))
app.use('/api/auth', authRouter)
app.use('/api/auth/oauth', oauthRouter)
app.use('/api/home', homeRouter)
app.use('/api/courses', coursesRouter)
app.use('/api/documents', documentsRouter)
app.use('/api/hse', hseRouter)
// Bảng hse_findings tạo trong IIFE migration của hse.ts (cùng quy ước với jsa_*),
// nên router này phải mount sau hseRouter.
app.use('/api/findings', findingsRouter)
// Cổng công khai: KHÔNG qua requireAuth, mỗi request tự xác thực bằng token trong URL.
// Cũng mount sau hseRouter vì bảng hse_portal_tokens tạo trong IIFE migration của hse.ts.
app.use('/api/portal', portalRouter)
app.use('/api/jsa', jsaRouter)
app.use('/api/news', newsRouter)
app.use('/api/news-sources', newsSourcesRouter)
app.use('/api/admin', adminRouter)
app.use('/api/config', configRouter)
app.use('/api/media', mediaRouter)

// Serve uploads tĩnh (video, media, content) — không cần auth để stream trong <video>/<iframe>
app.use('/uploads', express.static(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads')
))

// Production: phục vụ bản build React (frontend) từ cùng máy chủ này.
// dist backend nằm ở server/dist, build frontend nằm ở gốc dự án ../../dist.
if (isProd) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const clientDir = path.resolve(__dirname, '../../dist')
  app.use(express.static(clientDir))
  // SPA fallback: mọi route không phải /api trả về index.html cho React Router.
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'))
  })
}

// Xử lý lỗi tập trung (gồm lỗi multer: file quá lớn / sai định dạng)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error & { code?: string; type?: string }, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err)
  if (res.headersSent) return
  if (err.message?.includes('File too large'))
    return res.status(413).json({ error: 'File vượt quá giới hạn cho phép.' })
  // body-parser: JSON vượt 1MB (thường do dán ảnh base64 thẳng vào nội dung).
  if (err.type === 'entity.too.large')
    return res.status(413).json({ error: 'Nội dung quá lớn. Hãy chèn ảnh bằng nút tải ảnh thay vì dán trực tiếp.' })
  // Lỗi Postgres có mã SQLSTATE 5 ký tự: không trả err.message ra ngoài vì lộ tên
  // bảng/cột. Chi tiết đã ghi log ở trên.
  if (typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code))
    return res.status(500).json({ error: 'Lỗi máy chủ khi lưu dữ liệu. Vui lòng thử lại hoặc báo quản trị viên.' })
  res.status(400).json({ error: err.message || 'Đã xảy ra lỗi.' })
})

const port = Number(process.env.PORT) || 4000
app.listen(port, async () => {
  try {
    await initAuthDb()
    console.log('[atld-auth] Migration auth_provider OK')
  } catch (e) {
    console.warn('[atld-auth] Migration warning:', (e as Error).message)
  }
  try {
    await initOAuthDb()
    console.log('[atld-oauth] Migration OAuth columns OK')
  } catch (e) {
    console.warn('[atld-oauth] Migration warning:', (e as Error).message)
  }
  console.log(`[atld-api] Máy chủ chạy tại http://localhost:${port}`)
  // Khởi động bộ lấy tin RSS sau khi server đã sẵn sàng
  const { startNewsFetcher } = await import('./lib/newsFetch.js')
  startNewsFetcher()
})
