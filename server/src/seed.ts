import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { pool, query } from './db.js'

async function seed() {
  console.log('Bắt đầu seed dữ liệu vào schema atld...')

  // Xóa dữ liệu cũ trong schema atld (không đụng public.*)
  await query('TRUNCATE progress, questions, courses, quiz_fields, branches, documents, news, milestones, goals, menu_items, users RESTART IDENTITY CASCADE')

  // --- Menu điều hướng trang chủ ---
  const menuItems = [
    ['Trang chủ', '#home', 1],
    ['Giới thiệu', '#gioi-thieu', 2],
    ['Lĩnh vực', '#linh-vuc', 3],
    ['Năng lực', '#nang-luc', 4],
    ['Tin tức', '#tin-tuc', 5],
    ['Liên hệ', '#lien-he', 6],
  ] as const
  for (const [label, href, order] of menuItems) {
    await query('INSERT INTO menu_items (label, href, sort_order) VALUES ($1, $2, $3)', [label, href, order])
  }
  console.log(`- ${menuItems.length} mục menu`)

  // --- Chi nhánh / đơn vị ---
  const branches = [
    { name: 'Nhà máy Xi măng Bình Phước', location: 'Bình Phước', sort_order: 1 },
    { name: 'Nhà máy Xi măng Kiên Lương', location: 'Kiên Giang', sort_order: 2 },
    { name: 'Trạm nghiền Cam Ranh', location: 'Khánh Hòa', sort_order: 3 },
    { name: 'Trạm nghiền Phú Hữu', location: 'TP. Hồ Chí Minh', sort_order: 4 },
  ]
  const branchIds: number[] = []
  for (const b of branches) {
    const { rows } = await query<{ id: number }>(
      'INSERT INTO branches (name, location, sort_order) VALUES ($1, $2, $3) RETURNING id',
      [b.name, b.location, b.sort_order],
    )
    branchIds.push(rows[0].id)
  }
  console.log(`- ${branches.length} chi nhánh`)

  // --- Người dùng (mật khẩu băm bằng bcrypt) ---
  // permissions: mảng khóa mục CMS được cấp (chỉ áp dụng cho officer; admin toàn quyền)
  const users = [
    { username: 'admin', password: 'Admin@123', full_name: 'Quản trị viên VICEM Hà Tiên', role: 'admin', permissions: [] as string[] },
    { username: 'canbo', password: 'Canbo@123', full_name: 'Trần Thị Bình (Cán bộ ATLĐ)', role: 'officer', permissions: ['tin-tuc', 'tai-lieu', 'muc-tieu'] },
    { username: 'hocvien', password: 'Hocvien@123', full_name: 'Nguyễn Văn An (Học viên)', role: 'trainee', permissions: [] as string[] },
  ]
  for (const u of users) {
    const hash = await bcrypt.hash(u.password, 10)
    await query(
      'INSERT INTO users (username, password_hash, full_name, role, permissions) VALUES ($1, $2, $3, $4, $5)',
      [u.username, hash, u.full_name, u.role, JSON.stringify(u.permissions)],
    )
  }
  console.log(`- ${users.length} tài khoản`)

  // --- Khóa học + câu hỏi ---
  const courses = [
    {
      id: 'atld-co-ban',
      title: 'An toàn lao động cơ bản',
      description: 'Kiến thức nền tảng về an toàn, vệ sinh lao động cho người lao động.',
      grp: 'Nhóm 4',
      branch: 0,
      video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      duration: '25 phút',
      summary: [
        'Quyền và nghĩa vụ của người lao động về ATVSLĐ theo Luật 84/2015/QH13.',
        'Nhận diện mối nguy và đánh giá rủi ro tại nơi làm việc.',
        'Sử dụng đúng phương tiện bảo vệ cá nhân (PPE): mũ, kính, găng, giày, dây an toàn.',
        'Quy tắc 5S và giữ gìn vệ sinh khu vực làm việc.',
        'Quy trình ứng phó sự cố và sơ cứu ban đầu.',
      ],
      pass_score: 80,
      sort_order: 1,
      quiz: [
        { text: 'PPE là viết tắt của khái niệm nào?', options: ['Phương tiện bảo vệ cá nhân', 'Quy trình phòng cháy', 'Kế hoạch sản xuất', 'Phiếu kiểm tra thiết bị'], correct: 0 },
        { text: 'Khi phát hiện mối nguy mất an toàn, người lao động nên làm gì đầu tiên?', options: ['Bỏ qua nếu không phải việc của mình', 'Tự ý sửa chữa thiết bị điện', 'Báo ngay cho người phụ trách/cán bộ ATLĐ', 'Chờ hết ca rồi báo'], correct: 2 },
        { text: '5S KHÔNG bao gồm nội dung nào sau đây?', options: ['Sàng lọc', 'Sắp xếp', 'Sản xuất', 'Sạch sẽ'], correct: 2 },
        { text: 'Văn bản pháp luật nào là nền tảng về ATVSLĐ tại Việt Nam?', options: ['Luật ATVSLĐ 84/2015/QH13', 'Luật Doanh nghiệp', 'Luật Giao thông', 'Luật Đất đai'], correct: 0 },
        { text: 'Mục tiêu quan trọng nhất của công tác an toàn lao động là gì?', options: ['Tăng sản lượng', 'Bảo vệ tính mạng, sức khỏe người lao động', 'Giảm chi phí điện', 'Rút ngắn giờ làm'], correct: 1 },
      ],
    },
    {
      id: 'moi-truong',
      title: 'Bảo vệ môi trường trong sản xuất xi măng',
      description: 'Quản lý chất thải, quan trắc và trách nhiệm môi trường của người lao động.',
      grp: 'Nhóm 4',
      branch: 1,
      video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      duration: '20 phút',
      summary: [
        'Phân loại chất thải: chất thải thường, chất thải nguy hại.',
        'Quy trình thu gom, lưu giữ và xử lý chất thải đúng quy định.',
        'Kiểm soát bụi và khí thải trong sản xuất xi măng.',
        'Ý nghĩa của quan trắc môi trường định kỳ (nước, khí, tiếng ồn).',
        'Trách nhiệm của mỗi cá nhân trong bảo vệ môi trường.',
      ],
      pass_score: 80,
      sort_order: 2,
      quiz: [
        { text: 'Chất thải nguy hại cần được xử lý như thế nào?', options: ['Đổ chung rác sinh hoạt', 'Thu gom, lưu giữ riêng và xử lý theo quy định', 'Chôn lấp tại chỗ', 'Đốt tự do'], correct: 1 },
        { text: 'Quan trắc môi trường KHÔNG bao gồm yếu tố nào?', options: ['Chất lượng nước thải', 'Khí thải', 'Tiếng ồn', 'Doanh thu công ty'], correct: 3 },
        { text: 'Trong sản xuất xi măng, yếu tố môi trường nào cần kiểm soát chặt nhất?', options: ['Bụi và khí thải', 'Ánh sáng', 'Màu sơn tường', 'Nhiệt độ phòng họp'], correct: 0 },
        { text: 'Ai chịu trách nhiệm bảo vệ môi trường trong doanh nghiệp?', options: ['Chỉ ban giám đốc', 'Chỉ cán bộ môi trường', 'Mọi người lao động', 'Chỉ đơn vị bên ngoài'], correct: 2 },
      ],
    },
  ]

  for (const c of courses) {
    await query(
      `INSERT INTO courses (id, title, description, grp, branch_id, video_url, duration, summary, pass_score, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [c.id, c.title, c.description, c.grp, branchIds[c.branch] ?? null, c.video_url, c.duration, JSON.stringify(c.summary), c.pass_score, c.sort_order],
    )
    for (let i = 0; i < c.quiz.length; i++) {
      const q = c.quiz[i]
      await query(
        'INSERT INTO questions (course_id, text, options, correct_index, sort_order) VALUES ($1, $2, $3, $4, $5)',
        [c.id, q.text, JSON.stringify(q.options), q.correct, i],
      )
    }
  }
  console.log(`- ${courses.length} khóa học + câu hỏi`)

  // --- Tài liệu mẫu (metadata; file thật sẽ upload qua giao diện) ---
  const docs = [
    ['Nội quy an toàn lao động 2026.pdf', 'Nội quy', 'Nội quy ATLĐ áp dụng toàn công ty năm 2026.', 820],
    ['Quy trình vận hành lò nung an toàn.docx', 'Quy trình', 'Hướng dẫn vận hành an toàn lò nung xi măng.', 340],
    ['Biên bản diễn tập PCCC Q1-2026.pdf', 'Biên bản', 'Biên bản diễn tập phòng cháy chữa cháy quý 1.', 510],
    ['Kết quả quan trắc môi trường Q2-2026.xlsx', 'Quan trắc môi trường', 'Số liệu quan trắc nước, khí, tiếng ồn quý 2.', 128],
    ['Giấy phép môi trường.pdf', 'Hồ sơ pháp lý', 'Giấy phép môi trường do Sở TN&MT cấp.', 1450],
  ]
  for (const [name, category, description, size] of docs) {
    await query(
      `INSERT INTO documents (name, category, description, size_kb, stored_name, mime_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [name, category, description, size, 'seed-placeholder', 'application/octet-stream', 'Trần Thị Bình (Cán bộ ATLĐ)'],
    )
  }
  console.log(`- ${docs.length} tài liệu mẫu`)

  // --- Tin tức ---
  const news = [
    ['Phát động Tháng hành động về An toàn, vệ sinh lao động 2026', 'Sự kiện', 'VICEM Hà Tiên chính thức phát động Tháng hành động về ATVSLĐ năm 2026 với nhiều hoạt động huấn luyện, kiểm tra thiết bị và diễn tập ứng phó sự cố.'],
    ['Cảnh báo: Kiểm tra dây an toàn trước khi làm việc trên cao', 'Cảnh báo an toàn', 'Tất cả người lao động làm việc ở độ cao từ 2m trở lên phải kiểm tra dây an toàn, đai và điểm neo trước khi bắt đầu công việc. Không sử dụng thiết bị đã sờn, rách hoặc quá hạn kiểm định.'],
    ['Kết quả quan trắc môi trường quý 2 đạt chuẩn', 'Thông báo', 'Toàn bộ chỉ tiêu về nước thải, khí thải và tiếng ồn quý 2/2026 đều đạt quy chuẩn kỹ thuật quốc gia. Công ty tiếp tục duy trì các biện pháp kiểm soát.'],
    ['Hoàn thành cấp 120 chứng chỉ ATLĐ trong tháng 6', 'Thông báo', 'Nền tảng huấn luyện trực tuyến đã giúp 120 người lao động hoàn thành khóa học và đạt bài trắc nghiệm trong tháng 6/2026. Tỷ lệ đạt lần đầu là 88%.'],
  ]
  for (const [title, category, content] of news) {
    const excerpt = content.slice(0, 120) + (content.length > 120 ? '…' : '')
    await query(
      'INSERT INTO news (title, category, excerpt, content, author) VALUES ($1, $2, $3, $4, $5)',
      [title, category, excerpt, content, 'Ban ATLĐ'],
    )
  }
  console.log(`- ${news.length} tin tức`)

  // --- Timeline thành tích ---
  const milestones = [
    ['2021', 'Khởi động chương trình', 'Triển khai huấn luyện ATVSLĐ tập trung cho 500 người lao động.', 1],
    ['2022', '1.200 chứng chỉ', 'Cấp 1.200 chứng chỉ ATLĐ, 0 tai nạn lao động nghiêm trọng.', 2],
    ['2023', 'Số hóa huấn luyện', 'Ra mắt nền tảng học trực tuyến, tiết kiệm 40% chi phí.', 3],
    ['2024', 'Đạt ISO 45001', 'Hệ thống quản lý ATVSLĐ đạt chứng nhận ISO 45001:2018.', 4],
    ['2025', '5.000 giờ huấn luyện', 'Tích lũy hơn 5.000 giờ huấn luyện, tỷ lệ đạt trắc nghiệm 92%.', 5],
  ]
  for (const [year, title, detail, order] of milestones) {
    await query('INSERT INTO milestones (year_label, title, detail, sort_order) VALUES ($1, $2, $3, $4)', [year, title, detail, order])
  }
  console.log(`- ${milestones.length} mốc thành tích`)

  // --- Mục tiêu năm/tháng ---
  const goals = [
    ['year', 'Mục tiêu năm 2026', '100% người lao động hoàn thành huấn luyện định kỳ', 68, 1],
    ['year', 'Không tai nạn lao động', 'Duy trì 0 tai nạn lao động nghiêm trọng cả năm', 100, 2],
    ['month', 'Mục tiêu tháng 7/2026', 'Cấp mới 150 chứng chỉ ATLĐ', 45, 3],
    ['month', 'Quan trắc môi trường', 'Hoàn thành quan trắc môi trường Q3', 30, 4],
  ]
  for (const [scope, title, target, progress, order] of goals) {
    await query('INSERT INTO goals (scope, title, target, progress, sort_order) VALUES ($1, $2, $3, $4, $5)', [scope, title, target, progress, order])
  }
  console.log(`- ${goals.length} mục tiêu`)

  // --- Trường thông tin học viên trước khi làm trắc nghiệm ---
  const quizFields = [
    { field_key: 'full_name', label: 'Họ và tên', type: 'text', options: [], required: true, sort_order: 1 },
    { field_key: 'cccd', label: 'Số CCCD', type: 'text', options: [], required: true, sort_order: 2 },
    { field_key: 'grp', label: 'Nhóm đối tượng', type: 'select', options: ['Nhóm 1', 'Nhóm 2', 'Nhóm 3', 'Nhóm 4', 'Nhóm 5', 'Nhóm 6'], required: true, sort_order: 3 },
    { field_key: 'unit', label: 'Đơn vị công tác', type: 'text', options: [], required: false, sort_order: 4 },
  ]
  for (const f of quizFields) {
    await query(
      'INSERT INTO quiz_fields (field_key, label, type, options, required, sort_order) VALUES ($1,$2,$3,$4,$5,$6)',
      [f.field_key, f.label, f.type, JSON.stringify(f.options), f.required, f.sort_order],
    )
  }
  console.log(`- ${quizFields.length} trường trắc nghiệm`)

  const siteConfig: [string, string][] = [
    ['brand_name_top', 'VICEM'],
    ['brand_name_bottom', 'HÀ TIÊN'],
    ['hero_title', 'An toàn lao động & Bảo vệ môi trường'],
    ['hero_subtitle', 'Hệ thống huấn luyện số hóa của Công ty Cổ phần Xi măng VICEM Hà Tiên — nâng cao năng lực, đảm bảo an toàn, phát triển bền vững.'],
    ['hero_badge', 'Công ty Cổ phần Xi măng VICEM Hà Tiên'],
    ['contact_address', 'Km 8, Quốc lộ 80, Kiên Lương, Kiên Giang'],
    ['contact_phone', '(0297) 3 853 004'],
    ['contact_email', 'atld@vicemhatien.com.vn'],
    ['footer_text', '© 2026 Công ty Cổ phần Xi măng VICEM Hà Tiên. Hệ thống huấn luyện số hóa.'],
    ['footer_note', 'Tuân thủ Luật ATVSLĐ 84/2015/QH13 · Nghị định 44/2016/NĐ-CP'],
  ]
  for (const [key, value] of siteConfig) {
    await query('INSERT INTO site_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value])
  }
  console.log(`- ${siteConfig.length} cấu hình trang`)

  console.log('Seed hoàn tất.')
  await pool.end()
}

seed().catch((e) => {
  console.error('Seed lỗi:', e)
  process.exit(1)
})
