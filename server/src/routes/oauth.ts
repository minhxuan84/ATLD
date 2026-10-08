import { Router } from 'express'
import crypto from 'node:crypto'
import { query } from '../db.js'
import { signToken, type AuthUser, type Role, type CmsSection } from '../auth.js'

export const oauthRouter = Router()

const SECRET = process.env.JWT_SECRET || 'dev_secret'

// ── State CSRF helpers ────────────────────────────────────────────────────────
// Tạo state token chống CSRF: encode (from|timestamp|hmac) → base64url
function makeState(from: string): string {
  const payload = `${from}|${Date.now()}`
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 16)
  return Buffer.from(`${payload}|${sig}`).toString('base64url')
}

// Xác thực state token: kiểm tra HMAC + thời gian (10 phút)
function verifyState(state: string): { from: string } | null {
  try {
    const decoded = Buffer.from(state, 'base64url').toString()
    const parts = decoded.split('|')
    if (parts.length !== 3) return null
    const [from, ts, sig] = parts
    if (Date.now() - Number(ts) > 10 * 60 * 1000) return null
    const payload = `${from}|${ts}`
    const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 16)
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
    return { from }
  } catch {
    return null
  }
}

// ── Migration helper ──────────────────────────────────────────────────────────
export async function initOAuthDb() {
  await query(`
    ALTER TABLE atld.users ADD COLUMN IF NOT EXISTS email VARCHAR(200);
    ALTER TABLE atld.users ADD COLUMN IF NOT EXISTS oauth_provider_id VARCHAR(200);
    ALTER TABLE atld.users ADD COLUMN IF NOT EXISTS oauth_provider_name VARCHAR(20);
  `)
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_provider_id_idx
      ON atld.users (oauth_provider_name, oauth_provider_id)
     WHERE oauth_provider_id IS NOT NULL
  `)
}

// ── Shared: tìm hoặc tạo user OAuth trong DB ──────────────────────────────────
interface OAuthProfile {
  provider: 'microsoft' | 'google'
  providerId: string
  email: string
  fullName: string
}

interface UserRow {
  id: number
  username: string
  full_name: string
  role: Role
  permissions: string[]
  site_id: number | null
}

async function upsertOAuthUser(profile: OAuthProfile): Promise<AuthUser> {
  // 1. Tìm theo provider_id (tài khoản đã đăng nhập trước đó)
  let { rows } = await query<UserRow>(
    `SELECT id, username, full_name, role, permissions, site_id
       FROM atld.users
      WHERE oauth_provider_name = $1 AND oauth_provider_id = $2`,
    [profile.provider, profile.providerId],
  )

  if (!rows[0] && profile.email) {
    // 2. Tìm theo email — liên kết tài khoản hiện có
    ;({ rows } = await query<UserRow>(
      `SELECT id, username, full_name, role, permissions, site_id
         FROM atld.users WHERE LOWER(email) = $1`,
      [profile.email.toLowerCase()],
    ))
    if (rows[0]) {
      await query(
        `UPDATE atld.users
            SET oauth_provider_name = $1,
                oauth_provider_id   = $2,
                auth_provider       = $3,
                email               = $4
          WHERE id = $5`,
        [profile.provider, profile.providerId, profile.provider, profile.email.toLowerCase(), rows[0].id],
      )
    }
  }

  if (!rows[0]) {
    // 3. Tạo user mới với role trainee
    // Dùng email làm username (bỏ ký tự đặc biệt), thêm suffix nếu trùng
    const baseUsername = profile.email
      ? profile.email.toLowerCase().replace(/@.*$/, '').replace(/[^a-z0-9._-]/g, '_').slice(0, 50)
      : `oauth_${profile.providerId.slice(0, 12)}`

    ;({ rows } = await query<UserRow>(
      `INSERT INTO atld.users
         (username, password_hash, full_name, role, permissions, auth_provider,
          email, oauth_provider_name, oauth_provider_id)
       VALUES ($1, '', $2, 'trainee', '[]', $3, $4, $3, $5)
       ON CONFLICT (username) DO UPDATE
         SET full_name          = EXCLUDED.full_name,
             oauth_provider_name = EXCLUDED.oauth_provider_name,
             oauth_provider_id   = EXCLUDED.oauth_provider_id,
             email               = EXCLUDED.email,
             auth_provider       = EXCLUDED.auth_provider
       RETURNING id, username, full_name, role, permissions, site_id`,
      [baseUsername, profile.fullName, profile.provider, profile.email.toLowerCase() || null, profile.providerId],
    ))
  } else {
    // Cập nhật tên/email phòng thay đổi
    await query(
      `UPDATE atld.users SET full_name = $1, email = $2 WHERE id = $3`,
      [profile.fullName, profile.email.toLowerCase() || null, rows[0].id],
    )
    // Re-fetch để đảm bảo dữ liệu mới nhất
    ;({ rows } = await query<UserRow>(
      `SELECT id, username, full_name, role, permissions, site_id FROM atld.users WHERE id = $1`,
      [rows[0].id],
    ))
  }

  const u = rows[0]
  return {
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    role: u.role,
    permissions: (Array.isArray(u.permissions) ? u.permissions : []) as CmsSection[],
    siteId: u.site_id ?? null,
  }
}

// Lấy base URL frontend (trong production, API và frontend cùng origin)
function frontendBase(req: import('express').Request): string {
  return `${req.protocol}://${req.get('host')}`
}

