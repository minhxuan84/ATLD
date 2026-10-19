/**
 * Ảnh học viên khai trong form trắc nghiệm (Pha H2).
 *
 * Có hai lối vào — học viên có tài khoản (courses.ts) và học viên quét QR
 * (portal.ts) — nên thư mục, bộ lọc và hàm kiểm đường dẫn để một chỗ, tránh hai bên
 * trôi lệch cách kiểm.
 *
 * Theo đúng mẫu của media.ts: tên file do server sinh bằng randomUUID, chỉ nhận ảnh
 * raster, đối chiếu cả phần mở rộng và mimetype, KHÔNG nhận SVG (SVG chứa được script).
 */
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Ảnh học viên không công khai như ảnh nhận diện — chỉ đi vào PDF chứng nhận. */
export const TRAINEE_DIR = path.join(__dirname, '..', '..', 'uploads', 'trainee')
fs.mkdirSync(TRAINEE_DIR, { recursive: true })

const ALLOWED_IMG = ['png', 'jpg', 'jpeg', 'webp']
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp']
const MAX_IMG_MB = 4

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TRAINEE_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')
    cb(null, `${crypto.randomUUID()}${ext}`)
  },
})

export const traineePhotoUpload = multer({
  storage,
  limits: { fileSize: MAX_IMG_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(1)
    if (!ALLOWED_IMG.includes(ext) || !ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new Error('Chỉ chấp nhận ảnh PNG, JPG hoặc WEBP.'))
    }
    cb(null, true)
  },
})

/**
 * Đổi `stored_name` do client gửi lên thành đường dẫn thật, hoặc null nếu không hợp lệ.
 *
 * Giá trị này đi từ client vào `doc.image()` khi dựng chứng nhận, nên PHẢI kiểm lại ở
 * đây: nhúng thẳng là mở đường đọc file tùy ý trên server. Ba lớp — khớp đúng dạng tên
 * server tự sinh, `startsWith` sau khi join (chặn `../`), và file có thật.
 *
 * Trả null chứ không ném: thiếu ảnh thì chứng nhận vẫn phải ra, không được làm người
 * đạt bài mất chứng nhận vì một cái tên file sai.
 */
export function resolveTraineePhoto(storedName: unknown): string | null {
  const name = String(storedName ?? '').trim()
  if (!name || !/^[\w-]+\.(png|jpe?g|webp)$/i.test(name)) return null
  const filePath = path.join(TRAINEE_DIR, name)
  // path.join đã chuẩn hóa `..`; so lại tiền tố để chắc chắn không ra khỏi thư mục.
  if (!filePath.startsWith(TRAINEE_DIR + path.sep)) return null
  return fs.existsSync(filePath) ? filePath : null
}

/** Kiểm nhanh một stored_name có hợp lệ không, dùng ở tầng xác thực form. */
export const isTraineePhotoName = (v: unknown) => resolveTraineePhoto(v) !== null
