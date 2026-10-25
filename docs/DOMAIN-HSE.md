# Nghiệp vụ HSE: số hoá QT111-07

Module "An toàn" (`/cms/an-toan`) số hoá **QT111-07, Kiểm soát ATVSLĐ, PCCN và BVMT đối với nhà thầu / NLĐ bên ngoài** của VICEM Hà Tiên. Đặc tả gốc (bộ prompt thiết kế 23 phần) nằm ở `.claude/So_hoa_QT111-07_ATVSLD.md`. File này mô tả **những gì code đang làm**.

## 1. Biểu mẫu

| Mã | Nội dung | Nơi trong hệ thống |
|---|---|---|
| BM111-07.01 | Bản cam kết ATVSLĐ của nhà thầu | `hse_commitments`. PDF do `buildCommitmentPdf` tạo, ký số SmartCA |
| BM111-07.02 | Đánh giá hồ sơ nhà thầu | `hse_dossiers`, `hse_contractor_docs`, `hse_evaluations` |
| BM111-07.03 | Kiểm tra ban đầu / tuần / tháng | `hse_inspections` (theo `form_type`), `hse_inspection_items` |
| BM111-07.04 | Kiểm tra hằng ngày | `hse_inspections` |
| BM111-07.05/.06 | Vi phạm, đình chỉ, khắc phục | `hse_findings` (CAPA), `hse_suspensions` |

## 2. Luồng tổng thể

```
Nhà thầu (hse_contractors)
  └─ Hợp đồng (hse_contracts: site_id, risk_level)   ← mỏ neo site scoping
       ├─ Hồ sơ nhà thầu / đánh giá (dossiers, evaluations)
       ├─ Cam kết BM.01 → PDF → ký SmartCA
       ├─ NLĐ (hse_workers ⟷ hse_contract_workers) + giấy tờ (hse_worker_docs)
       ├─ Thiết bị (hse_equipments ⟷ hse_contract_equipments) + giấy tờ
       ├─ JSA / e-Permit (jsa_permits) theo loại công việc (jsa_work_types)
       ├─ Cổng (hse_access_logs, quét QR / khuôn mặt)
       ├─ Kiểm tra (hse_inspections) → Phát hiện (hse_findings) → CAPA
       ├─ Đình chỉ (hse_suspensions: cả hợp đồng hoặc cá nhân)
       └─ Đánh giá sau hợp đồng (hse_evaluations)
Khách / nhà cung cấp: hse_visitors (site_id riêng) + hse_visitor_logs
```

## 3. Quyền vào nhà máy của NLĐ: một chỗ quyết định duy nhất

`evalWorkerAccess(workerId)` trong `server/src/lib/hse-core.ts` là **nơi duy nhất** quyết định một NLĐ có qua cổng được hay không. `syncWorkerAccess` chỉ ghi kết quả vào `hse_workers.access_status`/`access_block_reason`.

Thứ tự ưu tiên có ý nghĩa nghiệp vụ, vì quyết định của con người luôn thắng kết quả tính tự động:

1. **Thu hồi** (`revoked`): không tự khôi phục kể cả khi hồ sơ đủ lại. Chỉ `PATCH /workers/:id/restore-access` mới gỡ được.
2. **Đình chỉ** (`suspended`): có lệnh `hse_suspensions.status='issued'` áp lên chính NLĐ đó, hoặc lên hợp đồng mà NLĐ thuộc về.
3. Các lý do sau được **cộng dồn**, để cán bộ thấy hết việc cần làm trong một lần (`blocked`):
   - `entry_approval_status` khác `approved`. Đây là bước phê duyệt cấp quyền và có thể ký SmartCA.
   - Ngoài khoảng `access_valid_from`..`access_valid_to`.
   - Thiếu giấy tờ bắt buộc theo chức danh và `risk_level` của hợp đồng (`evalWorkerEligibility`).

Tập giá trị `access_status` ∈ `allowed | blocked | suspended | revoked` bị khoá bằng CHECK. Lý do: một giá trị lạ sẽ âm thầm thành "được vào". **Khi thêm điều kiện mới, phải thêm vào `evalWorkerAccess`**, không rải ra từng endpoint (`/gate/log`, `/gate/lookup`...).

Thiết bị có logic tương tự nhưng đơn giản hơn: `evalEquipmentEligibility` / `syncEquipmentAccess` chỉ cho ra `allowed | blocked`.

