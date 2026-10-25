import fs from 'node:fs'
import ldap from 'ldapjs'
import { query } from '../db.js'

export interface LdapConfig {
  url: string
  baseDn: string
  bindDn: string
  bindPassword: string
  attrUsername: string // sAMAccountName (mặc định) hoặc userPrincipalName
  attrFullName: string // displayName (mặc định)
}

export interface LdapUser {
  username: string
  fullName: string
  dn: string
}

export function getConfigFromEnv(): LdapConfig | null {
  const url = process.env.LDAP_URL
  const baseDn = process.env.LDAP_BASE_DN
  const bindDn = process.env.LDAP_BIND_DN
  const bindPassword = process.env.LDAP_BIND_PASSWORD
  if (!url || !baseDn || !bindDn || !bindPassword) return null
  return {
    url, baseDn, bindDn, bindPassword,
    attrUsername: process.env.LDAP_ATTR_USERNAME ?? 'sAMAccountName',
    attrFullName: process.env.LDAP_ATTR_FULLNAME ?? 'displayName',
  }
}

let warnedInsecureTls = false

/**
 * TLS cho ldaps://. Mặc định giữ hành vi cũ (không kiểm chứng chỉ, vì AD nội bộ thường dùng CA riêng)
 * nhưng cảnh báo một lần. Bật kiểm tra:
 *  - LDAP_TLS_CA_FILE=/path/ca.pem → tin CA này và bắt buộc kiểm chứng chỉ
 *  - LDAP_TLS_REJECT_UNAUTHORIZED=true → kiểm theo CA hệ thống
 */
export function ldapTlsOptions(): { rejectUnauthorized: boolean; ca?: Buffer } {
  const caFile = process.env.LDAP_TLS_CA_FILE
  if (caFile) return { rejectUnauthorized: true, ca: fs.readFileSync(caFile) }
  if (process.env.LDAP_TLS_REJECT_UNAUTHORIZED === 'true') return { rejectUnauthorized: true }
  if (!warnedInsecureTls) {
    warnedInsecureTls = true
    console.warn('[ldap] TLS không kiểm chứng chỉ — đặt LDAP_TLS_CA_FILE hoặc LDAP_TLS_REJECT_UNAUTHORIZED=true để bật.')
  }
  return { rejectUnauthorized: false }
}

function createClient(url: string): ldap.Client {
  return ldap.createClient({
    url,
    timeout: 5000,
    connectTimeout: 5000,
    tlsOptions: ldapTlsOptions(),
  })
}

function bindAsync(client: ldap.Client, dn: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.bind(dn, password, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function searchAsync(
  client: ldap.Client,
  baseDn: string,
  filter: string,
  attributes: string[],
): Promise<ldap.SearchEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: ldap.SearchEntry[] = []
    client.search(baseDn, { scope: 'sub', filter, attributes }, (err, res) => {
      if (err) return reject(err)
      res.on('searchEntry', (entry) => entries.push(entry))
      res.on('error', reject)
      res.on('end', () => resolve(entries))
    })
  })
}

export async function authenticateLdapWithConfig(
  cfg: LdapConfig,
  username: string,
  password: string,
): Promise<LdapUser> {
  const sanitizedUsername = username.replace(/[*()\\\x00]/g, '')

  const svcClient = createClient(cfg.url)
  let userDn: string
  let bindId: string // định danh dùng để bind (ưu tiên userPrincipalName)
  let fullName: string
  try {
    await bindAsync(svcClient, cfg.bindDn, cfg.bindPassword)
    const entries = await searchAsync(
      svcClient,
      cfg.baseDn,
      `(${cfg.attrUsername}=${sanitizedUsername})`,
      [cfg.attrUsername, cfg.attrFullName, 'userPrincipalName', 'distinguishedName'],
    )
    if (entries.length === 0) {
      throw new Error('Tài khoản không tồn tại trong hệ thống thư mục.')
    }
    const entry = entries[0]
    // entry.dn.toString() escape byte UTF-8 (OU tiếng Việt có dấu → \c3\b2…) khiến bind sai.
    // Ưu tiên userPrincipalName để bind; nếu không có, dùng distinguishedName (đã unescape), cuối cùng mới tới DN thô.
    const upn = getAttrValue(entry, 'userPrincipalName')
    const dnAttr = getAttrValue(entry, 'distinguishedName')
    userDn = dnAttr || entry.dn.toString()
    bindId = upn || dnAttr || unescapeDnHex(entry.dn.toString())
    fullName = getAttrValue(entry, cfg.attrFullName) || getAttrValue(entry, cfg.attrUsername) || sanitizedUsername
  } finally {
    svcClient.destroy()
  }

  const userClient = createClient(cfg.url)
  try {
    await bindAsync(userClient, bindId, password)
  } catch {
    throw new Error('Mật khẩu không đúng.')
  } finally {
    userClient.destroy()
  }

  return { username: sanitizedUsername, fullName, dn: userDn }
}

