// Xuất PDF biểu mẫu QT111-07 — render HTML ẩn, chụp bằng html2canvas rồi ghép jsPDF.
// QR xác thực nhúng mã biểu mẫu + định danh để tra cứu nguồn gốc. Các thư viện nặng
// (qrcode, html2canvas, jspdf) đều dynamic import để không phình bundle chính.

export interface FormMeta { label: string; value: string }
export interface FormRow { code: string; name: string; result?: string; note?: string }
export interface FormSection { title?: string; rows: FormRow[] }
export interface FormPdfData {
  formCode: string          // vd 'BM111-07.03'
  formTitle: string         // tên biểu mẫu
  meta: FormMeta[]          // dòng thông tin đầu biểu (hợp đồng, ngày…)
  sections: FormSection[]   // các nhóm hạng mục
  footerNote?: string       // nhận xét chung
  verifyCode: string        // chuỗi mã hóa vào QR
  signatureLabels?: [string, string]
  fileName: string          // tên file .pdf khi tải
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Nhãn + màu cho kết quả kiểm tra
function resultCell(r?: string): string {
  if (!r) return '<td style="text-align:center">—</td>'
  const map: Record<string, [string, string]> = {
    pass: ['Đạt', '#15803d'], fail: ['Không đạt', '#be123c'], na: ['N/A', '#64748b'],
  }
  const [label, color] = map[r] ?? [r, '#334155']
  return `<td style="text-align:center;color:${color};font-weight:600">${esc(label)}</td>`
}

// Dựng khối HTML biểu mẫu (khổ A4 dọc, 794px ~ 210mm @96dpi)
function buildHtml(d: FormPdfData, qrDataUrl: string): string {
  const metaRows = d.meta
    .map((m) => `<div style="min-width:48%;padding:2px 0"><b>${esc(m.label)}:</b> ${esc(m.value)}</div>`)
    .join('')
  const body = d.sections.map((sec) => {
    const head = sec.title
      ? `<tr><td colspan="4" style="background:#e6eef7;font-weight:700;color:#004a91;padding:5px 8px">${esc(sec.title)}</td></tr>`
      : ''
    const rows = sec.rows.map((r) => `
      <tr>
        <td style="width:52px;text-align:center;color:#64748b">${esc(r.code)}</td>
        <td>${esc(r.name)}</td>
        ${resultCell(r.result)}
        <td style="color:#475569">${esc(r.note ?? '')}</td>
      </tr>`).join('')
    return head + rows
  }).join('')
  const [sigL, sigR] = d.signatureLabels ?? ['Người lập biểu', 'Người phê duyệt']
  return `
  <div style="width:794px;padding:36px 40px;box-sizing:border-box;font-family:'Times New Roman',serif;color:#0f172a;background:#fff">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div style="font-size:13px;line-height:1.4">
        <div style="font-weight:700">CÔNG TY CP XI MĂNG VICEM HÀ TIÊN</div>
        <div style="color:#475569">An toàn – Vệ sinh lao động / PCCN / BVMT</div>
      </div>
      <div style="text-align:right;font-size:12px">
        <div style="font-weight:700;color:#004a91">${esc(d.formCode)}</div>
        <img src="${qrDataUrl}" width="88" height="88" style="margin-top:4px" alt="QR" />
      </div>
    </div>
    <h2 style="text-align:center;font-size:19px;margin:14px 0 4px;text-transform:uppercase">${esc(d.formTitle)}</h2>
    <div style="display:flex;flex-wrap:wrap;font-size:13px;margin:10px 0 12px">${metaRows}</div>
    <table style="width:100%;border-collapse:collapse;font-size:12.5px" border="1">
      <thead><tr style="background:#004a91;color:#fff">
        <th style="padding:5px">TT</th><th style="padding:5px;text-align:left">Nội dung kiểm tra</th>
        <th style="padding:5px;width:90px">Kết quả</th><th style="padding:5px;text-align:left">Ghi chú</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    ${d.footerNote ? `<div style="font-size:13px;margin-top:12px"><b>Nhận xét chung:</b> ${esc(d.footerNote)}</div>` : ''}
    <div style="display:flex;justify-content:space-around;margin-top:40px;font-size:13px;text-align:center">
      <div><b>${esc(sigL)}</b><div style="color:#94a3b8;margin-top:2px">(Ký, ghi rõ họ tên)</div></div>
      <div><b>${esc(sigR)}</b><div style="color:#94a3b8;margin-top:2px">(Ký, ghi rõ họ tên)</div></div>
    </div>
    <div style="margin-top:24px;font-size:10px;color:#94a3b8;text-align:center">
      Mã xác thực: ${esc(d.verifyCode)} — Quét QR để kiểm tra nguồn gốc biểu mẫu.
    </div>
  </div>`
}

// ── Bản cam kết điện tử (BM111-07.01) — văn bản dạng đoạn + chữ ký ảnh ──
export interface CommitmentPdfData {
  formCode: string
  title: string
  meta: FormMeta[]
  content: string            // nội dung cam kết (nhiều dòng)
  signerName: string
  signerTitle?: string
  signatureDataUrl?: string  // ảnh chữ ký PNG dataURL
  signedAt?: string
  verifyCode: string
  fileName: string
}

function buildCommitmentHtml(d: CommitmentPdfData, qrDataUrl: string): string {
  const metaRows = d.meta
    .map((m) => `<div style="min-width:48%;padding:2px 0"><b>${esc(m.label)}:</b> ${esc(m.value)}</div>`).join('')
  const paras = d.content.split('\n').filter((l) => l.trim())
    .map((l) => `<p style="margin:6px 0;line-height:1.55">${esc(l)}</p>`).join('')
  const sigImg = d.signatureDataUrl
    ? `<img src="${d.signatureDataUrl}" width="180" height="80" style="object-fit:contain" alt="Chữ ký" />`
    : '<div style="height:80px"></div>'
  return `
  <div style="width:794px;padding:36px 40px;box-sizing:border-box;font-family:'Times New Roman',serif;color:#0f172a;background:#fff">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div style="font-size:13px;line-height:1.4">
        <div style="font-weight:700">CÔNG TY CP XI MĂNG VICEM HÀ TIÊN</div>
        <div style="color:#475569">An toàn – Vệ sinh lao động / PCCN / BVMT</div>
      </div>
      <div style="text-align:right;font-size:12px">
        <div style="font-weight:700;color:#004a91">${esc(d.formCode)}</div>
        <img src="${qrDataUrl}" width="88" height="88" style="margin-top:4px" alt="QR" />
      </div>
    </div>
    <h2 style="text-align:center;font-size:19px;margin:14px 0 4px;text-transform:uppercase">${esc(d.title)}</h2>
    <div style="display:flex;flex-wrap:wrap;font-size:13px;margin:10px 0 12px">${metaRows}</div>
    <div style="font-size:13.5px">${paras}</div>
    <div style="display:flex;justify-content:flex-end;margin-top:32px;font-size:13px;text-align:center">
      <div style="min-width:240px">
        <b>ĐẠI DIỆN NHÀ THẦU</b>
        ${d.signedAt ? `<div style="color:#64748b;font-size:11px">Ký ngày ${esc(d.signedAt)}</div>` : ''}
        <div style="margin:6px 0">${sigImg}</div>
        <div style="font-weight:700">${esc(d.signerName)}</div>
        ${d.signerTitle ? `<div style="color:#475569">${esc(d.signerTitle)}</div>` : ''}
      </div>
    </div>
    <div style="margin-top:24px;font-size:10px;color:#94a3b8;text-align:center">
      Mã xác thực: ${esc(d.verifyCode)} — Quét QR để kiểm tra nguồn gốc biểu mẫu.
    </div>
  </div>`
}

export async function exportCommitmentPdf(d: CommitmentPdfData): Promise<void> {
  const [{ default: QRCode }, { default: html2canvas }, { jsPDF }] = await Promise.all([
    import('qrcode'), import('html2canvas'), import('jspdf'),
  ])
  const qrDataUrl = await QRCode.toDataURL(d.verifyCode, { margin: 1, width: 176 })
  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1'
  holder.innerHTML = buildCommitmentHtml(d, qrDataUrl)
  document.body.appendChild(holder)
  try {
    const el = holder.firstElementChild as HTMLElement
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pw = pdf.internal.pageSize.getWidth()
    const ph = pdf.internal.pageSize.getHeight()
    const imgH = (canvas.height * pw) / canvas.width
    const img = canvas.toDataURL('image/png')
    if (imgH <= ph) { pdf.addImage(img, 'PNG', 0, 0, pw, imgH) }
    else {
      let remaining = imgH, pos = 0
      while (remaining > 0) {
        pdf.addImage(img, 'PNG', 0, pos, pw, imgH); remaining -= ph
        if (remaining > 0) { pdf.addPage(); pos -= ph }
      }
    }
    pdf.save(d.fileName)
  } finally {
    document.body.removeChild(holder)
  }
}

// Tạo & tải PDF biểu mẫu. Dựng node ẩn ngoài luồng hiển thị, chụp rồi bỏ.
export async function exportFormPdf(d: FormPdfData): Promise<void> {
  const [{ default: QRCode }, { default: html2canvas }, { jsPDF }] = await Promise.all([
    import('qrcode'), import('html2canvas'), import('jspdf'),
  ])
  const qrDataUrl = await QRCode.toDataURL(d.verifyCode, { margin: 1, width: 176 })

  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1'
  holder.innerHTML = buildHtml(d, qrDataUrl)
  document.body.appendChild(holder)
  try {
    const el = holder.firstElementChild as HTMLElement
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pw = pdf.internal.pageSize.getWidth()
    const ph = pdf.internal.pageSize.getHeight()
    const imgH = (canvas.height * pw) / canvas.width
    const img = canvas.toDataURL('image/png')
    if (imgH <= ph) {
      pdf.addImage(img, 'PNG', 0, 0, pw, imgH)
    } else {
      // Nội dung dài hơn 1 trang → cắt theo chiều cao trang
      let remaining = imgH, pos = 0
      while (remaining > 0) {
        pdf.addImage(img, 'PNG', 0, pos, pw, imgH)
        remaining -= ph
        if (remaining > 0) { pdf.addPage(); pos -= ph }
      }
    }
    pdf.save(d.fileName)
  } finally {
    document.body.removeChild(holder)
  }
}
