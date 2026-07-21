/**
 * Client tích hợp SmartCA VNPT — chữ ký số cho hồ sơ ATVSLĐ/PCCN/BVMT.
 *
 * Cấu hình lưu trong bảng site_config (prefix smartca.*), có thể chỉnh trực tiếp
 * trong CMS (Cấu hình → Chữ ký số SmartCA) mà không cần restart server. Nếu DB
 * chưa có, fallback về env vars:
 *   SMARTCA_API_URL      — base URL, vd: https://api-cld.vnpt.vn/smartca
 *   SMARTCA_CLIENT_ID    — Client ID từ VNPT SmartCA developer portal
 *   SMARTCA_CLIENT_SECRET
 *   SMARTCA_WEBHOOK_SECRET — dùng để xác minh HMAC của callback
 *
 * Tài liệu API: https://smartca.vnpt.vn/developer
 */
import { createHmac } from 'crypto'
import { query } from '../db.js'

export interface SmartCaConfig {
  apiUrl: string
  clientId: string
  clientSecret: string
  webhookSecret: string
}

export interface SigningTransaction {
  txId: string
  qrUrl: string       // URL QR code cho mobile SmartCA app
  deeplink: string    // vnpt-smartca://... cho điện thoại
  expiresAt: string   // ISO timestamp
}

export interface SigningResult {
  txId: string
  status: 'pending' | 'signed' | 'rejected' | 'expired'
  signature?: string       // Base64 CAdES signature khi status = 'signed'
  certSerial?: string      // Serial số chứng chỉ của người ký
  certSubject?: string     // Distinguished name của người ký
  signedAt?: string        // ISO timestamp
}

/**
 * Đọc cấu hình SmartCA từ DB (site_config, prefix smartca.*), fallback về env.
 * Trả về null nếu chưa cấu hình đủ 4 trường bắt buộc.
 */
export async function loadSmartCaConfig(): Promise<SmartCaConfig | null> {
  let db: Record<string, string> = {}
  try {
    const { rows } = await query<{ key: string; value: string }>(
      `SELECT key, value FROM site_config WHERE key LIKE 'smartca.%'`,
    )
    for (const r of rows) db[r.key.replace('smartca.', '')] = r.value
  } catch {
    // Bảng site_config chưa sẵn sàng — chỉ dùng env.
  }
  // DB chỉ được dùng khi được bật (smartca.enabled = 'true'); ngược lại thử env.
  const enabled = db.enabled === 'true'
  const apiUrl = (enabled && db.api_url) || process.env.SMARTCA_API_URL
  const clientId = (enabled && db.client_id) || process.env.SMARTCA_CLIENT_ID
  const clientSecret = (enabled && db.client_secret) || process.env.SMARTCA_CLIENT_SECRET
  const webhookSecret = (enabled && db.webhook_secret) || process.env.SMARTCA_WEBHOOK_SECRET
  if (!apiUrl || !clientId || !clientSecret || !webhookSecret) return null
  return { apiUrl, clientId, clientSecret, webhookSecret }
}

/** true nếu SmartCA đã cấu hình đủ (DB hoặc env) — dùng để gác các route ký. */
export async function isSmartCaConfigured(): Promise<boolean> {
  return (await loadSmartCaConfig()) !== null
}

async function getConfig(): Promise<SmartCaConfig> {
  const cfg = await loadSmartCaConfig()
  if (!cfg) {
    throw new Error(
      'SmartCA chưa được cấu hình. Vào CMS → Chữ ký số SmartCA để nhập API URL, Client ID, Client Secret và Webhook Secret.',
    )
  }
  return cfg
}

/** Lấy access token bằng client credentials (OAuth2). */
async function getAccessTokenFor(cfg: SmartCaConfig): Promise<string> {
  const res = await fetch(`${cfg.apiUrl}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`SmartCA token error ${res.status}: ${body}`)
  }
  const data = await res.json() as { access_token: string }
  return data.access_token
}

/**
 * Khởi tạo giao dịch ký số.
 * @param documentHash  SHA-256 hex của PDF cần ký
 * @param documentName  Tên tài liệu hiển thị trong SmartCA app
 * @param callbackUrl   URL HTTPS nhận webhook khi ký xong (POST)
 */
export async function initiateSign(
  documentHash: string,
  documentName: string,
  callbackUrl: string,
): Promise<SigningTransaction> {
  const cfg = await getConfig()
  const token = await getAccessTokenFor(cfg)

  const res = await fetch(`${cfg.apiUrl}/v1/sign/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      hash: documentHash,
      hashAlgorithm: 'SHA256',
      documentName,
      callbackUrl,
      expireMinutes: 10,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`SmartCA initiate error ${res.status}: ${body}`)
  }
  const data = await res.json() as {
    transactionId: string
    qrUrl: string
    deeplink: string
    expiresAt: string
  }
  return {
    txId: data.transactionId,
    qrUrl: data.qrUrl,
    deeplink: data.deeplink,
    expiresAt: data.expiresAt,
  }
}

/** Lấy trạng thái giao dịch ký (polling từ frontend). */
export async function getSignStatus(txId: string): Promise<SigningResult> {
  const cfg = await getConfig()
  const token = await getAccessTokenFor(cfg)

  const res = await fetch(`${cfg.apiUrl}/v1/sign/status/${encodeURIComponent(txId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`SmartCA status error ${res.status}`)
  }
  const data = await res.json() as {
    transactionId: string
    status: string
    signature?: string
    certSerial?: string
    certSubject?: string
    signedAt?: string
  }
  return {
    txId: data.transactionId,
    status: data.status as SigningResult['status'],
    signature: data.signature,
    certSerial: data.certSerial,
    certSubject: data.certSubject,
    signedAt: data.signedAt,
  }
}

/**
 * Xác minh HMAC của webhook callback từ VNPT SmartCA.
 * VNPT ký header X-SmartCA-Signature bằng HMAC-SHA256(body, webhookSecret).
 */
export async function verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
  const cfg = await loadSmartCaConfig()
  if (!cfg) return false
  const expected = createHmac('sha256', cfg.webhookSecret)
    .update(rawBody, 'utf8')
    .digest('hex')
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return diff === 0
}
