---
trigger: glob
globs: "src/db/**,scripts/**,drizzle.config.ts"
---

# Quy chuẩn Database & Sync Worker (`db-worker-standards`)

1. **Nạp môi trường Worker:**
   - `scripts/load-env.ts` gọi `dotenv.config({ path: ".env.local" })`.
   - `scripts/sync-tools.ts` bắt buộc đặt `import "./load-env";` ở **dòng đầu tiên** trước khi import `@/db` hoặc bất kỳ module đọc `process.env` nào.

2. **Chuẩn hóa kết nối Neon (`channel_binding=require`):**
   - Cả `src/db/index.ts` và `drizzle.config.ts` phải đi qua helper `sanitizeDatabaseUrl()` để xóa tham số `channel_binding` khỏi URL (giữ nguyên `sslmode=require`), tránh lỗi trên `@neondatabase/serverless`.
   - App & worker dùng HTTP driver `neon()` qua `DATABASE_URL`; `drizzle.config.ts` ưu tiên `DATABASE_URL_UNPOOLED` và fallback về `DATABASE_URL`.

3. **Schema & Indexes (`src/db/schema.ts`):**
   - Bảng `tools` giữ đúng 20 cột chuẩn (`githubId` là `bigint({ mode: "number" })` unique, `summaryVi`, `category`, `subCategory`, `secondarySubCategories`, `useCases`, `replaces`, `usability`, `isPinned`, `userNotes`, v.v.); bảng `syncLogs` (`sync_logs`) gồm 7 cột (`id`, `ranAt`, `fetchedCount`, `aiProcessedCount`, `updatedStarsOnly`, `failedCount`, `errorSummary`).
   - Bắt buộc khai báo B-Tree index cho `category`, `subCategory`, `stars` và **GIN index** cho 3 cột mảng: `secondarySubCategories`, `useCases`, `replaces`.

4. **Chiến lược Crawl, Idempotency & AI Fallback (`scripts/`):**
   - Crawl song song 2 luồng: Trụ cột (`stars:>1500 pushed:>[6 tháng trước] archived:false`) và Mới nổi (`stars:>500 created:>[30 ngày trước] archived:false`), khử trùng theo `repo.id`.
   - Áp dụng Quality Gate (loại thiếu `description`, `archived === true`, hoặc `topics` chứa `awesome`, `awesome-list`, `roadmap`, `books`, `interview-questions`, `tutorial`, `cheatsheet`).
   - `fetchCleanReadme(fullName)`: tải `/repos/{fullName}/readme`, decode base64, Regex làm sạch HTML/ảnh/badges/khoảng trắng, cắt tối đa **2.500 ký tự đầu**, trả `{ sha, text }`.
   - Idempotency theo `readmeSha`: không đổi → chỉ cập nhật `stars`, `lastPushedAt`, `updatedAt`, tăng `updatedStarsOnly`, không gọi AI.
   - Repo mới/đổi README (giới hạn AI theo `SYNC_LIMIT`, mặc định `20`): gọi AI fallback 4 tầng + `AiClassificationSchema` → UPSERT `onConflictDoUpdate` theo `githubId` (**tuyệt đối bảo toàn `isPinned` và `userNotes`**) → `sleep(1500)`.
   - Nếu cả 4 AI provider fail cho 1 repo → **bỏ qua không upsert** vào `tools`, tăng `failedCount` và ghi tóm tắt vào `sync_logs`. Bọc `try/catch` từng repo và luôn ghi 1 dòng tổng kết vào `sync_logs`.
