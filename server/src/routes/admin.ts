import { Router } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { query } from '../db.js'
import { requireAuth, requireSection, requireCms, CMS_SECTIONS, requireRole } from '../auth.js'
import { escapeText } from '../util.js'
import { audit, clientIp } from '../lib/hse-core.js'
import { hashToken } from './portal.js'
import { generateCourse, aiAvailable, buildVideoScript, type GeneratedCourse } from '../ai.js'
import { createJob, getJob, spawnVideoJob } from '../video.js'
import { authenticateLdapWithConfig, syncUsersFromAd } from '../lib/ldap.js'
import type { LdapConfig } from '../lib/ldap.js'

export const adminRouter = Router()

// Mọi endpoint yêu cầu đăng nhập; quyền chi tiết kiểm tra theo từng mục CMS bên dưới.
adminRouter.use(requireAuth)

// ---- Dashboard: thống kê tổng quan ----
adminRouter.get('/stats', requireCms, async (_req, res) => {
  const [users, courses, docs, news, certs, roleBreakdown, recentCerts] = await Promise.all([
    query('SELECT count(*)::int AS n FROM users'),
    query('SELECT count(*)::int AS n FROM courses'),
    query('SELECT count(*)::int AS n FROM documents'),
    query('SELECT count(*)::int AS n FROM news'),
    query('SELECT count(*)::int AS n FROM progress WHERE passed = true'),
    query(`SELECT role, count(*)::int AS n FROM users GROUP BY role`),
    query(`SELECT p.cert_id, u.full_name, c.title, p.quiz_score, p.trainee_info,
                   to_char(p.completed_at,'YYYY-MM-DD') AS date
            FROM progress p
            JOIN users u ON u.id = p.user_id
            JOIN courses c ON c.id = p.course_id
            WHERE p.passed = true
            ORDER BY p.completed_at DESC NULLS LAST LIMIT 8`),
  ])
  res.json({
    totals: {
      users: users.rows[0].n,
      courses: courses.rows[0].n,
      documents: docs.rows[0].n,
      news: news.rows[0].n,
      certificates: certs.rows[0].n,
    },
    roleBreakdown: roleBreakdown.rows,
    recentCertificates: recentCerts.rows,
  })
})

// ---- Người dùng ----
// Lọc danh sách quyền hợp lệ (bỏ khóa lạ), tránh ghi quyền không tồn tại.
function cleanPermissions(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return [...new Set(input.map((x) => String(x)))].filter((x) => (CMS_SECTIONS as readonly string[]).includes(x))
}