Sau mọi thay đổi ảnh hưởng tới điều kiện vào (giấy tờ, đình chỉ, phê duyệt, gán hợp đồng), phải gọi lại `syncWorkerAccess` / `syncEquipmentAccess`.

## 4. Đào tạo và chứng chỉ

- `jsa_work_type_courses` khai báo loại công việc cần những khoá học nào.
- `lib/hse-training.ts` (`checkWorkerTraining`, `checkContractTraining`) đối chiếu NLĐ với `quiz_certificates` **theo CCCD/hộ chiếu, không theo họ tên**. Số CCCD chỉ được bỏ dấu phân cách; phải giữ số 0 ở đầu và chữ cái của hộ chiếu.
- `resolveWorkerIdentity(idNumber)` nối `atld.users` với `hse_workers` qua `id_number`.
- Bài thi qua link (portal token `purpose='quiz'`) ghi chứng chỉ có `source` tương ứng. Ảnh học viên chụp khi thi nằm ở `uploads/trainee/`.

## 5. Phát hiện và CAPA: máy trạng thái 8 bước

Endpoint nằm trong `server/src/routes/findings.ts`. Bảng do hse.ts tạo, nên router này phải mount sau `/api/hse`. Nhảy bước trạng thái sẽ trả **400**.

```
new → assessed → (suspended) → capa_assigned → capa_done → verifying → verified → (resume_approved) → closed
                └→ closed  (kết luận không vi phạm)
verifying → capa_assigned  (xác minh chưa đạt, return_count++)
mọi trạng thái chưa kết thúc → cancelled
```

- Ghi nhận, đánh giá, giao và xác minh do cán bộ kiểm tra làm (`canInspect`). Đình chỉ và duyệt làm tiếp do cấp phê duyệt làm (`canApprove`).
- Người xác minh phải khác người chịu trách nhiệm khắc phục (CHECK `verified_by <> responsible_person`).
- `risk_level` ∈ `high | low`.

## 6. JSA / e-Permit

- `jsa_permits.status`: `draft → submitted → approved → active → closed`, hoặc `cancelled`. Kích hoạt (`active`) cần quyền approve.
- Giấy phép gắn với `site_id`, `work_type_id`, danh sách NLĐ (`jsa_permit_workers`), mối nguy và biện pháp (`jsa_permit_hazards`/`controls`), cùng PPE.
- Danh mục: `jsa_work_types` → giấy tờ (`jsa_work_type_docs`), PPE (`jsa_work_type_ppe`) và khoá học (`jsa_work_type_courses`).

## 7. Portal không cần đăng nhập (`/api/portal`, `portalApi`)

Truy cập qua `hse_portal_tokens`. Mỗi token có `purpose`:

| purpose | Ai dùng | Làm gì |
|---|---|---|
| `worker_declare` | Nhà thầu | Khai báo NLĐ và giấy tờ → `hse_worker_submissions` (`pending/approved/rejected`), cán bộ duyệt |
| `field_report` | Bất kỳ ai tại hiện trường | Báo phát hiện, kèm ảnh |
| `capa_response` | Bên chịu trách nhiệm | Nộp bằng chứng khắc phục cho một `finding_id` |
| `quiz` | Học viên ngoài | Làm bài thi một khoá học (`course_id` bắt buộc) |

Token có hạn dùng, được rate-limit, và **không bao giờ gửi JWT** lên portal. Khi thêm purpose mới, phải nới CHECK theo mẫu DROP + ADD (xem skill `atld-db-migration`).

## 8. Ký số SmartCA (VNPT)

- `lib/smartca.ts`: `initiateSign`, `getSignStatus`, `verifyWebhookSignature`, `isSmartCaConfigured`.
- Dùng cho cam kết BM.01 (`hse_commitments.smartca_*`) và phê duyệt cấp quyền NLĐ (`hse_workers.entry_smartca_tx_id`).
- Dữ liệu ký là hash SHA-256 của bytes PDF, nên **`buildCommitmentPdf` phải giữ nguyên Helvetica và bố cục**.
- Cấu hình SmartCA được nhập tại `/cms/smartca`.

## 9. Audit

Mọi thao tác ghi đều gọi `audit()`, ghi vào `hse_audit_logs`, và được hiển thị ở `/cms/an-toan/nhat-ky`.
