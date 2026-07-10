import { useState, useEffect, useCallback } from 'react'
import { api, downloadDoc, getToken } from '../lib/api'
import { useAuth, canAccess } from '../context/AuthContext'
import { Card } from '../components/ui'
import {
  Search, Upload, Trash2, FileText, Download, Folder, FolderOpen,
  FolderPlus, ChevronRight, Pencil, Eye, X, Check, FileImage, Loader2,
  Settings, Lock, Tags,
} from 'lucide-react'

type Role = 'trainee' | 'officer' | 'admin'
const ROLE_RANK: Record<Role, number> = { trainee: 0, officer: 1, admin: 2 }
const ROLE_LABEL: Record<Role, string> = { trainee: 'Thực tập sinh', officer: 'Cán bộ', admin: 'Quản trị' }
const roleAtLeast = (userRole: Role | undefined, minRole: string) =>
  (ROLE_RANK[userRole as Role] ?? 0) >= (ROLE_RANK[minRole as Role] ?? 0)

interface Category { id: number; name: string; sort_order: number }

interface DocRow {
  id: number; name: string; category: string; description: string
  size_kb: number; mime_type: string; uploaded_by: string; uploaded_at: string
  folder_id: number | null
}
interface FolderRow {
  id: number; name: string; parent_id: number | null
  sort_order: number; view_role: string; manage_role: string
}
interface FolderNode extends FolderRow { children: FolderNode[]; docs: DocRow[] }

function buildTree(folders: FolderRow[], docs: DocRow[]) {
  // Sort folders by sort_order then name before building tree
  const sorted = [...folders].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  const map = new Map<number, FolderNode>()
  sorted.forEach((f) => map.set(f.id, { ...f, children: [], docs: [] }))
  docs.forEach((d) => { if (d.folder_id != null) map.get(d.folder_id)?.docs.push(d) })
  const roots: FolderNode[] = []
  sorted.forEach((f) => {
    const node = map.get(f.id)!
    if (f.parent_id == null) roots.push(node)
    else map.get(f.parent_id)?.children.push(node)
  })
  const rootDocs = docs.filter((d) => d.folder_id == null || !map.has(d.folder_id))
  return { roots, rootDocs }
}

const isImage = (m: string) => m.startsWith('image/')
const isPdf   = (m: string) => m === 'application/pdf'
const canView = (m: string) => isImage(m) || isPdf(m)