adminRouter.get('/users', requireSection('nguoi-dung'), async (_req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.username, u.full_name, u.role, u.permissions, u.site_id, b.name AS site_name,
            to_char(u.created_at,'YYYY-MM-DD') AS created_at
     FROM users u LEFT JOIN branches b ON b.id = u.site_id ORDER BY u.id`,
  )
  res.json({ users: rows })
})

adminRouter.post('/users', requireSection('nguoi-dung'), async (req, res) => {
  const username = String(req.body?.username ?? '').trim().toLowerCase()
  const fullName = escapeText(String(req.body?.fullName ?? '').trim()).slice(0, 150)
  const password = String(req.body?.password ?? '')
  // Chỉ admin thật mới được đặt vai trò và cấp quyền. Cán bộ được ủy quyền mục "người dùng"
  // chỉ tạo được học viên, không thể tự nâng quyền hay tạo admin (chống leo thang đặc quyền).
  const isAdmin = req.user!.role === 'admin'
  const role = isAdmin ? String(req.body?.role ?? 'trainee') : 'trainee'
  const permissions = isAdmin ? cleanPermissions(req.body?.permissions) : []
  // Site chỉ do admin gán (chỉ ý nghĩa với officer). null = không giới hạn/không có site.
  const siteId = isAdmin && req.body?.site_id ? Number(req.body.site_id) : null
  if (!/^[a-z0-9_.]{3,60}$/.test(username)) return res.status(400).json({ error: 'Tên đăng nhập không hợp lệ (3-60 ký tự, chữ thường/số/_).' })
  if (!fullName) return res.status(400).json({ error: 'Thiếu họ tên.' })
  if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự.' })
  if (!['trainee', 'officer', 'admin'].includes(role)) return res.status(400).json({ error: 'Vai trò không hợp lệ.' })

  const dup = await query('SELECT 1 FROM users WHERE username = $1', [username])
  if (dup.rows.length) return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại.' })

  const hash = await bcrypt.hash(password, 10)
  const { rows } = await query(
    'INSERT INTO users (username, password_hash, full_name, role, permissions, site_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [username, hash, fullName, role, JSON.stringify(permissions), siteId],
  )
  res.status(201).json({ id: rows[0].id })
})

adminRouter.put('/users/:id', requireSection('nguoi-dung'), async (req, res) => {
  const id = Number(req.params.id)
  const fullName = escapeText(String(req.body?.fullName ?? '').trim()).slice(0, 150)
  const password = req.body?.password ? String(req.body.password) : ''
  const isAdmin = req.user!.role === 'admin'

  if (!fullName) return res.status(400).json({ error: 'Thiếu họ tên.' })

  // Vai trò & quyền chỉ do admin thật quản lý. Cán bộ được ủy quyền chỉ đổi được họ tên / mật khẩu.
  if (isAdmin) {
    const role = String(req.body?.role ?? '')
    const permissions = cleanPermissions(req.body?.permissions)
    const siteId = req.body?.site_id ? Number(req.body.site_id) : null
    if (!['trainee', 'officer', 'admin'].includes(role)) return res.status(400).json({ error: 'Vai trò không hợp lệ.' })
    // Không cho tự hạ quyền admin cuối cùng
    if (req.user!.id === id && role !== 'admin') {
      const admins = await query(`SELECT count(*)::int AS n FROM users WHERE role='admin'`)
      if (admins.rows[0].n <= 1) return res.status(400).json({ error: 'Không thể hạ quyền admin cuối cùng.' })
    }
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự.' })
      const hash = await bcrypt.hash(password, 10)
      await query('UPDATE users SET full_name=$1, role=$2, permissions=$3, site_id=$4, password_hash=$5 WHERE id=$6', [fullName, role, JSON.stringify(permissions), siteId, hash, id])
    } else {
      await query('UPDATE users SET full_name=$1, role=$2, permissions=$3, site_id=$4 WHERE id=$5', [fullName, role, JSON.stringify(permissions), siteId, id])
    }
  } else {
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự.' })
      const hash = await bcrypt.hash(password, 10)
      await query('UPDATE users SET full_name=$1, password_hash=$2 WHERE id=$3', [fullName, hash, id])
    } else {
      await query('UPDATE users SET full_name=$1 WHERE id=$2', [fullName, id])
    }
  }
  res.json({ ok: true })
})

adminRouter.delete('/users/:id', requireSection('nguoi-dung'), async (req, res) => {
  const id = Number(req.params.id)
  if (req.user!.id === id) return res.status(400).json({ error: 'Không thể tự xóa tài khoản đang đăng nhập.' })
  await query('DELETE FROM users WHERE id = $1', [id])
  res.json({ ok: true })
})

// ---- Khóa học ----
// AI sinh nội dung khóa học từ chủ đề (prompt). Trả bản nháp để duyệt, KHÔNG tự lưu.
// Video KHÔNG tự khởi động — admin xem lại nội dung rồi bấm "Tạo video" (POST /videos/create).
adminRouter.post('/courses/ai-generate', requireSection('khoa-hoc'), async (req, res) => {
  if (!aiAvailable()) {
    return res.status(503).json({ error: 'Chưa cấu hình AI (ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL) trên máy chủ.' })
  }
  const topic = String(req.body?.topic ?? '').trim().slice(0, 500)
  if (topic.length < 3) return res.status(400).json({ error: 'Vui lòng nhập chủ đề (tối thiểu 3 ký tự).' })
  // Số câu hỏi admin cấu hình (3–20, mặc định 8)
  const questionCount = Math.max(3, Math.min(20, Number(req.body?.questionCount ?? 8) || 8))
  try {
    const course = await generateCourse(topic, questionCount)
    if (!course.questions.length) return res.status(422).json({ error: 'AI chưa tạo được câu hỏi hợp lệ, thử lại với chủ đề rõ hơn.' })
    res.json({ course })
  } catch (err) {
    console.error('[ai-generate]', (err as Error).message)
    res.status(502).json({ error: 'Không gọi được dịch vụ AI. Kiểm tra API key và kết nối mạng.' })
  }
})

adminRouter.post('/courses', requireSection('khoa-hoc'), async (req, res) => {
  const id = String(req.body?.id ?? '').trim().toLowerCase()
  if (!/^[a-z0-9-]{2,60}$/.test(id)) return res.status(400).json({ error: 'Mã khóa học không hợp lệ (chữ thường/số/gạch ngang).' })
  const dup = await query('SELECT 1 FROM courses WHERE id = $1', [id])
  if (dup.rows.length) return res.status(409).json({ error: 'Mã khóa học đã tồn tại.' })

  const b = req.body
  const branchId = b.branch_id ? Number(b.branch_id) : null
  const passScore = Math.max(0, Math.min(100, Number(b.pass_score) || 80))
  await query(
    `INSERT INTO courses (id, title, description, grp, branch_id, video_url, duration, summary, pass_score, sort_order,
                          questions_per_attempt, validity_months, randomize_options, max_attempts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [id, String(b.title ?? '').slice(0, 200), String(b.description ?? ''), String(b.grp ?? ''), branchId,
     String(b.video_url ?? ''), String(b.duration ?? ''), JSON.stringify(Array.isArray(b.summary) ? b.summary : []),
     passScore, Number(b.sort_order) || 0,
     Number(b.questions_per_attempt) || 0,
     b.validity_months ? Number(b.validity_months) : null,
     Boolean(b.randomize_options),
     // 0 = không giới hạn. Chặn trên 20 để tránh nhập nhầm thành số vô nghĩa.
     Math.max(0, Math.min(20, Number(b.max_attempts) || 0))],
  )
  res.status(201).json({ id })
})

