# BỘ PROMPT CLAUDE CODE
## Số hóa Quy trình QT111-07 – Kiểm soát ATVSLĐ, PCCN và BVMT

> Mục tiêu: xây dựng Web App quản lý nhà thầu, nhà cung cấp và khách bên ngoài theo quy trình QT111-07; hỗ trợ kiểm soát hồ sơ, nhân sự, thiết bị, huấn luyện, kiểm tra hiện trường, vi phạm, đình chỉ, khắc phục và lưu hồ sơ.

---

# 1. PROMPT KHỞI TẠO DỰ ÁN

```text
Bạn là Senior Solution Architect, Business Analyst và Full-stack Developer.

Hãy xây dựng một Web App quản lý kiểm soát ATVSLĐ, PCCN và BVMT đối với:
1. Nhà thầu làm việc trong địa bàn Công ty;
2. Nhà thầu làm việc ngoài địa bàn Công ty;
3. Nhà cung cấp;
4. Khách bên ngoài.

Hệ thống phải số hóa quy trình QT111-07 và các biểu mẫu:
- BM111-07.01: Bản cam kết ATVSLĐ-PCCN-BVMT của nhà thầu;
- BM111-07.02: Bảng đánh giá hồ sơ nhà thầu;
- BM111-07.03: Bảng kiểm tra ATMT nhà thầu ban đầu/hàng tháng/hàng tuần;
- BM111-07.04: Bảng kiểm tra ATMT nhà thầu hàng ngày;
- Phụ lục I: Phân loại hình hoạt động/dịch vụ nhà thầu;
- Phụ lục II: Ma trận quản lý an toàn theo chức danh người lao động.

Yêu cầu kiến trúc:
- Frontend: Next.js 15, TypeScript, Tailwind CSS, shadcn/ui;
- Backend: Next.js API hoặc NestJS;
- Database: PostgreSQL + Prisma ORM;
- Authentication: Auth.js/Keycloak, hỗ trợ phân quyền RBAC;
- Lưu file: MinIO hoặc S3 compatible;
- Nhật ký: audit log đầy đủ;
- Triển khai: Docker Compose, có thể chạy trong mạng nội bộ;
- Ngôn ngữ giao diện: tiếng Việt;
- Responsive cho desktop, tablet và điện thoại;
- Ưu tiên PWA để cán bộ an toàn kiểm tra hiện trường bằng điện thoại;
- Có khả năng hoạt động tạm thời khi mất mạng và đồng bộ lại khi có mạng.

Các vai trò:
- SYSTEM_ADMIN;
- COMPANY_ATMT_ADMIN;
- BRANCH_ATMT;
- CONTRACT_OWNER;
- RELATED_UNIT_MANAGER;
- SAFETY_INSPECTOR;
- SECURITY_RECEPTION;
- MEDICAL_STAFF;
- CONTRACTOR_ADMIN;
- CONTRACTOR_SUPERVISOR;
- VIEWER;
- APPROVER.

Nguyên tắc bắt buộc:
- Không cho phép người lao động hoặc thiết bị có yêu cầu nghiêm ngặt tham gia công việc nếu hồ sơ bắt buộc thiếu, hết hạn hoặc bị từ chối;
- Mọi thay đổi trạng thái hồ sơ phải lưu lịch sử;
- Mọi phê duyệt/từ chối phải có người thực hiện, thời gian và ý kiến;
- Hỗ trợ cảnh báo hồ sơ sắp hết hạn;
- Hỗ trợ đình chỉ công việc và chỉ cho phép hoạt động lại sau khi khắc phục được xác nhận;
- Có dashboard theo Công ty/chi nhánh/đơn vị/nhà thầu/hợp đồng;
- Có chức năng xuất PDF/Excel theo đúng cấu trúc các biểu mẫu.

Trước khi viết code:
1. Phân tích nghiệp vụ;
2. Vẽ sơ đồ module;
3. Đề xuất mô hình dữ liệu;
4. Liệt kê trạng thái workflow;
5. Viết acceptance criteria;
6. Tạo kế hoạch triển khai theo sprint;
7. Sau đó mới bắt đầu tạo source code.

Không được tự lược bỏ quy tắc nghiệp vụ. Nếu có điểm chưa rõ, ghi thành ASSUMPTION trong tài liệu, không tự coi là quy định chính thức.
```

---

# 2. PROMPT PHÂN TÍCH NGHIỆP VỤ VÀ WORKFLOW

