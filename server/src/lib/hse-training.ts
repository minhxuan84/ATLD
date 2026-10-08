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

export async function checkContractTraining(contractId: number, workTypeId: number, runQuery: typeof query = query): Promise<TrainingCheck> {
  const workers = await runQuery<{ worker_id: number }>(
    `SELECT worker_id FROM atld.hse_contract_workers WHERE contract_id = $1`, [contractId])
  return checkWorkerTraining(workTypeId, workers.rows.map((w) => w.worker_id), runQuery)
}
