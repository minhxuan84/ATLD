import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth, requireSection, siteScope } from '../auth.js'
import { findWorkersByTraineeIdentity } from '../lib/hse-training.js'
import { audit, clientIp, syncWorkerAccess } from '../lib/hse-core.js'
import { traineePhotoUpload } from '../lib/trainee-photo.js'
import { generateQuizPdfs, validateTraineeInfo } from '../lib/quiz-record.js'
import { resolveCertPdf } from '../lib/cert-store.js'
import { issueQuiz, gradeQuiz } from '../lib/quiz-grade.js'
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

  // Rút đề + xáo phương án qua issueQuiz: dùng chung với portal.ts (đường QR) để hai
  // lối vào không trôi lệch cách phát đề. `seed` phải gửi kèm và client gửi trả lại
  // khi nộp — xem ghi chú trong quiz-grade.ts về việc chấm đúng khi xáo phương án.
  const issued = issueQuiz(
    {
      questions_per_attempt: course.questions_per_attempt,
      randomize_options: course.randomize_options,
      pass_score: course.pass_score,
    },
    allQuestions.rows,
  )

  const progress = await query(
    `SELECT step, quiz_score, passed, cert_id, completed_at, expires_at
     FROM progress WHERE user_id = $1 AND course_id = $2`,
    [req.user!.id, req.params.id],
  )

  res.json({
    course,
    questions: issued.questions,
    questionIds: issued.questionIds, // Để client gửi lại khi submit
    seed: issued.seed,               // Client gửi lại khi nộp để chấm đúng phép xáo
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
  // validateTraineeInfo dùng chung với portal.ts (đường QR) — kể cả lớp kiểm stored_name
  // của trường ảnh, để đường không đăng nhập không lỏng hơn đường có đăng nhập.
  const checked = validateTraineeInfo(
    fieldRows.rows, (req.body?.traineeInfo ?? {}) as Record<string, unknown>)
  if ('error' in checked) return res.status(400).json({ error: checked.error })
  const traineeInfo = checked.info
  // randomize_options PHẢI đọc ở đây: trước Pha H6 endpoint này không đọc cột đó, nên
  // nó xáo phương án lúc phát đề mà lúc chấm hoàn toàn không biết đã xáo — đó chính là
  // chỗ bài bị chấm sai (xem ghi chú trong quiz-grade.ts).
  const courseRes = await query<{
    pass_score: number; title: string; validity_months: number | null; max_attempts: number
    randomize_options: boolean
  }>(
    `SELECT pass_score, title, validity_months, max_attempts, randomize_options
     FROM courses WHERE id = $1`,
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

  // Nếu có questionIds (đề ngẫu nhiên) thì chỉ chấm bộ đó, ngược lại chấm toàn bộ.
  // Lấy cả options để biết số phương án — gradeQuiz cần nó để dựng lại phép xáo và để
  // loại chỉ số nằm ngoài khoảng.
  const qres = await query<{ id: number; correct_index: number; options: string[] }>(
    questionIds && questionIds.length > 0
      ? `SELECT id, correct_index, options FROM questions WHERE course_id = $1 AND id = ANY($2::int[])`
      : 'SELECT id, correct_index, options FROM questions WHERE course_id = $1',
    questionIds && questionIds.length > 0 ? [courseId, questionIds] : [courseId],
  )
  const total = qres.rows.length
  if (total === 0) return res.status(400).json({ error: 'Khóa học chưa có câu hỏi.' })

  // Chấm qua gradeQuiz (dùng chung với đường QR). `seed` do client gửi lại từ lúc nhận
  // đề; thiếu seed thì coi như không xáo — bài làm đang mở trong trình duyệt lúc deploy
  // vẫn chấm được, chỉ là theo thứ tự gốc.
  const graded = gradeQuiz({
    randomizeOptions: Boolean(course.randomize_options),
    passScore: course.pass_score,
    seed: typeof req.body?.seed === 'string' ? req.body.seed : null,
    answers,
    questions: qres.rows.map((q) => ({
      id: q.id, correct_index: q.correct_index, option_count: q.options.length,
    })),
  })
  const { score, passScore, passed } = graded
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

  // Lưu attempt vào quiz_attempts. download_key sinh cho MỌI bài làm (kể cả trượt):
  // trượt thì không có chứng nhận, nhưng vẫn phải tải được bài làm để biết sai câu nào.
  const attemptKey = crypto.randomBytes(32).toString('hex')
  const attemptRes = await query<{ id: number }>(
    `INSERT INTO atld.quiz_attempts (user_id, course_id, question_ids, answers, score, passed,
      trainee_info, trainee_key, download_key, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now()) RETURNING id`,
    // Lưu normalizedAnswers (chỉ số GỐC), KHÔNG lưu chỉ số hiển thị: thứ tự hiển thị
    // chỉ sống trong một lần thi, lưu nó thì PDF bài làm và mọi lần xem lại đều sai.
    [req.user!.id, courseId, JSON.stringify(questionIds || []),
     JSON.stringify(graded.normalizedAnswers),
     score, passed, JSON.stringify(traineeInfo), traineeKey, attemptKey],
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

  // ── Pha H3/H4: tên và ảnh trên chứng nhận lấy theo VAI TRÒ của trường ─────
  // Tên: chỉ trường purpose='full_name'. Không có trường nào được đánh dấu thì mới
  // rơi về tên tài khoản — đường này chỉ có ở lối vào có đăng nhập, học viên quét QR
  // bắt buộc phải khai (xem portal.ts).
  // Ảnh: ưu tiên trường purpose='photo'; chưa đánh dấu thì lấy trường ảnh đầu tiên
  // để admin quên chọn vai trò không làm chứng nhận mất ảnh.
  const photoField = fieldRows.rows.find((f) => f.purpose === 'photo')
    ?? fieldRows.rows.find((f) => f.type === 'image')
  const photoStoredName = photoField ? (traineeInfo[photoField.field_key] ?? null) : null
  const nameField = fieldRows.rows.find((f) => f.purpose === 'full_name')
  const traineeName = (nameField ? traineeInfo[nameField.field_key] : '') || req.user!.fullName

  // ── Pha H3: ghi chứng nhận vào danh mục cho cán bộ tra cứu hồ sơ ──────────
  // download_key 32 byte: cert_id có Date.now() trong đó nên đoán được, không dùng
  // một mình làm cửa tải file.
  let downloadKey: string | null = null
  if (passed) {
    downloadKey = crypto.randomBytes(32).toString('hex')
    await query(
      `INSERT INTO atld.quiz_certificates
        (cert_id, course_id, attempt_id, user_id, trainee_name, trainee_info, photo_stored_name,
         score, passed, issued_at, expires_at, download_key, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10, $11, 'account')`,
      [certId, courseId, attemptId, req.user!.id, traineeName, JSON.stringify(traineeInfo),
       photoStoredName, score, true, expiresAt, downloadKey],
    )
  }

  // ── Pha H5: sinh 2 PDF. generateQuizPdfs tự bọc try/catch từng PDF — lỗi ghi
  // file không được làm học viên mất kết quả vừa chấm, tải lại sau vẫn được.
  const pdfs = await generateQuizPdfs({
    attemptId, certId, courseId, courseTitle: course.title,
    traineeName, traineeInfo,
    fieldLabels: Object.fromEntries(fieldRows.rows.map((f) => [f.field_key, f.label])),
    photoFieldKey: photoField?.field_key ?? null,
    photoStoredName,
    score, passed, passScore, expiresAt,
    questionIds: questionIds ?? [],
    // Chỉ số GỐC: PDF bài làm in options theo thứ tự trong DB, nên đáp án đã chọn
    // cũng phải là chỉ số trong thứ tự đó.
    answers: graded.normalizedAnswers,
  })

  res.json({
    score,
    passed,
    passScore,
    attempts_used: used + 1,
    max_attempts: maxAttempts,
    attempts_left: attemptsLeft,
    attempt_pdf: pdfs.detailPdf
      ? `/api/courses/attempts/${attemptId}/pdf?k=${attemptKey}`
      : null,
    certificate: passed
      ? {
          certId,
          traineeName,
          courseTitle: course.title,
          score,
          date: new Date().toLocaleDateString('vi-VN'),
          expiresAt,
          pdf_url: pdfs.certPdf
            ? `/api/courses/certificates/${encodeURIComponent(certId!)}/pdf?k=${downloadKey}`
            : null,
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

// ── Pha H5: phục vụ PDF bài làm và chứng nhận ─────────────────────────────
// Hai cửa cho cùng một file:
//   1. `?k=<download_key>` — học viên vừa thi xong, kể cả đường QR không có tài khoản.
//   2. JWT + requireSection('khoa-hoc') — cán bộ đào tạo tải lại bất cứ lúc nào.
// Một thông điệp lỗi duy nhất cho cả "không có bản ghi" và "khóa sai" (như BAD_TOKEN
// của portal.ts): cert_id đoán được, đừng để nó thành cách dò xem mã nào có thật.
const BAD_KEY = 'Liên kết tải tệp không hợp lệ hoặc đã hết hiệu lực.'

/** So khóa tải bằng timingSafeEqual — không so bằng `===` trên giá trị bí mật. */
function keyMatches(provided: unknown, expected: string | null | undefined): boolean {
  const a = String(provided ?? '')
  if (!expected || a.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(expected))
}

/** Gác cửa thứ hai: JWT hợp lệ + quyền mục khóa học. Tự trả 401/403 khi không đạt. */
function staffGate(req: Parameters<typeof requireAuth>[0], res: Parameters<typeof requireAuth>[1], ok: () => void) {
  requireAuth(req, res, () => requireSection('khoa-hoc')(req, res, ok))
}

/** Cán bộ gán site chỉ tải được PDF khi khóa học HOẶC học viên thuộc site mình. */
async function pdfInScope(req: Parameters<typeof requireAuth>[0], table: 'cert' | 'attempt', key: string | number) {
  const { all, siteId } = siteScope(req.user!)
  if (all) return true
  const sql = table === 'cert'
    ? `SELECT 1 FROM atld.quiz_certificates x JOIN atld.courses co ON co.id = x.course_id
       LEFT JOIN atld.users u ON u.id = x.user_id
       WHERE x.cert_id = $1 AND (co.branch_id = $2 OR u.site_id = $2)`
    : `SELECT 1 FROM atld.quiz_attempts x JOIN atld.courses co ON co.id = x.course_id
       LEFT JOIN atld.users u ON u.id = x.user_id
       WHERE x.id = $1 AND (co.branch_id = $2 OR u.site_id = $2)`
  const r = await query(sql, [key, siteId])
  return r.rows.length > 0
}

/** Gửi file PDF sau khi kiểm lại đường dẫn nằm trong CERT_DIR. */
function sendCertPdf(res: Parameters<typeof requireAuth>[1], storedName: unknown, downloadName: string) {
  const filePath = resolveCertPdf(storedName)
  if (!filePath) {
    return res.status(404).json({ error: 'Tệp PDF chưa được tạo hoặc không còn trên hệ thống.' })
  }
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${downloadName}"`)
  res.sendFile(filePath)
}

coursesRouter.get('/certificates/:certId/pdf', async (req, res) => {
  const { rows } = await query<{ cert_pdf: string | null; download_key: string; cert_id: string }>(
    'SELECT cert_pdf, download_key, cert_id FROM atld.quiz_certificates WHERE cert_id = $1',
    [req.params.certId],
  )
  const cert = rows[0]

  // Có gửi `k` thì chỉ xét `k`: sai là 403 ngay, không rơi về cửa cán bộ (gửi `k` sai
  // kèm JWT hợp lệ vẫn vào được qua cửa 2 — nhưng phải bỏ `k` ra, để lỗi nói đúng việc).
  if (req.query.k !== undefined) {
    if (!cert || !keyMatches(req.query.k, cert.download_key)) {
      return res.status(403).json({ error: BAD_KEY })
    }
    return sendCertPdf(res, cert.cert_pdf, `chung-nhan-${cert.cert_id}.pdf`)
  }

  staffGate(req, res, async () => {
    try {
      if (!cert || !(await pdfInScope(req, 'cert', cert.cert_id))) {
        return res.status(404).json({ error: 'Không tìm thấy chứng nhận.' })
      }
      sendCertPdf(res, cert.cert_pdf, `chung-nhan-${cert.cert_id}.pdf`)
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
    }
  })
})

coursesRouter.get('/attempts/:id/pdf', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 1) return res.status(403).json({ error: BAD_KEY })

  const { rows } = await query<{ detail_pdf: string | null; download_key: string | null }>(
    'SELECT detail_pdf, download_key FROM atld.quiz_attempts WHERE id = $1',
    [id],
  )
  const attempt = rows[0]

  if (req.query.k !== undefined) {
    if (!attempt || !keyMatches(req.query.k, attempt.download_key)) {
      return res.status(403).json({ error: BAD_KEY })
    }
    return sendCertPdf(res, attempt.detail_pdf, `bai-lam-${id}.pdf`)
  }

  staffGate(req, res, async () => {
    try {
      if (!attempt || !(await pdfInScope(req, 'attempt', id))) {
        return res.status(404).json({ error: 'Không tìm thấy bài làm.' })
      }
      sendCertPdf(res, attempt.detail_pdf, `bai-lam-${id}.pdf`)
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
    }
  })
})
