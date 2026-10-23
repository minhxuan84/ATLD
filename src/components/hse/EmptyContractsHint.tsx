// Gợi ý khi danh sách hợp đồng rỗng — dùng chung cho mọi form chọn hợp đồng.
//
// Lý do có component này: /hse/contracts lọc theo site của cán bộ (siteScope ở server),
// và migration cũ gán mọi hợp đồng chưa có site về Kiên Lương. Cán bộ phụ trách nhà máy
// khác đăng nhập vào sẽ thấy dropdown rỗng hoàn toàn, không một dòng giải thích — rất dễ
// kết luận là phần mềm lỗi trong khi dữ liệu vẫn nguyên, chỉ thuộc site khác.
import { useAuth, seesAllSites } from '../../context/AuthContext'

export default function EmptyContractsHint({ activeOnly = false }: { activeOnly?: boolean }) {
  const { user } = useAuth()
  // Người xem được mọi site thì rỗng nghĩa là chưa ai tạo hợp đồng — câu chữ phải khác,
  // nói "site của bạn" với admin là sai và gây hiểu lầm.
  const allSites = seesAllSites(user)
  return (
    <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
      {allSites ? (
        <>
          Chưa có hợp đồng nào{activeOnly ? ' đang thực hiện hoặc chờ duyệt' : ''} trong hệ thống. Tạo hợp đồng
          ở tab <b>Nhà thầu &amp; Hợp đồng</b> trước.
        </>
      ) : (
        <>
          Không có hợp đồng nào{activeOnly ? ' đang thực hiện hoặc chờ duyệt' : ''} thuộc nhà máy bạn phụ trách.
          Hợp đồng được tạo trước khi phân chia nhà máy có thể đang gắn vào nhà máy khác — nhờ
          quản trị viên kiểm tra mục <b>Chi nhánh / site</b> của hợp đồng.
        </>
      )}
    </p>
  )
}