```text
Hãy đóng vai Business Analyst và chuyển QT111-07 thành tài liệu nghiệp vụ cho Web App.

Phân tích riêng 4 quy trình:

A. Nhà thầu làm việc trong địa bàn Công ty:
1. Đơn vị liên quan tiếp nhận nhu cầu/nhà thầu;
2. Nhà thầu khai báo thông tin hợp đồng, công việc, vị trí, thời gian;
3. Nhà thầu lập và ký Bản cam kết BM111-07.01;
4. Nhà thầu tải hồ sơ an toàn, nhân sự và thiết bị;
5. Đơn vị ATMT đánh giá theo BM111-07.02;
6. Nếu hồ sơ thiếu: trả về bổ sung;
7. Nếu thiếu hồ sơ bắt buộc liên quan đến người hoặc thiết bị nghiêm ngặt: khóa quyền tham gia;
8. Đơn vị ATMT/đơn vị liên quan tổ chức hướng dẫn, huấn luyện;
9. Kiểm tra ban đầu/hàng tuần/hàng tháng theo BM111-07.03;
10. Kiểm tra hàng ngày theo BM111-07.04;
11. Ghi nhận vi phạm, yêu cầu khắc phục hoặc đình chỉ;
12. Xác nhận khắc phục;
13. Kết thúc công việc và lưu hồ sơ.

B. Nhà thầu làm việc ngoài địa bàn Công ty:
1. Khai báo nhà thầu, hợp đồng, địa điểm;
2. Kiểm tra chứng nhận ISO 45001 còn hiệu lực;
3. Nếu không có hoặc không phù hợp, đánh giá hồ sơ theo BM111-07.02;
4. Tổ chức đánh giá định kỳ hàng năm tại chỗ hoặc online;
5. Lập điểm không phù hợp và kế hoạch khắc phục;
6. Xác nhận kết quả;
7. Lưu hồ sơ.

C. Nhà cung cấp và khách bên ngoài:
1. Bảo vệ/tiếp tân tiếp nhận;
2. Đơn vị liên quan xác nhận người tiếp nhận;
3. Hướng dẫn an toàn, môi trường;
4. Xác nhận hoàn thành hướng dẫn;
5. Giám sát hoạt động;
6. Kết thúc lượt vào và lưu hồ sơ.

D. Hợp đồng:
1. Đơn vị lập hợp đồng phải lấy ý kiến ĐV ATMT trước khi trình ký;
2. Ghi nhận các yêu cầu an toàn, biện pháp thi công, hồ sơ nhân lực và thiết bị trong hợp đồng;
3. Chỉ cho phép kích hoạt công việc khi yêu cầu an toàn đã được phê duyệt.

Hãy trả về:
- Danh sách actor;
- Use case;
- BPMN dạng Mermaid;
- State machine cho Contractor Project;
- State machine cho hồ sơ;
- State machine cho người lao động;
- State machine cho thiết bị;
- State machine cho phiếu kiểm tra;
- State machine cho vi phạm/khắc phục;
- Ma trận RACI;
- Danh sách business rules đánh số BR-001 trở đi;
- Acceptance criteria theo Given/When/Then.
```

---

# 3. PROMPT THIẾT KẾ MODULE

```text
Hãy thiết kế hệ thống thành các module sau:

1. Quản trị tổ chức
- Công ty;
- Chi nhánh;
- Đơn vị nghiệp vụ;
- Đơn vị ATMT;
- Người dùng;
- Vai trò và phạm vi dữ liệu.

2. Quản lý nhà thầu/nhà cung cấp
- Hồ sơ pháp nhân;
- Người đại diện;
- Đầu mối an toàn;
- Lịch sử đánh giá;
- Tình trạng được phép hoạt động;
- Danh sách hợp đồng/công việc.

3. Quản lý hợp đồng và công việc
- Số hợp đồng;
- Hạng mục;
- Vị trí;
- Thời gian;
- Đơn vị quản lý hợp đồng;
- Đơn vị liên quan;
- Chỉ huy/giám sát nhà thầu;
- Loại hình dịch vụ;
- Mức rủi ro;
- Công việc trong/ngoài địa bàn;
- Trạng thái phê duyệt.

4. Cam kết nhà thầu BM111-07.01
- Form điện tử;
- Ký xác nhận;
- Sinh PDF;
- Quản lý phiên bản;
- Cho phép tải phụ lục/hồ sơ chứng minh.

5. Đánh giá hồ sơ BM111-07.02
- Checklist 11 nhóm;
- Trạng thái Có/Không/Không áp dụng;
- Ghi chú;
- File bằng chứng;
- Trả bổ sung từng mục;
- Đánh giá lại;
- Kết luận tổng thể.

6. Quản lý người lao động nhà thầu
- Thông tin cá nhân;
- Chức danh;
- Công việc;
- Khám sức khỏe;
- Huấn luyện;
- Thẻ ATLĐ;
- Chứng chỉ nghề;
- Bằng lái;
- JSA/hướng dẫn công việc;
- Tình trạng đủ điều kiện.

7. Quản lý thiết bị
- Loại thiết bị;
- Số quản lý/serial/biển số;
- Thiết bị nghiêm ngặt;
- Chứng nhận kiểm định;
- Ngày hết hạn;
- Kiểm tra trước vận hành;
- Tình trạng được phép sử dụng.

8. Huấn luyện và hướng dẫn
- An toàn chung;
- 12 nguyên tắc vàng;
- 10 nguyên tắc phòng ngừa TNLĐ nặng/chết người;
- Hướng dẫn/JSA công việc cụ thể;
- Kiểm tra sức khỏe ngày đầu cho công việc nguy cơ cao;
- Ký xác nhận;
- QR xác minh.

9. Kiểm tra ATMT BM111-07.03
- Ban đầu/hàng tuần/hàng tháng;
- Nhân sự;
- Biển báo, rào chắn, vệ sinh, phân loại rác;
- Thiết bị;
- Ảnh bằng chứng;
- Chữ ký người kiểm tra;
- Kết luận.

10. Kiểm tra hàng ngày BM111-07.04
- Ma trận ngày 1–31;
- Checklist động;
- Check nhanh trên mobile;
- Cho phép chụp ảnh;
- Ghi nhận vị trí và thời gian;
- Tổng hợp theo tháng.

11. Vi phạm, sự cố, đình chỉ và khắc phục
- Loại vi phạm;
- Mức độ;
- Căn cứ;
- Ảnh/video;
- Yêu cầu khắc phục;
- Hạn hoàn thành;
- Đình chỉ toàn bộ/một phần/người/thiết bị;
- Xác nhận khắc phục;
- Cho phép hoạt động lại;
- Lịch sử.

12. Nhà cung cấp và khách bên ngoài
- Đăng ký trước;
- Check-in/check-out;
- Người liên hệ;
- Mục đích;
- Hướng dẫn an toàn;
- Xác nhận;
- Thẻ/QR ra vào.

13. Dashboard và báo cáo
- Hồ sơ đạt/chưa đạt;
- Hồ sơ sắp hết hạn/hết hạn;
- Người/thiết bị bị khóa;
- Số cuộc kiểm tra;
- Số vi phạm;
- Tỷ lệ khắc phục đúng hạn;
- Nhà thầu theo mức rủi ro;
- Thống kê theo chi nhánh, đơn vị, hợp đồng.

Hãy tạo:
- Sơ đồ module;
- Menu theo vai trò;
- Danh sách màn hình;
- Route frontend;
- API endpoint;
- Permission code;
- Acceptance criteria cho từng module.
```

