/**
 * Lớp gọi API cho cổng công khai (Pha D).
 *
 * KHÔNG dùng api() trong src/lib/api.ts: helper đó tự gắn JWT từ localStorage. Nếu cán
 * bộ đang đăng nhập mở thử link nhà thầu, token của họ sẽ bị gửi lên endpoint công
 * khai — không cần thiết và làm lẫn ngữ cảnh. Ở đây luôn gửi request vô danh.
 */
interface PortalOptions {
  method?: string
  body?: unknown
  form?: FormData
}

export async function portalApi<T = unknown>(path: string, opts: PortalOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  let body: BodyInit | undefined
  if (opts.form) {
    body = opts.form
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const res = await fetch(`/api/portal${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body,
  })
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error ?? `Lỗi ${res.status}`)
  }
  return data as T
}

export interface DocType {
  id: number
  name: string
  is_mandatory: boolean
}

export interface PortalFinding {
  finding_no: string
  description: string
  area: string | null
  capa_requirement: string | null
  capa_due_at: string | null
  risk_level: string | null
  status: string
}

export interface PortalInfo {
  purpose: 'worker_declare' | 'field_report' | 'capa_response'
  label: string | null
  contractor_name: string | null
  contract_no: string | null
  site_name: string | null
  expires_at: string
  remaining_uses: number | null
  docTypes: DocType[]
  finding: PortalFinding | null
}
