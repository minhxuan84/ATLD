/**
 * Server-side PDF generation dùng PDFKit.
 * Tạo PDF commitment ATVSLĐ-PCCN-BVMT để lấy hash SHA-256 trước khi ký SmartCA.
 */
import PDFDocument from 'pdfkit'
import { createHash } from 'crypto'
import { Readable } from 'stream'
import fs from 'fs'

export interface CommitmentPdfData {
  id: number
  title: string
  content: string
  contractNo: string
  contractTitle: string
  contractorName: string
  signerName: string
  signerTitle: string
  verifyCode: string
  createdAt: string // ISO string
}

/** Tạo PDF Buffer từ dữ liệu cam kết. */
export function buildCommitmentPdf(data: CommitmentPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 60 })
    const chunks: Buffer[] = []

    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // Font mặc định (Helvetica) — tiếng Việt sẽ bị mất dấu trên PDFKit
    // nếu không nhúng font Unicode. Đây là PDF dành cho hash/ký số, không cần
    // render đẹp, nên dùng Latin transcription cho nội dung ký và lưu gốc trong DB.
    doc.fontSize(14).font('Helvetica-Bold').text('BAN CAM KET AT-VSL-PCCN-BVMT', { align: 'center' })
    doc.fontSize(11).font('Helvetica').text(`(${data.title})`, { align: 'center' })
    doc.moveDown()

    doc.fontSize(10)
      .text(`So hop dong: ${data.contractNo}`)
      .text(`Cong trinh: ${data.contractTitle}`)
      .text(`Nha thau: ${data.contractorName}`)
      .text(`Ngay tao: ${new Date(data.createdAt).toLocaleDateString('vi-VN')}`)
    doc.moveDown()

    // Nội dung cam kết
    doc.fontSize(10).font('Helvetica').text(data.content, { lineGap: 3 })
    doc.moveDown(2)

    // Khối ký
    doc.fontSize(10)
      .text(`Nguoi ky: ${data.signerName}`)
      .text(`Chuc vu: ${data.signerTitle}`)
    doc.moveDown()

    // Mã xác minh (verify code) ở cuối tài liệu
    doc.fontSize(8).fillColor('grey')
      .text(`Ma xac minh: ${data.verifyCode}`, { align: 'right' })

    doc.end()
  })
}

export interface PermitPdfWorker { fullName: string; idNumber: string; role: string }
export interface PermitPdfHazard { description: string; riskLevel: string; controls: string[] }
export interface PermitPdfApproval { approverName: string; role: string; decision: string; comments: string; decidedAt: string }
export interface PermitPdfData {
  permitNumber: string
  siteName: string
  workTypeName: string
  location: string
  workDescription: string
  startTime: string        // ISO
  endTime: string          // ISO
  requesterName: string
  approverName: string
  closedByName: string
  closedAt: string         // ISO, '' nếu chưa đóng
  closureNotes: string
  workers: PermitPdfWorker[]
  hazards: PermitPdfHazard[]
  approvals: PermitPdfApproval[]
}

// Ngày dd/mm/yyyy theo lệ dự án (src/lib/date.ts phía client). Trả '' cho giá trị rỗng.
function d(iso: string): string {
  if (!iso) return ''
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`
}
function dt(iso: string): string {
  if (!iso) return ''
  const x = new Date(iso)
  if (Number.isNaN(x.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d(iso)} ${p(x.getHours())}:${p(x.getMinutes())}`
}

// ── Font Unicode cho tiếng Việt ────────────────────────────────────────────
// PDFKit chỉ có sẵn 14 font chuẩn (Helvetica, Times…), không font nào chứa
// glyph tiếng Việt: 'Kiểm tra' sẽ ra 'Ki\x1eÃm tra'. Biên bản nghiệm thu là
// tài liệu để đọc và lưu hồ sơ nên phải nhúng font thật.
// Ảnh runtime (node:20-alpine) đã có OpenSans; các path còn lại để máy dev
// (Linux/Windows) cũng ra đúng dấu. Không tìm được font nào thì rơi về
// Helvetica + bỏ dấu — vẫn đọc được, không ra ký tự rác.
const VN_FONT_CANDIDATES: Array<{ regular: string; bold: string }> = [
  { regular: '/usr/share/fonts/opensans/OpenSans-Regular.ttf', bold: '/usr/share/fonts/opensans/OpenSans-Bold.ttf' },
  { regular: '/usr/share/fonts/TTF/DejaVuSans.ttf', bold: '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf' },
  { regular: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', bold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' },
  { regular: 'C:\\Windows\\Fonts\\arial.ttf', bold: 'C:\\Windows\\Fonts\\arialbd.ttf' },
]

let vnFontCache: { regular: string; bold: string } | null | undefined
/** Tìm cặp font Unicode khả dụng; kết quả cache lại vì path không đổi trong 1 tiến trình. */
function resolveVnFont(): { regular: string; bold: string } | null {
  if (vnFontCache !== undefined) return vnFontCache
  vnFontCache = VN_FONT_CANDIDATES.find((f) => fs.existsSync(f.regular) && fs.existsSync(f.bold)) ?? null
  return vnFontCache
}