---

# 4. PROMPT THIẾT KẾ CƠ SỞ DỮ LIỆU

```text
Hãy thiết kế PostgreSQL schema bằng Prisma cho hệ thống kiểm soát ATVSLĐ.

Tối thiểu phải có các entity:

Organization
Branch
Department
User
Role
Permission
UserRoleScope

Contractor
ContractorContact
Contract
WorkPackage
WorkLocation
ServiceCategory
RiskClassification

ContractorCommitment
CommitmentVersion
CommitmentAttachment
CommitmentSignature

DocumentType
ContractorDocument
DocumentVersion
DocumentReview
DocumentReviewItem

Worker
WorkerAssignment
WorkerRole
WorkerDocument
WorkerHealthCheck
WorkerTraining
WorkerInduction
WorkerEligibility

Equipment
EquipmentAssignment
EquipmentInspectionCertificate
EquipmentDailyCheck
EquipmentEligibility

SafetyRequirementMatrix
SafetyRequirementMatrixItem
RoleRequirementMapping

SafetyInspection
SafetyInspectionSection
SafetyInspectionItem
SafetyInspectionEvidence
DailyInspectionSheet
DailyInspectionEntry

Violation
SuspensionOrder
CorrectiveAction
CorrectiveActionEvidence
ReinstatementApproval

Visitor
VisitRegistration
SafetyBriefing
GateCheckin

Notification
AuditLog
FileObject
Comment
ApprovalRequest
ApprovalAction

Yêu cầu:
- Mỗi bảng có id UUID;
- Có createdAt, createdBy, updatedAt, updatedBy;
- Hỗ trợ soft delete;
- Có version để optimistic locking cho dữ liệu quan trọng;
- Có tenant/scope theo Công ty/chi nhánh;
- Không lưu trực tiếp file binary trong database;
- Trạng thái dùng enum rõ ràng;
- Có index cho các trường thường tìm kiếm;
- Có unique constraint hợp lý;
- Audit log lưu before/after JSON;
- Dữ liệu hồ sơ phải hỗ trợ ngày cấp, ngày hết hạn, cơ quan cấp, số hiệu, file đính kèm;
- WorkerEligibility và EquipmentEligibility phải có lý do đạt/không đạt và thời điểm tính toán;
- Thiết kế quy tắc tính đủ điều kiện dựa trên ma trận yêu cầu.

Hãy xuất:
1. ERD Mermaid;
2. Prisma schema hoàn chỉnh;
3. Seed data cho role, permission, loại hồ sơ, loại hình dịch vụ, checklist mẫu;
4. Migration plan;
5. Giải thích các quyết định thiết kế.
```

---

# 5. PROMPT PHÂN LOẠI LOẠI HÌNH DỊCH VỤ VÀ MỨC KIỂM SOÁT

```text
Hãy xây dựng rule engine phân loại loại hình dịch vụ nhà thầu.

Nhóm chính:
- Loại 1: công việc nguy cơ thấp, khu vực không có mối nguy/rủi ro cao; ví dụ vệ sinh văn phòng, bảo vệ, sửa chữa thiết bị văn phòng, cung cấp thực phẩm, chăm sóc cây xanh;
- Loại 2: công việc nguy cơ cao hoặc làm việc trong khu vực có mối nguy/rủi ro cao; ví dụ xây dựng, xây lắp, sửa chữa, bảo trì cơ điện, vận chuyển nội bộ, khai thác mỏ, vệ sinh công nghiệp;
- Loại 3: vận chuyển tại khu vực tách biệt hoặc ngoài ranh giới địa lý Công ty; ví dụ vận chuyển đường bộ/đường thủy, thu gom và vận chuyển chất thải.

Yêu cầu chức năng:
1. Cho người dùng chọn loại dịch vụ;
2. Hệ thống gợi ý loại hình và mức rủi ro;
3. Cho phép ĐV ATMT điều chỉnh nhưng phải ghi lý do;
4. Tự sinh bộ hồ sơ, huấn luyện, kiểm tra và tần suất kiểm soát tương ứng;
5. Công việc nguy cơ cao phải yêu cầu biện pháp thi công an toàn được phê duyệt;
6. Thiết bị nghiêm ngặt phải có kiểm định còn hiệu lực;
7. Thay đổi loại hình hoặc mức rủi ro phải chạy lại kiểm tra tính đủ điều kiện.

Hãy tạo:
- Data model;
- Rule table;
- Hàm TypeScript classifyServiceRisk();
- Hàm generateRequiredDocuments();
- Hàm generateInspectionSchedule();
- Unit tests;
- UI wizard phân loại.
```

---

