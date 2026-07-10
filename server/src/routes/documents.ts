import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { query } from '../db.js'
import { requireAuth, requireSection } from '../auth.js'
import type { Role } from '../auth.js'
import { escapeText, sanitizeFileName, ALLOWED_EXT, MAX_FILE_MB } from '../util.js'

export const documentsRouter = Router()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

// Thứ bậc role: trainee < officer < admin
const ROLE_RANK: Record<Role, number> = { trainee: 0, officer: 1, admin: 2 }

function roleAtLeast(userRole: Role, minRole: string): boolean {
  return (ROLE_RANK[userRole] ?? 0) >= (ROLE_RANK[minRole as Role] ?? 0)
}

// ── MIGRATION khi module load ─────────────────────────────────
;(async () => {
  try {
    // Migration 001 — cây thư mục
    await query(`
      CREATE TABLE IF NOT EXISTS atld.doc_folders (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(200) NOT NULL,
        parent_id  INTEGER REFERENCES atld.doc_folders(id) ON DELETE CASCADE,
        created_by VARCHAR(150),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`)
    await query(`ALTER TABLE atld.documents ADD COLUMN IF NOT EXISTS folder_id INTEGER REFERENCES atld.doc_folders(id) ON DELETE SET NULL`)
    await query(`CREATE INDEX IF NOT EXISTS idx_documents_folder ON atld.documents(folder_id)`)
    await query(`CREATE INDEX IF NOT EXISTS idx_folders_parent ON atld.doc_folders(parent_id)`)

    // Migration 002 — danh mục động + phân quyền thư mục + sort_order
    await query(`
      CREATE TABLE IF NOT EXISTS atld.doc_categories (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`)
    // Seed mặc định nếu bảng rỗng
    await query(`
      INSERT INTO atld.doc_categories (name, sort_order)
      SELECT * FROM (VALUES
        ('Nội quy',10),('Quy trình',20),('Biên bản',30),
        ('Quan trắc môi trường',40),('Hồ sơ pháp lý',50)
      ) AS v(name,sort_order)
      WHERE NOT EXISTS (SELECT 1 FROM atld.doc_categories LIMIT 1)`)

    await query(`ALTER TABLE atld.doc_folders ADD COLUMN IF NOT EXISTS sort_order  INTEGER     NOT NULL DEFAULT 0`)
    await query(`ALTER TABLE atld.doc_folders ADD COLUMN IF NOT EXISTS view_role   VARCHAR(20) NOT NULL DEFAULT 'trainee'`)
    await query(`ALTER TABLE atld.doc_folders ADD COLUMN IF NOT EXISTS manage_role VARCHAR(20) NOT NULL DEFAULT 'officer'`)
    await query(`CREATE INDEX IF NOT EXISTS idx_folders_sort ON atld.doc_folders(parent_id, sort_order)`)
  } catch (e) {
    console.error('[documents] migration error:', (e as Error).message)
  }
})()

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')
    cb(null, `${crypto.randomUUID()}${ext}`)
  },
})
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(1)
    if (!ALLOWED_EXT.includes(ext)) return cb(new Error(`Định dạng .${ext} không được phép.`))
    cb(null, true)
  },
})

// ════════════════ DANH MỤC TÀI LIỆU ════════════════

// GET /categories — danh sách danh mục (yêu cầu auth)
documentsRouter.get('/categories', requireAuth, async (_req, res) => {
  const { rows } = await query(`SELECT id, name, sort_order FROM doc_categories ORDER BY sort_order, name`)
  res.json({ categories: rows })
})

// POST /categories — tạo danh mục mới
documentsRouter.post('/categories', requireAuth, requireSection('tai-lieu'), async (req, res) => {
  const name = escapeText(String(req.body?.name ?? '').trim()).slice(0, 100)
  if (!name) return res.status(400).json({ error: 'Tên danh mục không được để trống.' })
  const sortOrder = Number(req.body?.sort_order ?? 0)
  const { rows } = await query(
    `INSERT INTO doc_categories (name, sort_order) VALUES ($1,$2) RETURNING id`,
    [name, isNaN(sortOrder) ? 0 : sortOrder],
  )
  res.status(201).json({ id: rows[0].id })
})