adminRouter.put('/courses/:id', requireSection('khoa-hoc'), async (req, res) => {
  const b = req.body
  const branchId = b.branch_id ? Number(b.branch_id) : null
  const passScore = Math.max(0, Math.min(100, Number(b.pass_score) || 80))
  // Form CMS không gửi questions_per_attempt/randomize_options → nếu ghi thẳng thì mỗi
  // lần sửa khóa học sẽ xóa luôn cấu hình rút đề. COALESCE giữ giá trị cũ khi thiếu khóa.
  const qpa = b.questions_per_attempt === undefined ? null : Number(b.questions_per_attempt) || 0
  const randomize = b.randomize_options === undefined ? null : Boolean(b.randomize_options)
  // max_attempts cũng theo COALESCE: form không gửi khóa này thì giữ giới hạn cũ,
  // không âm thầm mở lại thành không giới hạn.
  const maxAttempts = b.max_attempts === undefined
    ? null : Math.max(0, Math.min(20, Number(b.max_attempts) || 0))
  await query(
    `UPDATE courses SET title=$1, description=$2, grp=$3, branch_id=$4, video_url=$5, duration=$6, summary=$7, pass_score=$8,
                        questions_per_attempt=COALESCE($9, questions_per_attempt),
                        validity_months=$10,
                        randomize_options=COALESCE($11, randomize_options),
                        max_attempts=COALESCE($12, max_attempts)
     WHERE id=$13`,
    [String(b.title ?? '').slice(0, 200), String(b.description ?? ''), String(b.grp ?? ''), branchId,
     String(b.video_url ?? ''), String(b.duration ?? ''), JSON.stringify(Array.isArray(b.summary) ? b.summary : []),
     passScore,
     qpa,
     b.validity_months ? Number(b.validity_months) : null,
     randomize,
     maxAttempts,
     req.params.id],
  )
  res.json({ ok: true })
})

