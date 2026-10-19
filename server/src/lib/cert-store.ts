/**
 * Lưu và đọc PDF bài làm / chứng nhận (Pha H5).
 *
 * Khác uploads/media và uploads/content: hai thư mục đó phục vụ công khai qua
 * `<img src>`. PDF ở đây là hồ sơ đào tạo, chỉ ra qua endpoint có `download_key`
 * hoặc JWT + requireSection('khoa-hoc') — nên KHÔNG mount static, mọi lần đọc đi
 * qua resolveCertPdf() để kiểm lại đường dẫn.
 */
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const CERT_DIR = path.join(__dirname, '..', '..', 'uploads', 'certs')
fs.mkdirSync(CERT_DIR, { recursive: true })

/**
 * Ghi một buffer PDF ra đĩa, trả về tên file để lưu vào DB.
 * Tên do server sinh (randomUUID) nên không bao giờ chứa dữ liệu từ client.
 */
export async function writeCertPdf(buf: Buffer): Promise<string> {
  const name = `${crypto.randomUUID()}.pdf`
  await fsp.writeFile(path.join(CERT_DIR, name), buf)
  return name
}

/**
 * Đổi tên file lấy từ DB thành đường dẫn thật, hoặc null nếu không hợp lệ.
 *
 * Cùng ba lớp như resolveTraineePhoto: khớp dạng tên server tự sinh, `startsWith`
 * sau khi join (chặn `../`), và file có thật. Tên này đến từ DB chứ không từ client,
 * nhưng vẫn kiểm — cột đó có thể bị ghi sai từ một đường khác về sau.
 */
export function resolveCertPdf(storedName: unknown): string | null {
  const name = String(storedName ?? '').trim()
  if (!name || !/^[\w-]+\.pdf$/i.test(name)) return null
  const filePath = path.join(CERT_DIR, name)
  if (!filePath.startsWith(CERT_DIR + path.sep)) return null
  return fs.existsSync(filePath) ? filePath : null
}
