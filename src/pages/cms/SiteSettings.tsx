import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useConfig } from '../../context/ConfigContext'
import Logo from '../../components/Logo'
import ImageUpload from './ImageUpload'
import { FIELD_ICONS, MAX_FIELD_CARDS, readFieldCards, type FieldCard } from '../../lib/fieldIcons'
import { Save, Check, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react'

// Nhóm các trường cấu hình để hiển thị theo khu vực
const GROUPS: { title: string; fields: { key: string; label: string; multiline?: boolean }[] }[] = [
  {
    title: 'Thương hiệu (Logo)',
    fields: [
      { key: 'brand_name_top', label: 'Tên dòng trên (vd: VICEM)' },
      { key: 'brand_name_bottom', label: 'Tên dòng dưới (vd: HÀ TIÊN)' },
    ],
  },
  {
    title: 'Banner trang chủ (Hero)',
    fields: [
      { key: 'hero_badge', label: 'Nhãn nhỏ phía trên tiêu đề' },
      { key: 'hero_title', label: 'Tiêu đề chính' },
      { key: 'hero_subtitle', label: 'Mô tả', multiline: true },
    ],
  },
  {
    title: 'Thông tin liên hệ',
    fields: [
      { key: 'contact_address', label: 'Địa chỉ' },
      { key: 'contact_phone', label: 'Điện thoại' },
      { key: 'contact_email', label: 'Email' },
    ],
  },
  {
    title: 'Chân trang (Footer)',
    fields: [
      { key: 'footer_text', label: 'Dòng bản quyền', multiline: true },
      { key: 'footer_note', label: 'Ghi chú tuân thủ', multiline: true },
    ],
  },
]

export default function SiteSettings() {
  const { config, reload } = useConfig()
  const [form, setForm] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Thẻ "Lĩnh vực hoạt động" giữ riêng dạng mảng; khi lưu mới ghép vào fields_cards.
  const [cards, setCards] = useState<FieldCard[]>([])

  useEffect(() => {
    setForm(config)
    setCards(readFieldCards(config))
  }, [config])

  const updateCard = (i: number, patch: Partial<FieldCard>) =>
    setCards((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const addCard = () =>
    setCards((cs) => (cs.length >= MAX_FIELD_CARDS ? cs : [...cs, { title: '', desc: '', link: '', icon: '' }]))
  const removeCard = (i: number) => {
    const c = cards[i]
    if (c.title.trim() && !confirm(`Xóa thẻ "${c.title}"?`)) return
    setCards((cs) => (cs.length <= 1 ? cs : cs.filter((_, j) => j !== i)))
  }
  const moveCard = (i: number, d: -1 | 1) =>
    setCards((cs) => {
      const j = i + d
      if (j < 0 || j >= cs.length) return cs
      const next = [...cs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setSaved(false)
    try {
      await api('/config', { method: 'PUT', body: { ...form, fields_cards: JSON.stringify(cards) } })
      reload()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lưu thất bại.')
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Trang tĩnh &amp; Nhận diện</h1>
      <p className="mt-1 text-slate-500">Cập nhật logo, banner, thông tin liên hệ và chân trang hiển thị trên toàn hệ thống.</p>

      {/* Xem trước logo */}
      <div className="mt-5 flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4">
        <span className="text-sm text-slate-500">Xem trước logo:</span>
        <Logo size="lg" />
      </div>

      {/* Tải logo & ảnh banner (lưu ngay khi tải, không cần bấm Lưu) */}
      <div className="mt-6 space-y-5 rounded-2xl border border-slate-200 bg-white p-5">
        <div>
          <h2 className="font-semibold text-slate-800">Hình ảnh nhận diện</h2>
          <p className="text-sm text-slate-500">Ảnh được áp dụng ngay sau khi tải lên. Để trống sẽ dùng logo/ảnh mặc định.</p>
        </div>
        <ImageUpload
          configKey="logo_url" label="Logo công ty"
          hint="Nền trong suốt (PNG) hiển thị đẹp nhất. Để trống dùng biểu trưng mặc định."
          currentUrl={config.logo_url ?? ''} onChange={reload} aspect="aspect-[3/1]"
        />
        <div className="grid gap-5 border-t border-slate-100 pt-5 md:grid-cols-3">
          {(['hero_image_1', 'hero_image_2', 'hero_image_3'] as const).map((k, i) => (
            <ImageUpload
              key={k} configKey={k} label={`Ảnh banner ${i + 1}`}
              hint="Tỷ lệ ngang (16:9), tối thiểu 1600px."
              currentUrl={config[k] ?? ''} onChange={reload}
            />
          ))}
        </div>
      </div>

      <form onSubmit={save} className="mt-6 space-y-6">
        {GROUPS.map((g) => (
          <div key={g.title} className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-800">{g.title}</h2>
            <div className="mt-3 space-y-3">
              {g.fields.map((f) => (
                <div key={f.key}>
                  <label className="block text-sm font-medium text-slate-700">{f.label}</label>
                  {f.multiline ? (
                    <textarea
                      value={form[f.key] ?? ''} rows={2}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  ) : (
                    <input
                      value={form[f.key] ?? ''}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Những con số biết nói (trang chủ) */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-800">Những con số biết nói (trang chủ)</h2>
          <p className="text-sm text-slate-500">4 chỉ số nổi bật ở khu "Năng lực". Phần số sẽ tự đếm từ 0 khi khách cuộn tới (vd: <b>1.200+</b>, <b>92%</b>).</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Chỉ số {n}</p>
                <div className="mt-2 grid grid-cols-[110px_1fr] gap-2">
                  <div>
                    <label className="block text-xs text-slate-500">Giá trị</label>
                    <input
                      value={form[`stat_${n}_value`] ?? ''} maxLength={20}
                      onChange={(e) => setForm({ ...form, [`stat_${n}_value`]: e.target.value })}
                      placeholder="1.200+" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Nhãn</label>
                    <input
                      value={form[`stat_${n}_label`] ?? ''} maxLength={80}
                      onChange={(e) => setForm({ ...form, [`stat_${n}_label`]: e.target.value })}
                      placeholder="Chứng chỉ đã cấp" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Lĩnh vực hoạt động (trang chủ) */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-800">Lĩnh vực hoạt động (trang chủ)</h2>
          <p className="text-sm text-slate-500">
            Các thẻ giới thiệu mảng hoạt động (1–{MAX_FIELD_CARDS} thẻ, thêm/bớt/sắp xếp được).
            Mỗi thẻ cần tiêu đề. Đường dẫn phải là đường dẫn trong hệ thống, bắt đầu bằng
            <b> /</b> (vd: <code className="rounded bg-slate-100 px-1">/huan-luyen</code>).
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-700">Nhãn nhỏ phía trên tiêu đề</label>
              <input
                value={form.fields_eyebrow ?? ''} maxLength={60}
                onChange={(e) => setForm({ ...form, fields_eyebrow: e.target.value })}
                placeholder="Lĩnh vực hoạt động"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Tiêu đề khu</label>
              <input
                value={form.fields_heading ?? ''} maxLength={160}
                onChange={(e) => setForm({ ...form, fields_heading: e.target.value })}
                placeholder="Các chức năng chính của hệ thống"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {cards.map((c, i) => {
              const Preview = c.icon ? FIELD_ICONS[c.icon]?.icon : undefined
              return (
                <div key={i} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Thẻ {i + 1}</p>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => moveCard(i, -1)} disabled={i === 0}
                        aria-label={`Đưa thẻ ${i + 1} lên trước`} title="Lên trước"
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30">
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => moveCard(i, 1)} disabled={i === cards.length - 1}
                        aria-label={`Đưa thẻ ${i + 1} ra sau`} title="Ra sau"
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30">
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => removeCard(i)} disabled={cards.length <= 1}
                        aria-label={`Xóa thẻ ${i + 1}`} title={cards.length <= 1 ? 'Cần giữ ít nhất 1 thẻ' : 'Xóa thẻ'}
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 space-y-2">
                    <div>
                      <label className="block text-xs text-slate-500">Tiêu đề <span className="text-red-500">*</span></label>
                      <input
                        value={c.title} maxLength={80} required
                        onChange={(e) => updateCard(i, { title: e.target.value })}
                        placeholder="Huấn luyện ATLĐ"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500">Mô tả</label>
                      <textarea
                        value={c.desc} maxLength={300} rows={3}
                        onChange={(e) => updateCard(i, { desc: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-slate-500">Đường dẫn</label>
                        <input
                          value={c.link} maxLength={120}
                          onChange={(e) => updateCard(i, { link: e.target.value })}
                          placeholder="/huan-luyen"
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500">Biểu tượng</label>
                        <div className="mt-1 flex items-center gap-2">
                          <select
                            value={c.icon}
                            onChange={(e) => updateCard(i, { icon: e.target.value })}
                            className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                          >
                            <option value="">— Mặc định —</option>
                            {Object.entries(FIELD_ICONS).map(([k, v]) => (
                              <option key={k} value={k}>{v.label}</option>
                            ))}
                          </select>
                          {/* Xem trước ngay: tên icon là tiếng Anh, không ai nhớ nổi
                              'ClipboardCheck' trông thế nào. */}
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                            {Preview ? <Preview className="h-5 w-5" /> : <span className="text-[10px]">mặc định</span>}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={addCard} disabled={cards.length >= MAX_FIELD_CARDS}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:border-vicem-400 hover:text-vicem-700 disabled:opacity-40">
              <Plus className="h-4 w-4" /> Thêm thẻ
            </button>
            <span className="text-xs text-slate-400">{cards.length}/{MAX_FIELD_CARDS} thẻ</span>
          </div>
        </div>

        {/* Hiển thị nhóm mục tiêu trên trang chủ */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-800">Kế hoạch mục tiêu (trang chủ)</h2>
          <p className="text-sm text-slate-500">Chọn nhóm nào mặc định xổ ra khi khách truy cập trang chủ. Khách vẫn có thể tự đóng/mở.</p>
          <div className="mt-3 space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={(form.goals_year_open ?? '1') !== '0'} onChange={(e) => setForm({ ...form, goals_year_open: e.target.checked ? '1' : '0' })} className="accent-vicem-600" />
              Mặc định xổ ra nhóm <b>Mục tiêu năm</b>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={(form.goals_month_open ?? '0') === '1'} onChange={(e) => setForm({ ...form, goals_month_open: e.target.checked ? '1' : '0' })} className="accent-vicem-600" />
              Mặc định xổ ra nhóm <b>Mục tiêu tháng</b>
            </label>
          </div>
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex items-center gap-3">
          <button type="submit" className="inline-flex items-center gap-2 rounded-lg bg-vicem-600 px-5 py-2.5 font-semibold text-white hover:bg-vicem-700">
            <Save className="h-4 w-4" /> Lưu thay đổi
          </button>
          {saved && <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600"><Check className="h-4 w-4" /> Đã lưu &amp; áp dụng</span>}
        </div>
      </form>
    </div>
  )
}
