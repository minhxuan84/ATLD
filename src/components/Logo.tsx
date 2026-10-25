// Logo VICEM Hà Tiên tái hiện bằng SVG theo bộ nhận diện:
// khối chữ "VC" xanh, chữ VICEM xanh dương, HÀ TIÊN đỏ, biểu tượng ngựa.
import { useConfig } from '../context/ConfigContext'

export default function Logo({ className = '', size = 'md' }: { className?: string; size?: 'md' | 'lg' }) {
  const { config } = useConfig()
  const box = size === 'lg' ? 48 : 40
  return (
    <span className={`flex items-center ${className}`} aria-label={`${config.brand_name_top} ${config.brand_name_bottom}`}>
      {/* Logo: ảnh tải lên nếu có, ngược lại dùng biểu trưng SVG mặc định */}
      {config.logo_url ? (
        <img src={config.logo_url} alt={`${config.brand_name_top} ${config.brand_name_bottom}`} height={box} className="shrink-0 object-contain" style={{ height: box }} />
      ) : (
        <svg width={box} height={box} viewBox="0 0 40 40" role="img" aria-hidden className="shrink-0">
          <rect width="40" height="40" rx="6" fill="#0055A4" />
          <path d="M8 10 L14 26 L17 26 L11 10 Z" fill="#fff" />
          <path d="M30 12 a8 8 0 1 0 0 16 a8 8 0 0 1 0 -16 Z" fill="#E2231A" />
          <path d="M16 10 L22 26 L25 26 L19 10 Z" fill="#fff" opacity="0.85" />
        </svg>
      )}
    </span>
  )
}
