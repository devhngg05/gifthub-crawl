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
| `lastPushedAt` | `timestamp('last_pushed_at', { withTimezone: true })` | `NOT NULL` | Thời điểm push gần nhất (UTC `timestamptz`) |
| `readmeSha` | `varchar('readme_sha', { length: 64 })` | Nullable | SHA tệp README khi phân loại |
| `summaryVi` | `text('summary_vi')` | `NOT NULL` | Tóm tắt tiếng Việt (10–500 ký tự) |
| `category` | `varchar('category', { length: 100 })` | `NOT NULL` | 1 trong 10 nhóm lớn (`'other'` nếu lệch) |
| `subCategory` | `varchar('sub_category', { length: 100 })` | `NOT NULL` | 1 trong 43 ngách (`'uncategorized'` nếu lệch) |
| `secondarySubCategories` | `text('secondary_sub_categories').array()` | `NOT NULL`, default `'{}'::text[]` | Tối đa 2 ngách phụ hợp lệ |
| `useCases` | `text('use_cases').array()` | `NOT NULL`, default `'{}'::text[]` | 1–4 cụm tiếng Việt ("động từ + đối tượng") |
| `replaces` | `text('replaces').array()` | `NOT NULL`, default `'{}'::text[]` | 0–3 phần mềm thương mại thay thế |
| `usability` | `varchar('usability', { length: 50 })` | `NOT NULL` | `'app-ready' \| 'cli-tool' \| 'dev-required'` |
| `isPinned` | `boolean('is_pinned')` | `NOT NULL`, default `false` | **Bảo toàn tuyệt đối khi UPSERT** |
| `userNotes` | `text('user_notes')` | Nullable | **Bảo toàn tuyệt đối khi UPSERT** |
| `searchText` | `text('search_text')` | `NOT NULL`, default `''` | Văn bản chuẩn hóa (không dấu, chữ thường, từ khóa tích cực) phục vụ tìm kiếm `pg_trgm` |
| `createdAt` | `timestamp('created_at', { withTimezone: true })` | `NOT NULL`, `defaultNow()` | Thời điểm tạo bản ghi (UTC `timestamptz`) |
| `updatedAt` | `timestamp('updated_at', { withTimezone: true })` | `NOT NULL`, `defaultNow()`, `.$onUpdate(() => new Date())` | Thời điểm cập nhật bản ghi (UTC `timestamptz`) |

## 2. Bảng `syncLogs` (tên bảng SQL `sync_logs`)

| Cột | Kiểu PostgreSQL / Drizzle | Ràng buộc & Mặc định | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | `serial('id')` | PK | Khóa chính |
| `ranAt` | `timestamp('ran_at', { withTimezone: true })` | `NOT NULL`, `defaultNow()` | Thời điểm chạy worker (UTC `timestamptz`) |
| `fetchedCount` | `integer('fetched_count')` | `NOT NULL`, default `0` | Tổng repo qua Quality Gate |
| `aiProcessedCount` | `integer('ai_processed_count')` | `NOT NULL`, default `0` | Repo phân loại AI & upsert thành công |
| `updatedStarsOnly` | `integer('updated_stars_only')` | `NOT NULL`, default `0` | Repo bỏ qua AI do `readmeSha` không đổi |
| `failedCount` | `integer('failed_count')` | `NOT NULL`, default `0` | Repo lỗi (đã bỏ qua upsert) |
| `errorSummary` | `text('error_summary')` | Nullable | Tóm tắt lỗi trong lượt đồng bộ |

## 3. Chiến lược Index & Truy vấn
- **Unique B-Tree trên `tools`:** `githubId`.
- **B-Tree Indexes đơn cột trên `tools`:** `tools_category_idx` (`category`), `tools_sub_category_idx` (`sub_category`), `tools_stars_idx` (`stars`), `tools_created_at_idx` (`created_at DESC NULLS LAST` — phục vụ tab `fresh` và đếm `newLast7Days` trên `/newsfeed`).
- **Composite B-Tree Indexes phục vụ `ORDER BY` và lọc trên `tools`:**
  - `tools_pinned_stars_pushed_idx` (`is_pinned DESC NULLS LAST, stars DESC NULLS LAST, last_pushed_at DESC NULLS LAST, id DESC NULLS LAST`) — khớp mệnh đề `ORDER BY` mặc định (`sort = "stars"`) ở `tools-page-query.ts` / `tool-query.ts`, đồng thời hỗ trợ lọc `is_pinned = true` qua cột dẫn đầu `is_pinned`.
  - `tools_last_pushed_at_idx` (`last_pushed_at DESC NULLS LAST, stars DESC NULLS LAST, id DESC NULLS LAST`) — khớp `sort = "recent"` ở `tool-query.ts` và lọc cửa sổ thời gian trên `/newsfeed`.
- **GIN Indexes cho 3 cột mảng trên `tools`:**
  - `tools_secondary_sub_categories_gin_idx` (`using('gin', table.secondarySubCategories)`)
  - `tools_use_cases_gin_idx` (`using('gin', table.useCases)`)
  - `tools_replaces_gin_idx` (`using('gin', table.replaces)`)
