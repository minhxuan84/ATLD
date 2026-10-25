---
name: atld-db-migration
description: Use when adding or changing database tables, columns, indexes, CHECK/UNIQUE constraints or seed/reference data in the ATLĐ project (schema `atld` in DB `vicem_cms`), or when running SQL against DEV/PROD via psql.
---

# Migration DB cho ATLĐ

## Luật cứng

1. **Chỉ schema `atld`.** Mọi tên bảng đều viết đầy đủ là `atld.<table>`. Không bao giờ CREATE/ALTER/DROP trong `public`: schema đó chứa CMS khác đang chạy thật.
2. **Chỉ thêm (additive) và idempotent.** Không DROP/RENAME bảng hay cột trên DB thật. Câu lệnh phải chạy lại nhiều lần mà không lỗi.
3. **Không chạy `npm run seed`** trên DB có dữ liệu, vì nó TRUNCATE.
4. Tiếng Việt qua psql: ghi ra file `.sql` UTF-8 rồi chạy `psql -f`. Không dùng `psql -c` trong Git Bash.

## Đặt migration ở đâu

| Trường hợp | Nơi đặt |
|---|---|
| Tính năng mới, bảng mới tách biệt | Router riêng, theo mẫu `NEWS_MIGRATIONS` trong `server/src/routes/news.ts`: mảng câu lệnh, mỗi câu try/catch riêng, log `[xxx migration]` |
| Thêm cột hoặc bảng vào cụm HSE/JSA/quiz | IIFE đầu `server/src/routes/hse.ts`. **Cả khối dùng chung một try/catch**, nên một câu lỗi sẽ bỏ qua mọi câu sau nó. Đặt câu mới ở **cuối khối** và tự kiểm bằng DB thật trước khi commit |
| Router phụ thuộc bảng do hse.ts tạo | Mount **sau** `app.use('/api/hse', ...)` trong `server/src/index.ts` (như `findings`, `portal`) |

## Mẫu câu lệnh

```sql
CREATE TABLE IF NOT EXISTS atld.foo (
  id SERIAL PRIMARY KEY,
  site_id INTEGER REFERENCES atld.branches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE atld.foo ADD COLUMN IF NOT EXISTS note TEXT;
CREATE INDEX IF NOT EXISTS idx_foo_site ON atld.foo(site_id);

-- Thêm constraint
DO $$ BEGIN
  ALTER TABLE atld.foo ADD CONSTRAINT foo_status_chk CHECK (status IN ('a','b'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed tham chiếu
INSERT INTO atld.hse_doc_types (code, name, ...) VALUES (...) ON CONFLICT (code) DO NOTHING;
```

### Nới rộng một CHECK đã có (thêm giá trị enum)

Nếu chỉ ADD lại, câu lệnh sẽ dính `duplicate_object`, bị nuốt lỗi, và **CHECK cũ vẫn giữ nguyên**. Phải DROP rồi ADD:

```sql
ALTER TABLE atld.hse_portal_tokens DROP CONSTRAINT IF EXISTS hse_portal_tokens_purpose_chk;
ALTER TABLE atld.hse_portal_tokens ADD CONSTRAINT hse_portal_tokens_purpose_chk
  CHECK (purpose IN ('worker_declare','field_report','capa_response','quiz','<mới>'));
```

### Khoá tập giá trị trên cột đã có dữ liệu

Trước tiên chuẩn hoá các giá trị lạ về giá trị an toàn nhất, rồi mới ADD CHECK. Ví dụ `access_status` được chuẩn hoá về `'blocked'`, không về `'allowed'`.

## Sau khi thêm cột

- Cập nhật SELECT/RETURNING của API và kiểu dữ liệu ở `src/` (đã từng có lỗi trang trắng do lệch field).
- Cột `DATE` trả về dạng chuỗi `yyyy-mm-dd` (type parser 1082 trong `db.ts`).
- Kiểm chứng: khởi động server, đảm bảo log không có dòng `[hse migration]` hay `[xxx migration]` báo lỗi, rồi `\d atld.foo` trong psql.

## Sửa dữ liệu thật

Chỉ dùng `UPDATE ... WHERE <điều kiện hẹp>` hoặc `INSERT ... WHERE NOT EXISTS`, chạy trong transaction:

```sql
BEGIN;
UPDATE ...;
SELECT ...;   -- kiểm tra kết quả
COMMIT;       -- hoặc ROLLBACK
```

Trên DEV/PROD phải backup trước (xem skill `atld-deploy-dev`).
