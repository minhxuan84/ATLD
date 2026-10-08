import { useEffect, useState } from 'react'
import { fetchBlobUrl } from '../../lib/api'
import { fmtDate } from '../../lib/date'

// Mỗi ảnh tải độc lập: ảnh hỏng không chặn các ảnh khác, URL luôn thu hồi khi đóng.
export default function InspectionPhoto({ id, fileName, takenAt }: { id: number; fileName: string; takenAt: string }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    let objectUrl = ''
    setUrl(''); setError('')
    ;(async () => {
      try {
        objectUrl = await fetchBlobUrl(`/hse/inspection-photos/${id}/file`)
        const image = new Image()
        image.src = objectUrl
        await image.decode()
        if (active) setUrl(objectUrl)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Không đọc được ảnh.')
      } finally {
        if (!active && objectUrl) URL.revokeObjectURL(objectUrl)
      }
    })()
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [id, attempt])
  if (error) return <div className="w-28 min-h-24 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700" title={`${fileName}: ${error}`}>
    Không hiển thị được ảnh.
    <button onClick={() => setAttempt((n) => n + 1)} className="block mt-1 underline">Thử lại</button>
  </div>
  if (!url) return <div className="w-24 h-24 rounded border grid place-items-center text-xs text-gray-400">Đang tải…</div>
  return <a href={url} target="_blank" rel="noopener noreferrer" className="block">
    <img src={url} alt={fileName} className="w-24 h-24 object-cover rounded border hover:opacity-75" title={`${fileName} — ${fmtDate(takenAt)}`} />
  </a>
}
