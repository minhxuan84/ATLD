// Tiện ích bảo mật dùng chung phía server

// Escape HTML để chống XSS khi lưu & hiển thị nội dung do người dùng nhập
export function escapeText(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Giải mã HTML entity về ký tự thật — dùng khi tạo văn bản thuần (tóm tắt tin).
// TinyMCE mã hóa 'named' cho ký tự Latin/dấu câu và 'numeric' cho ký tự tiếng Việt.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', middot: '·', bull: '•',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', deg: '°', copy: '©', reg: '®', trade: '™', euro: '€',
  aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï',
  oacute: 'ó', ograve: 'ò', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø',
  uacute: 'ú', ugrave: 'ù', ucirc: 'û', uuml: 'ü',
  yacute: 'ý', yuml: 'ÿ', ntilde: 'ñ', ccedil: 'ç',
  Aacute: 'Á', Agrave: 'À', Acirc: 'Â', Atilde: 'Ã',
  Eacute: 'É', Egrave: 'È', Ecirc: 'Ê',
  Iacute: 'Í', Igrave: 'Ì',
  Oacute: 'Ó', Ograve: 'Ò', Ocirc: 'Ô', Otilde: 'Õ',
  Uacute: 'Ú', Ugrave: 'Ù', Ucirc: 'Û', Yacute: 'Ý',
}
export function decodeEntities(input: string): string {
  return String(input ?? '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name: string) =>
      Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : m)
}

// Làm sạch tên file: bỏ path traversal và ký tự nguy hiểm
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[/\\]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/[^\w.\-() À-ỹ]/g, '')
    .trim()
    .slice(0, 120) || 'tai-lieu'
}

export const ALLOWED_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg']
export const MAX_FILE_MB = 20

// Làm sạch HTML từ trình soạn thảo (TinyMCE) theo danh sách thẻ/thuộc tính an toàn.
// Chống XSS: loại bỏ script/style/iframe, sự kiện on*, và URL javascript:.
const ALLOWED_TAGS = new Set([
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'hr',
  'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'span', 'div', 'figure', 'figcaption',
])
const ALLOWED_ATTR: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan']),
}

export function sanitizeHtml(input: string): string {
  let html = String(input ?? '')
  // Bỏ hẳn các khối nguy hiểm kèm nội dung
  html = html.replace(/<\s*(script|style|iframe|object|embed|form|link|meta)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
  html = html.replace(/<\s*(script|style|iframe|object|embed|form|link|meta)\b[^>]*\/?>/gi, '')

  // Duyệt từng thẻ: giữ thẻ hợp lệ + thuộc tính an toàn, loại bỏ phần còn lại
  html = html.replace(/<(\/?)([a-zA-Z0-9]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (_m, slash: string, rawTag: string, attrs: string) => {
    const tag = rawTag.toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) return ''
    if (slash) return `</${tag}>`

    const allowed = ALLOWED_ATTR[tag]
    let safeAttrs = ''
    if (allowed) {
      const attrRe = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*("([^"]*)"|'([^']*)')/g
      let a: RegExpExecArray | null
      while ((a = attrRe.exec(attrs)) !== null) {
        const name = a[1].toLowerCase()
        const value = a[3] ?? a[4] ?? ''
        if (name.startsWith('on')) continue // chặn sự kiện inline
        if (!allowed.has(name)) continue
        // Chặn URL nguy hiểm ở href/src
        if ((name === 'href' || name === 'src') && /^\s*(javascript|data|vbscript):/i.test(value)) continue
        safeAttrs += ` ${name}="${value.replace(/"/g, '&quot;')}"`
      }
      // Thêm rel an toàn cho link mở tab mới
      if (tag === 'a' && /target\s*=/.test(safeAttrs)) safeAttrs += ' rel="noopener noreferrer"'
    }
    return `<${tag}${safeAttrs}>`
  })
  return html.trim()
}
