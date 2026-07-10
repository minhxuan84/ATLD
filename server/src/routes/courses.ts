import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth } from '../auth.js'

export const coursesRouter = Router()

// Danh sách khóa học (kèm tiến độ của user hiện tại nếu đã đăng nhập)
coursesRouter.get('/', requireAuth, async (req, res) => {
  const courses = await query(
    `SELECT c.id, c.title, c.description, c.grp, c.branch_id, b.name AS branch_name,
            c.video_url, c.duration, c.summary, c.pass_score,
            (SELECT count(*)::int FROM questions q WHERE q.course_id = c.id) AS question_count
     FROM courses c
     LEFT JOIN branches b ON b.id = c.branch_id
     ORDER BY b.sort_order NULLS LAST, c.sort_order, c.id`,
  )
  const progress = await query(
    'SELECT course_id, step, quiz_score, passed, cert_id FROM progress WHERE user_id = $1',
    [req.user!.id],
  )
  const pmap = Object.fromEntries(progress.rows.map((p) => [p.course_id, p]))
  res.json({
    courses: courses.rows.map((c) => ({ ...c, progress: pmap[c.id] ?? null })),
  })
})

// Trường thông tin học viên cần khai báo trước khi làm trắc nghiệm (admin cấu hình)
coursesRouter.get('/meta/quiz-fields', requireAuth, async (_req, res) => {
  const { rows } = await query(
    'SELECT field_key, label, type, options, required FROM quiz_fields ORDER BY sort_order, id',
  )
  res.json({ fields: rows })
})

// Chi tiết khóa học — KHÔNG trả correct_index để tránh lộ đáp án
coursesRouter.get('/:id', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT id, title, description, grp, video_url, duration, summary, pass_score
     FROM courses WHERE id = $1`,
    [req.params.id],
  )
  const course = rows[0]
  if (!course) return res.status(404).json({ error: 'Không tìm thấy khóa học.' })

  const questions = await query(
    'SELECT id, text, options FROM questions WHERE course_id = $1 ORDER BY sort_order, id',
    [req.params.id],
  )
  const progress = await query(
    'SELECT step, quiz_score, passed, cert_id, completed_at FROM progress WHERE user_id = $1 AND course_id = $2',
    [req.user!.id, req.params.id],
  )
  res.json({ course, questions: questions.rows, progress: progress.rows[0] ?? null })
})

// Cập nhật bước hiện tại (điều hướng 3 bước)
coursesRouter.post('/:id/step', requireAuth, async (req, res) => {
  const step = Number(req.body?.step)
  if (![1, 2, 3].includes(step)) return res.status(400).json({ error: 'Bước không hợp lệ.' })
  await query(
    `INSERT INTO progress (user_id, course_id, step) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, course_id) DO UPDATE SET step = GREATEST(progress.step, EXCLUDED.step), updated_at = now()`,
    [req.user!.id, req.params.id, step],
  )
  res.json({ ok: true })
})

// Nộp bài trắc nghiệm — CHẤM ĐIỂM & CẤP CHỨNG CHỈ PHÍA SERVER
coursesRouter.post('/:id/submit', requireAuth, async (req, res) => {
  const answers = req.body?.answers as Record<string, number> | undefined
  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'Thiếu bài làm.' })
  }
  const courseId = req.params.id

  // Xác thực + làm sạch thông tin học viên theo cấu hình quiz_fields
  const fieldRows = await query<{ field_key: string; label: string; type: string; options: string[]; required: boolean }>(
    'SELECT field_key, label, type, options, required FROM quiz_fields ORDER BY sort_order, id',
  )
  const rawInfo = (req.body?.traineeInfo ?? {}) as Record<string, unknown>
  const traineeInfo: Record<string, string> = {}
  for (const f of fieldRows.rows) {
    const value = String(rawInfo[f.field_key] ?? '').trim().slice(0, 200)
    if (f.required && !value) {
      return res.status(400).json({ error: `Vui lòng nhập "${f.label}".` })
    }
    if (f.type === 'select' && value && !f.options.includes(value)) {
      return res.status(400).json({ error: `Giá trị "${f.label}" không hợp lệ.` })
    }
    if (value) traineeInfo[f.field_key] = value
  }
  const courseRes = await query<{ pass_score: number; title: string }>(
    'SELECT pass_score, title FROM courses WHERE id = $1',
    [courseId],
  )
  const course = courseRes.rows[0]
  if (!course) return res.status(404).json({ error: 'Không tìm thấy khóa học.' })

  const qres = await query<{ id: number; correct_index: number }>(
    'SELECT id, correct_index FROM questions WHERE course_id = $1',
    [courseId],
  )
  const total = qres.rows.length
  if (total === 0) return res.status(400).json({ error: 'Khóa học chưa có câu hỏi.' })

  const correct = qres.rows.reduce(
    (acc, q) => acc + (Number(answers[String(q.id)]) === q.correct_index ? 1 : 0),
    0,
  )
  const score = Math.round((correct / total) * 100)
  const passed = score >= course.pass_score
  const certId = passed ? `ATLD-${courseId.toUpperCase()}-${Date.now().toString().slice(-6)}` : null

  await query(
    `INSERT INTO progress (user_id, course_id, step, quiz_score, passed, cert_id, trainee_info, completed_at)
     VALUES ($1, $2, 3, $3, $4, $5, $6, CASE WHEN $4 THEN now() ELSE NULL END)
     ON CONFLICT (user_id, course_id) DO UPDATE
       SET quiz_score = EXCLUDED.quiz_score, passed = EXCLUDED.passed,
           cert_id = EXCLUDED.cert_id, trainee_info = EXCLUDED.trainee_info,
           completed_at = EXCLUDED.completed_at, updated_at = now()`,
    [req.user!.id, courseId, score, passed, certId, JSON.stringify(traineeInfo)],
  )

  // Tên trên chứng chỉ ưu tiên họ tên khai báo, không có thì dùng tên tài khoản
  const traineeName = traineeInfo.full_name || req.user!.fullName

  res.json({
    score,
    passed,
    passScore: course.pass_score,
    certificate: passed
      ? {
          certId,
          traineeName,
          courseTitle: course.title,
          score,
          date: new Date().toLocaleDateString('vi-VN'),
        }
      : null,
  })
})