// PATCH /categories/:id — cập nhật danh mục
documentsRouter.patch('/categories/:id', requireAuth, requireSection('tai-lieu'), async (req, res) => {
  const sets: string[] = []; const params: unknown[] = []
  if (req.body?.name !== undefined) {
    const name = escapeText(String(req.body.name).trim()).slice(0, 100)
    if (!name) return res.status(400).json({ error: 'Tên không hợp lệ.' })
    params.push(name); sets.push(`name=$${params.length}`)
  }
  if (req.body?.sort_order !== undefined) {
    const n = Number(req.body.sort_order)
    params.push(isNaN(n) ? 0 : n); sets.push(`sort_order=$${params.length}`)
  }
  if (!sets.length) return res.status(400).json({ error: 'Không có trường nào để cập nhật.' })
  params.push(req.params.id)
  await query(`UPDATE doc_categories SET ${sets.join(',')} WHERE id=$${params.length}`, params)
  res.json({ ok: true })
})

// DELETE /categories/:id — xóa danh mục
documentsRouter.delete('/categories/:id', requireAuth, requireSection('tai-lieu'), async (req, res) => {
  // Trả về cảnh báo nếu còn tài liệu dùng danh mục này, nhưng vẫn cho xóa
  const { rows } = await query(
    `SELECT id FROM doc_categories WHERE id=$1`, [req.params.id])
  if (!rows.length) return res.status(404).json({ error: 'Không tìm thấy danh mục.' })
  await query(`DELETE FROM doc_categories WHERE id=$1`, [req.params.id])
  res.json({ ok: true })
})

// ════════════════ CÂY TÀI LIỆU ════════════════

// GET /tree — trả lại folders + docs đã lọc theo view_role của user
documentsRouter.get('/tree', requireAuth, async (req, res) => {
  const userRole = req.user!.role
  type FolderRow = { id: number; name: string; parent_id: number | null; sort_order: number; view_role: string; manage_role: string; created_at: string }
  type DocRow    = { id: number; name: string; category: string; description: string; size_kb: number; mime_type: string; uploaded_by: string; uploaded_at: string; folder_id: number | null }
  const [fRes, dRes] = await Promise.all([
    query<FolderRow>(`SELECT id, name, parent_id, sort_order, view_role, manage_role,
                  to_char(created_at,'YYYY-MM-DD') AS created_at
           FROM doc_folders ORDER BY parent_id NULLS FIRST, sort_order, name`),
    query<DocRow>(`SELECT id, name, category, description, size_kb, mime_type, uploaded_by,
                  to_char(uploaded_at,'YYYY-MM-DD') AS uploaded_at, folder_id
           FROM documents ORDER BY name`),
  ])

  // Lọc folder theo view_role
  const visibleFolders = fRes.rows.filter((f) => roleAtLeast(userRole, f.view_role))
  const visibleFolderIds = new Set(visibleFolders.map((f) => f.id))

  // Docs thuộc folder bị ẩn cũng bị ẩn
  const visibleDocs = dRes.rows.filter(
    (d) => d.folder_id == null || visibleFolderIds.has(d.folder_id),
  )

  res.json({ folders: visibleFolders, documents: visibleDocs })
})

// GET / — danh sách phẳng (backward compat)
documentsRouter.get('/', requireAuth, async (req, res) => {
  const userRole = req.user!.role
  const q = String(req.query.q ?? '').trim().toLowerCase()
  const cat = String(req.query.category ?? '').trim()
  const params: unknown[] = []; const where: string[] = []
  if (q) {
    params.push(`%${q}%`)
    where.push(`(lower(d.name) LIKE $${params.length} OR lower(d.description) LIKE $${params.length})`)
  }
  if (cat && cat !== 'all') { params.push(cat); where.push(`d.category=$${params.length}`) }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const { rows } = await query<{ view_role: string | null }>(
    `SELECT d.id, d.name, d.category, d.description, d.size_kb, d.mime_type,
            d.uploaded_by, d.folder_id,
            to_char(d.uploaded_at,'YYYY-MM-DD') AS uploaded_at,
            f.view_role
     FROM documents d LEFT JOIN doc_folders f ON f.id=d.folder_id
     ${clause} ORDER BY d.uploaded_at DESC, d.id DESC`,
    params,
  )
  const visible = rows.filter((r) => !r.view_role || roleAtLeast(userRole, r.view_role))
  res.json({ documents: visible })
})

// ════════════════ TẢI LÊN / XEM / TẢI VỀ ════════════════

