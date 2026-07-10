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

const SYSTEM_PROMPT = `Bạn là chuyên gia biên soạn nội dung huấn luyện An toàn, Vệ sinh lao động (ATVSLĐ)
và Bảo vệ môi trường cho nhà máy xi măng VICEM Hà Tiên, tuân thủ Luật ATVSLĐ 84/2015/QH13
và Nghị định 44/2016/NĐ-CP của Việt Nam.

Nhiệm vụ: từ chủ đề người dùng cung cấp, soạn một khóa huấn luyện hoàn chỉnh bằng TIẾNG VIỆT.
Yêu cầu:
- Nội dung chính xác, thực tế, phù hợp môi trường sản xuất xi măng.
- summary: 4-7 ý cốt lõi, mỗi ý là một câu ngắn gọn, rõ ràng.
- questions: 5-8 câu trắc nghiệm, mỗi câu có đúng 4 lựa chọn, chỉ 1 đáp án đúng.
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

export function aiAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export async function generateCourse(topic: string): Promise<GeneratedCourse> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
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
