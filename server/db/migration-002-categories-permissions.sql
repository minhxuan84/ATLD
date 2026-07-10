-- Migration 002: Dynamic categories + folder permissions + sort order
-- ADDITIVE ONLY — không đụng bảng/cột cũ, chỉ thêm mới

-- ════════════ DANH MỤC TÀI LIỆU ════════════
CREATE TABLE IF NOT EXISTS atld.doc_categories (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed categories từ frontend hiện tại (chỉ khi bảng rỗng)
INSERT INTO atld.doc_categories (name, sort_order)
SELECT * FROM (VALUES
  ('Nội quy',               10),
  ('Quy trình',             20),
  ('Biên bản',              30),
  ('Quan trắc môi trường',  40),
  ('Hồ sơ pháp lý',        50)
) AS v(name, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM atld.doc_categories LIMIT 1);

-- ════════════ PHÂN QUYỀN & THỨ TỰ THƯ MỤC ════════════
-- view_role  : 'trainee' = tất cả | 'officer' = cán bộ+admin | 'admin' = chỉ admin
-- manage_role: 'officer' = cán bộ+admin (mặc định) | 'admin' = chỉ admin

ALTER TABLE atld.doc_folders
  ADD COLUMN IF NOT EXISTS sort_order  INTEGER     NOT NULL DEFAULT 0;

ALTER TABLE atld.doc_folders
  ADD COLUMN IF NOT EXISTS view_role   VARCHAR(20) NOT NULL DEFAULT 'trainee';

ALTER TABLE atld.doc_folders
  ADD COLUMN IF NOT EXISTS manage_role VARCHAR(20) NOT NULL DEFAULT 'officer';

CREATE INDEX IF NOT EXISTS idx_folders_sort ON atld.doc_folders(parent_id, sort_order);
