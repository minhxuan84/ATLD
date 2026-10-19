/**
 * Bộ lấy tin RSS tự động (Pha I).
 *
 * Bảo mật:
 * - Chỉ HTTPS; reject dải IP nội bộ (SSRF guard).
 * - Theo tối đa 3 redirect, kiểm lại hostname mỗi chặng.
 * - AbortSignal.timeout(10_000), chặn trên 300 KB.
 * - Content-Type phải là xml/rss/atom.
 * - Tiêu đề qua escapeText, nội dung qua sanitizeHtml, tóm tắt qua makeExcerpt.
 * - Luôn ghi status='draft' — không có đường cho nội dung ngoài tự lên trang.
 */
import dns from 'node:dns/promises'
import { XMLParser } from 'fast-xml-parser'
import { query } from '../db.js'
import { escapeText, sanitizeHtml, makeExcerpt } from '../util.js'

const MAX_BYTES = 300 * 1024   // 300 KB
const MAX_REDIRECTS = 3
const FETCH_TIMEOUT_MS = 10_000

// ─── SSRF guard ───────────────────────────────────────────────────────────────

function isPrivateIp(ip: string): boolean {
  // IPv4
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 127) return true                           // loopback 127/8
    if (a === 10) return true                            // 10/8
    if (a === 172 && b >= 16 && b <= 31) return true    // 172.16/12
    if (a === 192 && b === 168) return true              // 192.168/16
    if (a === 169 && b === 254) return true              // link-local 169.254/16
    if (a === 0) return true                             // 0/8
    if (a === 100 && b >= 64 && b <= 127) return true   // CGNAT 100.64/10
    return false
  }
  // IPv6
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (lower === '::1') return true                       // loopback
  if (/^fe80/i.test(lower)) return true                 // link-local fe80::/10
  if (/^f[cd]/i.test(lower)) return true                // ULA fc00::/7
  return false
}

async function guardedFetch(url: string, redirectsLeft = MAX_REDIRECTS): Promise<Response> {
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new Error(`URL không hợp lệ: ${url}`) }
  if (parsed.protocol !== 'https:') throw new Error('Nguồn RSS phải dùng HTTPS.')

  // Phân giải DNS và kiểm IP trước khi kết nối
  const { address } = await dns.lookup(parsed.hostname).catch(() => {
    throw new Error(`Không phân giải được hostname: ${parsed.hostname}`)
  })
  if (isPrivateIp(address)) {
    throw new Error(`Hostname ${parsed.hostname} phân giải về địa chỉ nội bộ (${address}).`)
  }

  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'manual',
    headers: { 'User-Agent': 'ATLD-RSSFetcher/1.0 (+https://atld.hatiencement.vn)' },
  })

  // Xử lý redirect thủ công để kiểm lại DNS mỗi chặng
  if (res.status >= 300 && res.status < 400) {
    if (redirectsLeft <= 0) throw new Error('Vượt quá số lần chuyển hướng tối đa (3).')
    const location = res.headers.get('location')
    if (!location) throw new Error('Phản hồi redirect thiếu header Location.')
    return guardedFetch(new URL(location, url).toString(), redirectsLeft - 1)
  }

  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  return res
}

// ─── Parser RSS / Atom ────────────────────────────────────────────────────────

interface RawItem { title: string; link: string; description: string; pubDate?: string }

function parseXml(xml: string): RawItem[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    cdataPropName: '__cdata',
    isArray: (name) => name === 'item' || name === 'entry',
  })
  const doc = parser.parse(xml) as Record<string, unknown>

  // RSS 2.0 — doc.rss.channel.item[]
  const channel = (doc?.rss as Record<string, unknown>)?.channel as Record<string, unknown> | undefined
  if (channel) {
    const items = (channel.item as Record<string, unknown>[] | undefined) ?? []
    return items.map((it) => ({
      title: extractText(it.title),
      link: extractText(it.link),
      description: extractText((it['content:encoded'] ?? it.description) as unknown),
      pubDate: it.pubDate ? String(it.pubDate) : undefined,
    }))
  }

  // Atom 1.0 — doc.feed.entry[]
  const feed = doc?.feed as Record<string, unknown> | undefined
  if (feed) {
    const entries = (feed.entry as Record<string, unknown>[] | undefined) ?? []
    return entries.map((en) => {
      const links = (Array.isArray(en.link) ? en.link : en.link ? [en.link] : []) as Record<string, unknown>[]
      const alt = links.find((l) => l['@_rel'] === 'alternate' || !l['@_rel'])
      const link = alt ? String(alt['@_href'] ?? '') : ''
      const body = (en.content ?? en.summary) as unknown
      return {
        title: extractText(en.title),
        link,
        description: extractText(body),
        pubDate: en.updated ? String(en.updated) : en.published ? String(en.published) : undefined,
      }
    })
  }

  return []
}

