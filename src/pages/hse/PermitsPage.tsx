// Quản lý Giấy phép làm việc (e-Permit) — Pha 3
import { useState, useEffect } from 'react'
import { useAuth, canHse } from '../../context/AuthContext'
import { fmtDateTime } from '../../lib/date'
import { api, openFileInNewTab } from '../../lib/api'

interface Permit {
  id: number
  permit_number: string
  site_id: number
  site_name: string
  work_type_id: number | null
  work_type_name: string | null
  location: string
  work_description: string
  start_time: string
  end_time: string
  status: 'draft' | 'submitted' | 'approved' | 'active' | 'closed' | 'cancelled'
  requester_id: number
  requester_name: string
  submitted_at: string | null
  approved_by: number | null
  approved_at: string | null
  activated_at: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
}

interface Worker {
  id: number
  worker_id: number
  role: string
  full_name: string
  id_number: string
}

interface Hazard {
  id: number
  hazard_description: string
  risk_level: string | null
  sequence: number
}

interface Control {
  id: number
  hazard_id: number
  control_measure: string
  sequence: number
}

interface Approval {
  id: number
  approver_id: number
  approver_name: string
  role: string
  decision: 'approved' | 'rejected'
  comments: string
  created_at: string
}

interface Site {
  id: number
  code: string
  name: string
}

interface WorkType {
  id: number
  code: string
  name: string
  risk_level: string
  requires_permit: boolean
}

