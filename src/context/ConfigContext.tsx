import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { api } from '../lib/api'

export type SiteConfig = Record<string, string>
export interface MenuItem { id: number; label: string; href: string }

// Menu mặc định (fallback khi chưa tải xong hoặc API lỗi)
const DEFAULT_MENU: MenuItem[] = [
  { id: -1, label: 'Trang chủ', href: '#home' },
  { id: -2, label: 'Giới thiệu', href: '#gioi-thieu' },
  { id: -3, label: 'Lĩnh vực', href: '#linh-vuc' },
  { id: -4, label: 'Năng lực', href: '#nang-luc' },
  { id: -5, label: 'Tin tức', href: '#tin-tuc' },
  { id: -6, label: 'Liên hệ', href: '#lien-he' },
]

// Giá trị mặc định (fallback khi chưa tải xong hoặc API lỗi)
const DEFAULTS: SiteConfig = {
  brand_name_top: 'VICEM',
  brand_name_bottom: 'HÀ TIÊN',
  hero_title: 'An toàn lao động & Bảo vệ môi trường',
  hero_subtitle: 'Nền tảng huấn luyện số hóa: học mọi lúc mọi nơi, kiểm tra và cấp chứng chỉ trực tuyến — vì một môi trường làm việc an toàn, xanh, bền vững.',
  hero_badge: 'Công ty Cổ phần Xi măng VICEM Hà Tiên',
  contact_address: 'Km 8, Quốc lộ 80, Kiên Lương, Kiên Giang',
  contact_phone: '(0297) 3 853 004',
  contact_email: 'atld@vicemhatien.com.vn',
  footer_text: '© 2026 Công ty Cổ phần Xi măng VICEM Hà Tiên. Hệ thống huấn luyện số hóa.',
  footer_note: 'Tuân thủ Luật ATVSLĐ 84/2015/QH13 · Nghị định 44/2016/NĐ-CP',
  // Ảnh nhận diện (rỗng = dùng logo SVG / ảnh hero mặc định)
  logo_url: '',
  hero_image_1: '',
  hero_image_2: '',
  hero_image_3: '',
  // "Những con số biết nói" (giá trị hiển thị + nhãn). Giá trị đếm từ 0 khi cuộn tới.
  stat_1_value: '1.200+', stat_1_label: 'Chứng chỉ đã cấp',
  stat_2_value: '5.000+', stat_2_label: 'Giờ huấn luyện',
  stat_3_value: '92%', stat_3_label: 'Tỷ lệ đạt trắc nghiệm',
  stat_4_value: '0', stat_4_label: 'Tai nạn nghiêm trọng',
}

interface ConfigState {
  config: SiteConfig
  menu: MenuItem[]
  reload: () => void
}

const ConfigContext = createContext<ConfigState | null>(null)

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<SiteConfig>(DEFAULTS)
  const [menu, setMenu] = useState<MenuItem[]>(DEFAULT_MENU)

  const reload = useCallback(() => {
    api<{ config: SiteConfig }>('/config')
      .then((d) => setConfig({ ...DEFAULTS, ...d.config }))
      .catch(() => {})
    api<{ menu: MenuItem[] }>('/config/menu')
      .then((d) => { if (d.menu.length) setMenu(d.menu) })
      .catch(() => {})
  }, [])

  useEffect(reload, [reload])

  return <ConfigContext.Provider value={{ config, menu, reload }}>{children}</ConfigContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfig(): ConfigState {
  const ctx = useContext(ConfigContext)
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider')
  return ctx
}