# 6. PROMPT MA TRẬN ĐIỀU KIỆN NGƯỜI LAO ĐỘNG

```text
Hãy xây dựng module ma trận quản lý an toàn theo chức danh người lao động nhà thầu.

Các nhóm chức danh ban đầu:
1. Lao động phổ thông/thời vụ;
2. Công nhân bốc xếp/vệ sinh công nghiệp;
3. Công nhân lắp máy/công nhân xây dựng;
4. Công nhân kỹ thuật: điện, hàn điện, cắt gió đá;
5. Công nhân lắp đặt giàn giáo;
6. Giám sát kỹ thuật kiểm tra lắp đặt giàn giáo;
7. Chỉ huy công trường/giám sát công trường;
8. Tài xế ô tô/xe tải;
9. Tài xế cẩu, người ra tín hiệu cẩu, móc cẩu, vận hành thiết bị nâng, xe nâng, máy đào, xe xúc, xe ủi, xe san.

Các yêu cầu có thể áp dụng:
- Kiểm tra sức khỏe ngày đầu đối với công việc nguy cơ cao;
- Hướng dẫn an toàn chung;
- Hướng dẫn 12 nguyên tắc vàng;
- Hướng dẫn 10 nguyên tắc phòng ngừa TNLĐ nặng/chết người;
- Hướng dẫn an toàn/JSA theo công việc;
- Bằng lái;
- Giấy chứng nhận ATLĐ;
- Thẻ an toàn lao động;
- Chứng chỉ nghề/bằng nghề;
- Chứng nhận giám sát/lắp đặt giàn giáo hoặc quyết định giao nhiệm vụ.

Yêu cầu:
- Ma trận phải cấu hình được, không hard-code;
- Hỗ trợ hiệu lực theo thời gian;
- Có phiên bản;
- Khi chọn chức danh, hệ thống tự sinh checklist hồ sơ;
- Hệ thống tự động tính trạng thái:
  + ELIGIBLE;
  + MISSING_REQUIRED_DOCUMENT;
  + EXPIRED_DOCUMENT;
  + PENDING_REVIEW;
  + SUSPENDED;
- Người thiếu hồ sơ bắt buộc không được đưa vào danh sách làm việc;
- Hiển thị lý do cụ thể;
- Có API kiểm tra eligibility trước check-in.

Hãy viết:
1. Schema;
2. Seed data;
3. Service evaluateWorkerEligibility();
4. API;
5. UI ma trận;
6. UI hồ sơ người lao động;
7. Unit tests và integration tests.
```

---

# 7. PROMPT BM111-07.01 – BẢN CAM KẾT ĐIỆN TỬ

```text
Hãy xây dựng tính năng Bản cam kết ATVSLĐ-PCCN-BVMT của nhà thầu theo BM111-07.01.

Các trường:
- Tên nhà thầu;
- Người đại diện;
- Địa chỉ;
- Điện thoại;
- Fax;
- Hạng mục/công việc;
- Vị trí;
- Thời gian bắt đầu/kết thúc;
- Chỉ huy công trường/giám sát;
- Chức vụ.

Checklist hồ sơ cam kết:
1. Hợp đồng thực hiện công việc;
2. Biện pháp thi công an toàn đã duyệt;
3. Giấy chứng nhận huấn luyện ATLĐ của Chỉ huy/Giám sát;
4. Chứng nhận giám sát/lắp đặt giàn giáo nếu có;
5. Thẻ ATLĐ người lao động;
6. Chứng chỉ nghề/bằng nghề;
7. Giấy khám sức khỏe;
8. Giấy chứng nhận kiểm định thiết bị nghiêm ngặt.

Nội dung cam kết phải hiển thị đầy đủ theo các nhóm:
- ATVSLĐ và PCCN;
- Vệ sinh môi trường;
- An ninh trật tự;
- Giao thông;
- Trách nhiệm xử lý, báo cáo, khắc phục và bồi thường khi xảy ra sự cố.

Yêu cầu:
- Nhà thầu tạo bản nháp;
- Hệ thống kiểm tra thiếu dữ liệu;
- Đại diện nhà thầu ký xác nhận;
- Đơn vị liên quan tiếp nhận;
- ĐV ATMT xác nhận;
- Sinh PDF có mã QR kiểm chứng;
- Không cho sửa bản đã ký; sửa phải tạo phiên bản mới;
- Lưu hash file PDF;
- Audit log toàn bộ quá trình.

Hãy tạo frontend, backend, database, PDF template, API ký xác nhận và test.
```

---

# 8. PROMPT BM111-07.02 – ĐÁNH GIÁ HỒ SƠ NHÀ THẦU

