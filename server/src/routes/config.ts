import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth, requireSection } from '../auth.js'

export const configRouter = Router()

// Danh sách khóa hợp lệ + giới hạn độ dài, tránh ghi khóa lạ
const FIELDS: Record<string, number> = {
  brand_name_top: 40,
  brand_name_bottom: 40,
  hero_title: 200,
  hero_subtitle: 500,
  hero_badge: 200,
  contact_address: 200,
  contact_phone: 60,
  contact_email: 120,
  footer_text: 300,
  footer_note: 300,
  // Trạng thái mở/thu mặc định của nhóm mục tiêu Năm/Tháng ('1' = mở, '0' = thu)
  goals_year_open: 1,
  goals_month_open: 1,
  // "Những con số biết nói" trên trang chủ: 4 chỉ số (giá trị + nhãn). Giá trị có thể kèm +/%.
  stat_1_value: 20, stat_1_label: 80,
  stat_2_value: 20, stat_2_label: 80,
  stat_3_value: 20, stat_3_label: 80,
  stat_4_value: 20, stat_4_label: 80,
  // Khu "Lĩnh vực hoạt động" trên trang chủ: nhãn nhỏ, tiêu đề, và 4 thẻ.
  // field_N_icon lưu KHÓA icon (vd 'GraduationCap'), không lưu SVG — trang chủ tra
  // khóa đó trong một bảng whitelist, khóa lạ thì dùng icon mặc định.
  fields_eyebrow: 60, fields_heading: 160,
  field_1_title: 80, field_1_desc: 300, field_1_link: 120, field_1_icon: 40,
  field_2_title: 80, field_2_desc: 300, field_2_link: 120, field_2_icon: 40,
  field_3_title: 80, field_3_desc: 300, field_3_link: 120, field_3_icon: 40,
  field_4_title: 80, field_4_desc: 300, field_4_link: 120, field_4_icon: 40,
  // Danh sách thẻ thêm/bớt được (JSON). Có khóa này thì trang chủ bỏ qua field_N_*.
  // Giá trị được dựng lại ở normalizeFieldCards nên độ dài ở đây chỉ là trần an toàn.
  fields_cards: 8000,
}

const MAX_FIELD_CARDS = 8
const ICON_KEY = /^[A-Za-z]{1,40}$/

/**
 * Kiểm và dựng lại danh sách thẻ "Lĩnh vực hoạt động" từ client. Không lưu nguyên
 * chuỗi client gửi: chỉ giữ 4 trường biết trước, cắt độ dài, kiểm đường dẫn nội bộ.
 * Trả về chuỗi lỗi nếu không hợp lệ.
 */
function normalizeFieldCards(raw: unknown): { value: string } | { error: string } {
  let arr: unknown
  try { arr = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return { error: 'Danh sách thẻ lĩnh vực không hợp lệ.' } }
  if (!Array.isArray(arr)) return { error: 'Danh sách thẻ lĩnh vực không hợp lệ.' }
  if (arr.length === 0) return { error: 'Cần ít nhất 1 thẻ lĩnh vực.' }
  if (arr.length > MAX_FIELD_CARDS) return { error: `Tối đa ${MAX_FIELD_CARDS} thẻ lĩnh vực.` }
  const cards = []
  for (const [i, c] of arr.entries()) {
    const o = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
    const title = String(o.title ?? '').trim().slice(0, 80)
    const desc = String(o.desc ?? '').trim().slice(0, 300)
    const link = String(o.link ?? '').trim().slice(0, 120)
    const icon = String(o.icon ?? '').trim()
    if (!title) return { error: `Thẻ ${i + 1} chưa có tiêu đề.` }
    if (link && !SAFE_PATH.test(link)) {
      return { error: `Đường dẫn thẻ ${i + 1} phải bắt đầu bằng "/" (vd: /huan-luyen).` }
    }
    cards.push({ title, desc, link, icon: ICON_KEY.test(icon) ? icon : '' })
  }
  return { value: JSON.stringify(cards) }
}

/**
 * Khóa chứa đường dẫn (đi vào `to=` của <Link>), khác mọi khóa còn lại chỉ hiển thị
 * dạng text. Giá trị `javascript:…` ở đây là XSS, nên chỉ nhận đường dẫn nội bộ.
 * Chặn ngay tại tầng dữ liệu: người ghi được đã phải có quyền 'trang-tinh', nhưng
 * một giá trị sai lưu vào DB rồi thì mọi khách vào trang chủ đều ăn.
 */
const PATH_KEYS = /^field_\d_link$/
const SAFE_PATH = /^\/[\w\-/]*$/

// Công khai: đọc toàn bộ cấu hình trang tĩnh
configRouter.get('/', async (_req, res) => {
  const { rows } = await query<{ key: string; value: string }>('SELECT key, value FROM site_config')
  const config: Record<string, string> = {}
  for (const r of rows) config[r.key] = r.value
  res.json({ config })
})

// Công khai: menu điều hướng đang hiển thị (chỉ mục visible, đúng thứ tự)
configRouter.get('/menu', async (_req, res) => {
  const { rows } = await query(
    'SELECT id, label, href FROM menu_items WHERE visible = true ORDER BY sort_order, id',
  )
  res.json({ menu: rows })
})

// Admin: cập nhật cấu hình (chỉ các khóa cho phép, có escape + giới hạn)
configRouter.put('/', requireAuth, requireSection('trang-tinh'), async (req, res) => {
  const body = req.body ?? {}
  const updates = Object.entries(body).filter(([k]) => k in FIELDS)
  if (updates.length === 0) return res.status(400).json({ error: 'Không có trường hợp lệ để cập nhật.' })

  // Kiểm toàn bộ đường dẫn TRƯỚC khi ghi bất cứ khóa nào: nửa bộ giá trị đã lưu còn
  // nửa kia bị từ chối thì khu "Lĩnh vực" ra tình trạng lệch, khó lần ra nguyên nhân.
  for (const [i, [key, raw]] of updates.entries()) {
    if (key === 'fields_cards') {
      const r = normalizeFieldCards(raw)
      if ('error' in r) return res.status(400).json({ error: r.error })
      updates[i] = [key, r.value]
      continue
    }
    if (!PATH_KEYS.test(key)) continue
    const v = String(raw ?? '').trim()
    if (v && !SAFE_PATH.test(v)) {
      return res.status(400).json({
        error: `Đường dẫn của thẻ lĩnh vực phải là đường dẫn trong hệ thống, `
          + `bắt đầu bằng "/" (vd: /huan-luyen). Giá trị không hợp lệ: "${v.slice(0, 40)}".`,
      })
    }
  }

  for (const [key, raw] of updates) {
    // React tự escape khi render text node nên không escape ở đây (tránh double-escape);
    // chỉ trim và giới hạn độ dài. Giá trị chỉ hiển thị dưới dạng text, không render HTML thô.
    const value = String(raw ?? '').trim().slice(0, FIELDS[key])
    await query(
      `INSERT INTO site_config (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, value],
    )
  }
  res.json({ ok: true })
})
