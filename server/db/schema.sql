-- ============================================================
-- VICEM Hà Tiên - Hệ thống Huấn luyện ATLĐ & Môi trường
-- Migration: tạo schema riêng "atld" trong database vicem_cms
-- KHÔNG ĐỤNG tới schema public (23 bảng CMS sẵn có)
-- ============================================================

CREATE SCHEMA IF NOT EXISTS atld;
SET search_path TO atld;

-- Bảng người dùng + phân quyền (RBAC server-side)
CREATE TABLE IF NOT EXISTS atld.users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(60)  UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(150) NOT NULL,
  role          VARCHAR(20)  NOT NULL CHECK (role IN ('trainee','officer','admin')),
  -- Quyền truy cập từng mục CMS (mảng khóa mục). Admin bỏ qua kiểm tra này (toàn quyền).
  permissions   JSONB        NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Chi nhánh / đơn vị (nhóm khóa học theo nhà máy, trạm nghiền...)
CREATE TABLE IF NOT EXISTS atld.branches (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(150) NOT NULL,
  location   VARCHAR(200) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0
);

-- Khóa huấn luyện
CREATE TABLE IF NOT EXISTS atld.courses (
  id          VARCHAR(60) PRIMARY KEY,
  title       VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  grp         VARCHAR(60)  NOT NULL DEFAULT '',
  branch_id   INT REFERENCES atld.branches(id) ON DELETE SET NULL,
  video_url   TEXT NOT NULL DEFAULT '',
  duration    VARCHAR(40)  NOT NULL DEFAULT '',
  summary     JSONB NOT NULL DEFAULT '[]',
  pass_score  INT   NOT NULL DEFAULT 80,
  sort_order  INT   NOT NULL DEFAULT 0
);

-- Câu hỏi trắc nghiệm (correct_index KHÔNG trả về client khi làm bài)
CREATE TABLE IF NOT EXISTS atld.questions (
  id            SERIAL PRIMARY KEY,
  course_id     VARCHAR(60) NOT NULL REFERENCES atld.courses(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  options       JSONB NOT NULL,
  correct_index INT  NOT NULL,
  sort_order    INT  NOT NULL DEFAULT 0
);

-- Tiến độ học + chứng chỉ (chấm điểm & cấp chứng chỉ phía server)
CREATE TABLE IF NOT EXISTS atld.progress (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES atld.users(id) ON DELETE CASCADE,
  course_id    VARCHAR(60) NOT NULL REFERENCES atld.courses(id) ON DELETE CASCADE,
  step         INT NOT NULL DEFAULT 1,
  quiz_score   INT,
  passed       BOOLEAN NOT NULL DEFAULT false,
  cert_id      VARCHAR(60),
  trainee_info JSONB NOT NULL DEFAULT '{}',
  completed_at TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id)
);

-- Trường thông tin học viên khai báo trước khi làm trắc nghiệm (admin tự định nghĩa)
CREATE TABLE IF NOT EXISTS atld.quiz_fields (
  id         SERIAL PRIMARY KEY,
  field_key  VARCHAR(40) UNIQUE NOT NULL,
  label      VARCHAR(120) NOT NULL,
  type       VARCHAR(20) NOT NULL DEFAULT 'text' CHECK (type IN ('text','select')),
  options    JSONB NOT NULL DEFAULT '[]',
  required   BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0
);

-- Tài liệu hồ sơ (upload thật, lưu file trên đĩa)
CREATE TABLE IF NOT EXISTS atld.documents (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(200) NOT NULL,
  category      VARCHAR(60)  NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  size_kb       INT NOT NULL DEFAULT 0,
  stored_name   VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(120) NOT NULL DEFAULT '',
  uploaded_by   VARCHAR(150) NOT NULL,
  uploaded_by_id INT REFERENCES atld.users(id) ON DELETE SET NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tin tức
CREATE TABLE IF NOT EXISTS atld.news (
  id         SERIAL PRIMARY KEY,
  title      VARCHAR(200) NOT NULL,
  category   VARCHAR(60)  NOT NULL,
  excerpt    TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL DEFAULT '',
  author     VARCHAR(150) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trang chủ: timeline thành tích
CREATE TABLE IF NOT EXISTS atld.milestones (
  id         SERIAL PRIMARY KEY,
  year_label VARCHAR(20) NOT NULL,
  title      VARCHAR(200) NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0
);

-- Trang chủ: kế hoạch mục tiêu năm/tháng
CREATE TABLE IF NOT EXISTS atld.goals (
  id         SERIAL PRIMARY KEY,
  scope      VARCHAR(10) NOT NULL CHECK (scope IN ('year','month')),
  title      VARCHAR(200) NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  progress   INT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  sort_order INT NOT NULL DEFAULT 0
);

-- Cấu hình trang tĩnh: header/footer/logo/banner (key-value, quản trị qua CMS)
CREATE TABLE IF NOT EXISTS atld.site_config (
  key        VARCHAR(60) PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Menu điều hướng trang chủ (quản trị qua CMS)
CREATE TABLE IF NOT EXISTS atld.menu_items (
  id         SERIAL PRIMARY KEY,
  label      VARCHAR(80) NOT NULL,
  href       VARCHAR(200) NOT NULL,
  visible    BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_questions_course ON atld.questions(course_id);
CREATE INDEX IF NOT EXISTS idx_courses_branch   ON atld.courses(branch_id);
CREATE INDEX IF NOT EXISTS idx_progress_user    ON atld.progress(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_cat    ON atld.documents(category);
CREATE INDEX IF NOT EXISTS idx_news_created     ON atld.news(created_at DESC);