/** Bỏ dấu tiếng Việt — chỉ dùng khi không nhúng được font Unicode. */
function stripTones(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // dấu thanh + dấu mũ/móc đã tách rời
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')  // đ không phân tách được bằng NFD
}

/**
 * Biên bản nghiệm thu đóng giấy phép làm việc.
 * Nhúng font Unicode để hiển thị đúng tiếng Việt (xem VN_FONT_CANDIDATES).
 * Khác buildCommitmentPdf: bản cam kết vẫn giữ Helvetica vì byte của nó được
 * hash để ký SmartCA — đổi font sẽ làm lệch hash của các bản đã ký.
 */
export function buildPermitPdf(data: PermitPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 55 })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // FR/FB = tên font thường/đậm; t() giữ nguyên dấu khi nhúng được font.
    const vn = resolveVnFont()
    let FR = 'Helvetica'
    let FB = 'Helvetica-Bold'
    if (vn) {
      try {
        doc.registerFont('VN', vn.regular)
        doc.registerFont('VN-Bold', vn.bold)
        FR = 'VN'
        FB = 'VN-Bold'
      } catch {
        // Font lỗi/không đọc được: giữ Helvetica, t() sẽ bỏ dấu.
        vnFontCache = null
      }
    }
    const hasVn = FR !== 'Helvetica'
    const t = (s: string): string => (hasVn ? s : stripTones(s))

    doc.fontSize(14).font(FB).text(t('BIÊN BẢN NGHIỆM THU GIẤY PHÉP LÀM VIỆC'), { align: 'center' })
    doc.fontSize(10).font(FR).text(t(`Số giấy phép: ${data.permitNumber}`), { align: 'center' })
    doc.moveDown()

    const row = (label: string, value: string) => {
      if (!value) return
      doc.font(FB).text(t(`${label}: `), { continued: true })
      doc.font(FR).text(t(value))
    }
    doc.fontSize(10)
    row('Địa điểm', data.siteName)
    row('Loại công việc', data.workTypeName)
    row('Vị trí thi công', data.location)
    row('Nội dung công việc', data.workDescription)
    row('Thời gian', `${dt(data.startTime)} - ${dt(data.endTime)}`)
    row('Người đề nghị', data.requesterName)
    row('Người phê duyệt', data.approverName)
    doc.moveDown()

    const section = (title: string) => {
      doc.moveDown(0.4).fontSize(11).font(FB).text(t(title))
      doc.fontSize(10).font(FR)
    }

    if (data.workers.length) {
      section(`I. NGƯỜI LAO ĐỘNG (${data.workers.length})`)
      data.workers.forEach((w, i) => {
        const parts = [w.fullName, w.idNumber && `CCCD ${w.idNumber}`, w.role].filter(Boolean)
        doc.text(t(`${i + 1}. ${parts.join(' - ')}`))
      })
    }

    if (data.hazards.length) {
      section('II. NHẬN DIỆN MỐI NGUY & BIỆN PHÁP KIỂM SOÁT')
      data.hazards.forEach((h, i) => {
        doc.text(t(`${i + 1}. [${h.riskLevel || 'n/a'}] ${h.description}`))
        h.controls.forEach((c) => doc.text(t(`   - ${c}`), { indent: 10 }))
      })
    }

    if (data.approvals.length) {
      section('III. LỊCH SỬ PHÊ DUYỆT')
      data.approvals.forEach((a) => {
        const parts = [dt(a.decidedAt), a.approverName, a.role, a.decision].filter(Boolean)
        doc.text(t(parts.join(' | ')))
        if (a.comments) doc.text(t(`   ${a.comments}`), { indent: 10 })
      })
    }

    section('IV. NGHIỆM THU ĐÓNG PHÉP')
    row('Người nghiệm thu', data.closedByName)
    row('Thời điểm đóng', dt(data.closedAt))
    row('Ý kiến nghiệm thu', data.closureNotes)

    doc.moveDown(2)
    const y = doc.y
    doc.fontSize(10).font(FB)
    doc.text(t('NGƯỜI ĐỀ NGHỊ'), 70, y, { width: 200, align: 'center' })
    doc.text(t('NGƯỜI NGHIỆM THU'), 320, y, { width: 200, align: 'center' })
    doc.fontSize(8).font(FR).fillColor('grey')
    doc.text(t('(ký, ghi rõ họ tên)'), 70, y + 14, { width: 200, align: 'center' })
    doc.text(t('(ký, ghi rõ họ tên)'), 320, y + 14, { width: 200, align: 'center' })

    doc.fillColor('grey').fontSize(8)
      .text(t(`Mã xác minh: PERMIT-${data.permitNumber} | Xuất ngày ${d(new Date().toISOString())}`),
        55, y + 80, { align: 'right' })

    doc.end()
  })
}

/** Tạo SHA-256 hex của PDF buffer — đây là giá trị được ký bởi SmartCA. */
export function hashPdf(pdfBuffer: Buffer): string {
  return createHash('sha256').update(pdfBuffer).digest('hex')
}

/** Readable stream từ buffer — dùng để stream PDF ra response. */
export function bufferToStream(buffer: Buffer): Readable {
  const stream = new Readable()
  stream.push(buffer)
  stream.push(null)
  return stream
}
