import { fmtDate } from '../../lib/date'

interface RequiredCourse { id: string; title: string; pass_score: number }
interface CourseCertificate extends RequiredCourse {
  status: 'valid' | 'expired' | 'not_passed' | 'missing' | 'missing_identity'
  cert_id: string | null; quiz_score: number | null
  completed_at: string | null; expires_at: string | null
}
export interface TrainingCheck {
  work_type_id: number; courses: RequiredCourse[]; ok: boolean
  workers: Array<{ id: number; full_name: string; id_number: string | null; ok: boolean; courses: CourseCertificate[] }>
}
const STATUS_LABEL: Record<CourseCertificate['status'], string> = {
  valid: 'Còn hiệu lực', expired: 'Hết hạn', not_passed: 'Chưa đạt',
  missing: 'Chưa có chứng chỉ', missing_identity: 'Thiếu CCCD/CMND/HC',
}

export default function TrainingCheckPanel({ training, snapshot = false }: { training: TrainingCheck; snapshot?: boolean }) {
  return (
    <section className="border rounded p-3 space-y-3" aria-label="Khóa học và chứng chỉ JSA">
      <h3 className="font-bold text-sm">Khóa học yêu cầu & chứng chỉ NLĐ {snapshot && '(tại thời điểm kiểm tra)'}</h3>
      {!training.courses.length ? <p className="text-sm text-gray-500">Công việc này chưa yêu cầu khóa học.</p> : <>
        <ul className="list-disc pl-5 text-sm space-y-1">
          {training.courses.map((c) => <li key={c.id}>{c.title} — điểm đạt: {c.pass_score}%</li>)}
        </ul>
        {!training.workers.length ? <p className="text-sm text-amber-700 bg-amber-50 rounded p-2">Hợp đồng chưa được gán người lao động để đối chiếu chứng chỉ.</p> : <>
          <p className={`text-sm rounded p-2 ${training.ok ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
            {training.ok ? 'Tất cả NLĐ có chứng chỉ yêu cầu còn hiệu lực.' : 'Có NLĐ chưa đủ chứng chỉ yêu cầu. Cần bổ sung trước khi làm công việc này.'}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-gray-50"><tr>
                <th className="text-left p-2">Người lao động</th><th className="text-left p-2">Khóa học / chứng chỉ</th>
                <th className="text-left p-2">Ngày cấp / hết hạn</th><th className="text-left p-2">Trạng thái</th>
              </tr></thead>
              <tbody>{training.workers.flatMap((w) => w.courses.map((c) => (
                <tr key={`${w.id}:${c.id}`} className="border-t align-top">
                  <td className="p-2">{w.full_name}<div className="text-xs text-gray-500">{w.id_number || 'Chưa có CCCD'}</div></td>
                  <td className="p-2">{c.title}<div className="text-xs text-gray-500">{c.cert_id || '—'}{c.quiz_score !== null && ` · ${c.quiz_score}%`}</div></td>
                  <td className="p-2">{fmtDate(c.completed_at)}<div className="text-xs text-gray-500">{c.expires_at ? `Hết hạn: ${fmtDate(c.expires_at)}` : c.status === 'valid' ? 'Không hết hạn' : '—'}</div></td>
                  <td className="p-2"><span className={`inline-block rounded px-2 py-1 text-xs ${c.status === 'valid' ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'}`}>{STATUS_LABEL[c.status]}</span></td>
                </tr>
              )))}</tbody>
            </table>
          </div>
        </>}
        <p className="text-xs text-gray-500">Đối chiếu CCCD/CMND/hộ chiếu của NLĐ với thông tin đã khai khi thi hoặc tài khoản học viên; không ghép theo họ tên.</p>
      </>}
    </section>
  )
}