// POST / — upload (kiểm tra manage_role nếu có folder)
documentsRouter.post('/', requireAuth, requireSection('tai-lieu'), upload.single('file'), async (req, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ error: 'Vui lòng chọn file.' })

  const folderIdRaw = req.body?.folder_id
  const folder_id = folderIdRaw && !isNaN(Number(folderIdRaw)) ? Number(folderIdRaw) : null

  // Kiểm tra manage_role của folder đích
  if (folder_id != null) {
    const { rows } = await query(`SELECT manage_role FROM doc_folders WHERE id=$1`, [folder_id])
    if (rows[0] && !roleAtLeast(req.user!.role, rows[0].manage_role)) {
      fs.rm(file.path, { force: true }, () => {})
      return res.status(403).json({ error: 'Bạn không có quyền upload vào thư mục này.' })
    }
  }

  const category  = String(req.body?.category ?? 'Nội quy').slice(0, 60)
  const description = escapeText(String(req.body?.description ?? '').trim()).slice(0, 300) || 'Không có mô tả.'
  const displayName = sanitizeFileName(file.originalname)
  const { rows } = await query(
    `INSERT INTO documents (name,category,description,size_kb,stored_name,mime_type,uploaded_by,uploaded_by_id,folder_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [displayName, category, description, Math.max(1, Math.round(file.size / 1024)),
     file.filename, file.mimetype, req.user!.fullName, req.user!.id, folder_id],
  )
  res.status(201).json({ id: rows[0].id })
})

// Helper — lấy thông tin file + kiểm tra quyền xem
async function getDocForServing(id: string, userRole: Role) {
  const { rows } = await query<{
    stored_name: string; name: string; mime_type: string; view_role: string | null
  }>(
    `SELECT d.stored_name, d.name, d.mime_type, f.view_role
     FROM documents d LEFT JOIN doc_folders f ON f.id=d.folder_id
     WHERE d.id=$1`, [id],
  )
  if (!rows[0]) return { doc: null, forbidden: false }
  const doc = rows[0]
  if (doc.view_role && !roleAtLeast(userRole, doc.view_role)) return { doc: null, forbidden: true }
  return { doc, forbidden: false }
}

// GET /:id/view — xem inline
documentsRouter.get('/:id/view', requireAuth, async (req, res) => {
  const { doc, forbidden } = await getDocForServing(req.params.id, req.user!.role)
  if (forbidden) return res.status(403).json({ error: 'Bạn không có quyền xem tài liệu này.' })
  if (!doc) return res.status(404).json({ error: 'Không tìm thấy tài liệu.' })
  const filePath = path.join(UPLOAD_DIR, doc.stored_name)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File không tồn tại trên máy chủ.' })
  const safe = doc.name.replace(/[^\w.\- À-ỹ]/g, '_')
  res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream')
  res.setHeader('Content-Disposition', `inline; filename="${safe}"`)
  res.setHeader('Cache-Control', 'private, max-age=300')
  fs.createReadStream(filePath).pipe(res)
})

// GET /:id/download — tải về
documentsRouter.get('/:id/download', requireAuth, async (req, res) => {
  const { doc, forbidden } = await getDocForServing(req.params.id, req.user!.role)
  if (forbidden) return res.status(403).json({ error: 'Bạn không có quyền tải tài liệu này.' })
  if (!doc) return res.status(404).json({ error: 'Không tìm thấy tài liệu.' })
  const filePath = path.join(UPLOAD_DIR, doc.stored_name)
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File không tồn tại trên máy chủ.' })
  res.download(filePath, doc.name)
})

// PATCH /:id — cập nhật tài liệu
documentsRouter.patch('/:id', requireAuth, requireSection('tai-lieu'), async (req, res) => {
  // Kiểm tra manage_role folder hiện tại
  const { rows: curRows } = await query<{ folder_id: number | null }>(
    `SELECT folder_id FROM documents WHERE id=$1`, [req.params.id])
  if (!curRows[0]) return res.status(404).json({ error: 'Không tìm thấy tài liệu.' })

  const folderId = curRows[0].folder_id
  if (folderId != null) {
    const { rows: fRows } = await query(`SELECT manage_role FROM doc_folders WHERE id=$1`, [folderId])
    if (fRows[0] && !roleAtLeast(req.user!.role, fRows[0].manage_role)) {
      return res.status(403).json({ error: 'Bạn không có quyền sửa tài liệu trong thư mục này.' })
    }
  }

  const { name, description, category, folder_id } = req.body ?? {}
  const sets: string[] = []; const params: unknown[] = []
  if (name) { params.push(sanitizeFileName(String(name))); sets.push(`name=$${params.length}`) }
  if (description !== undefined) { params.push(escapeText(String(description ?? '').trim()).slice(0, 300)); sets.push(`description=$${params.length}`) }
  if (category) { params.push(String(category).slice(0, 60)); sets.push(`category=$${params.length}`) }
  if (folder_id !== undefined) {
    const fid = folder_id === null ? null : Number(folder_id)
    params.push(isNaN(fid as number) ? null : fid); sets.push(`folder_id=$${params.length}`)
  }
  if (!sets.length) return res.status(400).json({ error: 'Không có trường nào để cập nhật.' })
  params.push(req.params.id)
  await query(`UPDATE documents SET ${sets.join(',')} WHERE id=$${params.length}`, params)
  res.json({ ok: true })
})

// DELETE /:id — xóa tài liệu
documentsRouter.delete('/:id', requireAuth, requireSection('tai-lieu'), async (req, res) => {
  const { rows } = await query<{ stored_name: string; folder_id: number | null }>(
    'SELECT stored_name, folder_id FROM documents WHERE id=$1', [req.params.id])
  if (!rows[0]) return res.json({ ok: true })

  // Kiểm tra manage_role
  if (rows[0].folder_id != null) {
    const { rows: fRows } = await query(`SELECT manage_role FROM doc_folders WHERE id=$1`, [rows[0].folder_id])
    if (fRows[0] && !roleAtLeast(req.user!.role, fRows[0].manage_role)) {
      return res.status(403).json({ error: 'Bạn không có quyền xóa tài liệu trong thư mục này.' })
    }
  }

  fs.rm(path.join(UPLOAD_DIR, rows[0].stored_name), { force: true }, () => {})
  await query('DELETE FROM documents WHERE id=$1', [req.params.id])
  res.json({ ok: true })
})

// ════════════════ THƯ MỤC ════════════════

// POST /folders — tạo thư mục (với sort_order, view_role, manage_role)
documentsRouter.post('/folders', requireAuth, requireSection('tai-lieu'), async (req, res) => {
  const name = sanitizeFileName(String(req.body?.name ?? '').trim())
  if (!name) return res.status(400).json({ error: 'Tên thư mục không được để trống.' })
  const parentId   = req.body?.parent_id ? Number(req.body.parent_id) : null
  const sortOrder  = Number(req.body?.sort_order ?? 0)
  const viewRole   = ['trainee','officer','admin'].includes(req.body?.view_role) ? req.body.view_role : 'trainee'
  const manageRole = ['officer','admin'].includes(req.body?.manage_role) ? req.body.manage_role : 'officer'
  const { rows } = await query(
    `INSERT INTO doc_folders (name,parent_id,created_by,sort_order,view_role,manage_role)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [name, parentId, req.user!.fullName, isNaN(sortOrder) ? 0 : sortOrder, viewRole, manageRole],
  )
  res.status(201).json({ id: rows[0].id })
})