// ── Microsoft (Azure AD — tenant "common" hỗ trợ cả tài khoản cá nhân + công ty) ────
const msClientId     = () => process.env.MICROSOFT_CLIENT_ID ?? ''
const msClientSecret = () => process.env.MICROSOFT_CLIENT_SECRET ?? ''
const msTenant       = () => process.env.MICROSOFT_TENANT ?? 'common'
const msRedirect     = (req: import('express').Request) =>
  `${req.protocol}://${req.get('host')}/api/auth/oauth/microsoft/callback`

oauthRouter.get('/microsoft', (req, res) => {
  if (!msClientId()) {
    return res.status(503).json({ error: 'Đăng nhập Microsoft chưa được kích hoạt.' })
  }
  const from  = typeof req.query.from === 'string' ? req.query.from : '/'
  const state = makeState(from)
  const params = new URLSearchParams({
    client_id:     msClientId(),
    response_type: 'code',
    redirect_uri:  msRedirect(req),
    response_mode: 'query',
    scope:         'openid profile email User.Read',
    state,
  })
  res.redirect(
    `https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0/authorize?${params}`,
  )
})

oauthRouter.get('/microsoft/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query as Record<string, string>
  if (error) {
    console.error('[oauth/microsoft]', error, error_description)
    return res.redirect(
      `/dang-nhap?error=${encodeURIComponent('Đăng nhập Microsoft thất bại: ' + error)}`,
    )
  }
  const verified = verifyState(state ?? '')
  if (!verified) {
    return res.redirect('/dang-nhap?error=state_invalid')
  }
  try {
    // Đổi code → access token
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0/token`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     msClientId(),
          client_secret: msClientSecret(),
          code,
          grant_type:   'authorization_code',
          redirect_uri:  msRedirect(req),
          scope:         'openid profile email User.Read',
        }).toString(),
      },
    )
    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string; error_description?: string }
    if (!tokenData.access_token) {
      throw new Error(tokenData.error_description ?? tokenData.error ?? 'Không nhận được token.')
    }

    // Lấy thông tin user từ Microsoft Graph
    const meRes = await fetch(
      'https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName',
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
    )
    const me = (await meRes.json()) as {
      id: string
      displayName?: string
      mail?: string
      userPrincipalName?: string
    }

    const authUser = await upsertOAuthUser({
      provider:   'microsoft',
      providerId: me.id,
      email:      me.mail ?? me.userPrincipalName ?? '',
      fullName:   me.displayName ?? me.userPrincipalName ?? me.id,
    })

    // OAuth callback luôn lưu token (remember=true ở client) → token sống lâu.
    const token = signToken(authUser, true)
    res.redirect(
      `${frontendBase(req)}/oauth/callback#token=${encodeURIComponent(token)}&from=${encodeURIComponent(verified.from)}`,
    )
  } catch (err) {
    console.error('[oauth/microsoft/callback]', err)
    res.redirect('/dang-nhap?error=oauth_failed')
  }
})

// ── Google ────────────────────────────────────────────────────────────────────
const ggClientId     = () => process.env.GOOGLE_CLIENT_ID ?? ''
const ggClientSecret = () => process.env.GOOGLE_CLIENT_SECRET ?? ''
const ggRedirect     = (req: import('express').Request) =>
  `${req.protocol}://${req.get('host')}/api/auth/oauth/google/callback`

oauthRouter.get('/google', (req, res) => {
  if (!ggClientId()) {
    return res.status(503).json({ error: 'Đăng nhập Google chưa được kích hoạt.' })
  }
  const from  = typeof req.query.from === 'string' ? req.query.from : '/'
  const state = makeState(from)
  const params = new URLSearchParams({
    client_id:     ggClientId(),
    response_type: 'code',
    redirect_uri:  ggRedirect(req),
    scope:         'openid profile email',
    state,
    access_type:   'online',
    prompt:        'select_account',
  })
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})

oauthRouter.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>
  if (error) {
    console.error('[oauth/google]', error)
    return res.redirect(
      `/dang-nhap?error=${encodeURIComponent('Đăng nhập Google thất bại: ' + error)}`,
    )
  }
  const verified = verifyState(state ?? '')
  if (!verified) {
    return res.redirect('/dang-nhap?error=state_invalid')
  }
  try {
    // Đổi code → access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     ggClientId(),
        client_secret: ggClientSecret(),
        code,
        grant_type:   'authorization_code',
        redirect_uri:  ggRedirect(req),
      }).toString(),
    })
    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string }
    if (!tokenData.access_token) {
      throw new Error(tokenData.error ?? 'Không nhận được token.')
    }

    // Lấy thông tin user từ Google UserInfo
    const meRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const me = (await meRes.json()) as { sub: string; name?: string; email?: string }

    const authUser = await upsertOAuthUser({
      provider:   'google',
      providerId: me.sub,
      email:      me.email ?? '',
      fullName:   me.name ?? me.email ?? me.sub,
    })

    // OAuth callback luôn lưu token (remember=true ở client) → token sống lâu.
    const token = signToken(authUser, true)
    res.redirect(
      `${frontendBase(req)}/oauth/callback#token=${encodeURIComponent(token)}&from=${encodeURIComponent(verified.from)}`,
    )
  } catch (err) {
    console.error('[oauth/google/callback]', err)
    res.redirect('/dang-nhap?error=oauth_failed')
  }
})
