// Đối chiếu khóa học JSA với chứng chỉ đã cấp theo CCCD, không theo họ tên.
import { query } from '../db.js'

export interface RequiredCourse {
  id: string; title: string; pass_score: number
}
export interface CourseCertificate extends RequiredCourse {
  status: 'valid' | 'expired' | 'not_passed' | 'missing' | 'missing_identity'
  cert_id: string | null; quiz_score: number | null
  completed_at: string | null; expires_at: string | null
}
export interface TrainingCheck {
  work_type_id: number
  courses: RequiredCourse[]
  workers: Array<{
    id: number; full_name: string; id_number: string | null
    ok: boolean; courses: CourseCertificate[]
  }>
  ok: boolean
}

// Chỉ bỏ dấu phân cách; giữ nguyên chữ số 0 đầu CCCD và chữ cái hộ chiếu.
const identitySql = (value: string) => `NULLIF(regexp_replace(upper(COALESCE(${value}, '')), '[[:space:].-]', '', 'g'), '')`

export async function checkWorkerTraining(workTypeId: number, workerIds: number[], runQuery: typeof query = query): Promise<TrainingCheck> {
  const courses = await runQuery<RequiredCourse>(
    `SELECT c.id, c.title, c.pass_score FROM atld.jsa_work_type_courses wc
     JOIN atld.courses c ON c.id = wc.course_id
     WHERE wc.work_type_id = $1 ORDER BY c.title, c.id`, [workTypeId])
  const workers = await runQuery<{ id: number; full_name: string; id_number: string | null }>(
    `SELECT id, full_name, id_number FROM atld.hse_workers WHERE id = ANY($1::int[])
     ORDER BY full_name, id`, [workerIds])
  const certificates = courses.rows.length && workers.rows.length ? await runQuery<{
    worker_id: number; course_id: string; has_identity: boolean
    passed: boolean | null; cert_id: string | null; quiz_score: number | null
    completed_at: string | null; expires_at: string | null; valid: boolean
  }>(
    `SELECT w.id AS worker_id, c.id AS course_id,
            ${identitySql('w.id_number')} IS NOT NULL AS has_identity,
            p.passed, p.cert_id, p.quiz_score, p.completed_at, p.expires_at,
            COALESCE(p.valid, false) AS valid
     FROM atld.hse_workers w
     CROSS JOIN atld.courses c
     LEFT JOIN LATERAL (
       SELECT pr.passed, pr.cert_id, pr.quiz_score, pr.completed_at, pr.expires_at,
              (pr.passed AND NULLIF(trim(pr.cert_id), '') IS NOT NULL
               AND pr.completed_at IS NOT NULL
               AND (pr.expires_at IS NULL OR pr.expires_at >= CURRENT_DATE)) AS valid
       FROM atld.progress pr JOIN atld.users u ON u.id = pr.user_id
       WHERE pr.course_id = c.id
         AND COALESCE(${identitySql("pr.trainee_info->>'cccd'")},
                      ${identitySql("pr.trainee_info->>'id_number'")},
                      ${identitySql('u.id_number')}) = ${identitySql('w.id_number')}
       ORDER BY valid DESC, pr.passed DESC, pr.completed_at DESC NULLS LAST, pr.id DESC
       LIMIT 1
     ) p ON true
     WHERE w.id = ANY($1::int[]) AND c.id = ANY($2::text[])`,
    [workerIds, courses.rows.map((c) => c.id)],
  ) : { rows: [] }
  const byWorkerCourse = new Map(certificates.rows.map((p) => [`${p.worker_id}:${p.course_id}`, p]))
  const results = workers.rows.map((w) => {
    const checked = courses.rows.map((c): CourseCertificate => {
      const p = byWorkerCourse.get(`${w.id}:${c.id}`)
      const status: CourseCertificate['status'] = !p?.has_identity ? 'missing_identity'
        : p.valid ? 'valid'
        : p.passed && p.cert_id && p.completed_at ? 'expired'
        : p.passed === false ? 'not_passed' : 'missing'
      return { ...c, status, cert_id: p?.cert_id ?? null, quiz_score: p?.quiz_score ?? null,
        completed_at: p?.completed_at ?? null, expires_at: p?.expires_at ?? null }
    })
    return { ...w, ok: checked.every((c) => c.status === 'valid'), courses: checked }
  })
  return { work_type_id: workTypeId, courses: courses.rows, workers: results,
    ok: courses.rows.length === 0 || (results.length > 0 && results.every((w) => w.ok)) }
}

