import { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api'
import RichText from '../../components/RichText'
import { fmtDateTime } from '../../lib/date'
import {
  Plus, Trash2, Pencil, X, Check, Rss, Clock, RefreshCw,
  ToggleLeft, ToggleRight, Eye, Send, AlertTriangle,
} from 'lucide-react'

const CATEGORIES = ['Thông báo', 'Sự kiện', 'Cảnh báo an toàn', 'Môi trường']
const CAT_COLOR: Record<string, string> = {
  'Thông báo':         'bg-vicem-100 text-vicem-700',
  'Sự kiện':           'bg-eco-100 text-eco-700',
  'Cảnh báo an toàn':  'bg-amber-100 text-amber-700',
  'Môi trường':        'bg-teal-100 text-teal-700',
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface NewsRow {
  id: number; title: string; category: string
  excerpt: string; content: string; author: string; date: string
}
interface DraftRow {
  id: number; title: string; category: string; excerpt: string
  source_name: string | null; source_url: string | null
  fetched_at: string | null; created_at: string
}
interface SourceRow {
  id: number; name: string; url: string; enabled: boolean
  interval_minutes: number; category: string | null
  last_fetched_at: string | null; last_status: string | null
  last_error: string | null; created_at: string
}

const EMPTY_NEWS = { id: 0, title: '', category: 'Thông báo', content: '' }
const EMPTY_SRC  = { id: 0, name: '', url: 'https://', interval_minutes: 180, category: 'Môi trường' }

// ─── Gợi ý nguồn RSS sẵn có ───────────────────────────────────────────────────
const RSS_SUGGESTIONS = [
  { name: 'Bộ TN&MT',   url: 'https://monre.gov.vn/rss/tintuc.aspx' },
  { name: 'TCMT (VEA)', url: 'https://vea.gov.vn/vn/tintuc/tinmoi/rss.xml' },
  { name: 'VICEM',      url: 'https://vicem.vn/rss/news' },
]

type Tab = 'published' | 'sources' | 'drafts'

export default function NewsManager() {
  const [tab, setTab] = useState<Tab>('published')

  // ── Tab: tin đã đăng ──────────────────────────────────────────────────────
  const [items,   setItems]   = useState<NewsRow[]>([])
  const [editing, setEditing] = useState<typeof EMPTY_NEWS | null>(null)
  const [saving,  setSaving]  = useState(false)
  const [newsErr, setNewsErr] = useState('')

  const fetchNews = useCallback(() => {
    api<{ news: NewsRow[] }>('/news').then((d) => setItems(d.news)).catch(() => {})
  }, [])
  useEffect(fetchNews, [fetchNews])

  const startNew  = () => { setNewsErr(''); setEditing({ ...EMPTY_NEWS }) }
  const startEdit = (n: NewsRow) => {
    setNewsErr('')
    setEditing({ id: n.id, title: n.title, category: n.category, content: n.content })
  }
  const cancelNews = () => { setEditing(null); setNewsErr('') }

  const saveNews = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing) return
    if (!editing.title.trim() || !editing.content.trim()) { setNewsErr('Cần tiêu đề và nội dung.'); return }
    setSaving(true); setNewsErr('')
    try {
      const body = { title: editing.title, category: editing.category, content: editing.content }
      if (editing.id) await api(`/news/${editing.id}`, { method: 'PUT', body })
      else            await api('/news', { method: 'POST', body })
      setEditing(null); fetchNews()
    } catch (err) {
      setNewsErr(err instanceof Error ? err.message : 'Lưu thất bại.')
    } finally { setSaving(false) }
  }

  const removeNews = async (id: number) => {
    if (!confirm('Xóa tin này?')) return
    await api(`/news/${id}`, { method: 'DELETE' })
    fetchNews()
  }

  // ── Tab: nguồn RSS ────────────────────────────────────────────────────────
  const [sources,    setSources]    = useState<SourceRow[]>([])
  const [srcEditing, setSrcEditing] = useState<typeof EMPTY_SRC | null>(null)
  const [srcSaving,  setSrcSaving]  = useState(false)
  const [srcErr,     setSrcErr]     = useState('')
  const [fetchingId, setFetchingId] = useState<number | null>(null)

  const loadSources = useCallback(() => {
    api<{ sources: SourceRow[] }>('/news-sources').then((d) => setSources(d.sources)).catch(() => {})
  }, [])
  useEffect(() => { if (tab === 'sources') loadSources() }, [tab, loadSources])

  const cancelSrc = () => { setSrcEditing(null); setSrcErr('') }

  const saveSrc = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!srcEditing) return
    setSrcSaving(true); setSrcErr('')
    try {
      const body = {
        name: srcEditing.name, url: srcEditing.url,
        interval_minutes: srcEditing.interval_minutes, category: srcEditing.category,
      }
      if (srcEditing.id) await api(`/news-sources/${srcEditing.id}`, { method: 'PATCH', body })
      else               await api('/news-sources', { method: 'POST', body })
      setSrcEditing(null); loadSources()
    } catch (err) {
      setSrcErr(err instanceof Error ? err.message : 'Lưu thất bại.')
    } finally { setSrcSaving(false) }
  }

  const toggleSrc = async (src: SourceRow) => {
    await api(`/news-sources/${src.id}`, { method: 'PATCH', body: { enabled: !src.enabled } })
    loadSources()
  }

  const deleteSrc = async (id: number) => {
    if (!confirm('Xóa nguồn này? Các tin đã lấy vẫn được giữ.')) return
    await api(`/news-sources/${id}`, { method: 'DELETE' })
    loadSources()
  }

  const fetchNow = async (src: SourceRow) => {
    setFetchingId(src.id)
    try {
      const r = await api<{ added: number; error?: string }>(`/news-sources/${src.id}/fetch-now`, { method: 'POST' })
      alert(r.error ? `Lỗi: ${r.error}` : `Lấy xong — thêm ${r.added} tin mới.`)
      loadSources()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Lỗi không xác định.')
    } finally { setFetchingId(null) }
  }

  // ── Tab: chờ duyệt ────────────────────────────────────────────────────────
  const [drafts,     setDrafts]    = useState<DraftRow[]>([])
  const [previewId,  setPreviewId] = useState<number | null>(null)
  const [publishing, setPublishing] = useState<number | null>(null)

  const loadDrafts = useCallback(() => {
    api<{ drafts: DraftRow[] }>('/news/drafts').then((d) => setDrafts(d.drafts)).catch(() => {})
  }, [])
  useEffect(() => { if (tab === 'drafts') loadDrafts() }, [tab, loadDrafts])

  const publishDraft = async (id: number) => {
    setPublishing(id)
    try {
      await api(`/news/${id}/publish`, { method: 'PATCH' })
      setDrafts((prev) => prev.filter((d) => d.id !== id))
    } finally { setPublishing(null) }
  }

  const deleteDraft = async (id: number) => {
    if (!confirm('Xóa bản nháp này?')) return
    await api(`/news/${id}`, { method: 'DELETE' })
    setDrafts((prev) => prev.filter((d) => d.id !== id))
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  const tabCls = (t: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
      tab === t ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'
    }`

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Tin tức &amp; bài viết</h1>
          <p className="mt-0.5 text-slate-500 text-sm">Quản lý tin gõ tay, nguồn RSS và duyệt tin tự động.</p>
        </div>
        {tab === 'published' && !editing && (
          <button onClick={startNew}
            className="inline-flex items-center gap-2 rounded-lg bg-vicem-600 px-4 py-2 font-semibold text-white hover:bg-vicem-700">
            <Plus className="h-4 w-4" /> Viết bài mới
          </button>
        )}
        {tab === 'sources' && !srcEditing && (
          <button onClick={() => setSrcEditing({ ...EMPTY_SRC })}
            className="inline-flex items-center gap-2 rounded-lg bg-eco-600 px-4 py-2 font-semibold text-white hover:bg-eco-700">
            <Plus className="h-4 w-4" /> Thêm nguồn
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit mb-5">
        <button className={tabCls('published')} onClick={() => setTab('published')}>Đã đăng</button>
        <button className={tabCls('sources')} onClick={() => setTab('sources')}>
          <span className="flex items-center gap-1.5"><Rss className="h-3.5 w-3.5" />Nguồn tự động</span>
        </button>
        <button className={tabCls('drafts')} onClick={() => setTab('drafts')}>
          Chờ duyệt {drafts.length > 0 && tab !== 'drafts' && (
            <span className="ml-1 rounded-full bg-amber-500 text-white text-[10px] font-bold px-1.5">
              {drafts.length}
            </span>
          )}
        </button>
      </div>

      {/* ─────────── Tab: đã đăng ─────────── */}
      {tab === 'published' && (
        <>
          {editing ? (
            <form onSubmit={saveNews} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-800">{editing.id ? 'Sửa bài viết' : 'Bài viết mới'}</h2>
                <button type="button" onClick={cancelNews} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
                <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  placeholder="Tiêu đề bài viết" maxLength={200}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-vicem-500 focus:ring-2 focus:ring-vicem-100" />
                <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Nội dung</label>
                <RichText value={editing.content} onChange={(html) => setEditing({ ...editing, content: html })} />
              </div>
              {newsErr && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{newsErr}</p>}
              <div className="flex gap-3">
                <button type="submit" disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-vicem-600 px-5 py-2.5 font-semibold text-white hover:bg-vicem-700 disabled:opacity-60">
                  <Check className="h-4 w-4" /> {editing.id ? 'Cập nhật' : 'Đăng bài'}
                </button>
                <button type="button" onClick={cancelNews}
                  className="rounded-lg border border-slate-300 px-5 py-2.5 font-medium text-slate-600 hover:bg-slate-50">Hủy</button>
              </div>
            </form>
          ) : (
            <div className="space-y-2">
              {items.length === 0 && (
                <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-400">
                  Chưa có bài viết nào.
                </p>
              )}
              {items.map((n) => (
                <div key={n.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${CAT_COLOR[n.category] ?? 'bg-slate-100 text-slate-600'}`}>
                    {n.category}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-800">{n.title}</p>
                    <p className="truncate text-xs text-slate-400">{n.author} · {n.date} · {n.excerpt}</p>
                  </div>
                  <button onClick={() => startEdit(n)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-vicem-50 hover:text-vicem-600" aria-label={`Sửa ${n.title}`}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => removeNews(n.id)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Xóa ${n.title}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ─────────── Tab: nguồn RSS ─────────── */}
      {tab === 'sources' && (
        <div className="space-y-4">
          {/* Form thêm / sửa nguồn */}
          {srcEditing && (
            <form onSubmit={saveSrc} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-800">{srcEditing.id ? 'Sửa nguồn' : 'Thêm nguồn RSS'}</h2>
                <button type="button" onClick={cancelSrc} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Tên nguồn <span className="text-red-500">*</span></label>
                  <input value={srcEditing.name} onChange={(e) => setSrcEditing({ ...srcEditing, name: e.target.value })}
                    placeholder="Ví dụ: Bộ TN&MT" maxLength={120}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-eco-500 focus:ring-2 focus:ring-eco-100" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Danh mục tin lấy về</label>
                  <select value={srcEditing.category ?? 'Môi trường'} onChange={(e) => setSrcEditing({ ...srcEditing, category: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">URL RSS (phải bắt đầu bằng https://) <span className="text-red-500">*</span></label>
                <input value={srcEditing.url} onChange={(e) => setSrcEditing({ ...srcEditing, url: e.target.value })}
                  placeholder="https://..." maxLength={500} type="url"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-eco-500 focus:ring-2 focus:ring-eco-100" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Chu kỳ quét (phút, tối thiểu 15)</label>
                <input type="number" min={15} max={1440} value={srcEditing.interval_minutes}
                  onChange={(e) => setSrcEditing({ ...srcEditing, interval_minutes: Number(e.target.value) })}
                  className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              {/* Gợi ý nhanh */}
              {!srcEditing.id && (
                <div>
                  <p className="text-xs text-slate-500 mb-2">Gợi ý nhanh:</p>
                  <div className="flex flex-wrap gap-2">
                    {RSS_SUGGESTIONS.map((s) => (
                      <button key={s.url} type="button"
                        onClick={() => setSrcEditing({ ...srcEditing, name: s.name, url: s.url })}
                        className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-eco-400 hover:text-eco-700">
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {srcErr && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{srcErr}</p>}
              <div className="flex gap-3">
                <button type="submit" disabled={srcSaving}
                  className="inline-flex items-center gap-2 rounded-lg bg-eco-600 px-5 py-2.5 font-semibold text-white hover:bg-eco-700 disabled:opacity-60">
                  <Check className="h-4 w-4" /> Lưu nguồn
                </button>
                <button type="button" onClick={cancelSrc}
                  className="rounded-lg border border-slate-300 px-5 py-2.5 font-medium text-slate-600 hover:bg-slate-50">Hủy</button>
              </div>
            </form>
          )}

          {/* Danh sách nguồn */}
          {sources.length === 0 && !srcEditing && (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-400">
              Chưa có nguồn nào. Nhấn "Thêm nguồn" để bắt đầu.
            </p>
          )}
          {sources.map((src) => (
            <div key={src.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start gap-3">
                <Rss className={`h-5 w-5 flex-shrink-0 mt-0.5 ${src.enabled ? 'text-eco-600' : 'text-slate-300'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-800">{src.name}</span>
                    {src.category && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CAT_COLOR[src.category] ?? 'bg-slate-100 text-slate-600'}`}>
                        {src.category}
                      </span>
                    )}
                    {!src.enabled && (
                      <span className="rounded-full bg-slate-100 text-slate-500 px-2 py-0.5 text-xs">Đã tắt</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 truncate mt-0.5">{src.url}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{src.interval_minutes} phút</span>
                    {src.last_fetched_at ? (
                      <span>Quét cuối: {fmtDateTime(src.last_fetched_at)}</span>
                    ) : (
                      <span className="text-slate-400">Chưa quét lần nào</span>
                    )}
                    {src.last_status === 'ok' && <span className="text-eco-600 font-medium">✓ OK</span>}
                    {src.last_status === 'error' && (
                      <span className="flex items-center gap-1 text-red-600">
                        <AlertTriangle className="h-3 w-3" />{src.last_error?.slice(0, 80)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => fetchNow(src)} disabled={fetchingId === src.id} title="Quét ngay"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-eco-50 hover:text-eco-600 disabled:opacity-50">
                    <RefreshCw className={`h-4 w-4 ${fetchingId === src.id ? 'animate-spin' : ''}`} />
                  </button>
                  <button onClick={() => toggleSrc(src)} title={src.enabled ? 'Tắt nguồn' : 'Bật nguồn'}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-eco-50 hover:text-eco-600">
                    {src.enabled ? <ToggleRight className="h-4 w-4 text-eco-600" /> : <ToggleLeft className="h-4 w-4" />}
                  </button>
                  <button onClick={() => setSrcEditing({ id: src.id, name: src.name, url: src.url, interval_minutes: src.interval_minutes, category: src.category ?? 'Môi trường' })}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-vicem-50 hover:text-vicem-600">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => deleteSrc(src.id)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─────────── Tab: chờ duyệt ─────────── */}
      {tab === 'drafts' && (
        <div className="space-y-3">
          {drafts.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-400">
              Không có tin nào đang chờ duyệt.
            </p>
          )}
          {drafts.map((d) => (
            <div key={d.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${CAT_COLOR[d.category] ?? 'bg-slate-100 text-slate-600'}`}>
                      {d.category}
                    </span>
                    {d.source_name && (
                      <span className="flex items-center gap-1 text-xs text-slate-400">
                        <Rss className="h-3 w-3" />{d.source_name}
                      </span>
                    )}
                    <span className="text-xs text-slate-400">{fmtDateTime(d.created_at)}</span>
                  </div>
                  <p className="font-medium text-slate-800 truncate">{d.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{d.excerpt}</p>
                  {d.source_url && (
                    <a href={d.source_url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-vicem-600 hover:underline mt-0.5 block truncate">
                      {d.source_url}
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => setPreviewId(previewId === d.id ? null : d.id)} title="Xem nội dung"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
                    <Eye className="h-4 w-4" />
                  </button>
                  <button onClick={() => publishDraft(d.id)} disabled={publishing === d.id} title="Duyệt đăng"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-eco-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-eco-700 disabled:opacity-60">
                    <Send className="h-3.5 w-3.5" />
                    {publishing === d.id ? 'Đang duyệt...' : 'Đăng'}
                  </button>
                  <button onClick={() => deleteDraft(d.id)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {/* Xem trước nội dung */}
              {previewId === d.id && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <DraftPreview id={d.id} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Tải và hiển thị nội dung full của một bản nháp (lazy, chỉ khi mở)
function DraftPreview({ id }: { id: number }) {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    // Dùng endpoint staff /news/:id (không có filter published)
    api<{ item: { content: string } }>(`/admin/news/${id}/preview`)
      .then((d) => setHtml(d.item.content))
      .catch(() => setHtml('<p class="text-red-500">Không tải được nội dung.</p>'))
  }, [id])
  if (!html) return <p className="text-xs text-slate-400">Đang tải...</p>
  return (
    <div
      className="prose prose-sm max-w-none text-slate-700"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
