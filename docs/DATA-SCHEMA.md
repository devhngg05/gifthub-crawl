# Thiết kế cơ sở dữ liệu (`DATA-SCHEMA.md`)

Cài đặt bằng Drizzle ORM (`drizzle-orm/pg-core`) tại `src/db/schema.ts` trên Neon PostgreSQL.

## 1. Bảng `tools`

| Cột | Kiểu PostgreSQL / Drizzle | Ràng buộc & Mặc định | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | `serial('id')` | PK | Khóa chính tự tăng |
| `githubId` | `bigint('github_id', { mode: 'number' })` | `NOT NULL`, `UNIQUE` | ID repo trên GitHub |
| `name` | `varchar('name', { length: 255 })` | `NOT NULL` | Tên repository |
| `fullName` | `varchar('full_name', { length: 255 })` | `NOT NULL` | Dạng `owner/repo` |
| `htmlUrl` | `text('html_url')` | `NOT NULL` | URL GitHub repository |
| `stars` | `integer('stars')` | `NOT NULL`, default `0` | Số sao GitHub |
| `language` | `varchar('language', { length: 100 })` | Nullable | Ngôn ngữ lập trình chính |
| `lastPushedAt` | `timestamp('last_pushed_at')` | `NOT NULL` | Thời điểm push gần nhất |
| `readmeSha` | `varchar('readme_sha', { length: 64 })` | Nullable | SHA tệp README khi phân loại |
| `summaryVi` | `text('summary_vi')` | `NOT NULL` | Tóm tắt tiếng Việt (10–500 ký tự) |
| `category` | `varchar('category', { length: 100 })` | `NOT NULL` | 1 trong 7 nhóm lớn (`'other'` nếu lệch) |
| `subCategory` | `varchar('sub_category', { length: 100 })` | `NOT NULL` | 1 trong 25 ngách (`'uncategorized'` nếu lệch) |
| `secondarySubCategories` | `text('secondary_sub_categories').array()` | `NOT NULL`, default `'{}'::text[]` | Tối đa 2 ngách phụ hợp lệ |
| `useCases` | `text('use_cases').array()` | `NOT NULL`, default `'{}'::text[]` | 1–4 cụm tiếng Việt ("động từ + đối tượng") |
| `replaces` | `text('replaces').array()` | `NOT NULL`, default `'{}'::text[]` | 0–3 phần mềm thương mại thay thế |
| `usability` | `varchar('usability', { length: 50 })` | `NOT NULL` | `'app-ready' \| 'cli-tool' \| 'dev-required'` |
| `isPinned` | `boolean('is_pinned')` | `NOT NULL`, default `false` | **Bảo toàn tuyệt đối khi UPSERT** |
| `userNotes` | `text('user_notes')` | Nullable | **Bảo toàn tuyệt đối khi UPSERT** |
| `createdAt` | `timestamp('created_at')` | `NOT NULL`, `defaultNow()` | Thời điểm tạo bản ghi |
| `updatedAt` | `timestamp('updated_at')` | `NOT NULL`, `defaultNow()` | Thời điểm cập nhật bản ghi |

## 2. Bảng `syncLogs` (tên bảng SQL `sync_logs`)

| Cột | Kiểu PostgreSQL / Drizzle | Ràng buộc & Mặc định | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | `serial('id')` | PK | Khóa chính |
| `ranAt` | `timestamp('ran_at')` | `NOT NULL`, `defaultNow()` | Thời điểm chạy worker |
| `fetchedCount` | `integer('fetched_count')` | `NOT NULL`, default `0` | Tổng repo qua Quality Gate |
| `aiProcessedCount` | `integer('ai_processed_count')` | `NOT NULL`, default `0` | Repo phân loại AI & upsert thành công |
| `updatedStarsOnly` | `integer('updated_stars_only')` | `NOT NULL`, default `0` | Repo bỏ qua AI do `readmeSha` không đổi |
| `failedCount` | `integer('failed_count')` | `NOT NULL`, default `0` | Repo lỗi (đã bỏ qua upsert) |
| `errorSummary` | `text('error_summary')` | Nullable | Tóm tắt lỗi trong lượt đồng bộ |

## 3. Chiến lược Index & Truy vấn
- **Unique B-Tree:** `githubId`.
- **B-Tree Indexes bắt buộc:** `category`, `subCategory`, `stars`.
- **GIN Indexes bắt buộc cho 3 cột mảng:**
  - `secondarySubCategories` (`using('gin', table.secondarySubCategories)`)
  - `useCases` (`using('gin', table.useCases)`)
  - `replaces` (`using('gin', table.replaces)`)
- **Truy vấn lọc sâu trên UI:**
  - Lọc `sub`: `subCategory = sub OR sub = ANY(secondarySubCategories)`, ưu tiên nhãn chính lên trên, sau đó `isPinned DESC, stars DESC`.
  - Tìm kiếm `q`: `ILIKE` trên `name`, `fullName`, `summaryVi`, `useCases` và `replaces`.

## 4. Kết nối Neon, Idempotency & UPSERT
- **Kết nối Neon (`src/db/index.ts`, `drizzle.config.ts`):** Helper `sanitizeDatabaseUrl()` xóa query param `channel_binding` (giữ `sslmode=require`); app/worker dùng HTTP driver `neon()` với `DATABASE_URL`; Drizzle migration ưu tiên `DATABASE_URL_UNPOOLED` (fallback `DATABASE_URL`).
- **Idempotency theo `readmeSha`:** Nếu `githubId` đã tồn tại với `readmeSha` không đổi → chỉ cập nhật `stars`, `lastPushedAt`, `updatedAt` và tăng `updatedStarsOnly` (không gọi AI).
- **Bảo toàn dữ liệu người dùng khi UPSERT:** `onConflictDoUpdate` theo `githubId` **TUYỆT ĐỐI KHÔNG** ghi đè `isPinned` và `userNotes`.
- **Fail-safe khi AI lỗi:** Nếu cả 4 AI provider thất bại cho 1 repo → **bỏ qua không upsert** vào `tools`, tăng `failedCount` và ghi nhận vào `sync_logs.errorSummary`.
