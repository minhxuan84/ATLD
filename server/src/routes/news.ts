import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth, requireSection } from '../auth.js'
import { escapeText, sanitizeHtml, makeExcerpt } from '../util.js'
import { audit, clientIp } from '../lib/hse-core.js'

export const newsRouter = Router()
export const newsSourcesRouter = Router()

// ═══════════════ CÔNG KHAI ═══════════════

// Danh sách tin tức — CHỈ published. Guard này là bảo đảm quan trọng nhất của Pha I:
// thiếu WHERE status='published' thì tin chưa duyệt lên thẳng trang chủ.
newsRouter.get('/', async (_req, res) => {
  const { rows } = await query<{
    id: number; title: string; category: string; excerpt: string
    content: string; author: string; date: string
  }>(
    `SELECT id, title, category, excerpt, content, author,
            to_char(created_at, 'YYYY-MM-DD') AS date
     FROM atld.news
     WHERE status = 'published'
     ORDER BY created_at DESC`,
  )
  const news = rows.map((r) => ({ ...r, excerpt: makeExcerpt(r.content) }))
  res.json({ news })
})

newsRouter.get('/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT id, title, category, excerpt, content, author,
            to_char(created_at, 'YYYY-MM-DD') AS date
     FROM atld.news WHERE id = $1 AND status = 'published'`,
    [req.params.id],
  )
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy tin.' })
  res.json({ item: rows[0] })
})

// ═══════════════ CÁN BỘ (requireSection 'tin-tuc') ═══════════════

// Đăng tin thủ công — luôn published
newsRouter.post('/', requireAuth, requireSection('tin-tuc'), async (req, res) => {
  const title = escapeText(String(req.body?.title ?? '').trim()).slice(0, 200)
  const category = String(req.body?.category ?? 'Thông báo').slice(0, 60)
  const content = sanitizeHtml(String(req.body?.content ?? '').trim()).slice(0, 20000)
  if (!title || !content) return res.status(400).json({ error: 'Thiếu tiêu đề hoặc nội dung.' })

  const excerpt = makeExcerpt(content)
  const { rows } = await query(
    `INSERT INTO atld.news (title, category, excerpt, content, author, status)
     VALUES ($1, $2, $3, $4, $5, 'published') RETURNING id`,
    [title, category, excerpt, content, req.user!.fullName],
  )
  res.status(201).json({ id: rows[0].id })
})

// Sửa tin
newsRouter.put('/:id', requireAuth, requireSection('tin-tuc'), async (req, res) => {
  const title = escapeText(String(req.body?.title ?? '').trim()).slice(0, 200)
  const category = String(req.body?.category ?? 'Thông báo').slice(0, 60)
  const content = sanitizeHtml(String(req.body?.content ?? '').trim()).slice(0, 20000)
  if (!title || !content) return res.status(400).json({ error: 'Thiếu tiêu đề hoặc nội dung.' })

  const excerpt = makeExcerpt(content)
  const { rowCount } = await query(
    'UPDATE atld.news SET title=$1, category=$2, excerpt=$3, content=$4 WHERE id=$5',
    [title, category, excerpt, content, req.params.id],
  )
  if (!rowCount) return res.status(404).json({ error: 'Không tìm thấy tin.' })
  res.json({ ok: true })
})

// Xóa tin
newsRouter.delete('/:id', requireAuth, requireSection('tin-tuc'), async (req, res) => {
  await query('DELETE FROM atld.news WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

// ─── Tin chờ duyệt ────────────────────────────────────────────────────────
newsRouter.get('/drafts', requireAuth, requireSection('tin-tuc'), async (_req, res) => {
  const { rows } = await query<{
    id: number; title: string; category: string; excerpt: string
    source_name: string | null; source_url: string | null; fetched_at: string | null
    created_at: string
  }>(
    `SELECT n.id, n.title, n.category,
            n.excerpt,
            n.source_name, n.source_url,
            to_char(n.fetched_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS fetched_at,
            to_char(n.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
     FROM atld.news n
     WHERE n.status = 'draft'
     ORDER BY n.created_at DESC
     LIMIT 200`,
  )
  res.json({ drafts: rows })
})

// Duyệt một tin draft → published
newsRouter.patch('/:id/publish', requireAuth, requireSection('tin-tuc'), async (req, res) => {
  // Cho phép sửa tiêu đề / danh mục trước khi duyệt (tuỳ chọn, bỏ qua nếu không gửi)
  const updates: string[] = ["status = 'published'"]
  const vals: unknown[] = []

  if (req.body?.title) {
    vals.push(escapeText(String(req.body.title).trim()).slice(0, 200))
    updates.push(`title = $${vals.length}`)
  }
  if (req.body?.category) {
    vals.push(String(req.body.category).slice(0, 60))
    updates.push(`category = $${vals.length}`)
  }

  vals.push(req.params.id)
  const { rowCount } = await query(
    `UPDATE atld.news SET ${updates.join(', ')} WHERE id = $${vals.length} AND status = 'draft'`,
    vals,
  )
  if (!rowCount) return res.status(404).json({ error: 'Không tìm thấy bản nháp.' })
  await audit(req.user!, 'NEWS_PUBLISH', 'news', Number(req.params.id), null, {}, clientIp(req))
  res.json({ ok: true })
})

// ═══════════════ NGUỒN RSS (/api/news-sources) ═══════════════

newsSourcesRouter.get('/', requireAuth, requireSection('tin-tuc'), async (_req, res) => {
  const { rows } = await query(
    `SELECT id, name, url, enabled, interval_minutes, category,
            to_char(last_fetched_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_fetched_at,
            last_status, last_error,
            to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
     FROM atld.news_sources
     ORDER BY created_at DESC`,
  )
  res.json({ sources: rows })
})

newsSourcesRouter.post('/', requireAuth, requireSection('tin-tuc'), async (req, res) => {
  const b = req.body ?? {}
  const name = escapeText(String(b.name ?? '').trim()).slice(0, 120)
  const url = String(b.url ?? '').trim().slice(0, 500)
  if (!name || !url) return res.status(400).json({ error: 'Thiếu tên hoặc URL nguồn.' })
  if (!url.startsWith('https://')) return res.status(400).json({ error: 'Nguồn RSS phải dùng HTTPS.' })
  const interval = Math.max(15, Math.min(1440, Number(b.interval_minutes ?? 180)))
  const category = b.category ? String(b.category).slice(0, 60) : null
  const { rows } = await query(
    `INSERT INTO atld.news_sources (name, url, interval_minutes, category, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [name, url, interval, category, req.user!.id],
  )
  await audit(req.user!, 'NEWS_SOURCE_ADD', 'news_sources', rows[0].id, null, { name, url }, clientIp(req))
  res.status(201).json({ id: rows[0].id })
})

newsSourcesRouter.patch('/:id', requireAuth, requireSection('tin-tuc'), async (req, res) => {
  const b = req.body ?? {}
  const sets: string[] = []; const vals: unknown[] = []
  if (b.name !== undefined) { vals.push(escapeText(String(b.name).trim()).slice(0, 120)); sets.push(`name=$${vals.length}`) }
  if (b.enabled !== undefined) { vals.push(Boolean(b.enabled)); sets.push(`enabled=$${vals.length}`) }
  if (b.interval_minutes !== undefined) {
    vals.push(Math.max(15, Math.min(1440, Number(b.interval_minutes))))
    sets.push(`interval_minutes=$${vals.length}`)
  }
  if (b.category !== undefined) { vals.push(b.category ? String(b.category).slice(0, 60) : null); sets.push(`category=$${vals.length}`) }
  if (!sets.length) return res.status(400).json({ error: 'Không có trường cần cập nhật.' })
  vals.push(req.params.id)
  const { rowCount } = await query(
    `UPDATE atld.news_sources SET ${sets.join(', ')} WHERE id=$${vals.length}`, vals)
  if (!rowCount) return res.status(404).json({ error: 'Không tìm thấy nguồn.' })
  res.json({ ok: true })
})

newsSourcesRouter.delete('/:id', requireAuth, requireSection('tin-tuc'), async (req, res) => {
  await query('DELETE FROM atld.news_sources WHERE id = $1', [req.params.id])
  await audit(req.user!, 'NEWS_SOURCE_DELETE', 'news_sources', Number(req.params.id), null, {}, clientIp(req))
  res.json({ ok: true })
})

// Thử quét ngay một nguồn mà không đợi hẹn giờ
newsSourcesRouter.post('/:id/fetch-now', requireAuth, requireSection('tin-tuc'), async (req, res) => {
  const { rows } = await query('SELECT * FROM atld.news_sources WHERE id=$1', [req.params.id])
  if (!rows[0]) return res.status(404).json({ error: 'Không tìm thấy nguồn.' })
  // Import động để tránh circular; fetchSource gọi DB trực tiếp, không cần pass pool
  const { fetchSource } = await import('../lib/newsFetch.js')
  const result = await fetchSource(rows[0] as import('../lib/newsFetch.js').NewsSourceRow)
  res.json(result)
})
