/**
 * Sinh nội dung khóa học huấn luyện an toàn bằng Claude API.
 * Trả về cấu trúc { title, description, grp, duration, summary[], questions[] }
 * để admin/cán bộ duyệt trước khi lưu. Không tự ghi vào DB.
 */
import Anthropic from '@anthropic-ai/sdk'

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8'

export interface GeneratedQuestion {
  text: string
  options: string[]
  correct_index: number
}
export interface GeneratedCourse {
  title: string
  description: string
  grp: string
  duration: string
  summary: string[]
  questions: GeneratedQuestion[]
}

/** System prompt động — số câu hỏi do admin cấu hình */
const buildSystemPrompt = (questionCount: number) =>
  `Bạn là chuyên gia biên soạn nội dung huấn luyện An toàn, Vệ sinh lao động (ATVSLĐ)
và Bảo vệ môi trường cho nhà máy xi măng VICEM Hà Tiên, tuân thủ Luật ATVSLĐ 84/2015/QH13
và Nghị định 44/2016/NĐ-CP của Việt Nam.

Nhiệm vụ: từ chủ đề người dùng cung cấp, soạn một khóa huấn luyện hoàn chỉnh bằng TIẾNG VIỆT.
Yêu cầu:
- Nội dung chính xác, thực tế, phù hợp môi trường sản xuất xi măng.
- summary: 4-7 ý cốt lõi, mỗi ý là một câu ngắn gọn, rõ ràng.
- questions: ĐÚNG ${questionCount} câu trắc nghiệm (không nhiều hơn, không ít hơn), mỗi câu có đúng 4 lựa chọn, chỉ 1 đáp án đúng.
- grp: chọn 1 trong: "Nhóm 1", "Nhóm 2", "Nhóm 3", "Nhóm 4", "Nhóm 5", "Nhóm 6" cho phù hợp đối tượng.
- duration: ước lượng thời lượng học, ví dụ "20 phút".

CHỈ trả về JSON hợp lệ theo đúng schema, KHÔNG kèm giải thích, KHÔNG bọc trong markdown.`

const TOOL = {
  name: 'tao_khoa_hoc',
  description: 'Trả về nội dung khóa học huấn luyện đã soạn.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Tên khóa học' },
      description: { type: 'string', description: 'Mô tả ngắn 1-2 câu' },
      grp: { type: 'string', description: 'Nhóm đối tượng (Nhóm 1..6)' },
      duration: { type: 'string', description: 'Thời lượng, vd "20 phút"' },
      summary: {
        type: 'array', items: { type: 'string' },
        description: '4-7 ý tóm tắt nội dung',
      },
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            options: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
            correct_index: { type: 'integer', minimum: 0, maximum: 3 },
          },
          required: ['text', 'options', 'correct_index'],
        },
      },
    },
    required: ['title', 'description', 'grp', 'duration', 'summary', 'questions'],
  },
}

/**
 * Chuyển GeneratedCourse thành script.json hợp lệ cho auto-video-gen.
 *
 * Ràng buộc Zod (src/render/script-schema.ts) phải tuân thủ tuyệt đối:
 *   - scenes: 5–8 phần tử, [0].type='hook', [cuối].type='outro'
 *   - feature-list: title ≤40, bullets 1–4 phần tử, mỗi bullet ≤50 ký tự
 *   - hook: headline ≤40, subhead ≤40
 *   - stat-hero: value ≤20, label ≤40, context ≤50
 *   - callout: statement ≤80, tag ≤20
 *   - outro: ctaTop ≤30, channelName ≤30, source ≤40
 *   - metadata.source.image: URL hợp lệ hoặc null
 *
 * Layout cố định 5 scenes (+1 nếu summary ≥ 4 ý) để luôn đạt min 5:
 *   1. hook         — tiêu đề + mô tả
 *   2. feature-list — 3 ý tóm tắt đầu
 *   3. callout      — thông điệp trọng tâm
 *   4. feature-list — ý 4-6  (CHỈ khi summary ≥ 4 ý)
 *   5. stat-hero    — thời lượng + nhóm đối tượng
 *   6. outro        — CTA
 *
 * Lưu ý: voice.provider phải là literal "lucylab" (Zod enforce), nhưng runtime
 * thực tế dùng TTS_PROVIDER; pipeline substitute "${VIETNAMESE_VOICEID}" từ env.
 */