export default function PermitsPage() {
  const { user } = useAuth()
  const [permits, setPermits] = useState<Permit[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [workTypes, setWorkTypes] = useState<WorkType[]>([])
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedPermit, setSelectedPermit] = useState<number | null>(null)
  const [permitDetail, setPermitDetail] = useState<{
    permit: Permit
    workers: Worker[]
    hazards: Hazard[]
    controls: Control[]
    approvals: Approval[]
  } | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [formData, setFormData] = useState({
    site_id: '',
    work_type_id: '',
    location: '',
    work_description: '',
    start_time: '',
    end_time: '',
  })

  const isApprover = canHse(user, 'approve')

  useEffect(() => {
    loadPermits()
    loadSites()
    loadWorkTypes()
  }, [statusFilter])

  async function loadPermits() {
    const url = statusFilter === 'all' ? '/jsa/permits' : `/jsa/permits?status=${statusFilter}`
    const r = await api<{ permits: Permit[] }>(url)
    setPermits(r.permits || [])
  }

  async function loadSites() {
    const r = await api<{ branches: { id: number; name: string }[] }>('/admin/branches')
    setSites(r.branches.map((b) => ({ id: b.id, code: String(b.id), name: b.name })) || [])
  }

  async function loadWorkTypes() {
    const r = await api<{ workTypes: WorkType[] }>('/jsa/work-types')
    setWorkTypes(r.workTypes || [])
  }

  async function loadPermitDetail(id: number) {
    const r = await api<{
      permit: Permit
      workers: Worker[]
      hazards: Hazard[]
      controls: Control[]
      approvals: Approval[]
    }>(`/jsa/permits/${id}`)
    setPermitDetail(r)
    setSelectedPermit(id)
  }

  async function createPermit() {
    if (!formData.site_id || !formData.location || !formData.work_description || !formData.start_time || !formData.end_time) {
      alert('Vui lòng điền đầy đủ thông tin.')
      return
    }
    await api('/jsa/permits', {
      method: 'POST',
      // api() tự JSON.stringify — truyền object, không stringify sẵn (sẽ thành double-encode).
      body: {
        site_id: Number(formData.site_id),
        work_type_id: formData.work_type_id ? Number(formData.work_type_id) : null,
        location: formData.location,
        work_description: formData.work_description,
        start_time: new Date(formData.start_time).toISOString(),
        end_time: new Date(formData.end_time).toISOString(),
      },
    })
    setShowCreate(false)
    setFormData({ site_id: '', work_type_id: '', location: '', work_description: '', start_time: '', end_time: '' })
    loadPermits()
  }

  async function submitPermit(id: number) {
    if (!confirm('Submit giấy phép này để phê duyệt?')) return
    await api(`/jsa/permits/${id}/submit`, { method: 'POST' })
    loadPermits()
    if (selectedPermit === id) loadPermitDetail(id)
  }

  async function approvePermit(id: number, decision: 'approved' | 'rejected') {
    const comments = prompt(`Nhận xét (${decision === 'approved' ? 'phê duyệt' : 'từ chối'}):`) || ''
    await api(`/jsa/permits/${id}/approve`, {
      method: 'POST',
      body: { decision, comments },
    })
    loadPermits()
    if (selectedPermit === id) loadPermitDetail(id)
  }

  async function activatePermit(id: number) {
    if (!confirm('Kích hoạt giấy phép này?')) return
    await api(`/jsa/permits/${id}/activate`, { method: 'POST' })
    loadPermits()
    if (selectedPermit === id) loadPermitDetail(id)
  }

  async function closePermit(id: number) {
    const closureNotes = prompt('Ghi chú đóng permit:') || ''
    await api(`/jsa/permits/${id}/close`, {
      method: 'POST',
      body: { closure_notes: closureNotes },
    })
    loadPermits()
    if (selectedPermit === id) loadPermitDetail(id)
  }

  async function cancelPermit(id: number) {
    if (!confirm('Hủy giấy phép này?')) return
    await api(`/jsa/permits/${id}/cancel`, { method: 'POST' })
    loadPermits()
    if (selectedPermit === id) loadPermitDetail(id)
  }

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-800',
    submitted: 'bg-blue-100 text-blue-800',
    approved: 'bg-green-100 text-green-800',
    active: 'bg-purple-100 text-purple-800',
    closed: 'bg-slate-100 text-slate-800',
    cancelled: 'bg-red-100 text-red-800',
  }

  const statusLabels: Record<string, string> = {
    draft: 'Nháp',
    submitted: 'Chờ duyệt',
    approved: 'Đã duyệt',
    active: 'Đang hoạt động',
    closed: 'Đã đóng',
    cancelled: 'Đã hủy',
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Giấy phép làm việc (e-Permit)</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + Tạo giấy phép
        </button>
      </div>

      <div className="mb-4 flex gap-2">
        {['all', 'draft', 'submitted', 'approved', 'active', 'closed'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 rounded ${
              statusFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            {s === 'all' ? 'Tất cả' : statusLabels[s]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Danh sách permits */}
        <div className="space-y-3">
          {permits.length === 0 && <p className="text-gray-500">Không có giấy phép nào.</p>}
          {permits.map((p) => (
            <div
              key={p.id}
              onClick={() => loadPermitDetail(p.id)}
              className={`p-4 border rounded-lg cursor-pointer hover:bg-gray-50 ${
                selectedPermit === p.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-blue-600">{p.permit_number}</span>
                    <span className={`px-2 py-0.5 text-xs rounded ${statusColors[p.status]}`}>
                      {statusLabels[p.status]}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mb-1">{p.location}</p>
                  <p className="text-sm text-gray-500">{p.site_name}</p>
                  {p.work_type_name && <p className="text-xs text-gray-500 mt-1">Loại CV: {p.work_type_name}</p>}
                  <p className="text-xs text-gray-400 mt-1">
                    {fmtDateTime(p.start_time)} → {fmtDateTime(p.end_time)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Chi tiết permit */}
        {permitDetail && (
          <div className="border border-gray-200 rounded-lg p-6 bg-white">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{permitDetail.permit.permit_number}</h2>
                <span className={`inline-block mt-1 px-2 py-1 text-sm rounded ${statusColors[permitDetail.permit.status]}`}>
                  {statusLabels[permitDetail.permit.status]}
                </span>
              </div>
              <button onClick={() => setSelectedPermit(null)} className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>

            <div className="space-y-4 mb-6">
              <div>
                <label className="text-sm font-semibold text-gray-700">Site:</label>
                <p className="text-gray-900">{permitDetail.permit.site_name}</p>
              </div>
              {permitDetail.permit.work_type_name && (
                <div>
                  <label className="text-sm font-semibold text-gray-700">Loại công việc:</label>
                  <p className="text-gray-900">{permitDetail.permit.work_type_name}</p>
                </div>
              )}
              <div>
                <label className="text-sm font-semibold text-gray-700">Địa điểm:</label>
                <p className="text-gray-900">{permitDetail.permit.location}</p>
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-700">Mô tả công việc:</label>
                <p className="text-gray-900">{permitDetail.permit.work_description}</p>
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-700">Thời gian:</label>
                <p className="text-gray-900">
                  {fmtDateTime(permitDetail.permit.start_time)} → {fmtDateTime(permitDetail.permit.end_time)}
                </p>
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-700">Người tạo:</label>
                <p className="text-gray-900">{permitDetail.permit.requester_name}</p>
              </div>
            </div>

            {permitDetail.workers.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Nhân công ({permitDetail.workers.length})</h3>
                <div className="space-y-2">
                  {permitDetail.workers.map((w) => (
                    <div key={w.id} className="text-sm flex justify-between">
                      <span>{w.full_name}</span>
                      <span className="text-gray-500">{w.role || 'N/A'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {permitDetail.hazards.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Rủi ro & biện pháp kiểm soát</h3>
                <div className="space-y-3">
                  {permitDetail.hazards.map((h) => {
                    const controls = permitDetail.controls.filter((c) => c.hazard_id === h.id)
                    return (
                      <div key={h.id} className="border-l-4 border-orange-400 pl-3">
                        <p className="text-sm font-medium text-gray-900">{h.hazard_description}</p>
                        {h.risk_level && (
                          <span className="inline-block mt-1 px-2 py-0.5 text-xs rounded bg-orange-100 text-orange-800">
                            {h.risk_level}
                          </span>
                        )}
                        {controls.length > 0 && (
                          <ul className="mt-2 space-y-1 text-sm text-gray-700">
                            {controls.map((c) => (
                              <li key={c.id} className="flex items-start">
                                <span className="mr-2">•</span>
                                <span>{c.control_measure}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {permitDetail.approvals.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Lịch sử phê duyệt</h3>
                <div className="space-y-2">
                  {permitDetail.approvals.map((a) => (
                    <div key={a.id} className="text-sm border-l-2 border-gray-300 pl-3">
                      <div className="flex justify-between">
                        <span className="font-medium">{a.approver_name}</span>
                        <span
                          className={`px-2 py-0.5 text-xs rounded ${
                            a.decision === 'approved' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {a.decision === 'approved' ? 'Đã duyệt' : 'Từ chối'}
                        </span>
                      </div>
                      {a.comments && <p className="text-gray-600 mt-1">{a.comments}</p>}
                      <p className="text-xs text-gray-400 mt-1">{fmtDateTime(a.created_at)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 flex-wrap">
              {permitDetail.permit.status === 'draft' && permitDetail.permit.requester_id === user?.id && (
                <>
                  <button
                    onClick={() => submitPermit(permitDetail.permit.id)}
                    className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                  >
                    Submit
                  </button>
                  <button
                    onClick={() => cancelPermit(permitDetail.permit.id)}
                    className="px-3 py-1.5 bg-gray-600 text-white text-sm rounded hover:bg-gray-700"
                  >
                    Hủy
                  </button>
                </>
              )}
              {permitDetail.permit.status === 'submitted' && isApprover && (
                <>
                  <button
                    onClick={() => approvePermit(permitDetail.permit.id, 'approved')}
                    className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                  >
                    Phê duyệt
                  </button>
                  <button
                    onClick={() => approvePermit(permitDetail.permit.id, 'rejected')}
                    className="px-3 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                  >
                    Từ chối
                  </button>
                </>
              )}
              {permitDetail.permit.status === 'approved' && isApprover && (
                <button
                  onClick={() => activatePermit(permitDetail.permit.id)}
                  className="px-3 py-1.5 bg-purple-600 text-white text-sm rounded hover:bg-purple-700"
                >
                  Kích hoạt
                </button>
              )}
              {permitDetail.permit.status === 'active' && isApprover && (
                <button
                  onClick={() => closePermit(permitDetail.permit.id)}
                  className="px-3 py-1.5 bg-slate-600 text-white text-sm rounded hover:bg-slate-700"
                >
                  Nghiệm thu đóng phép
                </button>
              )}
              {/* Biên bản nghiệm thu (Pha 5) — xem được khi đã duyệt trở đi. */}
              {['approved', 'active', 'closed'].includes(permitDetail.permit.status) && (
                <button
                  onClick={() => openFileInNewTab(`/jsa/permits/${permitDetail.permit.id}/pdf`)
                    .catch((e: Error) => alert(e.message))}
                  className="px-3 py-1.5 border border-slate-300 text-sm rounded hover:bg-slate-50"
                >
                  Biên bản nghiệm thu (PDF)
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal tạo permit */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Tạo giấy phép mới</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Site *</label>
                <select
                  value={formData.site_id}
                  onChange={(e) => setFormData({ ...formData, site_id: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  required
                >
                  <option value="">-- Chọn site --</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Loại công việc</label>
                <select
                  value={formData.work_type_id}
                  onChange={(e) => setFormData({ ...formData, work_type_id: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                >
                  <option value="">-- Không chọn --</option>
                  {workTypes.map((wt) => (
                    <option key={wt.id} value={wt.id}>
                      {wt.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Địa điểm *</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Mô tả công việc *</label>
                <textarea
                  value={formData.work_description}
                  onChange={(e) => setFormData({ ...formData, work_description: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  rows={3}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Thời gian bắt đầu *</label>
                <input
                  type="datetime-local"
                  value={formData.start_time}
                  onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Thời gian kết thúc *</label>
                <input
                  type="datetime-local"
                  value={formData.end_time}
                  onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  required
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={createPermit} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                Tạo
              </button>
              <button
                onClick={() => {
                  setShowCreate(false)
                  setFormData({ site_id: '', work_type_id: '', location: '', work_description: '', start_time: '', end_time: '' })
                }}
                className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
              >
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