// ── VIEWER MODAL ──────────────────────────────────────────────
function ViewerModal({ doc, onClose }: { doc: DocRow; onClose: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let url = ''
    const tok = getToken()
    fetch(`/api/documents/${doc.id}/view`, {
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    })
      .then((r) => { if (!r.ok) throw new Error('Không thể tải file.'); return r.blob() })
      .then((b) => { url = URL.createObjectURL(b); setBlobUrl(url) })
      .catch((e: Error) => setErr(e.message))
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [doc.id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <span className="max-w-[80%] truncate font-semibold text-slate-800">{doc.name}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => downloadDoc(doc.id, doc.name).catch(() => {})}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
              <Download className="h-4 w-4" /> Tải về
            </button>
            <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden rounded-b-2xl bg-slate-100">
          {!blobUrl && !err && (
            <div className="flex h-64 items-center justify-center text-slate-400">
              <Loader2 className="mr-2 h-6 w-6 animate-spin" /> Đang tải...
            </div>
          )}
          {err && (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-500">
              <FileText className="h-12 w-12 text-slate-300" /><p className="text-sm">{err}</p>
            </div>
          )}
          {blobUrl && isPdf(doc.mime_type) && (
            <iframe src={blobUrl} className="h-[75vh] w-full" title={doc.name} />
          )}
          {blobUrl && isImage(doc.mime_type) && (
            <div className="flex max-h-[75vh] items-center justify-center overflow-auto p-4">
              <img src={blobUrl} alt={doc.name} className="max-h-full max-w-full rounded-lg object-contain shadow" />
            </div>
          )}
          {blobUrl && !canView(doc.mime_type) && (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-500">
              <FileText className="h-12 w-12 text-slate-300" />
              <p className="text-sm">Định dạng này không hỗ trợ xem trực tiếp.</p>
              <button onClick={() => downloadDoc(doc.id, doc.name).catch(() => {})}
                className="rounded-lg bg-vicem-600 px-4 py-2 text-sm font-semibold text-white hover:bg-vicem-700">
                Tải về để xem
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── HÀNG TÀI LIỆU ─────────────────────────────────────────────
function DocItem({ doc, depth, canEdit, onView, onDelete, onRename, folders }: {
  doc: DocRow; depth: number; canEdit: boolean
  onView: (d: DocRow) => void
  onDelete: (id: number) => void
  onRename: (id: number, patch: Partial<DocRow>) => void
  folders: FolderRow[]
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(doc.name)
  const [fid, setFid] = useState<string>(doc.folder_id != null ? String(doc.folder_id) : '')
  const Icon = isImage(doc.mime_type) ? FileImage : FileText

  const save = () => {
    onRename(doc.id, { name: name.trim() || doc.name, folder_id: fid ? Number(fid) : null })
    setEditing(false)
  }

  return (
    <div className="group flex items-center gap-2 rounded-lg py-1.5 pr-2 hover:bg-slate-50"
      style={{ paddingLeft: depth * 20 + 8 }}>
      <Icon className="h-4 w-4 shrink-0 text-vicem-500" aria-hidden />
      {editing ? (
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm" autoFocus />
          <select value={fid} onChange={(e) => setFid(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-sm">
            <option value="">(Gốc)</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <button onClick={save} className="rounded p-1 text-emerald-600 hover:bg-emerald-50"><Check className="h-4 w-4" /></button>
          <button onClick={() => setEditing(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
      ) : (
        <>
          <button onClick={() => onView(doc)}
            className="min-w-0 flex-1 truncate text-left text-sm font-medium text-slate-700 hover:text-vicem-600 hover:underline"
            title={canView(doc.mime_type) ? 'Nhấn để xem' : doc.name}>
            {doc.name}
          </button>
          <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">
            {doc.size_kb} KB · {doc.uploaded_at}
          </span>
          <div className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100">
            {canView(doc.mime_type) && (
              <button onClick={() => onView(doc)}
                className="rounded p-1.5 text-slate-400 hover:bg-vicem-50 hover:text-vicem-600"
                aria-label="Xem"><Eye className="h-4 w-4" /></button>
            )}
            <button onClick={() => downloadDoc(doc.id, doc.name).catch((e: Error) => alert(e.message))}
              className="rounded p-1.5 text-slate-400 hover:bg-vicem-50 hover:text-vicem-600"
              aria-label="Tải về"><Download className="h-4 w-4" /></button>
            {canEdit && (
              <>
                <button onClick={() => setEditing(true)}
                  className="rounded p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-600"
                  aria-label="Sửa"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => onDelete(doc.id)}
                  className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="Xóa"><Trash2 className="h-4 w-4" /></button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── NÚT THƯ MỤC ───────────────────────────────────────────────
function FolderNodeView({ node, depth, hasSection, userRole, onView, onDeleteDoc, onRenameDoc,
  onDeleteFolder, onRenameFolder, onAddFolder, onUpload, onSettings, expanded, onToggle, folders }: {
  node: FolderNode; depth: number; hasSection: boolean; userRole: Role | undefined
  onView: (d: DocRow) => void
  onDeleteDoc: (id: number) => void
  onRenameDoc: (id: number, patch: Partial<DocRow>) => void
  onDeleteFolder: (id: number) => void
  onRenameFolder: (id: number, name: string) => void
  onAddFolder: (parentId: number) => void
  onUpload: (folderId: number | null) => void
  onSettings: (folder: FolderRow) => void
  expanded: Set<number>; onToggle: (id: number) => void
  folders: FolderRow[]
}) {
  const [renaming, setRenaming] = useState(false)
  const [rname, setRname] = useState(node.name)
  const open = expanded.has(node.id)
  const hasContent = node.children.length > 0 || node.docs.length > 0
  // Quyền quản lý thư mục này = có quyền section 'tai-lieu' VÀ role đủ manage_role
  const canManage = hasSection && roleAtLeast(userRole, node.manage_role)

  const saveRename = () => {
    if (rname.trim()) onRenameFolder(node.id, rname.trim())
    setRenaming(false)
  }

  return (
    <div>
      <div className="group flex items-center gap-1 rounded-lg py-1.5 pr-2 hover:bg-slate-100"
        style={{ paddingLeft: depth * 20 + 4 }}>
        <button className="flex flex-1 items-center gap-2 text-left" onClick={() => onToggle(node.id)}>
          <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''} ${!hasContent ? 'opacity-0 pointer-events-none' : ''}`} />
          {open
            ? <FolderOpen className="h-5 w-5 shrink-0 text-amber-500" />
            : <Folder className="h-5 w-5 shrink-0 text-amber-500" />}
          {renaming ? (
            <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <input value={rname} onChange={(e) => setRname(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(false) }}
                className="w-40 rounded border border-slate-300 px-2 py-0.5 text-sm" autoFocus />
              <button onClick={saveRename} className="rounded p-0.5 text-emerald-600 hover:bg-emerald-50"><Check className="h-3.5 w-3.5" /></button>
              <button onClick={() => setRenaming(false)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100"><X className="h-3.5 w-3.5" /></button>
            </span>
          ) : (
            <span className="text-sm font-semibold text-slate-700">{node.name}</span>
          )}
          {hasContent && (
            <span className="ml-1 text-xs text-slate-400">({node.docs.length})</span>
          )}
          {hasSection && <RoleBadges folder={node} />}
        </button>
        {canManage && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
            <button onClick={() => onUpload(node.id)} title="Upload vào thư mục này"
              className="rounded p-1 text-slate-400 hover:bg-vicem-50 hover:text-vicem-600"><Upload className="h-3.5 w-3.5" /></button>
            <button onClick={() => onAddFolder(node.id)} title="Tạo thư mục con"
              className="rounded p-1 text-slate-400 hover:bg-amber-50 hover:text-amber-600"><FolderPlus className="h-3.5 w-3.5" /></button>
            <button onClick={() => { setRname(node.name); setRenaming(true) }} title="Đổi tên"
              className="rounded p-1 text-slate-400 hover:bg-amber-50 hover:text-amber-600"><Pencil className="h-3.5 w-3.5" /></button>
            <button onClick={() => onSettings(node)} title="Cài đặt (thứ tự, phân quyền)"
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><Settings className="h-3.5 w-3.5" /></button>
            <button onClick={() => onDeleteFolder(node.id)} title="Xóa thư mục"
              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        )}
      </div>
      {open && (
        <div>
          {node.children.map((child) => (
            <FolderNodeView key={child.id} node={child} depth={depth + 1} hasSection={hasSection} userRole={userRole}
              onView={onView} onDeleteDoc={onDeleteDoc} onRenameDoc={onRenameDoc}
              onDeleteFolder={onDeleteFolder} onRenameFolder={onRenameFolder}
              onAddFolder={onAddFolder} onUpload={onUpload} onSettings={onSettings}
              expanded={expanded} onToggle={onToggle} folders={folders} />
          ))}
          {node.docs.map((d) => (
            <DocItem key={d.id} doc={d} depth={depth + 1} canEdit={canManage}
              onView={onView} onDelete={onDeleteDoc} onRename={onRenameDoc} folders={folders} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── MODAL UPLOAD ───────────────────────────────────────────────
function UploadModal({ folders, categories, defaultFolderId, onClose, onDone }: {
  folders: FolderRow[]; categories: Category[]; defaultFolderId: number | null
  onClose: () => void; onDone: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [cat, setCat] = useState(categories[0]?.name ?? 'Nội quy')
  const [folderId, setFolderId] = useState<string>(defaultFolderId != null ? String(defaultFolderId) : '')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) { setErr('Vui lòng chọn file'); return }
    setLoading(true); setErr('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('name', name || file.name)
      fd.append('description', desc)
      fd.append('category', cat)
      if (folderId) fd.append('folder_id', folderId)
      await api('/documents', { method: 'POST', body: fd })
      onDone()
    } catch (e: any) { setErr(e.message ?? 'Lỗi upload') }
    finally { setLoading(false) }
  }

  // Build flat folder options sorted by depth-aware label
  const opts = buildFolderOptions(folders)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">Tải tài liệu lên</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100"><X className="h-5 w-5 text-slate-500" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">File *</label>
            <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv"
              onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !name) setName(f.name.replace(/\.[^.]+$/, '')) }}
              className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-vicem-600 file:px-3 file:py-1 file:text-xs file:font-medium file:text-white" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Tên tài liệu</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Để trống = tên file"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-vicem-400 focus:outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Danh mục</label>
              <select value={cat} onChange={(e) => setCat(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-vicem-400 focus:outline-none">
                {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Thư mục</label>
              <select value={folderId} onChange={(e) => setFolderId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-vicem-400 focus:outline-none">
                <option value="">— Gốc —</option>
                {opts.map((o) => <option key={o.id} value={String(o.id)}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Mô tả</label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2}
              className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-vicem-400 focus:outline-none" />
          </div>
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Hủy</button>
            <button type="submit" disabled={loading}
              className="flex items-center gap-2 rounded-lg bg-vicem-600 px-4 py-2 text-sm font-semibold text-white hover:bg-vicem-700 disabled:opacity-60">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}Tải lên
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Flatten folder tree into indented select options */
function buildFolderOptions(folders: FolderRow[]) {
  const result: { id: number; label: string }[] = []
  const map = new Map<number, FolderRow & { children: FolderRow[] }>()
  for (const f of folders) map.set(f.id, { ...f, children: [] })
  const roots: (FolderRow & { children: FolderRow[] })[] = []
  for (const f of map.values()) {
    if (f.parent_id == null) roots.push(f)
    else map.get(f.parent_id)?.children.push(f)
  }
  const walk = (node: FolderRow & { children: FolderRow[] }, depth: number) => {
    result.push({ id: node.id, label: '  '.repeat(depth) + node.name })
    for (const c of (node as any).children) walk(map.get(c.id)!, depth + 1)
  }
  for (const r of roots) walk(r, 0)
  return result
}

// ── BADGE PHÂN QUYỀN ──────────────────────────────────────────
function RoleBadges({ folder }: { folder: FolderRow }) {
  return (
    <span className="ml-2 hidden items-center gap-1 sm:inline-flex">
      <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500"
        title={`Ai được xem: từ ${ROLE_LABEL[folder.view_role as Role] ?? folder.view_role} trở lên`}>
        <Eye className="h-3 w-3" />{ROLE_LABEL[folder.view_role as Role] ?? folder.view_role}
      </span>
      <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600"
        title={`Ai được quản lý: từ ${ROLE_LABEL[folder.manage_role as Role] ?? folder.manage_role} trở lên`}>
        <Lock className="h-3 w-3" />{ROLE_LABEL[folder.manage_role as Role] ?? folder.manage_role}
      </span>
    </span>
  )
}

// ── MODAL CÀI ĐẶT THƯ MỤC ─────────────────────────────────────
function FolderSettingsModal({ folder, onClose, onSave }: {
  folder: FolderRow; onClose: () => void
  onSave: (patch: Partial<FolderRow>) => Promise<void>
}) {
  const [name, setName] = useState(folder.name)
  const [sortOrder, setSortOrder] = useState(String(folder.sort_order))
  const [viewRole, setViewRole] = useState(folder.view_role)
  const [manageRole, setManageRole] = useState(folder.manage_role)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setErr('')
    try {
      await onSave({
        name: name.trim() || folder.name,
        sort_order: Number(sortOrder) || 0,
        view_role: viewRole, manage_role: manageRole,
      })
      onClose()
    } catch (e: any) { setErr(e.message ?? 'Lỗi lưu') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">Cài đặt thư mục</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100"><X className="h-5 w-5 text-slate-500" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Tên thư mục</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-vicem-400 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Số thứ tự hiển thị</label>
            <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-vicem-400 focus:outline-none" />
            <p className="mt-1 text-[11px] text-slate-400">Số nhỏ hiển thị trước.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Quyền xem (từ)</label>
              <select value={viewRole} onChange={(e) => setViewRole(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-vicem-400 focus:outline-none">
                <option value="trainee">Thực tập sinh</option>
                <option value="officer">Cán bộ</option>
                <option value="admin">Quản trị</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Quyền quản lý (từ)</label>
              <select value={manageRole} onChange={(e) => setManageRole(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-vicem-400 focus:outline-none">
                <option value="officer">Cán bộ</option>
                <option value="admin">Quản trị</option>
              </select>
            </div>
          </div>
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Hủy</button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-vicem-600 px-4 py-2 text-sm font-semibold text-white hover:bg-vicem-700 disabled:opacity-60">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}Lưu
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── MODAL QUẢN LÝ DANH MỤC ────────────────────────────────────
function CategoriesModal({ categories, onClose, onChanged }: {
  categories: Category[]; onClose: () => void; onChanged: () => void
}) {
  const [items, setItems] = useState<Category[]>(categories)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const refresh = async () => {
    const d = await api<{ categories: Category[] }>('/documents/categories')
    setItems(d.categories); onChanged()
  }

  const add = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true); setErr('')
    try {
      const nextOrder = (items.length ? items[items.length - 1].sort_order : 0) + 10
      await api('/documents/categories', { method: 'POST', body: { name, sort_order: nextOrder } })
      setNewName(''); await refresh()
    } catch (e: any) { setErr(e.message ?? 'Lỗi thêm danh mục') }
    finally { setBusy(false) }
  }

  const rename = async (id: number, name: string) => {
    await api(`/documents/categories/${id}`, { method: 'PATCH', body: { name } })
    await refresh()
  }
  const move = async (id: number, sort_order: number) => {
    await api(`/documents/categories/${id}`, { method: 'PATCH', body: { sort_order } })
    await refresh()
  }
  const remove = async (id: number) => {
    if (!confirm('Xóa danh mục này? Tài liệu đang dùng sẽ giữ nguyên tên danh mục cũ.')) return
    await api(`/documents/categories/${id}`, { method: 'DELETE' })
    await refresh()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">Quản lý danh mục</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100"><X className="h-5 w-5 text-slate-500" /></button>
        </div>

        <div className="mb-3 flex gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add() }}
            placeholder="Tên danh mục mới..."
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-vicem-400 focus:outline-none" />
          <button onClick={add} disabled={busy}
            className="rounded-lg bg-vicem-600 px-4 py-2 text-sm font-semibold text-white hover:bg-vicem-700 disabled:opacity-60">Thêm</button>
        </div>
        {err && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{err}</p>}

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {items.length === 0 && <p className="py-4 text-center text-sm text-slate-400">Chưa có danh mục nào.</p>}
          {items.map((c) => (
            <CategoryRow key={c.id} cat={c} onRename={rename} onMove={move} onRemove={remove} />
          ))}
        </div>
      </div>
    </div>
  )
}

function CategoryRow({ cat, onRename, onMove, onRemove }: {
  cat: Category
  onRename: (id: number, name: string) => void
  onMove: (id: number, sort: number) => void
  onRemove: (id: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(cat.name)
  return (
    <div className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
      <Tags className="h-4 w-4 shrink-0 text-vicem-500" />
      {editing ? (
        <>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') { onRename(cat.id, name.trim() || cat.name); setEditing(false) } }}
            className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm" />
          <button onClick={() => { onRename(cat.id, name.trim() || cat.name); setEditing(false) }}
            className="rounded p-1 text-emerald-600 hover:bg-emerald-50"><Check className="h-4 w-4" /></button>
          <button onClick={() => { setName(cat.name); setEditing(false) }}
            className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{cat.name}</span>
          <input type="number" defaultValue={cat.sort_order} title="Số thứ tự"
            onBlur={(e) => { const n = Number(e.target.value); if (n !== cat.sort_order) onMove(cat.id, n || 0) }}
            className="w-16 rounded border border-slate-200 px-2 py-0.5 text-center text-xs text-slate-500" />
          <div className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100">
            <button onClick={() => setEditing(true)} className="rounded p-1 text-slate-400 hover:bg-amber-50 hover:text-amber-600"><Pencil className="h-4 w-4" /></button>
            <button onClick={() => onRemove(cat.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
          </div>
        </>
      )}
    </div>
  )
}

// ── TRANG CHÍNH ───────────────────────────────────────────────
export default function DocumentsPage() {
  const { user } = useAuth()
  const hasSection = canAccess(user, 'tai-lieu')
  const userRole = user?.role as Role | undefined

  const [folders, setFolders] = useState<FolderRow[]>([])
  const [docs, setDocs]     = useState<DocRow[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr]       = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [viewing, setViewing]   = useState<DocRow | null>(null)
  const [uploadFolderId, setUploadFolderId] = useState<number | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [showCategories, setShowCategories] = useState(false)
  const [settingsFolder, setSettingsFolder] = useState<FolderRow | null>(null)

  const loadCategories = useCallback(async () => {
    try {
      const d = await api<{ categories: Category[] }>('/documents/categories')
      setCategories(d.categories)
    } catch { /* non-fatal */ }
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const data = await api<{ folders: FolderRow[]; documents: DocRow[] }>('/documents/tree')
      setFolders(data.folders)
      setDocs(data.documents)
      // Auto-expand top-level folders
      setExpanded(new Set(data.folders.filter((f) => f.parent_id == null).map((f) => f.id)))
    } catch (e: any) { setErr(e.message ?? 'Lỗi tải dữ liệu') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load(); loadCategories() }, [load, loadCategories])

  const toggle = (id: number) =>
    setExpanded((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  // ── handlers xóa / đổi tên ──
  const deleteDoc = async (id: number) => {
    if (!confirm('Xóa tài liệu này?')) return
    await api(`/documents/${id}`, { method: 'DELETE' })
    setDocs((prev) => prev.filter((d) => d.id !== id))
  }

  const renameDoc = async (id: number, patch: Partial<DocRow>) => {
    await api(`/documents/${id}`, { method: 'PATCH', body: patch })
    setDocs((prev) => prev.map((d) => d.id === id ? { ...d, ...patch } : d))
  }

  const deleteFolder = async (id: number) => {
    if (!confirm('Xóa thư mục và toàn bộ nội dung bên trong?')) return
    await api(`/documents/folders/${id}`, { method: 'DELETE' })
    load()
  }

  const renameFolder = async (id: number, name: string) => {
    await api(`/documents/folders/${id}`, { method: 'PATCH', body: { name } })
    setFolders((prev) => prev.map((f) => f.id === id ? { ...f, name } : f))
  }

  const saveFolderSettings = async (id: number, patch: Partial<FolderRow>) => {
    await api(`/documents/folders/${id}`, { method: 'PATCH', body: patch })
    setFolders((prev) => prev.map((f) => f.id === id ? { ...f, ...patch } : f))
  }

  const addFolder = async (parentId: number | null) => {
    const name = prompt('Tên thư mục mới:')?.trim()
    if (!name) return
    await api('/documents/folders', { method: 'POST', body: { name, parent_id: parentId } })
    load()
  }

  const handleUpload = (folderId: number | null) => {
    setUploadFolderId(folderId)
    setShowUpload(true)
  }

  // ── search mode: flat list ──
  const searchResults = search.trim()
    ? docs.filter((d) => d.name.toLowerCase().includes(search.toLowerCase()) || d.category.toLowerCase().includes(search.toLowerCase()))
    : null

  const { roots, rootDocs } = buildTree(folders, docs)

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Tài liệu hồ sơ</h1>
            <p className="mt-1 text-sm text-slate-500">Kho tài liệu an toàn lao động &amp; môi trường</p>
          </div>
          {hasSection && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setShowCategories(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                <Tags className="h-4 w-4" /> Danh mục
              </button>
              <button onClick={() => addFolder(null)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100">
                <FolderPlus className="h-4 w-4" /> Thư mục mới
              </button>
              <button onClick={() => handleUpload(null)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-vicem-600 px-4 py-2 text-sm font-semibold text-white hover:bg-vicem-700">
                <Upload className="h-4 w-4" /> Tải lên
              </button>
            </div>
          )}
        </div>

        {/* Search */}
        <div className="mb-5 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm tài liệu..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-4 text-sm shadow-sm focus:border-vicem-400 focus:outline-none focus:ring-1 focus:ring-vicem-400" />
          </div>
          {search && (
            <button onClick={() => setSearch('')}
              className="rounded-xl border border-slate-200 bg-white p-2 text-slate-400 hover:bg-slate-50"><X className="h-4 w-4" /></button>
          )}
        </div>

        <Card className="overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="mr-2 h-6 w-6 animate-spin" /> Đang tải...
            </div>
          )}
          {err && !loading && (
            <div className="p-6 text-center text-sm text-red-500">{err}</div>
          )}

          {!loading && !err && (
            <div className="p-3">
              {/* Search results: flat list — chỉ cho quản lý nếu đủ quyền, ở đây dùng hasSection */}
              {searchResults !== null && (
                searchResults.length === 0
                  ? <p className="py-10 text-center text-sm text-slate-400">Không tìm thấy tài liệu nào.</p>
                  : searchResults.map((d) => (
                      <DocItem key={d.id} doc={d} depth={0} canEdit={hasSection}
                        onView={setViewing} onDelete={deleteDoc} onRename={renameDoc} folders={folders} />
                    ))
              )}

              {/* Tree view */}
              {searchResults === null && (
                <>
                  {roots.length === 0 && rootDocs.length === 0 && (
                    <p className="py-10 text-center text-sm text-slate-400">
                      Chưa có tài liệu nào.{hasSection && ' Bấm "Tải lên" để thêm tài liệu mới.'}
                    </p>
                  )}
                  {roots.map((node) => (
                    <FolderNodeView key={node.id} node={node} depth={0} hasSection={hasSection} userRole={userRole}
                      onView={setViewing} onDeleteDoc={deleteDoc} onRenameDoc={renameDoc}
                      onDeleteFolder={deleteFolder} onRenameFolder={renameFolder}
                      onAddFolder={addFolder} onUpload={handleUpload} onSettings={setSettingsFolder}
                      expanded={expanded} onToggle={toggle} folders={folders} />
                  ))}
                  {rootDocs.map((d) => (
                    <DocItem key={d.id} doc={d} depth={0} canEdit={hasSection}
                      onView={setViewing} onDelete={deleteDoc} onRename={renameDoc} folders={folders} />
                  ))}
                </>
              )}
            </div>
          )}
        </Card>
      </div>

      {viewing && <ViewerModal doc={viewing} onClose={() => setViewing(null)} />}
      {showUpload && (
        <UploadModal folders={folders} categories={categories} defaultFolderId={uploadFolderId}
          onClose={() => setShowUpload(false)}
          onDone={() => { setShowUpload(false); load() }} />
      )}
      {showCategories && (
        <CategoriesModal categories={categories} onClose={() => setShowCategories(false)}
          onChanged={loadCategories} />
      )}
      {settingsFolder && (
        <FolderSettingsModal folder={settingsFolder} onClose={() => setSettingsFolder(null)}
          onSave={(patch) => saveFolderSettings(settingsFolder.id, patch)} />
      )}
    </div>
  )
}