```text
Hãy xây dựng tính năng đánh giá hồ sơ nhà thầu theo BM111-07.02.

11 nội dung kiểm tra:
1. Hợp đồng kinh tế và hợp đồng lao động;
2. Quản lý sức khỏe nghề nghiệp;
3. Kế hoạch huấn luyện an toàn lao động;
4. Giấy chứng nhận huấn luyện, thẻ ATLĐ, sổ theo dõi;
5. Máy móc, thiết bị thi công và kiểm định;
6. Thiết bị, dụng cụ và bộ phận bảo vệ;
7. Biện pháp phòng ngừa và PTBVCN;
8. Bằng nghề/chứng chỉ;
9. Cơ cấu tổ chức an toàn;
10. Ứng phó tình huống khẩn cấp;
11. Hệ thống báo cáo và thông tin ATVSLĐ.

Mỗi mục có:
- REQUIRED/OPTIONAL/NOT_APPLICABLE;
- C/K/N/A;
- Nhận xét;
- Danh sách hồ sơ liên kết;
- File bằng chứng;
- Người đánh giá;
- Thời gian;
- Yêu cầu bổ sung;
- Hạn bổ sung;
- Kết quả đánh giá lại.

Quy tắc:
- K = thiếu hoặc không đầy đủ;
- Hồ sơ thiếu phải tạo yêu cầu bổ sung;
- Nếu thiếu hồ sơ bắt buộc liên quan đến người hoặc thiết bị nghiêm ngặt, khóa người/thiết bị;
- Chỉ được APPROVED khi tất cả mục bắt buộc đạt;
- Có thể tạo nhiều vòng đánh giá;
- So sánh thay đổi giữa các vòng;
- Sinh PDF theo biểu mẫu;
- Gửi thông báo tự động.

Hãy tạo:
- Workflow;
- Database;
- API;
- UI checklist;
- Màn hình bổ sung hồ sơ cho nhà thầu;
- Màn hình phê duyệt;
- Hàm calculateAssessmentResult();
- Test cases.
```

---

# 9. PROMPT BM111-07.03 – KIỂM TRA BAN ĐẦU/TUẦN/THÁNG

```text
Hãy xây dựng phiếu kiểm tra ATMT nhà thầu BM111-07.03.

Thông tin chung:
- Loại kiểm tra: ban đầu/hàng tuần/hàng tháng;
- Nhà thầu;
- Số hợp đồng;
- Công việc;
- Vị trí;
- Đại diện/giám sát;
- Ngày kiểm tra;
- Người kiểm tra.

Nhóm A – Người lao động:
- Tổng số NLĐ;
- Huấn luyện ATMT;
- Chứng chỉ vận hành;
- PTBVCN;
- Cho phép thêm checklist tùy công việc.

Nhóm B – Yêu cầu ATMT:
- Biển báo an toàn;
- Rào chắn;
- Vệ sinh môi trường;
- Phân loại rác;
- Cho phép thêm checklist.

Nhóm C – Thiết bị:
- Tên thiết bị;
- Số lượng;
- Hiệu lực kiểm định;
- Tình trạng;
- Ghi chú;
- Bao gồm xe nâng, xe cẩu, máy và dụng cụ cầm tay.

Mỗi hạng mục có:
- Đạt;
- Không đạt;
- Không áp dụng;
- Ghi chú;
- Ảnh/video;
- Mức độ vi phạm;
- Hành động khắc phục;
- Hạn hoàn thành.

Yêu cầu:
- Mobile-first;
- Chụp ảnh trực tiếp;
- Ghi nhận timestamp;
- Có thể ghi nhận vị trí GPS nếu được cấp quyền;
- Tự tạo vi phạm từ mục không đạt;
- Có chữ ký người kiểm tra và đại diện nhà thầu;
- Sinh PDF;
- Không cho hoàn tất phiếu khi mục bắt buộc chưa đánh giá;
- Tự động lên lịch kỳ kiểm tra tiếp theo.

Hãy tạo toàn bộ module và test.
```

---

# 10. PROMPT BM111-07.04 – KIỂM TRA HÀNG NGÀY

```text
Hãy xây dựng Bảng kiểm tra ATMT nhà thầu hàng ngày BM111-07.04.

Giao diện cần hỗ trợ hai chế độ:
1. Chế độ mobile: kiểm tra theo ngày hiện tại;
2. Chế độ desktop: ma trận tháng, cột ngày 1–31.

Thông tin:
- Tháng/năm;
- Nhà thầu;
- Công việc;
- Vị trí;
- Ngày bắt đầu;
- Người theo dõi;
- Trưởng đơn vị.

Checklist mặc định:
- Huấn luyện ATMT;
- Chứng chỉ vận hành;
- PTBVCN;
- Biển báo an toàn;
- Rào chắn;
- Giữ gìn vệ sinh môi trường;
- Phân loại rác;
- Xe nâng;
- Xe cẩu;
- Máy và dụng cụ cầm tay.

Yêu cầu:
- Checklist cấu hình được;
- Mỗi ô ngày có trạng thái PASS/FAIL/NA/NOT_CHECKED;
- Cho phép ghi chú và ảnh cho từng ô;
- Người kiểm tra ký tên từng ngày;
- Cuối tháng trưởng đơn vị xác nhận;
- Tự động đánh dấu ngày chưa kiểm tra;
- Cảnh báo FAIL chưa khắc phục;
- Tạo violation/corrective action từ FAIL;
- Xuất Excel giống ma trận biểu mẫu;
- Xuất PDF theo tháng;
- Có chế độ offline và đồng bộ.

Hãy tạo database, API, UI, export, test và dữ liệu mẫu.
```

---

# 11. PROMPT VI PHẠM – ĐÌNH CHỈ – KHẮC PHỤC

