/**
 * Sinh PDF bài làm + chứng nhận sau khi chấm, dùng chung cho hai lối vào (Pha H5).
 *
 * Tách ra khỏi courses.ts vì portal.ts (học viên quét QR, Pha H6) phải ra đúng cùng
 * một bộ PDF — để hai bên tự dựng là sẽ trôi lệch bố cục và lệch cả chỗ lưu file.
 *
 * Nguyên tắc: lỗi sinh PDF KHÔNG được làm mất kết quả vừa chấm. Hàm này tự bọc
 * try/catch, ghi log rồi trả về những gì làm được — bài làm và chứng nhận đã vào DB
 * từ trước, tải lại sau vẫn được (xem endpoint regenerate ở courses.ts).
 */
import { query } from '../db.js'
import { buildAttemptPdf, buildCertificatePdf } from './pdf.js'
import type { AttemptPdfQuestion } from './pdf.js'
import { writeCertPdf } from './cert-store.js'
import { resolveTraineePhoto } from './trainee-photo.js'

export interface QuizPdfInput {
  attemptId: number
  certId: string | null
  courseTitle: string
  traineeName: string
  traineeInfo: Record<string, string>
  /** Nhãn hiển thị theo field_key, để PDF ghi "Họ và tên: ..." chứ không phải "hovaten: ..." */
  fieldLabels: Record<string, string>
  /** field_key của trường ảnh — bỏ khỏi bảng thông tin trong PDF bài làm vì giá trị
   *  là stored_name (uuid.png), in ra không có nghĩa. Null nếu form không có trường ảnh. */
  photoFieldKey: string | null
  photoStoredName: string | null
  score: number
  passed: boolean
  passScore: number
  expiresAt: string | null
  /** Câu hỏi đã phát cho lần thi này; rỗng thì chấm toàn bộ khóa. */
  questionIds: number[]
  courseId: string
  answers: Record<string, number>
}

export interface QuizPdfResult {
  detailPdf: string | null
  certPdf: string | null
}

/**
 * Dựng cả hai PDF, ghi ra đĩa và cập nhật `quiz_attempts.detail_pdf` /
 * `quiz_certificates.cert_pdf`. Chỉ sinh chứng nhận khi `passed` và có `certId`.
 */
export async function generateQuizPdfs(input: QuizPdfInput): Promise<QuizPdfResult> {
  const out: QuizPdfResult = { detailPdf: null, certPdf: null }

  // ── Bài làm chi tiết ──
  try {
    const qres = await query<{ id: number; text: string; options: string[]; correct_index: number }>(
      input.questionIds.length > 0
        ? `SELECT id, text, options, correct_index FROM questions
           WHERE course_id = $1 AND id = ANY($2::int[]) ORDER BY sort_order, id`
        : `SELECT id, text, options, correct_index FROM questions
           WHERE course_id = $1 ORDER BY sort_order, id`,
      input.questionIds.length > 0 ? [input.courseId, input.questionIds] : [input.courseId],
    )

    const questions: AttemptPdfQuestion[] = qres.rows.map((q) => {
      const raw = input.answers[String(q.id)]
      const picked = Number.isInteger(raw) ? Number(raw) : null
      return {
        text: q.text,
        options: q.options,
        correctIndex: q.correct_index,
        // Chỉ nhận chỉ số nằm trong khoảng options; ngoài khoảng coi như không trả lời.
        userAnswer: picked !== null && picked >= 0 && picked < q.options.length ? picked : null,
      }
    })

    // Đổi field_key thành nhãn người đọc hiểu; khóa nào không có nhãn thì giữ nguyên.
    const labelled: Record<string, string> = {}
    for (const [k, v] of Object.entries(input.traineeInfo)) {
      // Giá trị ảnh là stored_name (uuid.png) — in ra PDF không có nghĩa gì, bỏ.
      if (k === input.photoFieldKey) continue
      labelled[input.fieldLabels[k] ?? k] = v
    }

    const buf = await buildAttemptPdf({
      attemptId: input.attemptId,
      courseTitle: input.courseTitle,
      traineeInfo: labelled,
      score: input.score,
      passed: input.passed,
      passScore: input.passScore,
      submittedAt: new Date().toISOString(),
      questions,
    })
    out.detailPdf = await writeCertPdf(buf)
    await query('UPDATE atld.quiz_attempts SET detail_pdf = $1 WHERE id = $2',
      [out.detailPdf, input.attemptId])
  } catch (e) {
    console.error('[quiz pdf: attempt]', e)
  }

  // ── Chứng nhận (chỉ khi đạt) ──
  if (input.passed && input.certId) {
    try {
      // Kiểm lại stored_name trước khi nhúng: giá trị gốc đến từ client.
      const photoPath = resolveTraineePhoto(input.photoStoredName)
      const buf = await buildCertificatePdf({
        certId: input.certId,
        courseTitle: input.courseTitle,
        traineeName: input.traineeName,
        score: input.score,
        issuedAt: new Date().toISOString(),
        expiresAt: input.expiresAt,
        photoPath,
      })
      out.certPdf = await writeCertPdf(buf)
      await query('UPDATE atld.quiz_certificates SET cert_pdf = $1 WHERE cert_id = $2',
        [out.certPdf, input.certId])
    } catch (e) {
      console.error('[quiz pdf: certificate]', e)
    }
  }

  return out
}
