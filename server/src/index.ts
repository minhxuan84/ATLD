import 'dotenv/config'
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
import { jsaRouter } from './routes/jsa.js'
import { newsRouter } from './routes/news.js'
import { adminRouter } from './routes/admin.js'
import { configRouter } from './routes/config.js'
import { mediaRouter } from './routes/media.js'

const app = express()
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
app.use('/api/jsa', jsaRouter)
app.use('/api/news', newsRouter)
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
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.message)
  const isMulter = err.message.includes('File too large')
  res.status(isMulter ? 413 : 400).json({
    error: isMulter ? `File vượt quá giới hạn cho phép.` : err.message || 'Đã xảy ra lỗi.',
  })
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
})
