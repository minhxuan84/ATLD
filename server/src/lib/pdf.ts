/**
 * Server-side PDF generation dùng PDFKit.
 * Tạo PDF commitment ATVSLĐ-PCCN-BVMT để lấy hash SHA-256 trước khi ký SmartCA.
 */
import PDFDocument from 'pdfkit'
import { createHash } from 'crypto'
import { Readable } from 'stream'

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