/** Lấy text từ node có thể là string, object {#text, __cdata, ...}, hoặc null. */
function extractText(node: unknown): string {
  if (!node) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'object') {
    const n = node as Record<string, unknown>
    if (n.__cdata) return String(n.__cdata)
    if (n['#text']) return String(n['#text'])
  }
  return String(node)
}

// ─── Nguồn DB ─────────────────────────────────────────────────────────────────

export interface NewsSourceRow {
  id: number
  name: string
  url: string
  enabled: boolean
  interval_minutes: number
  category: string | null
  last_fetched_at: Date | null
}

export async function fetchSource(src: NewsSourceRow): Promise<{ added: number; error?: string }> {
  const startedAt = Date.now()
  try {
    const res = await guardedFetch(src.url)

    // Kiểm Content-Type
    const ct = res.headers.get('content-type') ?? ''
    if (!/xml|rss|atom/i.test(ct)) {
      throw new Error(`Content-Type không hợp lệ: ${ct}`)
    }

    // Đọc tối đa MAX_BYTES
    const reader = res.body?.getReader()
    if (!reader) throw new Error('Response body rỗng.')
    const chunks: Uint8Array[] = []
    let total = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.length
        if (total > MAX_BYTES) { reader.cancel(); throw new Error(`Phản hồi vượt quá 300 KB.`) }
        chunks.push(value)
      }
    }
    const xml = Buffer.concat(chunks).toString('utf-8')

    const items = parseXml(xml)
    let added = 0

    for (const item of items) {
      if (!item.link || !item.title) continue
      const title = escapeText(item.title.trim()).slice(0, 200)
      const rawHtml = item.description.trim().slice(0, 20000)
      const content = sanitizeHtml(rawHtml)
      const excerpt = makeExcerpt(content)
      const sourceUrl = item.link.trim().slice(0, 500)
      const category = src.category ?? 'Môi trường'
      const author = src.name

      const { rowCount } = await query(
        `INSERT INTO atld.news
           (title, category, excerpt, content, author, status, source_id, source_url, source_name, fetched_at)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, now())
         ON CONFLICT (source_url) DO NOTHING`,
        [title, category, excerpt, content, author, src.id, sourceUrl, src.name],
      )
      if (rowCount) added++
    }

    const elapsed = Date.now() - startedAt
    await query(
      `UPDATE atld.news_sources
       SET last_fetched_at = now(), last_status = 'ok', last_error = NULL
       WHERE id = $1`,
      [src.id],
    )
    console.log(`[newsFetch] nguồn #${src.id} "${src.name}": +${added} tin (${elapsed}ms)`)
    return { added }
  } catch (e) {
    const msg = (e as Error).message ?? String(e)
    await query(
      `UPDATE atld.news_sources
       SET last_fetched_at = now(), last_status = 'error', last_error = $1
       WHERE id = $2`,
      [msg.slice(0, 500), src.id],
    )
    console.error(`[newsFetch] nguồn #${src.id} "${src.name}" lỗi: ${msg}`)
    return { added: 0, error: msg }
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

export function startNewsFetcher(): void {
  const TICK_MS = 15 * 60 * 1000   // kiểm mỗi 15 phút

  const tick = async () => {
    try {
      const { rows } = await query<NewsSourceRow>(
        `SELECT id, name, url, enabled, interval_minutes, category, last_fetched_at
         FROM atld.news_sources
         WHERE enabled = true
           AND (last_fetched_at IS NULL
                OR last_fetched_at < now() - interval_minutes * interval '1 minute')`,
      )
      for (const src of rows) {
        // Không await: quét song song các nguồn, lỗi từng nguồn không block nhau
        fetchSource(src).catch((e) => console.error('[newsFetch tick]', e))
      }
    } catch (e) {
      console.error('[newsFetch tick error]', e)
    }
  }

  // Quét ngay lần đầu sau 30 giây khi server khởi động, rồi định kỳ
  setTimeout(tick, 30_000)
  setInterval(tick, TICK_MS)
  console.log('[newsFetch] scheduler đã khởi động (tick mỗi 15 phút)')
}
