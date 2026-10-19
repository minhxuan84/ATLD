import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth } from '../auth.js'
import { findWorkersByTraineeIdentity } from '../lib/hse-training.js'
import { audit, clientIp, syncWorkerAccess } from '../lib/hse-core.js'
import { traineePhotoUpload, isTraineePhotoName } from '../lib/trainee-photo.js'
import crypto from 'node:crypto'

export const coursesRouter = Router()

// Danh sách khóa học (kèm tiến độ của user hiện tại nếu đã đăng nhập)
coursesRouter.get('/', requireAuth, async (req, res) => {
  const courses = await query(
    `SELECT c.id, c.title, c.description, c.grp, c.branch_id, b.name AS branch_name,
            c.video_url, c.duration, c.summary, c.pass_score, c.validity_months,
            c.max_attempts,
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
    'SELECT field_key, label, type, options, required, purpose FROM quiz_fields ORDER BY sort_order, id',
  )
  res.json({ fields: rows })
})

// Ảnh học viên cho trường loại 'image' (Pha H2). Trả về stored_name; client gửi lại giá
// trị đó trong traineeInfo[field_key] khi nộp bài. Server kiểm lại tên này trước khi
// nhúng vào PDF (xem resolveTraineePhoto) — không tin giá trị client gửi lên.
coursesRouter.post('/:id/trainee-photo', requireAuth, traineePhotoUpload.single('file'), (req, res) => {
  // multer đã loại file sai định dạng bằng cách bỏ file, nên req.file trống gộp cả hai
  // lý do: không chọn ảnh, hoặc ảnh sai định dạng.
  if (!req.file) return res.status(400).json({ error: 'Vui lòng chọn ảnh PNG, JPG hoặc WEBP (tối đa 4MB).' })
  res.status(201).json({ stored_name: req.file.filename })
})

// Chi tiết khóa học — KHÔNG trả correct_index để tránh lộ đáp án
coursesRouter.get('/:id', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT id, title, description, grp, video_url, duration, summary, pass_score,
            questions_per_attempt, validity_months, randomize_options, max_attempts
     FROM courses WHERE id = $1`,
    [req.params.id],
  )
  const course = rows[0]
  if (!course) return res.status(404).json({ error: 'Không tìm thấy khóa học.' })

  // Số lần đã dùng để UI báo trước còn mấy lần, thay vì để học viên làm xong mới bị 403.
  const usedRes = await query<{ n: string }>(
    `SELECT count(*)::int AS n FROM atld.quiz_attempts
     WHERE user_id = $1 AND course_id = $2 AND submitted_at IS NOT NULL`,
    [req.user!.id, req.params.id],
  )
  const attemptsUsed = Number(usedRes.rows[0]?.n ?? 0)
  const maxAttempts = Number(course.max_attempts ?? 0)

  // Lấy tất cả câu hỏi (để biết tổng số)
  const allQuestions = await query<{ id: number; text: string; options: string[] }>(
    'SELECT id, text, options FROM questions WHERE course_id = $1 ORDER BY sort_order, id',
    [req.params.id],
  )

  // Nếu questions_per_attempt > 0 thì rút ngẫu nhiên, ngược lại trả hết
  const questionsPerAttempt = course.questions_per_attempt || 0
  let selectedQuestions = allQuestions.rows

  if (questionsPerAttempt > 0 && allQuestions.rows.length > questionsPerAttempt) {
    // Rút ngẫu nhiên N câu
    const shuffled = [...allQuestions.rows].sort(() => Math.random() - 0.5)
    selectedQuestions = shuffled.slice(0, questionsPerAttempt)
  }

  // Nếu randomize_options = true thì xáo trộn thứ tự options (chỉ UI, correct_index không trả về)
  if (course.randomize_options) {
    selectedQuestions = selectedQuestions.map((q) => ({
      ...q,
      options: [...q.options].sort(() => Math.random() - 0.5),
    }))
  }

  const progress = await query(
    `SELECT step, quiz_score, passed, cert_id, completed_at, expires_at
     FROM progress WHERE user_id = $1 AND course_id = $2`,
    [req.user!.id, req.params.id],
  )

  res.json({
    course,
    questions: selectedQuestions,
    questionIds: selectedQuestions.map((q) => q.id), // Để client gửi lại khi submit
    progress: progress.rows[0] ?? null,
    attempts_used: attemptsUsed,
    max_attempts: maxAttempts,
    attempts_left: maxAttempts > 0 ? Math.max(0, maxAttempts - attemptsUsed) : null,
  })
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
  const questionIds = req.body?.questionIds as number[] | undefined // Câu hỏi được phát cho attempt này
  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'Thiếu bài làm.' })
  }
  const courseId = req.params.id

  // Xác thực + làm sạch thông tin học viên theo cấu hình quiz_fields
  const fieldRows = await query<{ field_key: string; label: string; type: string; options: string[]; required: boolean; purpose: string }>(
    'SELECT field_key, label, type, options, required, purpose FROM quiz_fields ORDER BY sort_order, id',
  )
  const rawInfo = (req.body?.traineeInfo ?? {}) as Record<string, unknown>
  const traineeInfo: Record<string, string> = {}
  for (const f of fieldRows.rows) {
    const value = String(rawInfo[f.field_key] ?? '').trim().slice(0, 200)
    if (f.required && !value) {
      return res.status(400).json({ error: `Vui lòng ${f.type === 'image' ? 'tải lên' : 'nhập'} "${f.label}".` })
    }
    if (f.type === 'select' && value && !f.options.includes(value)) {
      return res.status(400).json({ error: `Giá trị "${f.label}" không hợp lệ.` })
    }
    // Trường ảnh chỉ chứa stored_name do endpoint upload sinh ra. Kiểm ngay tại đây để
    // một giá trị bịa (vd '../../../etc/passwd') bị chặn ở cửa nộp bài, không đi tiếp
    // vào DB rồi chờ tới lúc dựng PDF mới phát hiện.
    if (f.type === 'image' && value && !isTraineePhotoName(value)) {
      return res.status(400).json({ error: `Ảnh "${f.label}" không hợp lệ. Vui lòng tải lại ảnh.` })
    }
    if (value) traineeInfo[f.field_key] = value
  }
  const courseRes = await query<{
    pass_score: number; title: string; validity_months: number | null; max_attempts: number
  }>(
    'SELECT pass_score, title, validity_months, max_attempts FROM courses WHERE id = $1',
    [courseId],
  )
  const course = courseRes.rows[0]
  if (!course) return res.status(404).json({ error: 'Không tìm thấy khóa học.' })

  // ── Pha E4: giới hạn số lần thi (bước 3) ──────────────────────────────────
  // Đếm theo user_id vì quiz_attempts chỉ có cột đó. Hệ quả cần biết: nếu nhà thầu
  // cho nhiều người thi bằng một tài khoản thì số lần dùng chung. Muốn tách theo
  // từng người phải cấp tài khoản riêng.
  const maxAttempts = Number(course.max_attempts ?? 0)
  const usedRes = await query<{ n: string }>(
    `SELECT count(*)::int AS n FROM atld.quiz_attempts
     WHERE user_id = $1 AND course_id = $2 AND submitted_at IS NOT NULL`,
    [req.user!.id, courseId],
  )
  const used = Number(usedRes.rows[0]?.n ?? 0)
  // Chặn TRƯỚC khi chấm: chấm rồi mới chặn thì vẫn lộ kết quả và vẫn ghi attempt.
  if (maxAttempts > 0 && used >= maxAttempts) {
    return res.status(403).json({
      error: `Đã hết số lần làm bài cho phép (${maxAttempts} lần). `
        + 'Liên hệ cán bộ ATVSLĐ để được xem xét.',
      attempts_used: used, max_attempts: maxAttempts,
    })
  }

  // Nếu có questionIds (đề ngẫu nhiên) thì chỉ chấm bộ đó, ngược lại chấm toàn bộ
  const qres = await query<{ id: number; correct_index: number }>(
    questionIds && questionIds.length > 0
      ? `SELECT id, correct_index FROM questions WHERE course_id = $1 AND id = ANY($2::int[])`
      : 'SELECT id, correct_index FROM questions WHERE course_id = $1',
    questionIds && questionIds.length > 0 ? [courseId, questionIds] : [courseId],
  )
  const total = qres.rows.length
  if (total === 0) return res.status(400).json({ error: 'Khóa học chưa có câu hỏi.' })

  const correct = qres.rows.reduce(
    (acc, q) => acc + (Number(answers[String(q.id)]) === q.correct_index ? 1 : 0),
    0,
  )
  const score = Math.round((correct / total) * 100)
  const passScore = Math.max(0, Math.min(100, course.pass_score)) // Clamp 0–100
  const passed = score >= passScore
  const certId = passed ? `ATLD-${courseId.toUpperCase()}-${Date.now().toString().slice(-6)}` : null

  // Tính expires_at nếu passed và có validity_months
  const expiresAt =
    passed && course.validity_months
      ? new Date(Date.now() + course.validity_months * 30.44 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
      : null

  // ── Pha H3: trainee_key để đếm số lần thi theo CCCD qua QR ────────────────
  // Lấy trường có purpose='id_number' để băm. Không có thì trainee_key để null —
  // giới hạn max_attempts cho học viên QR rơi về max_uses của token (đếm theo link).
  const idField = fieldRows.rows.find((f) => f.purpose === 'id_number')
  const idNumber = idField ? traineeInfo[idField.field_key] : null
  const traineeKey = idNumber
    ? crypto.createHash('sha256').update(idNumber.trim().toLowerCase(), 'utf8').digest('hex')
    : null

  // Lưu attempt vào quiz_attempts
  const attemptRes = await query<{ id: number }>(
    `INSERT INTO atld.quiz_attempts (user_id, course_id, question_ids, answers, score, passed,
      trainee_info, trainee_key, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now()) RETURNING id`,
    [req.user!.id, courseId, JSON.stringify(questionIds || []), JSON.stringify(answers),
     score, passed, JSON.stringify(traineeInfo), traineeKey],
  )
  const attemptId = attemptRes.rows[0].id

  // Cập nhật progress: chỉ ghi đè khi passed hoặc chưa có passed trước đó
  // (tránh xóa lần đạt cũ khi thi lại trượt)
  const currentProgress = await query<{ passed: boolean }>(
    'SELECT passed FROM progress WHERE user_id = $1 AND course_id = $2',
    [req.user!.id, courseId],
  )
  const shouldUpdate = passed || !currentProgress.rows[0]?.passed

  if (shouldUpdate) {
    await query(
      `INSERT INTO progress (user_id, course_id, step, quiz_score, passed, cert_id, trainee_info, completed_at, expires_at)
       VALUES ($1, $2, 3, $3, $4, $5, $6, CASE WHEN $4 THEN now() ELSE NULL END, $7)
       ON CONFLICT (user_id, course_id) DO UPDATE
         SET quiz_score = EXCLUDED.quiz_score, passed = EXCLUDED.passed,
             cert_id = EXCLUDED.cert_id, trainee_info = EXCLUDED.trainee_info,
             completed_at = EXCLUDED.completed_at, expires_at = EXCLUDED.expires_at, updated_at = now()`,
      [req.user!.id, courseId, score, passed, certId, JSON.stringify(traineeInfo), expiresAt],
    )
  }

  // ── Pha E4 (bước 11): hết số lần mà vẫn chưa đạt → từ chối cấp quyền vào nhà máy.
  // Chỉ chạy đúng lần cuối cùng và chỉ khi trượt; đạt ở lần cuối thì không có gì để
  // từ chối. Bọc try/catch riêng: hồ sơ NLĐ là phần phụ của việc nộp bài, lỗi ở đây
  // không được làm học viên mất kết quả vừa chấm.
  const attemptsLeft = maxAttempts > 0 ? Math.max(0, maxAttempts - (used + 1)) : null
  if (!passed && maxAttempts > 0 && used + 1 >= maxAttempts) {
    try {
      const workerIds = await findWorkersByTraineeIdentity(
        req.user!.id, traineeInfo.cccd ?? traineeInfo.id_number ?? null)
      for (const wid of workerIds) {
        // Không ghi đè quyết định đã có của cán bộ ('approved' do người ký, hoặc
        // 'rejected' với lý do khác). Chỉ hạ hồ sơ còn đang chờ/bị trả lại.
        const upd = await query<{ id: number }>(
          `UPDATE atld.hse_workers
           SET entry_approval_status = 'rejected',
               entry_approval_note = $1, entry_approved_at = now(), updated_at = now()
           WHERE id = $2 AND entry_approval_status IN ('pending','returned')
             AND access_status <> 'revoked'
           RETURNING id`,
          [`Không đạt bài kiểm tra "${course.title}" sau ${maxAttempts} lần làm bài.`, wid])
        if (!upd.rows[0]) continue
        await audit(req.user!, 'WORKER_ENTRY_REJECT_QUIZ', 'worker', wid, null,
          { courseId, attempts: used + 1, maxAttempts, score }, clientIp(req))
        await syncWorkerAccess(wid)
      }
    } catch (e) {
      console.error('[quiz max_attempts → entry_approval]', e)
    }
  }

  // ── Pha H3: ghi chứng nhận vào danh mục cho cán bộ tra cứu hồ sơ ──────────
  if (passed) {
    const photoField = fieldRows.rows.find((f) => f.purpose === 'photo')
    const photoStoredName = photoField ? (traineeInfo[photoField.field_key] ?? null) : null
    const nameField = fieldRows.rows.find((f) => f.purpose === 'full_name')
    const traineeName = nameField ? traineeInfo[nameField.field_key] : req.user!.fullName
    const downloadKey = crypto.randomBytes(32).toString('hex')

    await query(
      `INSERT INTO atld.quiz_certificates
        (cert_id, course_id, attempt_id, user_id, trainee_name, trainee_info, photo_stored_name,
         score, passed, issued_at, expires_at, download_key, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10, $11, 'account')`,
      [certId, courseId, attemptId, req.user!.id, traineeName, JSON.stringify(traineeInfo),
       photoStoredName, score, true, expiresAt, downloadKey],
    )
  }

  // Tên trên chứng chỉ ưu tiên họ tên khai báo, không có thì dùng tên tài khoản
  const traineeName = traineeInfo.full_name || req.user!.fullName

  res.json({
    score,
    passed,
    passScore,
    attempts_used: used + 1,
    max_attempts: maxAttempts,
    attempts_left: attemptsLeft,
    certificate: passed
      ? {
          certId,
          traineeName,
          courseTitle: course.title,
          score,
          date: new Date().toLocaleDateString('vi-VN'),
          expiresAt,
        }
      : null,
  })
})

// Lịch sử thi của user hiện tại cho một khóa học
coursesRouter.get('/:id/attempts', requireAuth, async (req, res) => {
  const attempts = await query(
    `SELECT id, question_ids, score, passed, started_at, submitted_at
     FROM atld.quiz_attempts
     WHERE user_id = $1 AND course_id = $2
     ORDER BY submitted_at DESC NULLS LAST, started_at DESC
     LIMIT 20`,
    [req.user!.id, req.params.id],
  )
  res.json({ attempts: attempts.rows })
})