/**
 * Tìm hồ sơ NLĐ ứng với một người đi thi (Pha E4, bước 11).
 *
 * Nối qua CCCD như checkWorkerTraining, KHÔNG qua user_id: hse_workers không có cột
 * user_id, và NLĐ nhà thầu thường thi bằng tài khoản dùng chung. Ưu tiên CCCD khai
 * trong bài thi, không có thì lấy từ tài khoản.
 *
 * Trả về mảng vì id_number không UNIQUE trong hse_workers.
 */
export async function findWorkersByTraineeIdentity(
  userId: number,
  traineeIdNumber: string | null,
  runQuery: typeof query = query,
): Promise<number[]> {
  const r = await runQuery<{ id: number }>(
    `SELECT w.id FROM atld.hse_workers w
     WHERE ${identitySql('w.id_number')} IS NOT NULL
       AND ${identitySql('w.id_number')} = COALESCE(
             ${identitySql('$2::text')},
             (SELECT ${identitySql('u.id_number')} FROM atld.users u WHERE u.id = $1))
     ORDER BY w.id`,
    [userId, traineeIdNumber ?? null],
  )
  return r.rows.map((x) => x.id)
}

export interface TrainingRecord {
  course_id: string; course_title: string; grp: string | null
  passed: boolean; quiz_score: number | null; pass_score: number
  cert_id: string | null; completed_at: string | null
  expires_at: string | null; validity_months: number | null
  status: 'valid' | 'expired' | 'not_passed' | 'in_progress'
  days_left: number | null
}

// Lịch sử huấn luyện ATLĐ của một NLĐ — toàn bộ khóa đã học, không giới hạn loại công việc.
// Nối qua CCCD như checkWorkerTraining (ưu tiên trainee_info rồi users.id_number) vì
// NLĐ nhà thầu học bằng tài khoản nào thì hồ sơ vẫn phải gom về đúng người.
export async function getWorkerTrainingHistory(
  workerId: number,
  runQuery: typeof query = query,
): Promise<TrainingRecord[]> {
  const r = await runQuery<{
    course_id: string; course_title: string; grp: string | null
    passed: boolean; quiz_score: number | null; pass_score: number
    cert_id: string | null; completed_at: string | null
    expires_at: string | null; validity_months: number | null
    days_left: number | null
  }>(
    `SELECT c.id AS course_id, c.title AS course_title, c.grp, c.pass_score,
            c.validity_months,
            p.passed, p.quiz_score, p.cert_id, p.completed_at, p.expires_at,
            (p.expires_at - CURRENT_DATE) AS days_left
     FROM atld.hse_workers w
     JOIN atld.progress p ON true
     JOIN atld.users u ON u.id = p.user_id
     JOIN atld.courses c ON c.id = p.course_id
     WHERE w.id = $1
       AND ${identitySql('w.id_number')} IS NOT NULL
       AND COALESCE(${identitySql("p.trainee_info->>'cccd'")},
                    ${identitySql("p.trainee_info->>'id_number'")},
                    ${identitySql('u.id_number')}) = ${identitySql('w.id_number')}
     ORDER BY p.passed DESC, p.completed_at DESC NULLS LAST, c.title`,
    [workerId],
  )
  return r.rows.map((x) => ({
    ...x,
    status: !x.passed
      ? (x.quiz_score == null ? 'in_progress' : 'not_passed')
      : x.expires_at != null && Number(x.days_left) < 0
        ? 'expired'
        : 'valid',
    days_left: x.expires_at == null ? null : Number(x.days_left),
  }))
}

export async function checkContractTraining(contractId: number, workTypeId: number, runQuery: typeof query = query): Promise<TrainingCheck> {
  const workers = await runQuery<{ worker_id: number }>(
    `SELECT worker_id FROM atld.hse_contract_workers WHERE contract_id = $1`, [contractId])
  return checkWorkerTraining(workTypeId, workers.rows.map((w) => w.worker_id), runQuery)
}
