---
name: atld-pdf
description: Use when creating or modifying server-side PDFs in ATLĐ (commitment BM111-07.01, e-Permit, quiz attempt, certificate) via PDFKit in server/src/lib/pdf.ts — covers Vietnamese fonts, date format and the SmartCA hash constraint.
---

# PDF phía server (`server/src/lib/pdf.ts`)

## Các hàm có sẵn

| Hàm | Dùng cho | Font |
|---|---|---|
| `buildCommitmentPdf` | Cam kết BM111-07.01, được **ký số SmartCA** | **Helvetica, không được đổi** |
| `buildPermitPdf` | e-Permit / JSA | Font tiếng Việt (OpenSans) |
| `buildAttemptPdf` | Bài thi của học viên | Font tiếng Việt |
| `buildCertificatePdf` | Chứng chỉ | Font tiếng Việt |
| `hashPdf`, `bufferToStream` | SHA-256 dùng để ký; stream trả cho response | |

## Font tiếng Việt

- Font có sẵn của PDFKit không có dấu tiếng Việt. Dùng `resolveVnFont()`, hàm này duyệt `VN_FONT_CANDIDATES` theo thứ tự: OpenSans (`/usr/share/fonts/opensans`, do `font-opensans` trong Dockerfile cung cấp), DejaVu, rồi Arial Windows.
- Không tìm thấy font nào thì dùng Helvetica và `stripTones()`. Kết quả mất dấu nhưng không ra ký tự rác.
- Sửa Dockerfile thì phải xác minh trong container:
  ```bash
  docker exec atld-app ls /usr/share/fonts/opensans
  ```

## Tuyệt đối không

- **Không đổi font, bố cục hay nội dung tĩnh của `buildCommitmentPdf`.** Hash SHA-256 của bytes PDF là dữ liệu được ký SmartCA; chỉ cần thay đổi một byte là hỏng xác minh các cam kết đã ký.
- Không dùng `toLocaleDateString`. Dùng helper cục bộ `d()` (dd/mm/yyyy) và `dt()` (dd/mm/yyyy HH:mm) trong `pdf.ts`, vì server không import được `src/lib/date.ts`.

## PDF mới

1. Định nghĩa `interface XxxPdfData` và hàm `buildXxxPdf(data): Promise<Buffer>` cạnh các hàm sẵn có. Đăng ký font qua `resolveVnFont()`.
2. Endpoint trả PDF phải có auth và `siteScope`, đặt `Content-Type: application/pdf`.
3. Frontend mở PDF bằng `openFileInNewTab` / `downloadFile`, không dùng link trực tiếp.
4. Kiểm tra bằng cách sinh thử một file chứa chuỗi có dấu như "Đảm bảo an toàn – Hà Tiên". File thử đặt tên `_*.pdf` và không commit.