/** Giải mã chuỗi DN mà ldapjs escape thành \xx (byte UTF-8) về ký tự thật. */
function unescapeDnHex(dn: string): string {
  const bytes: number[] = []
  const re = /\\([0-9a-fA-F]{2})|([^\\]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(dn)) !== null) {
    if (m[1] != null) bytes.push(parseInt(m[1], 16))
    else for (const ch of Buffer.from(m[2], 'utf8')) bytes.push(ch)
  }
  return Buffer.from(bytes).toString('utf8')
}

/** Đọc giá trị attribute từ ldapjs entry. Phiên bản ldapjs này để attribute ở
 *  entry.attributes[].values (không có entry.object), fallback về entry.pojo. */
function getAttrValue(entry: ldap.SearchEntry, attrName: string): string {
  const fromAttrs = (entry as unknown as { attributes?: Array<{ type: string; values: string[] }> })
    .attributes
  if (Array.isArray(fromAttrs)) {
    const hit = fromAttrs.find((a) => a.type === attrName)?.values?.[0]
    if (hit != null) return hit
  }
  try {
    const attrs: Array<{ type: string; values: string[] }> =
      (entry as unknown as { pojo: { attributes: Array<{ type: string; values: string[] }> } })
        .pojo.attributes
    return attrs?.find((a) => a.type === attrName)?.values?.[0] ?? ''
  } catch {
    return ''
  }
}

/**
 * Lấy tất cả user từ AD (dùng cho đồng bộ).
 * Dùng paged search (pageSize 900) để tránh SizeLimitExceededError — AD giới hạn
 * MaxPageSize ~1000 mỗi truy vấn, OU lớn sẽ vượt và server trả lỗi nếu không phân trang.
 * SizeLimitExceeded (nếu vẫn xảy ra) được coi là partial: trả về những entry đã đọc.
 */
export async function syncUsersFromAd(cfg: LdapConfig): Promise<LdapUser[]> {
  const client = createClient(cfg.url)
  try {
    await bindAsync(client, cfg.bindDn, cfg.bindPassword)
    // objectCategory=person loại computer account; !(userAccountControl...=2) loại tài khoản bị vô hiệu hóa.
    const filter = `(&(objectCategory=person)(objectClass=user)(${cfg.attrUsername}=*)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))`
    const entries: ldap.SearchEntry[] = await new Promise((resolve, reject) => {
      const acc: ldap.SearchEntry[] = []
      client.search(
        cfg.baseDn,
        {
          scope: 'sub',
          filter,
          attributes: [cfg.attrUsername, cfg.attrFullName],
          paged: { pageSize: 900, pagePause: false },
        },
        (err, res) => {
          if (err) return reject(err)
          res.on('searchEntry', (entry) => acc.push(entry))
          res.on('error', (e) => {
            // Size limit dù đã phân trang: coi là partial thay vì fail toàn bộ.
            if ((e as { name?: string }).name === 'SizeLimitExceededError') resolve(acc)
            else reject(e)
          })
          res.on('end', () => resolve(acc))
        },
      )
    })
    return entries.map((entry) => {
      const username = getAttrValue(entry, cfg.attrUsername)
      const fullName = getAttrValue(entry, cfg.attrFullName) || username
      return { username, fullName, dn: entry.dn.toString() }
    }).filter((u) => u.username)
  } finally {
    client.destroy()
  }
}

/**
 * Đọc cấu hình LDAP từ site_config (nơi trang quản trị lưu). Trả về null nếu
 * chưa bật (ldap.enabled != 'true') hoặc thiếu thông tin kết nối bắt buộc.
 * Đây là nguồn cấu hình chính — env chỉ dùng để fallback lúc chưa có UI.
 */
export async function getConfigFromDb(): Promise<LdapConfig | null> {
  const { rows } = await query<{ key: string; value: string }>(
    `SELECT key, value FROM site_config WHERE key LIKE 'ldap.%'`,
  )
  const c: Record<string, string> = {}
  for (const r of rows) c[r.key.replace('ldap.', '')] = r.value
  if (c.enabled !== 'true') return null
  if (!c.url || !c.base_dn || !c.bind_dn || !c.bind_password) return null
  return {
    url: c.url,
    baseDn: c.base_dn,
    bindDn: c.bind_dn,
    bindPassword: c.bind_password,
    attrUsername: c.attr_username || 'sAMAccountName',
    attrFullName: c.attr_fullname || 'displayName',
  }
}

/** Ưu tiên cấu hình trong DB (từ trang quản trị), fallback về biến môi trường. */
export async function authenticateLdap(username: string, password: string): Promise<LdapUser> {
  const cfg = (await getConfigFromDb()) ?? getConfigFromEnv()
  if (!cfg) throw new Error('LDAP chưa được cấu hình. Cần: LDAP_URL, LDAP_BASE_DN, LDAP_BIND_DN, LDAP_BIND_PASSWORD')
  return authenticateLdapWithConfig(cfg, username, password)
}