export function buildVideoScript(course: GeneratedCourse, topic: string, imageUrl?: string | null): object {
  const cut = (s: string, n: number) => s.trim().slice(0, n)
  const scenes: object[] = []

  // Scene 1: hook — headline/subhead giới hạn 40 ký tự
  scenes.push({
    id: 'hook',
    type: 'hook',
    voiceText: `${course.title}. ${course.description}`,
    templateData: {
      template: 'hook',
      headline: cut(course.title || topic, 40),
      subhead: cut(course.description, 40) || undefined,
      kenBurns: 'zoom-in',
    },
  })

  // Scene 2: feature-list ý 1-3 — bullets BẮT BUỘC ≥1 phần tử
  const b1 = course.summary.slice(0, 3).map((s) => cut(s, 50)).filter(Boolean)
  const bullets1 = b1.length ? b1 : [cut(course.description || topic, 50)]
  scenes.push({
    id: 'summary-1',
    type: 'body',
    voiceText: `Nội dung chính. ${bullets1.join('. ')}`,
    templateData: {
      template: 'feature-list',
      title: 'Nội dung chính',
      bullets: bullets1,
    },
  })

  // Scene 3: callout — luôn có, giúp đảm bảo tối thiểu 5 scenes
  scenes.push({
    id: 'callout',
    type: 'body',
    voiceText: `Tuân thủ quy định an toàn là trách nhiệm của mỗi người lao động.`,
    templateData: {
      template: 'callout',
      statement: cut('Tuân thủ an toàn — trách nhiệm của mỗi người lao động', 80),
      tag: 'ATVSLĐ',
    },
  })

  // Scene 4: feature-list ý 4-6 (tùy chọn)
  const b2 = course.summary.slice(3, 6).map((s) => cut(s, 50)).filter(Boolean)
  if (b2.length) {
    scenes.push({
      id: 'summary-2',
      type: 'body',
      voiceText: b2.join('. '),
      templateData: {
        template: 'feature-list',
        title: 'Lưu ý quan trọng',
        bullets: b2,
      },
    })
  }

  // Scene 5: stat-hero — thời lượng + nhóm đối tượng
  const duration = course.duration || '20 phút'
  const grp = course.grp || ''
  scenes.push({
    id: 'info',
    type: 'body',
    voiceText: grp
      ? `Khóa học thuộc ${grp}, thời lượng ${duration}.`
      : `Thời lượng khóa học: ${duration}.`,
    templateData: {
      template: 'stat-hero',
      value: cut(duration, 20),
      label: 'Thời lượng học',
      context: grp ? cut(grp, 50) : undefined,
    },
  })

  // Scene 6: outro
  scenes.push({
    id: 'outro',
    type: 'outro',
    voiceText: 'Bắt đầu học ngay để nâng cao kiến thức an toàn lao động. VICEM Hà Tiên.',
    templateData: {
      template: 'outro',
      ctaTop: 'Bắt đầu học ngay',
      channelName: 'VICEM Hà Tiên ATLĐ',
      source: 'vicemhatien.com.vn',
    },
  })

  return {
    version: '1.0',
    metadata: {
      title: cut(course.title || topic, 100),
      source: {
        url: 'https://vicemhatien.com.vn',
        domain: 'vicemhatien.com.vn',
        image: imageUrl ?? null, // Zod: URL hợp lệ hoặc null → truyền từ admin hoặc null
      },
      channel: 'VICEM Hà Tiên ATLĐ',
    },
    voice: {
      provider: 'lucylab',              // literal bắt buộc theo Zod schema
      voiceId: '${VIETNAMESE_VOICEID}', // pipeline substitute từ env theo TTS_PROVIDER
      speed: 1.0,
    },
    scenes,
  }
}

export function aiAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY)
}

/**
 * Khởi tạo Anthropic client. Ưu tiên kết nối qua LLM Gateway:
 *  - ANTHROPIC_AUTH_TOKEN → gửi header `Authorization: Bearer` (dùng cho gateway)
 *  - ANTHROPIC_BASE_URL   → trỏ endpoint về gateway thay vì api.anthropic.com
 * Fallback về ANTHROPIC_API_KEY (header `x-api-key`) khi gọi trực tiếp Anthropic.
 */
function makeClient(): Anthropic {
  const baseURL = process.env.ANTHROPIC_BASE_URL || undefined
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN
  if (authToken) {
    return new Anthropic({ authToken, baseURL })
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL })
}

export async function generateCourse(topic: string, questionCount = 8): Promise<GeneratedCourse> {
  const client = makeClient()
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: buildSystemPrompt(Math.max(3, Math.min(20, questionCount))),
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content: `Chủ đề khóa huấn luyện: ${topic}` }],
  })

  const block = msg.content.find((b) => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') {
    throw new Error('AI không trả về nội dung hợp lệ.')
  }
  const data = block.input as GeneratedCourse

  // Làm sạch & bảo đảm ràng buộc tối thiểu
  const questions = (Array.isArray(data.questions) ? data.questions : [])
    .map((q) => ({
      text: String(q.text ?? '').trim(),
      options: (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim()).filter(Boolean),
      correct_index: Number(q.correct_index) || 0,
    }))
    .filter((q) => q.text && q.options.length >= 2 && q.correct_index < q.options.length)

  return {
    title: String(data.title ?? '').slice(0, 200),
    description: String(data.description ?? ''),
    grp: String(data.grp ?? 'Nhóm 4'),
    duration: String(data.duration ?? ''),
    summary: (Array.isArray(data.summary) ? data.summary : []).map((s) => String(s).trim()).filter(Boolean),
    questions,
  }
}
