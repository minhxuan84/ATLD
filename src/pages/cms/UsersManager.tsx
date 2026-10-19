import { useEffect, useState, useCallback, useMemo } from 'react'
import { api } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { CMS_SECTIONS, type CmsSection } from '../../types'
import { UserPlus, Pencil, Trash2, X, Search, ChevronLeft, ChevronRight } from 'lucide-react'

interface UserRow {
  id: number
  username: string
  full_name: string
  role: string
  permissions: CmsSection[]
  site_id: number | null
  site_name: string | null
  created_at: string
}

interface Branch { id: number; name: string; location: string }

const ROLES = [
  { value: 'trainee', label: 'Học viên' },
  { value: 'officer', label: 'Cán bộ ATLĐ' },
  { value: 'admin', label: 'Quản trị' },
]
const ROLE_LABEL: Record<string, string> = { trainee: 'Học viên', officer: 'Cán bộ ATLĐ', admin: 'Quản trị' }

export default function UsersManager() {
  const { user: me } = useAuth()
  const isAdmin = me?.role === 'admin'
  const [users, setUsers] = useState<UserRow[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20
  const [form, setForm] = useState<{ username: string; fullName: string; role: string; password: string; permissions: CmsSection[]; siteId: string }>({ username: '', fullName: '', role: 'trainee', password: '', permissions: [], siteId: '' })
  const [error, setError] = useState('')

  const fetchUsers = useCallback(() => {
    api<{ users: UserRow[] }>('/admin/users').then((d) => setUsers(d.users)).catch(() => {})
  }, [])
  useEffect(fetchUsers, [fetchUsers])
  useEffect(() => {
    if (isAdmin) api<{ branches: Branch[] }>('/admin/branches').then((d) => setBranches(d.branches)).catch(() => {})
  }, [isAdmin])

  const openCreate = () => {
    setForm({ username: '', fullName: '', role: 'trainee', password: '', permissions: [], siteId: '' })
    setError(''); setCreating(true); setEditing(null)
  }
  const openEdit = (u: UserRow) => {
    setForm({ username: u.username, fullName: u.full_name, role: u.role, password: '', permissions: u.permissions ?? [], siteId: u.site_id ? String(u.site_id) : '' })
    setError(''); setEditing(u); setCreating(false)
  }
  const close = () => { setCreating(false); setEditing(null); setError('') }

  const togglePerm = (key: CmsSection) => {
    setForm((f) => ({ ...f, permissions: f.permissions.includes(key) ? f.permissions.filter((p) => p !== key) : [...f.permissions, key] }))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    // Chỉ gửi role/permissions khi là admin; server cũng chặn leo thang đặc quyền.
    const perms = form.role === 'officer' ? form.permissions : []
    try {
      // Site chỉ ý nghĩa với officer; role khác thì gửi null để không giới hạn.
      const siteId = form.role === 'officer' && form.siteId ? Number(form.siteId) : null
      if (editing) {
        const body: Record<string, unknown> = { fullName: form.fullName, password: form.password || undefined }
        if (isAdmin) { body.role = form.role; body.permissions = perms; body.site_id = siteId }
        await api(`/admin/users/${editing.id}`, { method: 'PUT', body })
      } else {
        const body: Record<string, unknown> = { username: form.username, fullName: form.fullName, password: form.password }
        if (isAdmin) { body.role = form.role; body.permissions = perms; body.site_id = siteId }
        await api('/admin/users', { method: 'POST', body })
      }
      close(); fetchUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lưu thất bại.')
    }
  }

  const remove = async (u: UserRow) => {
    if (!confirm(`Xóa tài khoản "${u.username}"?`)) return
    try {
      await api(`/admin/users/${u.id}`, { method: 'DELETE' })
      fetchUsers()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Xóa thất bại.')
    }
  }

  // Lọc theo tên đăng nhập / họ tên (không phân biệt hoa thường, bỏ dấu cách thừa)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) => u.username.toLowerCase().includes(q) || (u.full_name ?? '').toLowerCase().includes(q),
    )
  }, [users, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // Về trang 1 khi từ khóa thay đổi để không kẹt ở trang trống
  useEffect(() => { setPage(1) }, [search])

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Quản lý người dùng</h1>
        <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-vicem-600 px-4 py-2 font-semibold text-white hover:bg-vicem-700">
          <UserPlus className="h-4 w-4" /> Thêm người dùng
        </button>
      </div>

      {/* Thanh tìm kiếm */}
      <div className="mt-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên đăng nhập hoặc họ tên…"
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100"
          />
        </div>
        <span className="text-sm text-slate-400">{filtered.length} người dùng</span>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Tên đăng nhập</th>
              <th className="px-4 py-3 font-medium">Họ tên</th>
              <th className="px-4 py-3 font-medium">Vai trò</th>
              <th className="px-4 py-3 font-medium">Site phụ trách</th>
              <th className="px-4 py-3 font-medium">Ngày tạo</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paged.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  {search ? 'Không tìm thấy người dùng phù hợp.' : 'Chưa có người dùng.'}
                </td>
              </tr>
            )}
            {paged.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-700">{u.username}{me?.id === u.id && <span className="ml-2 text-xs text-vicem-500">(bạn)</span>}</td>
                <td className="px-4 py-3 text-slate-600">{u.full_name}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${u.role === 'admin' ? 'bg-eco-100 text-eco-700' : u.role === 'officer' ? 'bg-vicem-100 text-vicem-700' : 'bg-slate-100 text-slate-600'}`}>
                    {ROLE_LABEL[u.role]}
                  </span>
                  {u.role === 'officer' && (
                    <span className="ml-2 text-xs text-slate-400">
                      {u.permissions?.length ? `${u.permissions.length} mục CMS` : 'chưa cấp quyền'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {u.role === 'officer'
                    ? (u.site_name ?? <span className="text-slate-400">Mọi site</span>)
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-slate-400">{u.created_at}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => openEdit(u)} className="rounded p-1.5 text-slate-400 hover:bg-vicem-50 hover:text-vicem-600" aria-label="Sửa"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => remove(u)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Xóa"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phân trang */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-slate-400">
            Trang {safePage}/{totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" /> Trước
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              Sau <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {(creating || editing) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">{editing ? 'Sửa người dùng' : 'Thêm người dùng'}</h2>
              <button onClick={close} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={submit} className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700">Tên đăng nhập</label>
                <input
                  value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
                  disabled={!!editing}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Họ tên</label>
                <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Vai trò</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} disabled={!isAdmin} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100">
                  {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                {!isAdmin && <p className="mt-1 text-xs text-slate-400">Chỉ quản trị viên mới đổi được vai trò và phân quyền.</p>}
              </div>

              {/* Phân quyền CMS: chỉ áp dụng cho Cán bộ ATLĐ (officer). Admin toàn quyền, học viên không vào CMS. */}
              {isAdmin && form.role === 'officer' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700">Quyền truy cập mục CMS</label>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5 rounded-lg border border-slate-200 p-2">
                    {CMS_SECTIONS.map((s) => (
                      <label key={s.key} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm text-slate-600 hover:bg-slate-50">
                        <input type="checkbox" checked={form.permissions.includes(s.key)} onChange={() => togglePerm(s.key)} className="accent-vicem-600" />
                        {s.label}
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-slate-400">Cán bộ chỉ thấy và thao tác trong các mục được tích chọn.</p>
                </div>
              )}

              {/* Site phụ trách: chỉ với officer. Bỏ trống + có quyền 'an-toan' toàn quyền = xem mọi site. */}
              {isAdmin && form.role === 'officer' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700">Chi nhánh / nhà máy phụ trách</label>
                  <select value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    <option value="">— Không giới hạn (mọi site) —</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <p className="mt-1 text-xs text-slate-400">Cán bộ chỉ thấy dữ liệu ATVSLĐ (hợp đồng, NLĐ, kiểm tra…) thuộc site này. Quyền “An toàn” toàn phần vẫn xem được mọi site.</p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700">{editing ? 'Mật khẩu mới (để trống nếu không đổi)' : 'Mật khẩu'}</label>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={close} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Hủy</button>
                <button type="submit" className="rounded-lg bg-vicem-600 px-4 py-2 text-sm font-semibold text-white hover:bg-vicem-700">Lưu</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
