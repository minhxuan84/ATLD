import { useState } from 'react'
import { Award, Printer, Download, FileText } from 'lucide-react'

export interface CertData {
  certId: string
  traineeName: string
  courseTitle: string
  score: number
  date: string
  /** PDF chứng nhận do server sinh (có ảnh + dấu PASSED). Null khi sinh PDF lỗi. */
  pdf_url?: string | null
}

interface Props {
  data: CertData
  /** Ảnh học viên để hiện trên chứng chỉ (blob URL của ảnh vừa chụp/tải). */
  photoUrl?: string | null
  /** PDF bài làm chi tiết do server sinh. */
  attemptPdfUrl?: string | null
}

export default function Certificate({ data, photoUrl, attemptPdfUrl }: Props) {
  const [downloading, setDownloading] = useState(false)

  // Dự phòng khi server không sinh được PDF: chụp phần tử #certificate bằng
  // html2canvas rồi ghép vào 1 trang PDF. Dynamic import để không phình bundle chính.
  const downloadClientPdf = async () => {
    setDownloading(true)
    try {
      const el = document.getElementById('certificate')
      if (!el) throw new Error('Không tìm thấy chứng chỉ.')
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ])
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
      const img = canvas.toDataURL('image/png')
      // Trang ngang, kích thước theo tỉ lệ ảnh để không méo.
      const pdf = new jsPDF({ orientation: canvas.width >= canvas.height ? 'landscape' : 'portrait', unit: 'px', format: [canvas.width, canvas.height] })
      pdf.addImage(img, 'PNG', 0, 0, canvas.width, canvas.height)
      pdf.save(`ChungChi_${data.certId}.pdf`)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Không tạo được PDF.')
    } finally {
      setDownloading(false)
    }
  }

  const btnPrimary = 'inline-flex items-center gap-2 rounded-lg bg-vicem-600 px-5 py-2.5 font-semibold text-white hover:bg-vicem-700 disabled:opacity-50'
  const btnOutline = 'inline-flex items-center gap-2 rounded-lg border border-vicem-600 px-5 py-2.5 font-semibold text-vicem-700 hover:bg-vicem-50'

  return (
    <div className="mt-4">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
        <p className="font-semibold">Chúc mừng! Bạn đã đạt bài trắc nghiệm với số điểm {data.score}%.</p>
      </div>

      <div className="mt-5 rounded-2xl border-4 border-double border-vicem-500 bg-white p-8" id="certificate">
        <div className={`flex flex-col items-center gap-6 ${photoUrl ? 'sm:flex-row sm:items-center' : ''}`}>
          {/* Ảnh học viên bên trái, dấu PASSED đóng chồng lên — giống bản PDF server. */}
          {photoUrl && (
            <div className="relative shrink-0">
              <img src={photoUrl} alt={`Ảnh học viên ${data.traineeName}`}
                className="h-40 w-32 rounded-lg border border-slate-300 object-cover" />
              <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 -rotate-12 rounded border-2 border-red-500/80 bg-white/40 px-2 py-0.5 text-sm font-extrabold tracking-widest text-red-600/80">
                PASSED
              </span>
            </div>
          )}

          <div className="flex-1 text-center">
            <div className="flex items-center justify-center gap-2 text-eco-600">
              <Award className="h-10 w-10" aria-hidden />
            </div>
            <p className="mt-2 text-sm font-bold uppercase tracking-widest text-vicem-500">VICEM Hà Tiên</p>
            <h3 className="mt-1 text-xl font-bold uppercase tracking-wide text-vicem-700">Chứng chỉ hoàn thành</h3>
            <p className="mt-1 text-sm text-slate-500">Huấn luyện An toàn, vệ sinh lao động</p>

            <p className="mt-6 text-slate-600">Chứng nhận ông/bà</p>
            <p className="mt-1 text-2xl font-bold text-slate-800">{data.traineeName}</p>
            <p className="mt-4 text-slate-600">đã hoàn thành khóa huấn luyện</p>
            <p className="mt-1 text-lg font-semibold text-vicem-700">“{data.courseTitle}”</p>
            <p className="mt-1 text-slate-600">với kết quả đạt <b>{data.score}%</b></p>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
          <span>Mã chứng chỉ: <b className="text-slate-700">{data.certId}</b></span>
          <span>Ngày cấp: <b className="text-slate-700">{data.date}</b></span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-3 print:hidden">
        <button onClick={() => window.print()} className={btnOutline}>
          <Printer className="h-4 w-4" /> In chứng chỉ
        </button>
        {attemptPdfUrl && (
          <a href={attemptPdfUrl} target="_blank" rel="noopener" className={btnOutline}>
            <FileText className="h-4 w-4" /> Bài làm chi tiết (PDF)
          </a>
        )}
        {/* Ưu tiên PDF server: có ảnh từ form, dấu PASSED, được lưu làm hồ sơ. */}
        {data.pdf_url ? (
          <a href={data.pdf_url} target="_blank" rel="noopener" className={btnPrimary}>
            <Download className="h-4 w-4" /> Tải chứng chỉ (PDF)
          </a>
        ) : (
          <button onClick={downloadClientPdf} disabled={downloading} className={btnPrimary}>
            <Download className="h-4 w-4" /> {downloading ? 'Đang tạo PDF…' : 'Tải chứng chỉ (PDF)'}
          </button>
        )}
      </div>
    </div>
  )
}