- **GIN Trigram Index cho tìm kiếm trên `tools`:** `CREATE EXTENSION IF NOT EXISTS "pg_trgm";` + `tools_search_text_trgm_idx` (`USING gin (search_text gin_trgm_ops)`). Index này vừa nằm trong migration Drizzle khởi tạo vừa có thể khởi tạo/tính lại bằng `scripts/backfill-search-text.ts`.
- **B-Tree Index trên `sync_logs`:** `sync_logs_ran_at_idx` (`ran_at DESC NULLS LAST`) — phục vụ `ORDER BY ran_at DESC LIMIT 30` trong `logs-query.ts` và `LIMIT 1` trong `tools-page-query.ts`.
- **Truy vấn lọc sâu & Tìm kiếm ngữ nghĩa 2 tầng trên UI (`src/lib/search-engine.ts`, `src/lib/tool-query.ts`):**
  - Lọc `sub`: lọc theo nhãn chính `tools.subCategory` để khớp 1–1 với badge Sidebar (và dùng `arrayOverlaps` với `secondarySubCategories` khi khớp ngữ nghĩa theo từ khóa tìm kiếm).
  - Tìm kiếm `q`: Phân tích từ điển đồng nghĩa Việt–Anh (~52 nhóm khái niệm), khớp ranh giới nguyên từ cho từ ngắn `<= 3` ký tự (`(' ' || search_text || ' ') LIKE '% <term> %'`), chấm điểm độ phù hợp (`buildSearchRelevanceScore`), và fallback Tầng 2 (`word_similarity >= 0.35`) khi Tầng 1 trả về 0 kết quả.

## 4. Kết nối Neon, Idempotency & UPSERT
- **Kết nối Neon (`src/db/index.ts`, `drizzle.config.ts`):** Helper `sanitizeDatabaseUrl()` xóa query param `channel_binding` (giữ `sslmode=require`); app/worker dùng HTTP driver `neon()` với `DATABASE_URL`; Drizzle migration ưu tiên `DATABASE_URL_UNPOOLED` (fallback `DATABASE_URL`).
- **Idempotency theo `readmeSha`:** Nếu `githubId` đã tồn tại với `readmeSha` không đổi → chỉ cập nhật `stars`, `lastPushedAt`, `updatedAt` và tăng `updatedStarsOnly` (không gọi AI).
- **Bảo toàn dữ liệu người dùng khi UPSERT & Reclassify:** Cả `onConflictDoUpdate` theo `githubId` lẫn chế độ `SYNC_RECLASSIFY` (`uncategorized` / `all`) **TUYỆT ĐỐI KHÔNG** ghi đè `isPinned` và `userNotes`.
- **Fail-safe khi AI lỗi:** Nếu cả 4 AI provider thất bại cho 1 repo → **bỏ qua không upsert** vào `tools`, tăng `failedCount` và ghi nhận vào `sync_logs.errorSummary`.

## 5. Quy trình Drizzle Migration & Nâng cấp an toàn Production

Thư mục migration chuẩn là `./drizzle` (cấu hình trong `drizzle.config.ts`, lưu lịch sử tại `drizzle.__drizzle_migrations`).

### 5.1. Database mới (trống)
1. Thiết lập `DATABASE_URL_UNPOOLED` (hoặc `DATABASE_URL`) trong `.env.local`.
2. Chạy migration:
   ```bash
   npm run db:migrate
   ```
   (Migration `0000_init_schema.sql` sẽ tự bật `CREATE EXTENSION IF NOT EXISTS "pg_trgm";`, tạo bảng `tools` + `sync_logs` với kiểu `timestamptz` và đầy đủ index.)
3. Quy trình khi chỉnh sửa `src/db/schema.ts` trong quá trình phát triển:
   ```bash
   npm run db:generate
   npm run db:check
   npm test
   ```

### 5.2. Database Production đã có sẵn bảng (chưa dùng `drizzle-kit migrate`)
> **Cảnh báo:** Nếu DB production trước đây được tạo bằng `drizzle-kit push`, **không** chạy trực tiếp `0000_init_schema.sql` vì lệnh `CREATE TABLE` sẽ báo lỗi bảng đã tồn tại.

Thực thi đoạn SQL idempotent dưới đây trong một phiên bảo trì / Neon SQL Editor (lưu ý: `USING <col> AT TIME ZONE 'UTC'` giả định dữ liệu `timestamp` cũ đang lưu theo UTC):

```sql
BEGIN;

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

ALTER TABLE "tools"
  ALTER COLUMN "last_pushed_at" TYPE timestamp with time zone USING "last_pushed_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';

ALTER TABLE "sync_logs"
  ALTER COLUMN "ran_at" TYPE timestamp with time zone USING "ran_at" AT TIME ZONE 'UTC';

CREATE INDEX IF NOT EXISTS "tools_search_text_trgm_idx" ON "tools" USING gin ("search_text" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "tools_pinned_stars_pushed_idx" ON "tools" USING btree ("is_pinned" DESC NULLS LAST, "stars" DESC NULLS LAST, "last_pushed_at" DESC NULLS LAST, "id" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "tools_last_pushed_at_idx" ON "tools" USING btree ("last_pushed_at" DESC NULLS LAST, "stars" DESC NULLS LAST, "id" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "tools_created_at_idx" ON "tools" USING btree ("created_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "sync_logs_ran_at_idx" ON "sync_logs" USING btree ("ran_at" DESC NULLS LAST);

COMMIT;
```

Sau khi chạy xong khối SQL nâng cấp trên, nếu muốn chuyển sang quản lý hoàn toàn bằng `npm run db:migrate` cho các migration kế tiếp (`0001+`), ghi nhận hash SHA-256 của `drizzle/0000_init_schema.sql` và `when` từ `drizzle/meta/_journal.json` vào bảng `drizzle.__drizzle_migrations` (hoặc tạo bảng trước rồi chèn 1 dòng baseline khớp `hash` & `created_at` của `0000_init_schema`).
