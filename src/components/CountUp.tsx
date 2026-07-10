import { useEffect, useRef, useState } from 'react'

// Đếm số từ 0 tới `end` khi `run` = true (dùng requestAnimationFrame, ease-out).
// `group` bật phân tách hàng nghìn kiểu Việt Nam (1200 -> 1.200); `prefix`/`suffix` thêm ký tự bao quanh.
export default function CountUp({
  end,
  run,
  duration = 1200,
  prefix = '',
  suffix = '',
  group = false,
}: {
  end: number
  run: boolean
  duration?: number
  prefix?: string
  suffix?: string
  group?: boolean
}) {
  const [value, setValue] = useState(0)
  const raf = useRef<number>()

  useEffect(() => {
    if (!run) return
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
      setValue(Math.round(eased * end))
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [run, end, duration])

  const text = group ? value.toLocaleString('vi-VN') : String(value)
  return <>{prefix}{text}{suffix}</>
}
