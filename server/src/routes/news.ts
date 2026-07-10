import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth, requireSection } from '../auth.js'
import { escapeText, sanitizeHtml } from '../util.js'

export const newsRouter = Router()

// Tạo tóm tắt từ nội dung HTML: bỏ thẻ, cắt gọn
function makeExcerpt(html: string): string {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  return text.slice(0, 160) + (text.length > 160 ? '…' : '')
}

// Danh sách tin tức (công khai cho người đã đăng nhập & trang chủ)
newsRouter.get('/', async (_req, res) => {
  const { rows } = await query(
    `SELECT id, title, category, excerpt, content, author,
            to_char(created_at, 'YYYY-MM-DD') AS date
     FROM news ORDER BY created_at DESC`,
  )
  res.json({ news: rows })
})

newsRouter.get('/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT id, title, category, excerpt, content, author,
            to_char(created_at, 'YYYY-MM-DD') AS date
     FROM news WHERE id = $1`,
    [req.params.id],
  )
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy tin.' })
  res.json({ item: rows[0] })
})

// Đăng tin — chỉ officer/admin. Nội dung là HTML từ TinyMCE -> sanitize chống XSS.
newsRouter.post('/', requireAuth, requireSection('tin-tuc'), async (req, res) => {
  const title = escapeText(String(req.body?.title ?? '').trim()).slice(0, 200)
  const category = String(req.body?.category ?? 'Thông báo').slice(0, 60)
  const content = sanitizeHtml(String(req.body?.content ?? '').trim()).slice(0, 20000)
  if (!title || !content) return res.status(400).json({ error: 'Thiếu tiêu đề hoặc nội dung.' })

  const excerpt = makeExcerpt(content)
  const { rows } = await query(
    `INSERT INTO news (title, category, excerpt, content, author)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [title, category, excerpt, content, req.user!.fullName],
  )
  res.status(201).json({ id: rows[0].id })
})

// Sửa tin — chỉ officer/admin
newsRouter.put('/:id', requireAuth, requireSection('tin-tuc'), async (req, res) => {
  const title = escapeText(String(req.body?.title ?? '').trim()).slice(0, 200)
  const category = String(req.body?.category ?? 'Thông báo').slice(0, 60)
  const content = sanitizeHtml(String(req.body?.content ?? '').trim()).slice(0, 20000)
  if (!title || !content) return res.status(400).json({ error: 'Thiếu tiêu đề hoặc nội dung.' })

  const excerpt = makeExcerpt(content)
  const { rowCount } = await query(
    'UPDATE news SET title=$1, category=$2, excerpt=$3, content=$4 WHERE id=$5',
    [title, category, excerpt, content, req.params.id],
  )
  if (!rowCount) return res.status(404).json({ error: 'Không tìm thấy tin.' })
  res.json({ ok: true })
})

// Xóa tin — chỉ officer/admin
newsRouter.delete('/:id', requireAuth, requireSection('tin-tuc'), async (req, res) => {
  await query('DELETE FROM news WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})