```text
Hãy xây dựng workflow quản lý vi phạm ATVSLĐ-PCCN-BVMT.

Nguồn tạo vi phạm:
- BM111-07.03;
- BM111-07.04;
- Kiểm tra đột xuất;
- Báo cáo sự cố;
- Người dùng ghi nhận trực tiếp.

Thông tin vi phạm:
- Nhà thầu;
- Hợp đồng/công việc;
- Vị trí;
- Người/thiết bị liên quan;
- Nhóm vi phạm;
- Mức độ: LOW/MEDIUM/HIGH/CRITICAL;
- Mô tả;
- Căn cứ;
- Ảnh/video;
- Người phát hiện;
- Thời gian;
- Hành động tức thời.

Workflow:
DRAFT -> ISSUED -> ACKNOWLEDGED -> CORRECTIVE_ACTION_SUBMITTED
-> VERIFYING -> CLOSED

Nhánh đình chỉ:
ISSUED -> SUSPENDED -> CORRECTIVE_ACTION_SUBMITTED
-> VERIFYING -> REINSTATED -> CLOSED

Quy tắc:
- ĐV liên quan hoặc ĐV ATMT có quyền đình chỉ;
- Đình chỉ có thể áp dụng cho toàn bộ công việc, khu vực, người hoặc thiết bị;
- Người/thiết bị bị đình chỉ phải bị chặn check-in và phân công;
- Khắc phục phải có bằng chứng;
- Chỉ người có thẩm quyền mới được xác nhận hoạt động lại;
- Mọi trạng thái phải có audit log;
- Quá hạn phải cảnh báo;
- Dashboard hiển thị số vi phạm mở và thời gian xử lý trung bình.

Hãy tạo:
- State machine;
- Database;
- API;
- UI;
- Notification;
- Permission;
- Test.
```

---

# 12. PROMPT NHÀ THẦU NGOÀI ĐỊA BÀN

```text
Hãy xây dựng module kiểm soát nhà thầu làm việc ngoài địa bàn Công ty.

Yêu cầu:
- Khai báo hợp đồng, địa điểm, phạm vi công việc;
- Tải chứng nhận ISO 45001;
- Kiểm tra số chứng nhận, tổ chức cấp, ngày cấp, ngày hết hạn;
- Nếu chứng nhận hợp lệ: ghi nhận trạng thái EXEMPT_FROM_SITE_ASSESSMENT nhưng vẫn lưu hồ sơ;
- Nếu không có/hết hạn/không phù hợp: bắt buộc đánh giá hồ sơ theo BM111-07.02;
- Lập kế hoạch đánh giá định kỳ hàng năm;
- Hỗ trợ đánh giá tại địa bàn nhà thầu hoặc online;
- Checklist đánh giá;
- Điểm không phù hợp;
- Yêu cầu khắc phục;
- Bằng chứng;
- Kết luận;
- Lịch đánh giá lại;
- Báo cáo lịch sử nhiều năm.

Hãy tạo workflow, database, API, UI lịch đánh giá, biểu mẫu đánh giá online và test.
```

---

# 13. PROMPT NHÀ CUNG CẤP VÀ KHÁCH BÊN NGOÀI

```text
Hãy xây dựng module kiểm soát nhà cung cấp và khách bên ngoài.

Quy trình:
1. Đăng ký trước hoặc đăng ký tại cổng;
2. Bảo vệ/tiếp tân nhập thông tin;
3. Chọn đơn vị/người tiếp nhận;
4. Xác nhận mục đích và khu vực được phép;
5. Thực hiện hướng dẫn ATVSLĐ và BVMT;
6. Khách xác nhận đã hiểu;
7. Cấp QR/thẻ khách;
8. Check-in;
9. Đơn vị liên quan giám sát;
10. Check-out;
11. Lưu hồ sơ.

Thông tin:
- Họ tên;
- Đơn vị;
- CCCD/hộ chiếu, chỉ lưu khi được phép theo chính sách dữ liệu;
- Điện thoại;
- Biển số xe;
- Người liên hệ;
- Mục đích;
- Khu vực;
- Thời gian;
- Nội dung hướng dẫn;
- Xác nhận;
- Tình trạng vào/ra.

Quy tắc:
- Không check-in nếu chưa được người tiếp nhận xác nhận;
- Không check-in nếu chưa hoàn thành hướng dẫn bắt buộc;
- Chỉ được đi vào khu vực được cấp phép;
- Cảnh báo khách chưa check-out;
- Lưu hồ sơ hướng dẫn.

Hãy tạo kiosk UI, mobile UI, API, QR check-in, dashboard bảo vệ và test.
```

---

# 14. PROMPT DASHBOARD VÀ BÁO CÁO

```text
Hãy xây dựng dashboard quản lý ATVSLĐ nhà thầu.

Bộ lọc:
- Thời gian;
- Công ty/chi nhánh;
- Đơn vị;
- Nhà thầu;
- Hợp đồng;
- Loại dịch vụ;
- Mức rủi ro.

KPI:
- Tổng nhà thầu đang hoạt động;
- Nhà thầu đủ/chưa đủ điều kiện;
- Hồ sơ chờ duyệt;
- Hồ sơ sắp hết hạn 30/60/90 ngày;
- Người lao động đủ/chưa đủ điều kiện;
- Thiết bị đủ/chưa đủ điều kiện;
- Số phiếu kiểm tra;
- Tỷ lệ hoàn thành kiểm tra đúng lịch;
- Số vi phạm theo mức độ;
- Số đình chỉ;
- Tỷ lệ khắc phục đúng hạn;
- Thời gian khắc phục trung bình;
- Nhà thầu có nhiều vi phạm nhất;
- Xu hướng theo tháng.

Báo cáo:
- Danh sách hồ sơ nhà thầu;
- Danh sách NLĐ;
- Danh sách thiết bị;
- Hồ sơ hết hạn/sắp hết hạn;
- Kết quả BM111-07.02;
- Kết quả BM111-07.03;
- Bảng tháng BM111-07.04;
- Vi phạm và khắc phục;
- Nhà thầu ngoài địa bàn;
- Khách/NCC vào làm việc.

Yêu cầu:
- Drill-down;
- Export Excel/PDF;
- Phân quyền dữ liệu;
- Không lộ dữ liệu ngoài phạm vi;
- Tối ưu truy vấn;
- Có API aggregation và cache.

Hãy tạo UI dashboard, query, API, export và test.
```

