import ldap from 'ldapjs'

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

function createClient(url: string): ldap.Client {
  return ldap.createClient({
    url,
    timeout: 5000,
    connectTimeout: 5000,
    tlsOptions: { rejectUnauthorized: false },
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
  let fullName: string
  try {
    await bindAsync(svcClient, cfg.bindDn, cfg.bindPassword)
    const entries = await searchAsync(
      svcClient,
      cfg.baseDn,
      `(${cfg.attrUsername}=${sanitizedUsername})`,
      [cfg.attrUsername, cfg.attrFullName],
    )
    if (entries.length === 0) {
      throw new Error('Tài khoản không tồn tại trong hệ thống thư mục.')
    }
    const entry = entries[0]
    userDn = entry.dn.toString()
    const attrs: Array<{ type: string; values: string[] }> =
      (entry as unknown as { pojo: { attributes: Array<{ type: string; values: string[] }> } })
        .pojo.attributes
    fullName =
      attrs.find((a) => a.type === cfg.attrFullName)?.values[0] ??
      attrs.find((a) => a.type === cfg.attrUsername)?.values[0] ??
      sanitizedUsername
  } finally {
    svcClient.destroy()
  }

  const userClient = createClient(cfg.url)
  try {
    await bindAsync(userClient, userDn, password)
  } catch {
    throw new Error('Mật khẩu không đúng.')
  } finally {
    userClient.destroy()
  }

  return { username: sanitizedUsername, fullName, dn: userDn }
}

/** Lấy tất cả user từ AD (dùng cho đồng bộ). */
export async function syncUsersFromAd(cfg: LdapConfig): Promise<LdapUser[]> {
  const client = createClient(cfg.url)
  try {
    await bindAsync(client, cfg.bindDn, cfg.bindPassword)
    const entries = await searchAsync(
      client,
      cfg.baseDn,
      `(&(objectClass=user)(${cfg.attrUsername}=*))`,
      [cfg.attrUsername, cfg.attrFullName],
    )
    return entries.map((entry) => {
      const attrs: Array<{ type: string; values: string[] }> =
        (entry as unknown as { pojo: { attributes: Array<{ type: string; values: string[] }> } })
          .pojo.attributes
      const username = attrs.find((a) => a.type === cfg.attrUsername)?.values[0] ?? ''
      const fullName = attrs.find((a) => a.type === cfg.attrFullName)?.values[0] ?? username
      return { username, fullName, dn: entry.dn.toString() }
    }).filter((u) => u.username)
  } finally {
    client.destroy()
  }
}

export async function authenticateLdap(username: string, password: string): Promise<LdapUser> {
  const cfg = getConfigFromEnv()
  if (!cfg) throw new Error('LDAP chưa được cấu hình. Cần: LDAP_URL, LDAP_BASE_DN, LDAP_BIND_DN, LDAP_BIND_PASSWORD')
  return authenticateLdapWithConfig(cfg, username, password)
}
