-- ============================================================
-- Migration 001: Cây thư mục cho Tài liệu hồ sơ
-- Additive only — KHÔNG đụng public.*, không xóa dữ liệu cũ.
-- ============================================================
SET search_path TO atld;

-- Thư mục hồ sơ (đệ quy qua parent_id). Xóa thư mục cha -> xóa cả con.
CREATE TABLE IF NOT EXISTS atld.doc_folders (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  parent_id  INTEGER REFERENCES atld.doc_folders(id) ON DELETE CASCADE,
  created_by VARCHAR(150),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Gắn tài liệu vào thư mục (NULL = nằm ở gốc). Xóa thư mục -> tài liệu về gốc.
ALTER TABLE atld.documents
  ADD COLUMN IF NOT EXISTS folder_id INTEGER REFERENCES atld.doc_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_folder ON atld.documents(folder_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent   ON atld.doc_folders(parent_id);