---

# 15. PROMPT THÔNG BÁO VÀ CẢNH BÁO

```text
Hãy xây dựng notification engine.

Sự kiện:
- Hồ sơ sắp hết hạn 90/60/30/15/7/1 ngày;
- Hồ sơ đã hết hạn;
- Hồ sơ bị từ chối;
- Yêu cầu bổ sung;
- Phiếu kiểm tra đến hạn/quá hạn;
- Vi phạm mới;
- Khắc phục sắp đến hạn/quá hạn;
- Lệnh đình chỉ;
- Xác nhận cho phép hoạt động lại;
- Khách chưa check-out;
- Người/thiết bị bị khóa.

Kênh:
- In-app;
- Email;
- Có interface để mở rộng Zalo OA/SMS/Microsoft Teams.

Yêu cầu:
- Template tiếng Việt;
- Scheduler;
- Chống gửi trùng;
- Người dùng cấu hình mức nhận;
- Escalation theo cấp quản lý;
- Log gửi;
- Retry khi lỗi.

Hãy tạo schema, worker, queue, template, API, UI và test.
```

---

# 16. PROMPT PHÂN QUYỀN VÀ AUDIT

```text
Hãy triển khai RBAC kết hợp data scope.

Permission mẫu:
- contractor.view/create/update/approve;
- contract.view/create/update/activate;
- commitment.create/sign/review;
- document.upload/review/approve/reject;
- worker.manage/review/block;
- equipment.manage/review/block;
- training.manage/confirm;
- inspection.create/complete/approve;
- violation.create/issue/suspend/verify/reinstate;
- visitor.register/approve/checkin/checkout;
- report.view/export;
- admin.manage.

Data scope:
- ALL_COMPANY;
- BRANCH;
- DEPARTMENT;
- ASSIGNED_CONTRACTS;
- OWN_CONTRACTOR.

Yêu cầu:
- Kiểm tra quyền cả frontend và backend;
- Không chỉ ẩn nút;
- Audit log cho create/update/delete/approve/reject/sign/suspend/reinstate/export/login;
- Audit hiển thị before/after;
- Không cho sửa/xóa audit;
- Có màn hình tra cứu audit theo đối tượng.

Hãy viết middleware, policy engine, database, UI và test bảo mật.
```

---

# 17. PROMPT API VÀ QUY TẮC ELIGIBILITY

```text
Hãy xây dựng Eligibility Engine trung tâm.

Các hàm:
- evaluateContractorEligibility(contractorId, workPackageId);
- evaluateWorkerEligibility(workerId, workPackageId, date);
- evaluateEquipmentEligibility(equipmentId, workPackageId, date);
- evaluateWorkPackageActivation(workPackageId);
- evaluateGateAccess(subjectId, subjectType, dateTime).

Kết quả chuẩn:
{
  "eligible": true/false,
  "status": "...",
  "blockingReasons": [],
  "warnings": [],
  "evaluatedAt": "...",
  "ruleVersion": "..."
}

Blocking reasons:
- Hồ sơ bắt buộc chưa có;
- Hồ sơ hết hạn;
- Hồ sơ chờ duyệt;
- Chưa hoàn thành huấn luyện;
- Chưa ký cam kết;
- Biện pháp thi công chưa duyệt;
- Người/thiết bị đang bị đình chỉ;
- Công việc ngoài thời hạn hợp đồng;
- Không thuộc danh sách được phân công;
- Chưa hoàn thành kiểm tra sức khỏe bắt buộc.

Yêu cầu:
- Rule engine cấu hình được;
- Lưu snapshot kết quả;
- Recalculate khi hồ sơ thay đổi;
- Có batch job kiểm tra hàng đêm;
- Có API real-time cho cổng bảo vệ;
- Viết unit tests cho mọi trường hợp chặn.
```

---

# 18. PROMPT GIAO DIỆN UX/UI

```text
Hãy thiết kế giao diện chuyên nghiệp theo phong cách hệ thống nội bộ doanh nghiệp công nghiệp.

Yêu cầu:
- Tông màu phù hợp nhận diện VICEM Hà Tiên, nhưng phải đảm bảo tương phản;
- Không dùng chữ trắng trên nền sáng;
- Sidebar rõ ràng;
- Dashboard dễ đọc;
- Mobile-first cho kiểm tra hiện trường;
- Status badge:
  + Xanh: đạt/đang hiệu lực;
  + Vàng: sắp hết hạn/chờ xử lý;
  + Đỏ: không đạt/hết hạn/đình chỉ;
  + Xám: không áp dụng;
- Form nhiều bước;
- Autosave;
- Validation tiếng Việt;
- Empty state;
- Skeleton loading;
- Error boundary;
- Accessibility;
- Tìm kiếm nhanh;
- Bộ lọc lưu được;
- Bảng có sticky header và column visibility;
- Timeline lịch sử;
- Preview file;
- Chụp ảnh từ camera;
- Ký xác nhận trên màn hình.

Hãy tạo:
- Design tokens;
- Component inventory;
- Wireframe từng module;
- Source code layout;
- Trang dashboard;
- Trang hồ sơ nhà thầu;
- Trang kiểm tra mobile;
- Trang vi phạm;
- Trang phê duyệt.
```

---

# 19. PROMPT XUẤT BIỂU MẪU

