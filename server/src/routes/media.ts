import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { query } from '../db.js'
import { requireAuth, requireSection } from '../auth.js'

export const mediaRouter = Router()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Ảnh nhận diện (logo, banner) là ảnh công khai -> lưu riêng, phục vụ trực tiếp
const MEDIA_DIR = path.join(__dirname, '..', '..', 'uploads', 'media')
fs.mkdirSync(MEDIA_DIR, { recursive: true })
// Ảnh chèn trong nội dung tin tức/bài viết (TinyMCE) -> thư mục riêng, công khai
const CONTENT_DIR = path.join(__dirname, '..', '..', 'uploads', 'content')
fs.mkdirSync(CONTENT_DIR, { recursive: true })

// Các khóa cấu hình dành cho ảnh (chỉ nhận đúng các khóa này)
export const IMAGE_KEYS = ['logo_url', 'hero_image_1', 'hero_image_2', 'hero_image_3'] as const
type ImageKey = (typeof IMAGE_KEYS)[number]

// Chỉ cho phép ảnh raster (không nhận SVG để tránh script nhúng)
const ALLOWED_IMG = ['png', 'jpg', 'jpeg', 'webp']
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp']
const MAX_IMG_MB = 4

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, MEDIA_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')
    cb(null, `${crypto.randomUUID()}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: MAX_IMG_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(1)
    if (!ALLOWED_IMG.includes(ext) || !ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new Error('Chỉ chấp nhận ảnh PNG, JPG hoặc WEBP.'))
    }
    cb(null, true)
  },
})

// Bộ lưu riêng cho ảnh chèn trong nội dung bài viết (lưu vào CONTENT_DIR)
const contentStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, CONTENT_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')
    cb(null, `${crypto.randomUUID()}${ext}`)
  },
})
const contentUpload = multer({
  storage: contentStorage,
  limits: { fileSize: MAX_IMG_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(1)
    if (!ALLOWED_IMG.includes(ext) || !ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new Error('Chỉ chấp nhận ảnh PNG, JPG hoặc WEBP.'))
    }
    cb(null, true)
  },
})

// Xóa file media cũ khi thay/clear (chỉ xóa trong MEDIA_DIR, theo basename an toàn)
function removeMediaFile(url: string) {
  const name = path.basename(url || '')
  if (!name || !/^[\w.-]+$/.test(name)) return
  const p = path.join(MEDIA_DIR, name)
  if (p.startsWith(MEDIA_DIR)) fs.rm(p, { force: true }, () => {})
}

// ===== Công khai: phục vụ ảnh nhận diện (dùng trong <img> trên trang chủ) =====
mediaRouter.get('/:name', (req, res) => {
  const name = path.basename(req.params.name)
  // Chặn path traversal: chỉ nhận tên file phẳng, không dấu /
  if (!/^[\w-]+\.(png|jpe?g|webp)$/i.test(name)) {
    return res.status(400).json({ error: 'Tên tệp không hợp lệ.' })
  }
  const filePath = path.join(MEDIA_DIR, name)
  if (!filePath.startsWith(MEDIA_DIR) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Không tìm thấy ảnh.' })
  }
  res.setHeader('Cache-Control', 'public, max-age=3600')
  res.sendFile(filePath)
})

// ===== Công khai: phục vụ ảnh nội dung bài viết (dùng trong nội dung HTML) =====
mediaRouter.get('/content/:name', (req, res) => {
  const name = path.basename(req.params.name)
  if (!/^[\w-]+\.(png|jpe?g|webp)$/i.test(name)) {
    return res.status(400).json({ error: 'Tên tệp không hợp lệ.' })
  }
  const filePath = path.join(CONTENT_DIR, name)
  if (!filePath.startsWith(CONTENT_DIR) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Không tìm thấy ảnh.' })
  }
  res.setHeader('Cache-Control', 'public, max-age=3600')
  res.sendFile(filePath)
})

// ===== Người có quyền tin tức: tải ảnh chèn vào nội dung bài viết (TinyMCE) =====
// Trả về { location } đúng định dạng images_upload_handler của TinyMCE mong đợi.
mediaRouter.post('/content', requireAuth, requireSection('tin-tuc'), contentUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Vui lòng chọn ảnh.' })
  res.status(201).json({ location: `/api/media/content/${req.file.filename}` })
})

// ===== Admin: tải ảnh lên cho một khóa nhận diện =====
mediaRouter.post('/', requireAuth, requireSection('trang-tinh'), upload.single('file'), async (req, res) => {
  const key = String(req.body?.key ?? '') as ImageKey
  if (!IMAGE_KEYS.includes(key)) {
    // Dọn file vừa nhận nếu key sai
    if (req.file) removeMediaFile(req.file.filename)
    return res.status(400).json({ error: 'Khóa ảnh không hợp lệ.' })
  }
  if (!req.file) return res.status(400).json({ error: 'Vui lòng chọn ảnh.' })

  // Lấy ảnh cũ để xóa sau khi cập nhật thành công
  const { rows } = await query<{ value: string }>('SELECT value FROM site_config WHERE key = $1', [key])
  const oldUrl = rows[0]?.value ?? ''

  const url = `/api/media/${req.file.filename}`
  await query(
    `INSERT INTO site_config (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, url],
  )
  if (oldUrl) removeMediaFile(oldUrl)
  res.status(201).json({ key, url })
})

// ===== Admin: gỡ ảnh của một khóa (quay về mặc định) =====
mediaRouter.delete('/', requireAuth, requireSection('trang-tinh'), async (req, res) => {
  const key = String(req.body?.key ?? '') as ImageKey
  if (!IMAGE_KEYS.includes(key)) return res.status(400).json({ error: 'Khóa ảnh không hợp lệ.' })

  const { rows } = await query<{ value: string }>('SELECT value FROM site_config WHERE key = $1', [key])
  const oldUrl = rows[0]?.value ?? ''
  await query(
    `INSERT INTO site_config (key, value) VALUES ($1, '')
     ON CONFLICT (key) DO UPDATE SET value = '', updated_at = now()`,
    [key],
  )
  if (oldUrl) removeMediaFile(oldUrl)
  res.json({ ok: true })
})
