/**
 * Phát đề và chấm điểm — dùng chung cho hai lối vào (Pha H6).
 *
 * courses.ts (học viên có tài khoản) và portal.ts (học viên quét QR) phải phát đề và
 * chấm GIỐNG NHAU. Để mỗi bên tự viết là sẽ trôi lệch: một bên sửa cách rút đề hay
 * cách clamp pass_score, bên kia không biết.
 *
 * ── Vì sao có `seed` ──
 * Trước đây `randomize_options` xáo trộn mảng options rồi gửi cho client, client ghi
 * đáp án theo chỉ số TRONG MẢNG ĐÃ XÁO, còn lúc chấm lại so với `correct_index` là vị
 * trí trong thứ tự GỐC của DB. Không chỗ nào ghi lại phép xáo, nên hai chỉ số trỏ vào
 * hai đáp án khác nhau — khóa nào bật randomize_options là chấm sai.
 *
 * Cách sửa: phép xáo sinh từ một `seed` tường minh, thay cho Math.random(). Server gửi
 * seed kèm đề, client gửi seed trả lại khi nộp, server dựng lại ĐÚNG phép xáo đó và
 * đổi chỉ số đã xáo về chỉ số gốc trước khi so với correct_index. Không cần lưu phép
 * xáo ở đâu (không có bảng trạng thái giữa GET và POST), và hai lối vào dùng cùng hàm
 * nên không thể lệch nhau.
 */
import crypto from 'node:crypto'

/** PRNG tất định (mulberry32) — cùng seed cho ra cùng dãy số trên mọi tiến trình. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Phép xáo của MỘT câu hỏi: mảng vị trí gốc theo thứ tự hiển thị.
 * perm[i] = chỉ số gốc của phương án hiển thị ở vị trí i.
 *
 * Trộn seed với id câu hỏi để hai câu trong cùng một đề không xáo giống nhau, nhưng
 * vẫn dựng lại được từ (seed, questionId) lúc chấm.
 */
function permutation(seed: string, questionId: number, n: number): number[] {
  const h = crypto.createHash('sha256').update(`${seed}:${questionId}`).digest()
  const rand = rng(h.readUInt32BE(0))
  const perm = Array.from({ length: n }, (_, i) => i)
  // Fisher-Yates — không dùng sort(() => Math.random() - 0.5): so sánh không nhất quán
  // cho ra phân phối lệch và không tất định.
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[perm[i], perm[j]] = [perm[j], perm[i]]
  }
  return perm
}

/** Sinh seed mới cho một lần phát đề. */
export const newSeed = () => crypto.randomBytes(12).toString('base64url')

export interface QuizCourseConfig {
  questions_per_attempt: number | null
  randomize_options: boolean
  pass_score: number
}

export interface QuizQuestionRow {
  id: number
  text: string
  options: string[]
}

/** Đề đã phát: câu hỏi theo thứ tự hiển thị, KHÔNG kèm correct_index. */
export interface IssuedQuiz {
  seed: string
  questions: QuizQuestionRow[]
  questionIds: number[]
}

/**
 * Rút đề: chọn N câu (nếu questions_per_attempt > 0) và xáo phương án theo seed.
 *
 * Việc chọn N câu nào cũng đi qua seed để lúc chấm biết chắc đề gồm những câu nào —
 * nhưng client vẫn gửi questionIds về như trước, nên đây chỉ là để hai lần gọi cùng
 * seed ra cùng đề (tiện cho kiểm thử), không phải cơ chế xác thực.
 */
export function issueQuiz(
  course: QuizCourseConfig,
  all: QuizQuestionRow[],
  seed = newSeed(),
): IssuedQuiz {
  let picked = all
  const perAttempt = Number(course.questions_per_attempt ?? 0)
  if (perAttempt > 0 && all.length > perAttempt) {
    const order = permutation(seed, 0, all.length)
    picked = order.slice(0, perAttempt).map((i) => all[i])
  }

  const questions = course.randomize_options
    ? picked.map((q) => ({
        ...q,
        options: permutation(seed, q.id, q.options.length).map((i) => q.options[i]),
      }))
    : picked

  return { seed, questions, questionIds: picked.map((q) => q.id) }
}

export interface GradeInput {
  randomizeOptions: boolean
  passScore: number
  seed: string | null
  /** Đáp án client gửi: khóa là id câu hỏi dạng chuỗi, giá trị là chỉ số ĐÃ HIỂN THỊ. */
  answers: Record<string, number>
  questions: Array<{ id: number; correct_index: number; option_count: number }>
}

export interface GradeResult {
  total: number
  correct: number
  score: number
  passScore: number
  passed: boolean
  /** Đáp án đã đổi về chỉ số GỐC — đây là thứ lưu vào DB và in ra PDF bài làm. */
  normalizedAnswers: Record<string, number>
}

/**
 * Chấm bài. Khi randomize_options bật, đổi chỉ số đã hiển thị về chỉ số gốc bằng
 * đúng phép xáo của seed trước khi so với correct_index.
 *
 * Lưu `normalizedAnswers` chứ không lưu chỉ số hiển thị: thứ tự hiển thị chỉ sống
 * trong một lần thi, lưu nó thì PDF bài làm và mọi lần xem lại sau đều hiểu sai.
 */
export function gradeQuiz(input: GradeInput): GradeResult {
  const normalizedAnswers: Record<string, number> = {}
  let correct = 0

  for (const q of input.questions) {
    const raw = input.answers[String(q.id)]
    const shown = Number.isInteger(raw) ? Number(raw) : null
    if (shown === null || shown < 0 || shown >= q.option_count) continue

    // Không xáo, hoặc không có seed (đề phát trước khi có seed) → chỉ số đã là gốc.
    const original = input.randomizeOptions && input.seed
      ? permutation(input.seed, q.id, q.option_count)[shown]
      : shown

    normalizedAnswers[String(q.id)] = original
    if (original === q.correct_index) correct++
  }

  const total = input.questions.length
  const score = total > 0 ? Math.round((correct / total) * 100) : 0
  const passScore = Math.max(0, Math.min(100, input.passScore))  // Clamp 0–100
  return { total, correct, score, passScore, passed: score >= passScore, normalizedAnswers }
}