adminRouter.delete('/courses/:id', requireSection('khoa-hoc'), async (req, res) => {
  await query('DELETE FROM courses WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

// ---- Câu hỏi của khóa học (bao gồm correct_index, chỉ người có quyền mới thấy) ----
adminRouter.get('/courses/:id/questions', requireSection('khoa-hoc'), async (req, res) => {
  const { rows } = await query(
    'SELECT id, text, options, correct_index, sort_order FROM questions WHERE course_id=$1 ORDER BY sort_order, id',
    [req.params.id],
  )
  res.json({ questions: rows })
})

// Chuẩn hóa & kiểm tra dữ liệu câu hỏi, trả về {error} hoặc {text, options, correct}
function parseQuestion(body: unknown): { error: string } | { text: string; options: string[]; correct: number } {
  const b = body as Record<string, unknown>
  const text = String(b?.text ?? '').trim()
  const options = Array.isArray(b?.options) ? (b.options as unknown[]).map((o) => String(o).trim()).filter(Boolean) : []
  const correct = Number(b?.correct_index)
  if (!text || options.length < 2) return { error: 'Câu hỏi cần nội dung và ít nhất 2 lựa chọn.' }
  if (!(correct >= 0 && correct < options.length)) return { error: 'Đáp án đúng không hợp lệ.' }
  return { text, options, correct }
}

adminRouter.post('/courses/:id/questions', requireSection('khoa-hoc'), async (req, res) => {
  const parsed = parseQuestion(req.body)
  if ('error' in parsed) return res.status(400).json({ error: parsed.error })
  const order = await query('SELECT coalesce(max(sort_order),0)+1 AS n FROM questions WHERE course_id=$1', [req.params.id])
  const { rows } = await query(
    'INSERT INTO questions (course_id, text, options, correct_index, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [req.params.id, parsed.text, JSON.stringify(parsed.options), parsed.correct, order.rows[0].n],
  )
  res.status(201).json({ id: rows[0].id })
})

adminRouter.put('/questions/:id', requireSection('khoa-hoc'), async (req, res) => {
  const parsed = parseQuestion(req.body)
  if ('error' in parsed) return res.status(400).json({ error: parsed.error })
  await query(
    'UPDATE questions SET text=$1, options=$2, correct_index=$3 WHERE id=$4',
    [parsed.text, JSON.stringify(parsed.options), parsed.correct, req.params.id],
  )
  res.json({ ok: true })
})

adminRouter.delete('/questions/:id', requireSection('khoa-hoc'), async (req, res) => {
  await query('DELETE FROM questions WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

// Lịch sử chứng chỉ đã cấp của một khóa học (người đạt, điểm, ngày cấp).
adminRouter.get('/courses/:id/certificates', requireSection('khoa-hoc'), async (req, res) => {
  const { rows } = await query(
    `SELECT p.cert_id, p.quiz_score, p.trainee_info, u.full_name,
            to_char(p.completed_at, 'YYYY-MM-DD') AS date
     FROM progress p
     JOIN users u ON u.id = p.user_id
     WHERE p.course_id = $1 AND p.passed = true
     ORDER BY p.completed_at DESC NULLS LAST`,
    [req.params.id],
  )
  res.json({ certificates: rows })
})

// Toàn bộ kết quả học viên của một khóa học (cả đạt & chưa đạt).
adminRouter.get('/courses/:id/results', requireSection('khoa-hoc'), async (req, res) => {
  const { rows } = await query(
    `SELECT p.quiz_score, p.passed, p.step, p.cert_id, p.trainee_info,
            u.id AS user_id, u.full_name, u.username,
            to_char(p.completed_at, 'YYYY-MM-DD') AS completed_at,
            to_char(p.updated_at, 'YYYY-MM-DD HH24:MI') AS last_updated
     FROM progress p
     JOIN users u ON u.id = p.user_id
     WHERE p.course_id = $1
     ORDER BY p.passed DESC, p.completed_at DESC NULLS LAST`,
    [req.params.id],
  )
  res.json({ results: rows })
})

// ---- Pha H6: link QR thi tại hiện trường ----
// Gác bằng requireSection('khoa-hoc'), KHÔNG dùng POST /findings/portal-tokens: endpoint
// đó gác canInspect (quyền HSE), còn người cần tạo QR là cán bộ đào tạo.
// Dùng lại hse_portal_tokens để không có cơ chế token thứ hai trong hệ thống.

/** Danh mục chứng nhận đã cấp của một khóa — cả hai lối vào (tài khoản và QR). */
adminRouter.get('/courses/:id/quiz-certificates', requireSection('khoa-hoc'), async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.cert_id, c.trainee_name, c.score, c.issued_at, c.expires_at,
            c.source, c.cert_pdf, c.download_key, c.attempt_id,
            a.download_key AS attempt_key, a.detail_pdf,
            u.username
     FROM atld.quiz_certificates c
     LEFT JOIN atld.quiz_attempts a ON a.id = c.attempt_id
     LEFT JOIN atld.users u ON u.id = c.user_id
     WHERE c.course_id = $1
     ORDER BY c.issued_at DESC
     LIMIT 500`,
    [req.params.id],
  )
  res.json({ certificates: rows })
})

adminRouter.get('/courses/:id/quiz-tokens', requireSection('khoa-hoc'), async (req, res) => {
  const { rows } = await query(
    `SELECT t.id, t.label, t.expires_at, t.max_uses, t.used_count, t.revoked_at,
            t.created_at, u.full_name AS created_by_name,
            (t.revoked_at IS NULL AND t.expires_at > now()
             AND (t.max_uses IS NULL OR t.used_count < t.max_uses)) AS active
     FROM atld.hse_portal_tokens t
     LEFT JOIN atld.users u ON u.id = t.created_by
     WHERE t.purpose = 'quiz' AND t.course_id = $1
     ORDER BY t.created_at DESC`,
    [req.params.id],
  )
  res.json({ tokens: rows })
})

adminRouter.post('/courses/:id/quiz-tokens', requireSection('khoa-hoc'), async (req, res) => {
  const courseId = req.params.id
  const c = await query<{ id: string; title: string }>(
    'SELECT id, title FROM courses WHERE id = $1', [courseId])
  if (!c.rows[0]) return res.status(404).json({ error: 'Không tìm thấy khóa học.' })

  // Khóa chưa có câu hỏi thì link QR mở ra là lỗi — chặn tại đây để cán bộ biết ngay
  // thay vì dán QR lên tường rồi học viên quét mới thấy không thi được.
  const q = await query<{ n: number }>(
    'SELECT count(*)::int AS n FROM questions WHERE course_id = $1', [courseId])
  if (!Number(q.rows[0]?.n))
    return res.status(400).json({ error: 'Khóa học chưa có câu hỏi, chưa tạo được link thi.' })

  const b = req.body ?? {}
  const days = Math.min(Math.max(Number(b.days) || 30, 1), 180)
  const maxUses = b.max_uses === null || b.max_uses === undefined || b.max_uses === ''
    ? null : Math.min(Math.max(Number(b.max_uses), 1), 10000)

  // 32 byte ngẫu nhiên, không dùng randomUUID: đây là bí mật truy cập nên cần entropy
  // cao hơn UUID v4. DB chỉ giữ SHA-256, token thô chỉ trả về đúng lần này.
  const raw = crypto.randomBytes(32).toString('base64url')
  const r = await query<{ id: number }>(
    `INSERT INTO atld.hse_portal_tokens
       (token_hash, purpose, label, course_id, expires_at, max_uses, created_by)
     VALUES ($1, 'quiz', $2, $3, now() + ($4 || ' days')::interval, $5, $6)
     RETURNING id`,
    [hashToken(raw), escapeText(String(b.label ?? '').trim()) || null,
     courseId, String(days), maxUses, req.user!.id],
  )
  // token thô KHÔNG vào audit log — log đọc được rộng hơn danh sách link.
  await audit(req.user!, 'QUIZ_TOKEN_CREATE', 'portal_token', r.rows[0]!.id, null,
    { courseId, days, maxUses }, clientIp(req))
  res.status(201).json({ id: r.rows[0]!.id, token: raw, expires_in_days: days })
})

adminRouter.delete('/courses/:courseId/quiz-tokens/:id', requireSection('khoa-hoc'), async (req, res) => {
  const r = await query<{ id: number }>(
    `UPDATE atld.hse_portal_tokens SET revoked_at = now(), revoked_by = $1
     WHERE id = $2 AND course_id = $3 AND purpose = 'quiz' AND revoked_at IS NULL
     RETURNING id`,
    [req.user!.id, Number(req.params.id), req.params.courseId])
  if (!r.rows[0]) return res.status(404).json({ error: 'Không tìm thấy link còn hiệu lực.' })
  await audit(req.user!, 'QUIZ_TOKEN_REVOKE', 'portal_token', Number(req.params.id),
    null, null, clientIp(req))
  res.json({ ok: true })
})

// ---- Mục tiêu (goals) ----
adminRouter.get('/goals', requireSection('muc-tieu'), async (_req, res) => {
  const { rows } = await query('SELECT id, scope, title, target, progress FROM goals ORDER BY sort_order, id')
  res.json({ goals: rows })
})

adminRouter.post('/goals', requireSection('muc-tieu'), async (req, res) => {
  const b = req.body
  const scope = b.scope === 'month' ? 'month' : 'year'
  const { rows } = await query(
    'INSERT INTO goals (scope, title, target, progress, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [scope, String(b.title ?? '').slice(0, 200), String(b.target ?? ''), Math.max(0, Math.min(100, Number(b.progress) || 0)), Number(b.sort_order) || 0],
  )
  res.status(201).json({ id: rows[0].id })
})

adminRouter.put('/goals/:id', requireSection('muc-tieu'), async (req, res) => {
  const b = req.body
  await query(
    'UPDATE goals SET title=$1, target=$2, progress=$3 WHERE id=$4',
    [String(b.title ?? '').slice(0, 200), String(b.target ?? ''), Math.max(0, Math.min(100, Number(b.progress) || 0)), req.params.id],
  )
  res.json({ ok: true })
})

adminRouter.delete('/goals/:id', requireSection('muc-tieu'), async (req, res) => {
  await query('DELETE FROM goals WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

// ---- Timeline (milestones) ----
adminRouter.get('/milestones', requireSection('muc-tieu'), async (_req, res) => {
  const { rows } = await query('SELECT id, year_label, title, detail FROM milestones ORDER BY sort_order, year_label')
  res.json({ milestones: rows })
})

adminRouter.post('/milestones', requireSection('muc-tieu'), async (req, res) => {
  const b = req.body
  const { rows } = await query(
    'INSERT INTO milestones (year_label, title, detail, sort_order) VALUES ($1,$2,$3,$4) RETURNING id',
    [String(b.year_label ?? '').slice(0, 20), String(b.title ?? '').slice(0, 200), String(b.detail ?? ''), Number(b.sort_order) || 0],
  )
  res.status(201).json({ id: rows[0].id })
})

adminRouter.put('/milestones/:id', requireSection('muc-tieu'), async (req, res) => {
  const b = req.body
  await query(
    'UPDATE milestones SET year_label=$1, title=$2, detail=$3 WHERE id=$4',
    [String(b.year_label ?? '').slice(0, 20), String(b.title ?? '').slice(0, 200), String(b.detail ?? ''), req.params.id],
  )
  res.json({ ok: true })
})

adminRouter.delete('/milestones/:id', requireSection('muc-tieu'), async (req, res) => {
  await query('DELETE FROM milestones WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

// ---- Chi nhánh / đơn vị ----
// GET danh sách chi nhánh cũng dùng cho dropdown trong form khóa học → cho phép cả 2 quyền.
// Danh sách chi nhánh (chỉ đọc) — dùng cho gán site người dùng/hợp đồng/khách nên mở cho cả 'an-toan' và 'nguoi-dung'.
adminRouter.get('/branches', requireSection('chi-nhanh', 'khoa-hoc', 'an-toan', 'nguoi-dung'), async (_req, res) => {
  const { rows } = await query('SELECT id, name, location, sort_order FROM branches ORDER BY sort_order, id')
  res.json({ branches: rows })
})

adminRouter.post('/branches', requireSection('chi-nhanh'), async (req, res) => {
  const b = req.body
  const name = String(b.name ?? '').trim().slice(0, 150)
  if (!name) return res.status(400).json({ error: 'Thiếu tên chi nhánh.' })
  const { rows } = await query(
    'INSERT INTO branches (name, location, sort_order) VALUES ($1,$2,$3) RETURNING id',
    [name, String(b.location ?? '').slice(0, 200), Number(b.sort_order) || 0],
  )
  res.status(201).json({ id: rows[0].id })
})

adminRouter.put('/branches/:id', requireSection('chi-nhanh'), async (req, res) => {
  const b = req.body
  const name = String(b.name ?? '').trim().slice(0, 150)
  if (!name) return res.status(400).json({ error: 'Thiếu tên chi nhánh.' })
  await query(
    'UPDATE branches SET name=$1, location=$2, sort_order=$3 WHERE id=$4',
    [name, String(b.location ?? '').slice(0, 200), Number(b.sort_order) || 0, req.params.id],
  )
  res.json({ ok: true })
})

// Xóa chi nhánh: khóa học thuộc chi nhánh sẽ về "chưa phân loại" (ON DELETE SET NULL)
adminRouter.delete('/branches/:id', requireSection('chi-nhanh'), async (req, res) => {
  await query('DELETE FROM branches WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

// ---- Trường thông tin trắc nghiệm (quiz_fields) ----

const FIELD_TYPES = ['text', 'select', 'image'] as const
/**
 * Vai trò của trường trong hồ sơ đào tạo (Pha H1):
 *  - full_name: tên in trên chứng nhận. Lấy từ form, KHÔNG lấy tên tài khoản đăng nhập.
 *  - photo:     ảnh in bên trái chứng nhận, dấu PASSED đóng chồng lên.
 *  - id_number: CCCD — dùng để đếm số lần thi của học viên vào bằng QR (không có tài khoản).
 * Đánh dấu tường minh thay vì dò theo mã trường, vì mã do admin tự đặt.
 */
const FIELD_PURPOSES = ['none', 'full_name', 'id_number', 'photo'] as const

/** Vai trò nào chỉ được gắn cho đúng một trường, kèm loại trường bắt buộc đi với nó. */
const PURPOSE_TYPE: Partial<Record<(typeof FIELD_PURPOSES)[number], (typeof FIELD_TYPES)[number]>> = {
  photo: 'image',
}

/** Chuẩn hóa type/purpose từ body và kiểm tính nhất quán giữa hai giá trị. */
function readTypeAndPurpose(b: Record<string, unknown>) {
  const type = FIELD_TYPES.includes(b.type as never) ? (b.type as (typeof FIELD_TYPES)[number]) : 'text'
  const purpose = FIELD_PURPOSES.includes(b.purpose as never)
    ? (b.purpose as (typeof FIELD_PURPOSES)[number]) : 'none'
  const options = Array.isArray(b.options)
    ? (b.options as unknown[]).map((o) => String(o).slice(0, 100)).filter(Boolean) : []

  if (type === 'select' && options.length < 1) return { error: 'Trường lựa chọn cần ít nhất 1 phương án.' }
  const need = PURPOSE_TYPE[purpose]
  if (need && type !== need) {
    return { error: `Vai trò "${purpose}" chỉ gắn được cho trường loại "${need}".` }
  }
  // Ngược lại: trường ảnh mà không đánh dấu photo thì ảnh không vào chứng nhận được.
  // Không chặn (form có thể cần nhiều ảnh), nhưng type ảnh thì options vô nghĩa.
  return { type, purpose, options: type === 'image' ? [] : options }
}

/**
 * Mỗi vai trò (trừ 'none') chỉ được gắn cho một trường — nếu hai trường cùng khai
 * full_name thì không có cách nào định được tên nào in lên chứng nhận. Chặn ở đây thay
 * vì âm thầm gỡ vai trò của trường kia, để người cấu hình biết mình đang đổi cái gì.
 */
async function purposeTaken(purpose: string, exceptId?: string) {
  if (purpose === 'none') return null
  const { rows } = await query<{ label: string }>(
    `SELECT label FROM quiz_fields WHERE purpose = $1 AND ($2::int IS NULL OR id <> $2::int) LIMIT 1`,
    [purpose, exceptId ?? null],
  )
  return rows[0]?.label ?? null
}

adminRouter.get('/quiz-fields', requireSection('truong-trac-nghiem'), async (_req, res) => {
  const { rows } = await query('SELECT id, field_key, label, type, options, required, purpose, sort_order FROM quiz_fields ORDER BY sort_order, id')
  res.json({ fields: rows })
})

adminRouter.post('/quiz-fields', requireSection('truong-trac-nghiem'), async (req, res) => {
  const b = req.body
  const fieldKey = String(b.field_key ?? '').trim().toLowerCase()
  if (!/^[a-z0-9_]{2,40}$/.test(fieldKey)) return res.status(400).json({ error: 'Mã trường không hợp lệ (chữ thường/số/_, 2-40 ký tự).' })
  const label = String(b.label ?? '').trim().slice(0, 120)
  if (!label) return res.status(400).json({ error: 'Thiếu nhãn hiển thị.' })
  const parsed = readTypeAndPurpose(b)
  if ('error' in parsed) return res.status(400).json({ error: parsed.error })
  const { type, purpose, options } = parsed

  const dup = await query('SELECT 1 FROM quiz_fields WHERE field_key=$1', [fieldKey])
  if (dup.rows.length) return res.status(409).json({ error: 'Mã trường đã tồn tại.' })
  const taken = await purposeTaken(purpose)
  if (taken) return res.status(409).json({ error: `Vai trò này đã gắn cho trường "${taken}". Gỡ vai trò ở trường đó trước.` })

  const order = await query('SELECT coalesce(max(sort_order),0)+1 AS n FROM quiz_fields')
  const { rows } = await query(
    'INSERT INTO quiz_fields (field_key, label, type, options, required, purpose, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [fieldKey, label, type, JSON.stringify(options), b.required !== false, purpose, order.rows[0].n],
  )
  res.status(201).json({ id: rows[0].id })
})

adminRouter.put('/quiz-fields/:id', requireSection('truong-trac-nghiem'), async (req, res) => {
  const b = req.body
  const label = String(b.label ?? '').trim().slice(0, 120)
  if (!label) return res.status(400).json({ error: 'Thiếu nhãn hiển thị.' })
  const parsed = readTypeAndPurpose(b)
  if ('error' in parsed) return res.status(400).json({ error: parsed.error })
  const { type, purpose, options } = parsed
  const taken = await purposeTaken(purpose, req.params.id)
  if (taken) return res.status(409).json({ error: `Vai trò này đã gắn cho trường "${taken}". Gỡ vai trò ở trường đó trước.` })
  await query(
    'UPDATE quiz_fields SET label=$1, type=$2, options=$3, required=$4, purpose=$5 WHERE id=$6',
    [label, type, JSON.stringify(options), b.required !== false, purpose, req.params.id],
  )
  res.json({ ok: true })
})

adminRouter.delete('/quiz-fields/:id', requireSection('truong-trac-nghiem'), async (req, res) => {
  await query('DELETE FROM quiz_fields WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

// ---- Menu điều hướng trang chủ ----
adminRouter.get('/menu', requireSection('menu'), async (_req, res) => {
  const { rows } = await query('SELECT id, label, href, visible, sort_order FROM menu_items ORDER BY sort_order, id')
  res.json({ menu: rows })
})

adminRouter.post('/menu', requireSection('menu'), async (req, res) => {
  const b = req.body
  const label = String(b.label ?? '').trim().slice(0, 80)
  const href = String(b.href ?? '').trim().slice(0, 200)
  if (!label || !href) return res.status(400).json({ error: 'Thiếu nhãn hoặc liên kết.' })
  const order = await query('SELECT coalesce(max(sort_order),0)+1 AS n FROM menu_items')
  const { rows } = await query(
    'INSERT INTO menu_items (label, href, visible, sort_order) VALUES ($1,$2,$3,$4) RETURNING id',
    [label, href, b.visible !== false, Number(b.sort_order) || order.rows[0].n],
  )
  res.status(201).json({ id: rows[0].id })
})

adminRouter.put('/menu/:id', requireSection('menu'), async (req, res) => {
  const b = req.body
  const label = String(b.label ?? '').trim().slice(0, 80)
  const href = String(b.href ?? '').trim().slice(0, 200)
  if (!label || !href) return res.status(400).json({ error: 'Thiếu nhãn hoặc liên kết.' })
  await query(
    'UPDATE menu_items SET label=$1, href=$2, visible=$3, sort_order=$4 WHERE id=$5',
    [label, href, b.visible !== false, Number(b.sort_order) || 0, req.params.id],
  )
  res.json({ ok: true })
})

adminRouter.delete('/menu/:id', requireSection('menu'), async (req, res) => {
  await query('DELETE FROM menu_items WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

// ── LDAP / Active Directory config (admin only) ──────────────────────────────

const LDAP_KEYS = ['url', 'base_dn', 'bind_dn', 'bind_password', 'attr_username', 'attr_fullname', 'enabled'] as const

adminRouter.get('/ldap-config', requireRole('admin'), async (_req, res) => {
  const { rows } = await query<{ key: string; value: string }>(
    `SELECT key, value FROM site_config WHERE key LIKE 'ldap.%'`,
  )
  const cfg: Record<string, string> = {}
  for (const r of rows) cfg[r.key.replace('ldap.', '')] = r.value
  res.json({
    config: {
      url: cfg.url ?? '',
      base_dn: cfg.base_dn ?? '',
      bind_dn: cfg.bind_dn ?? '',
      bind_password: cfg.bind_password ?? '',
      attr_username: cfg.attr_username ?? 'sAMAccountName',
      attr_fullname: cfg.attr_fullname ?? 'displayName',
      enabled: cfg.enabled === 'true',
    },
  })
})

adminRouter.put('/ldap-config', requireRole('admin'), async (req, res) => {
  const b = req.body ?? {}
  for (const k of LDAP_KEYS) {
    const val = k === 'enabled' ? String(!!b[k]) : String(b[k] ?? '')
    await query(
      `INSERT INTO site_config (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [`ldap.${k}`, val],
    )
  }
  res.json({ ok: true })
})

adminRouter.post('/ldap-test', requireRole('admin'), async (req, res) => {
  const b = req.body ?? {}
  if (!b.url || !b.bind_dn || !b.bind_password || !b.base_dn) {
    return res.status(400).json({ ok: false, msg: 'Thiếu thông tin kết nối.' })
  }
  const cfg: LdapConfig = {
    url: b.url, baseDn: b.base_dn, bindDn: b.bind_dn, bindPassword: b.bind_password,
    attrUsername: b.attr_username || 'sAMAccountName',
    attrFullName: b.attr_fullname || 'displayName',
  }
  try {
    // Thử bind bằng service account — nếu thành công là kết nối OK
    const ldap = await import('ldapjs')
    const client = ldap.default.createClient({ url: cfg.url, timeout: 5000, connectTimeout: 5000, tlsOptions: { rejectUnauthorized: false } })
    await new Promise<void>((ok, fail) => {
      client.bind(cfg.bindDn, cfg.bindPassword, (err) => { client.destroy(); err ? fail(err) : ok() })
    })
    res.json({ ok: true, msg: `Kết nối thành công tới ${cfg.url}` })
  } catch (e) {
    res.json({ ok: false, msg: e instanceof Error ? e.message : 'Kết nối thất bại.' })
  }
})

adminRouter.post('/ldap-sync', requireRole('admin'), async (_req, res) => {
  const { rows } = await query<{ key: string; value: string }>(
    `SELECT key, value FROM site_config WHERE key LIKE 'ldap.%'`,
  )
  const cfg: Record<string, string> = {}
  for (const r of rows) cfg[r.key.replace('ldap.', '')] = r.value
  if (!cfg.url || !cfg.base_dn || !cfg.bind_dn || !cfg.bind_password) {
    return res.status(400).json({ error: 'LDAP chưa được cấu hình đầy đủ.' })
  }
  const ldapCfg: LdapConfig = {
    url: cfg.url, baseDn: cfg.base_dn, bindDn: cfg.bind_dn, bindPassword: cfg.bind_password,
    attrUsername: cfg.attr_username || 'sAMAccountName',
    attrFullName: cfg.attr_fullname || 'displayName',
  }
  let users
  try {
    users = await syncUsersFromAd(ldapCfg)
  } catch (e) {
    return res.status(502).json({ error: `Lỗi truy vấn AD: ${e instanceof Error ? e.message : 'không rõ'}` })
  }
  const found = users.length
  let added = 0, updated = 0, skipped = 0
  for (const u of users) {
    if (!u.username) { skipped++; continue }
    const { rowCount } = await query(
      `INSERT INTO atld.users (username, password_hash, full_name, role, permissions, auth_provider)
       VALUES ($1, '', $2, 'officer', '[]', 'ldap')
       ON CONFLICT (username) DO UPDATE
         SET full_name = EXCLUDED.full_name, auth_provider = 'ldap'`,
      [u.username, u.fullName],
    )
    if (rowCount === 1) added++; else updated++
  }
  // found = số entry AD trả về. found=0 thường do sai 'Thuộc tính tên đăng nhập'
  // (phải là sAMAccountName) hoặc Base DN không chứa tài khoản nào.
  const hint = found === 0
    ? 'Không tìm thấy tài khoản nào trong AD. Kiểm tra "Thuộc tính tên đăng nhập" (nên là sAMAccountName) và Base DN.'
    : undefined
  res.json({ added, updated, skipped, found, hint, attrUsername: ldapCfg.attrUsername })
})

// ── SmartCA VNPT config (admin only) ─────────────────────────────────────────

const SMARTCA_KEYS = ['api_url', 'client_id', 'client_secret', 'webhook_secret', 'enabled'] as const

adminRouter.get('/smartca-config', requireRole('admin'), async (_req, res) => {
  const { rows } = await query<{ key: string; value: string }>(
    `SELECT key, value FROM site_config WHERE key LIKE 'smartca.%'`,
  )
  const cfg: Record<string, string> = {}
  for (const r of rows) cfg[r.key.replace('smartca.', '')] = r.value
  res.json({
    config: {
      api_url: cfg.api_url ?? '',
      client_id: cfg.client_id ?? '',
      client_secret: cfg.client_secret ?? '',
      webhook_secret: cfg.webhook_secret ?? '',
      enabled: cfg.enabled === 'true',
    },
  })
})

adminRouter.put('/smartca-config', requireRole('admin'), async (req, res) => {
  const b = req.body ?? {}
  for (const k of SMARTCA_KEYS) {
    const val = k === 'enabled' ? String(!!b[k]) : String(b[k] ?? '')
    await query(
      `INSERT INTO site_config (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [`smartca.${k}`, val],
    )
  }
  res.json({ ok: true })
})

adminRouter.post('/smartca-test', requireRole('admin'), async (req, res) => {
  const b = req.body ?? {}
  if (!b.api_url || !b.client_id || !b.client_secret) {
    return res.status(400).json({ ok: false, msg: 'Thiếu API URL, Client ID hoặc Client Secret.' })
  }
  try {
    const r = await fetch(`${b.api_url}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: b.client_id, client_secret: b.client_secret }),
    })
    if (!r.ok) {
      const body = await r.text()
      return res.json({ ok: false, msg: `SmartCA trả về ${r.status}: ${body.slice(0, 200)}` })
    }
    res.json({ ok: true, msg: `Kết nối SmartCA thành công (${b.api_url})` })
  } catch (e) {
    res.json({ ok: false, msg: e instanceof Error ? e.message : 'Kết nối thất bại.' })
  }
})

// ── Video jobs (auto-video-gen) ───────────────────────────────────────────────

/** GET /api/admin/videos/:jobId/status — poll trạng thái job tạo video */
adminRouter.get('/videos/:jobId/status', requireSection('khoa-hoc'), (req, res) => {
  const job = getJob(req.params.jobId)
  if (!job) return res.status(404).json({ error: 'Job không tồn tại (có thể đã reset sau khi restart server).' })
  res.json({
    jobId: job.jobId,
    status: job.status,          // 'pending' | 'running' | 'done' | 'error'
    topic: job.topic,
    createdAt: job.createdAt,
    videoUrl: job.status === 'done'
      ? `/uploads/videos/${job.jobId}/video.mp4`
      : null,
    error: job.error ?? null,
  })
})

/** GET /api/admin/videos/:jobId/file — download video.mp4 khi job 'done' */
adminRouter.get('/videos/:jobId/file', requireSection('khoa-hoc'), (req, res) => {
  const job = getJob(req.params.jobId)
  if (!job) return res.status(404).json({ error: 'Job không tồn tại.' })
  if (job.status !== 'done' || !job.videoPath) {
    return res.status(409).json({ error: `Video chưa sẵn sàng (trạng thái: ${job.status}).` })
  }
  res.download(job.videoPath, `video-${job.jobId.slice(0, 8)}.mp4`)
})

/** POST /api/admin/videos/create — khởi động job tạo video từ nội dung admin đã kiểm tra */
adminRouter.post('/videos/create', requireSection('khoa-hoc'), async (req, res) => {
  const topic = String(req.body?.topic ?? '').trim().slice(0, 500)
  if (topic.length < 3) return res.status(400).json({ error: 'Thiếu chủ đề.' })
  const courseData = req.body?.course as Partial<GeneratedCourse> | undefined
  if (!courseData?.title) return res.status(400).json({ error: 'Thiếu dữ liệu khóa học (course.title).' })
  // Validate imageUrl — phải là URL tuyệt đối hợp lệ hoặc null
  let imageUrl: string | null = null
  const rawImage = req.body?.imageUrl ? String(req.body.imageUrl).trim() : ''
  if (rawImage) {
    try { new URL(rawImage); imageUrl = rawImage } catch { /* URL không hợp lệ — bỏ qua */ }
  }
  const course: GeneratedCourse = {
    title: String(courseData.title ?? '').slice(0, 200),
    description: String(courseData.description ?? ''),
    grp: String(courseData.grp ?? 'Nhóm 4'),
    duration: String(courseData.duration ?? ''),
    summary: Array.isArray(courseData.summary) ? courseData.summary.map(String) : [],
    questions: [], // không cần câu hỏi để build script video
  }
  try {
    const script = buildVideoScript(course, topic, imageUrl)
    const jobId = createJob(topic)
    await spawnVideoJob(jobId, script)
    res.json({ jobId })
  } catch (err) {
    console.error('[videos/create]', (err as Error).message)
    res.status(500).json({ error: 'Không thể khởi động job tạo video.' })
  }
})