```text
Hãy xây dựng dịch vụ xuất biểu mẫu.

Biểu mẫu:
- BM111-07.01 PDF;
- BM111-07.02 PDF;
- BM111-07.03 PDF;
- BM111-07.04 Excel và PDF;
- Danh sách người lao động;
- Danh sách thiết bị;
- Báo cáo vi phạm/khắc phục.

Yêu cầu:
- Tiếng Việt Unicode;
- Đúng bố cục văn bản hành chính;
- Có mã biểu mẫu, ban hành;
- Header đơn vị chủ quản/đơn vị trực thuộc;
- Số hồ sơ;
- Ngày lập;
- Chữ ký;
- QR xác thực;
- Page number;
- Watermark DRAFT nếu chưa phê duyệt;
- Hash tài liệu;
- Endpoint kiểm tra tính xác thực từ QR;
- Không lỗi font khi mở trên Windows;
- Excel có vùng in, lặp header, khổ giấy phù hợp.

Hãy tạo service, template, endpoint, sample output và test.
```

---

# 20. PROMPT TEST VÀ NGHIỆM THU

```text
Hãy lập kế hoạch kiểm thử và viết test cho toàn bộ hệ thống.

Bao gồm:
- Unit test;
- Integration test;
- API test;
- E2E bằng Playwright;
- Permission test;
- Security test;
- File upload test;
- Workflow test;
- Export test;
- Performance test;
- Offline sync test.

Các kịch bản bắt buộc:
1. Nhà thầu thiếu hồ sơ người lao động bắt buộc;
2. Thiết bị kiểm định hết hạn;
3. Hồ sơ bổ sung qua nhiều vòng;
4. Người lao động đổi chức danh;
5. Thiết bị bị đình chỉ;
6. Phiếu hàng ngày FAIL tạo vi phạm;
7. Khắc phục chưa đạt bị trả lại;
8. Hoạt động lại sau phê duyệt;
9. Nhà thầu ngoài địa bàn có ISO 45001 hợp lệ;
10. ISO 45001 hết hạn;
11. Khách chưa hướng dẫn an toàn không check-in;
12. User chi nhánh A không xem dữ liệu chi nhánh B;
13. Export biểu mẫu đúng dữ liệu;
14. Audit log không thể sửa;
15. Hai người cùng cập nhật gây conflict version.

Hãy tạo test matrix, test data, code test và checklist UAT.
```

---

# 21. PROMPT DOCKER VÀ TRIỂN KHAI NỘI BỘ

```text
Hãy đóng gói hệ thống để triển khai trong mạng nội bộ.

Thành phần:
- Web app;
- PostgreSQL;
- Redis;
- MinIO;
- Worker;
- Reverse proxy;
- Backup service.

Yêu cầu:
- Docker Compose;
- .env.example;
- Healthcheck;
- Migration tự động có kiểm soát;
- Backup database và file;
- Restore guide;
- TLS nội bộ;
- Log rotation;
- Không dùng credential mặc định;
- Upload size configurable;
- Antivirus hook cho file upload;
- CI/CD;
- Staging và production;
- Monitoring cơ bản;
- Hướng dẫn cài đặt trên Ubuntu Server/IIS reverse proxy nếu cần.

Hãy tạo toàn bộ file cấu hình, script và tài liệu triển khai.
```

---

# 22. PROMPT KIỂM TRA CODE CUỐI CÙNG

```text
Hãy audit toàn bộ source code của Web App kiểm soát ATVSLĐ.

Kiểm tra:
1. Có đủ module theo QT111-07 không;
2. Có đủ BM111-07.01 đến BM111-07.04 không;
3. Có ma trận chức danh và hồ sơ không;
4. Có chặn người/thiết bị không đủ điều kiện không;
5. Có workflow đình chỉ và hoạt động lại không;
6. Có audit log không;
7. Có phân quyền theo phạm vi dữ liệu không;
8. Có cảnh báo hết hạn không;
9. Có export đúng biểu mẫu không;
10. Có test các business rule trọng yếu không;
11. Có lỗi bảo mật OWASP phổ biến không;
12. Có lỗi N+1, truy vấn chậm hoặc thiếu index không;
13. Giao diện mobile có sử dụng được tại hiện trường không;
14. Có thể triển khai bằng Docker không.

Hãy:
- Liệt kê lỗi theo Critical/High/Medium/Low;
- Sửa trực tiếp các lỗi Critical và High;
- Viết test chống tái phát;
- Cập nhật CHANGELOG;
- Tạo báo cáo nghiệm thu kỹ thuật.
```

---

# 23. LỆNH GỢI Ý DÙNG TRONG CLAUDE CODE

```bash
# Khởi tạo
claude

# Dán Prompt 1 để phân tích tổng thể.
# Sau đó lần lượt dán Prompt 2, 3, 4.

# Sau khi kiến trúc được duyệt:
# Dán từng prompt module 5-18.

# Cuối cùng:
# Dán Prompt 19-22 để xuất biểu mẫu, test, triển khai và audit.
```

## Cách triển khai khuyến nghị

1. Sprint 1: tổ chức, người dùng, phân quyền, nhà thầu, hợp đồng.
2. Sprint 2: cam kết và đánh giá hồ sơ.
3. Sprint 3: người lao động, thiết bị, ma trận điều kiện.
4. Sprint 4: huấn luyện, kiểm tra BM111-07.03 và BM111-07.04.
5. Sprint 5: vi phạm, đình chỉ, khắc phục, hoạt động lại.
6. Sprint 6: khách/NCC, dashboard, báo cáo, cảnh báo.
7. Sprint 7: xuất biểu mẫu, offline/PWA, kiểm thử và triển khai.
