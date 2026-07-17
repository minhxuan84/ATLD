// Kiểu dùng chung phía client. Vai trò khớp với RBAC phía server.
export type Role = 'trainee' | 'officer' | 'admin'

// Các mục CMS có thể phân quyền cho cán bộ. Phải khớp CMS_SECTIONS phía server.
export const CMS_SECTIONS = [
  { key: 'nguoi-dung', label: 'Người dùng' },
  { key: 'chi-nhanh', label: 'Chi nhánh / đơn vị' },
  { key: 'khoa-hoc', label: 'Khóa học & câu hỏi' },
  { key: 'truong-trac-nghiem', label: 'Trường trắc nghiệm' },
  { key: 'tin-tuc', label: 'Tin tức' },
  { key: 'tai-lieu', label: 'Tài liệu' },
  { key: 'muc-tieu', label: 'Mục tiêu & Timeline' },
  { key: 'menu', label: 'Quản lý menu' },
  { key: 'trang-tinh', label: 'Trang tĩnh & Nhận diện' },
  { key: 'an-toan', label: 'ATVSLĐ / PCCN / BVMT (toàn quyền)' },
  { key: 'an-toan:gate', label: '↳ Bảo vệ — Cổng kiểm soát' },
  { key: 'an-toan:inspect', label: '↳ Cán bộ ATMT — Kiểm tra & hồ sơ' },
  { key: 'an-toan:approve', label: '↳ Người phê duyệt — Đình chỉ' },
] as const
export type CmsSection = (typeof CMS_SECTIONS)[number]['key']
