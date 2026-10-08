// Integration test against the configured local DB. Every fixture is rolled back.
// Run after building server: node --env-file=server/.env server/test/hse-training.mjs
import assert from 'node:assert/strict'
import { pool } from '../dist/db.js'
import { checkWorkerTraining } from '../dist/lib/hse-training.js'

const client = await pool.connect()
const runQuery = (sql, values) => client.query(sql, values)
const key = `_training_test_${Date.now()}`
try {
  await client.query('BEGIN')
  const contractor = await runQuery(`INSERT INTO atld.hse_contractors (code, name) VALUES ($1,$1) RETURNING id`, [key])
  const wt = await runQuery(`INSERT INTO atld.jsa_work_types (code, name) VALUES ($1,$1) RETURNING id`, [key])
  const course = `${key}_course`
  await runQuery(`INSERT INTO atld.courses (id, title, pass_score) VALUES ($1,'Training test',80)`, [course])
  await runQuery(`INSERT INTO atld.jsa_work_type_courses (work_type_id,course_id) VALUES ($1,$2)`, [wt.rows[0].id, course])
  const makeWorker = async (name, identity) => (await runQuery(
    `INSERT INTO atld.hse_workers (contractor_id,full_name,id_number) VALUES ($1,$2,$3) RETURNING id`,
    [contractor.rows[0].id, name, identity])).rows[0].id
  const makeProgress = async (suffix, identity, info, passed, expiry, cert = 'CERT-TEST') => {
    const user = (await runQuery(
      `INSERT INTO atld.users (username,password_hash,full_name,id_number,role) VALUES ($1,'unused',$1,$2,'trainee') RETURNING id`,
      [`${key}_${suffix}`, identity])).rows[0].id
    await runQuery(`INSERT INTO atld.progress (user_id,course_id,passed,cert_id,quiz_score,trainee_info,completed_at,expires_at)
      VALUES ($1,$2,$3,$4,CASE WHEN $3 THEN 90 ELSE 40 END,$5,CASE WHEN $3 THEN now() ELSE NULL END,$6)`,
    [user, course, passed, passed ? cert : null, JSON.stringify(info), expiry])
  }
  const valid = await makeWorker('Valid old certificate', '001.234-567 890')
  const expired = await makeWorker('Expired certificate', '001234567891')
  const today = await makeWorker('Expires today', '001234567892')
  const failed = await makeWorker('Not passed', '001234567893')
  const missing = await makeWorker('Missing', '001234567894')
  const empty = await makeWorker('Missing identity', '   ')
  const account = await makeWorker('Account identity', '001234567895')
  const wrong = await makeWorker('Shared account must not match', '001234567896')
  const passport = await makeWorker('Passport case insensitive', 'ab-123456')
  await makeProgress('old', null, { cccd: '001234567890' }, true, null)
  await makeProgress('expired', null, { cccd: '001234567891' }, true, '2000-01-01')
  const date = (await runQuery(`SELECT CURRENT_DATE::text AS today`)).rows[0].today
  await makeProgress('today', null, { id_number: '001234567892' }, true, date)
  await makeProgress('failed', null, { cccd: '001234567893' }, false, null)
  await makeProgress('empty', null, { cccd: '' }, true, null)
  await makeProgress('account', '001234567895', {}, true, null)
  await makeProgress('wrong', '001234567896', { cccd: '009999999999' }, true, null)
  await makeProgress('passport', null, { cccd: 'AB123456' }, true, null)
  // A failed attempt on another account must not hide a still-valid certificate.
  await makeProgress('retry', null, { cccd: '001234567890' }, false, null)
  const ids = [valid, expired, today, failed, missing, empty, account, wrong, passport]
  const result = await checkWorkerTraining(wt.rows[0].id, ids, runQuery)
  const status = new Map(result.workers.map((w) => [w.id, w.courses[0].status]))
  for (const [id, expected] of [[valid,'valid'],[expired,'expired'],[today,'valid'],[failed,'not_passed'],
    [missing,'missing'],[empty,'missing_identity'],[account,'valid'],[wrong,'missing'],[passport,'valid']]) {
    assert.equal(status.get(id), expected)
  }
  assert.equal(result.ok, false)
  assert.equal((await checkWorkerTraining(wt.rows[0].id, [valid, today, account], runQuery)).ok, true)
  assert.equal((await checkWorkerTraining(wt.rows[0].id, [], runQuery)).ok, false)
  const noCourses = (await runQuery(`INSERT INTO atld.jsa_work_types (code,name) VALUES ($1,$1) RETURNING id`, [`${key}_empty`])).rows[0].id
  assert.equal((await checkWorkerTraining(noCourses, [empty], runQuery)).ok, true)
  console.log('PASS: legacy CCCD, normalization, leading zeros, passport, expiry/today, failed/missing, empty identity, account fallback, shared account isolation, best valid certificate, no workers/courses')
} finally {
  await client.query('ROLLBACK')
  client.release()
  await pool.end()
}
