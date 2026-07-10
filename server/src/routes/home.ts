import { Router } from 'express'
import { query } from '../db.js'

export const homeRouter = Router()

// Dữ liệu trang chủ công khai: giới thiệu, timeline, mục tiêu
homeRouter.get('/', async (_req, res) => {
  const [milestones, goals] = await Promise.all([
    query('SELECT year_label, title, detail FROM milestones ORDER BY sort_order, year_label'),
    query('SELECT scope, title, target, progress FROM goals ORDER BY sort_order, id'),
  ])
  res.json({
    intro: {
      heading: 'Huấn luyện An toàn lao động & Bảo vệ môi trường',
      paragraphs: [
        'VICEM Hà Tiên cung cấp chương trình huấn luyện An toàn, Vệ sinh lao động (ATVSLĐ) và Bảo vệ môi trường theo đúng quy định pháp luật (Luật ATVSLĐ 84/2015/QH13, Nghị định 44/2016/NĐ-CP).',
        'Chương trình số hóa giúp người lao động học mọi lúc, mọi nơi qua video, nắm nội dung cốt lõi và được kiểm tra, cấp chứng chỉ trực tuyến.',
      ],
      groups: [
        'Nhóm 1: Người quản lý phụ trách công tác ATVSLĐ',
        'Nhóm 2: Người làm công tác ATVSLĐ',
        'Nhóm 3: Người lao động làm công việc có yêu cầu nghiêm ngặt về ATVSLĐ',
        'Nhóm 4: Người lao động không thuộc nhóm 1, 3, 5, 6',
        'Nhóm 5: Người làm công tác y tế',
        'Nhóm 6: An toàn, vệ sinh viên',
      ],
    },
    milestones: milestones.rows,
    goals: goals.rows,
  })
})