// PATCH /folders/:id — cập nhật thư mục
documentsRouter.patch('/folders/:id', requireAuth, requireSection('tai-lieu'), async (req, res) => {
  const sets: string[] = []; const params: unknown[] = []
  if (req.body?.name !== undefined) {
    const n = sanitizeFileName(String(req.body.name).trim())
    if (!n) return res.status(400).json({ error: 'Tên không hợp lệ.' })
    params.push(n); sets.push(`name=$${params.length}`)
  }
  if (req.body?.sort_order !== undefined) {
    const n = Number(req.body.sort_order)
    params.push(isNaN(n) ? 0 : n); sets.push(`sort_order=$${params.length}`)
  }
  if (req.body?.view_role !== undefined && ['trainee','officer','admin'].includes(req.body.view_role)) {
    params.push(req.body.view_role); sets.push(`view_role=$${params.length}`)
  }
  if (req.body?.manage_role !== undefined && ['officer','admin'].includes(req.body.manage_role)) {
    params.push(req.body.manage_role); sets.push(`manage_role=$${params.length}`)
  }
  if (!sets.length) return res.status(400).json({ error: 'Không có trường nào để cập nhật.' })
  params.push(req.params.id)
  await query(`UPDATE doc_folders SET ${sets.join(',')} WHERE id=$${params.length}`, params)
  res.json({ ok: true })
})

// DELETE /folders/:id — xóa (cascade subfolder; docs về gốc qua ON DELETE SET NULL)
documentsRouter.delete('/folders/:id', requireAuth, requireSection('tai-lieu'), async (req, res) => {
  await query('DELETE FROM doc_folders WHERE id=$1', [req.params.id])
  res.json({ ok: true })
})
