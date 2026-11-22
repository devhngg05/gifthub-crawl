# Nhật ký thay đổi (`CHANGELOG.md`)

Tài liệu theo dõi phiên bản và tiến độ triển khai từng module của `github-tool-radar`. Mọi module hoàn thành phải cập nhật tệp này trước khi kết thúc phiên làm việc.

## [0.1.8] - 2026-11-22 (Module 6 theo kế hoạch — Giao diện Web Dark Mode & Nhật ký đồng bộ)
### Đã thiết lập
- Cập nhật cấu hình Next.js & Theme Dark Mode:
  - Gỡ `cacheComponents` và `partialPrefetching` trong `next.config.ts` (giữ nguyên `@tailwindcss/turbopack` cho Tailwind CSS v4) để tương thích `export const dynamic = "force-dynamic"`.
  - Hoàn thiện `src/app/globals.css` và `src/app/layout.tsx` với theme Dark Mode developer-first (`bg-zinc-950`, chữ `zinc-100`, điểm nhấn `emerald-400/500`, font `Geist Sans` & `Geist Mono`, `lang="vi"`).
- Tách module helper thuần `src/lib/ui-helpers.ts` kèm bộ unit test `src/lib/__tests__/ui-helpers.test.ts`:
  - `parseToolSearchParams()` (hỗ trợ cả tên chuẩn `category`, `subCategory`, `usability`, `pinned`, `q`, `sort` lẫn alias `sub`, `level`), `buildFilterUrl()`, `hasActiveFilters()`, `computeToolCounts()` (đếm cả nhãn chính và `secondarySubCategories` không trùng lặp), `formatStars()`, `formatIsoDate()`, `formatRelativeTimeVi()`, `escapeLikePattern()`.
- Hoàn thiện 4 Component tương tác (`src/components/`):
  - `RelativeTime.tsx`: dùng `useSyncExternalStore` render `YYYY-MM-DD` khi SSR/hydrate và chuyển sang thời gian tương đối tiếng Việt trên client (chống Hydration Mismatch).
  - `Sidebar.tsx`: cây danh mục 2 tầng đọc trực tiếp từ `TAXONOMY` (7 nhóm / 25 ngách), badge đếm thật từ DB, lọc nhanh `Tất cả`, `Đã ghim`, `Chưa phân loại`, link `/logs` và Drawer responsive trên mobile.
  - `SearchToolbar.tsx`: tìm kiếm debounce 300ms đồng bộ URL, phím tắt `Ctrl + K` / `/`, bộ lọc 3 mức `usability` (`app-ready`, `cli-tool`, `dev-required`), đổi `sort` (`stars` / `recent`) và nút xóa bộ lọc.
  - `ToolCard.tsx`: hiển thị đầy đủ metadata công cụ, thao tác `PATCH /api/tools/[id]` cho 3 trường chuẩn (`isPinned`, `userNotes`, `subCategory`), kèm Modal nhập `Admin Secret` lưu vào `sessionStorage` (`x-admin-secret`) khi server trả `401`.
- Hoàn thiện 2 trang Server Component (`export const dynamic = "force-dynamic"`):
  - `src/app/page.tsx`: đọc `await searchParams`, truy vấn Neon PostgreSQL qua Drizzle ORM, tối ưu lọc `secondarySubCategories` bằng toán tử containment `@>` (`arrayContains`) tận dụng GIN Index, ưu tiên nhãn chính + `isPinned` + `stars`/`lastPushedAt`, kèm Empty State rõ ràng.
  - `src/app/logs/page.tsx`: hiển thị 4 thẻ tổng quan thật từ DB và bảng 30 bản ghi `sync_logs` gần nhất (`ranAt DESC`) highlight `failedCount > 0` và `errorSummary`.

## [0.1.7] - 2026-11-22 (Module 5 theo kế hoạch — Lớp xác thực Admin & API cá nhân hóa PATCH /api/tools/[id])
### Đã thiết lập
- Hoàn thiện `src/lib/auth.ts`:
  - Cài đặt `verifyAdminSecret(headerValue: string | null)` đọc `process.env.ADMIN_SECRET` và `process.env.NODE_ENV` tại runtime.
  - Khi `ADMIN_SECRET` được cấu hình: băm SHA-256 cho cả secret cấu hình và header `x-admin-secret`, so sánh an toàn bằng `crypto.timingSafeEqual` (tránh rò rỉ timing/độ dài); thiếu hoặc sai trả `{ authorized: false, status: 401 }`.
  - Khi `ADMIN_SECRET` trống: ở local dev (`NODE_ENV !== "production"`) cho phép bypass kèm `console.warn` 1 dòng (không lộ secret); ở `production` bắt buộc fail-closed trả `{ authorized: false, status: 503 }`.
- Hoàn thiện `src/app/api/tools/[id]/route.ts`:
  - Cài đặt `PATCH(request: NextRequest, context: { params: Promise<{ id: string }> })` gọi `verifyAdminSecret(request.headers.get("x-admin-secret"))` trước tiên (`401`/`503`).
  - Validate `id` qua `ToolIdParamSchema`, parse JSON body an toàn (`400` khi hỏng) và kiểm tra chặt qua `ToolPatchSchema` (chỉ nhận 3 trường `isPinned`, `userNotes`, `subCategory`).
  - Khi cập nhật `subCategory`: tự động đồng bộ `category` từ `SUB_CATEGORY_MAP[subCategory].category` trong `src/config/taxonomy.ts`, đồng thời lọc bỏ `subCategory` mới khỏi `secondarySubCategories` một cách nguyên tử bằng `array_remove(${tools.secondarySubCategories}, ${subCategory}::text)` và cập nhật `updatedAt`.
  - Cập nhật qua `.returning()` trên Drizzle ORM, trả `404` nếu không tìm thấy bản ghi, `200` (`{ tool }`) khi thành công và `500` an toàn khi DB lỗi.
- Tạo bộ unit test offline Vitest (`src/lib/__tests__/auth.test.ts` và `src/app/api/tools/[id]/__tests__/route.test.ts` mock `@/db`) kiểm chứng đầy đủ các kịch bản 200, 400, 401, 404, 500, 503 và biểu thức SQL `array_remove(..., ::text)`.

## [0.1.6] - 2026-11-22 (Module 4 theo kế hoạch — Worker đồng bộ dữ liệu & GitHub Actions Workflow)
### Đã thiết lập
- Hoàn thiện `scripts/load-env.ts`: gọi `dotenv.config({ path: ".env.local", quiet: true })` ngay khi import và an toàn trên CI khi thiếu tệp `.env.local`.
- Hoàn thiện `scripts/sync-tools.ts`:
  - Giữ `import "./load-env";` ở dòng đầu tiên trước toàn bộ các import khác (`@/db`, `@/db/schema`, `./lib/github`, `./lib/classifier`).
  - Đọc và validate `process.env.SYNC_LIMIT` qua `zod` (mặc định `20`), chỉ đếm giới hạn trên các repository thực sự cần gọi AI (không tính nhầm repo chỉ cập nhật stars).
  - Triển khai Idempotency theo `readmeSha` (`stars`, `lastPushedAt`, `updatedAt` + `updatedStarsOnly`), đồng thời nếu đã chạm `SYNC_LIMIT` mà gặp repo cũ đổi `readmeSha` thì chỉ cập nhật stars/metadata và giữ nguyên `readmeSha` cũ để lượt sau tự động phân loại lại.
  - Triển khai UPSERT `onConflictDoUpdate` theo `githubId` bảo toàn tuyệt đối `isPinned` và `userNotes` (không đưa vào payload insert/update), kèm `sleep(1500)` sau mỗi repo phân loại AI.
  - Bọc `try/catch` từng repository (per-repo isolation), bỏ qua upsert khi cả 4 AI provider fail (`failedCount++`), làm sạch thông điệp lỗi qua `sanitizeErrorMessage()` để không lộ connection string/token, luôn ghi 1 dòng tổng kết vào `sync_logs` và in bảng tóm tắt `Tên repo | Provider đã dùng | subCategory | usability`.
  - Chuẩn hóa CLI guard `isDirectExecution()` bằng `pathToFileURL(path.resolve(...)).href` (an toàn hoa/thường ổ đĩa trên Windows với `tsx`).
- Cập nhật `.github/workflows/daily-sync.yml`: lịch `cron: "0 19 * * *"` + `workflow_dispatch` (input `limit` mặc định `"25"`), Node.js `24`, `permissions: contents: read`, chạy `npm ci` và `npx tsx scripts/sync-tools.ts` với đủ 5 biến môi trường (`DATABASE_URL`, `GITHUB_TOKEN`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `SYNC_LIMIT`).
- Tạo bộ unit test offline Vitest (`scripts/__tests__/load-env.test.ts` và `scripts/__tests__/sync-tools.test.ts`) kiểm chứng idempotency, bảo toàn `isPinned`/`userNotes`, per-repo isolation khi AI fail, đếm đúng `SYNC_LIMIT`, CLI guard Windows và làm sạch secret trong log.

## [0.1.5] - 2026-11-22 (Module 3 — Bộ thu thập GitHub & Bộ phân loại AI Multi-Provider Fallback)
### Đã thiết lập
- Hoàn thiện `scripts/lib/github.ts` với header chuẩn GitHub API (`Accept`, `X-GitHub-Api-Version: 2022-11-28`, tùy chọn `Authorization: Bearer`), hàm `buildSearchQueries()` & `fetchCandidateRepos()` chạy song song 2 luồng tìm kiếm (Trụ cột `stars:>1500 pushed:>[6 tháng trước]` + Mới nổi `stars:>500 created:>[30 ngày trước]`), khử trùng theo `repo.id`, Quality Gate chặn repo thiếu `description`, `archived === true` hoặc chứa 7 topics rác (`awesome`, `awesome-list`, `roadmap`, `books`, `interview-questions`, `tutorial`, `cheatsheet`), và `fetchCleanReadme()` giải mã base64, xóa HTML/badges/ảnh Markdown, rút gọn khoảng trắng, cắt tối đa 2.500 ký tự đầu và xử lý an toàn HTTP `404`.
- Hoàn thiện `scripts/lib/classifier.ts` lọc động danh sách `PROVIDERS` tại runtime theo thứ tự `Groq-70B` → `Groq-8B-Fallback` → `GitHub-Models-4o-mini` → `OpenRouter-Free`, gọi chuẩn OpenAI-compatible (`/chat/completions`, `temperature: 0.2`, `response_format: { type: "json_object" }`), nhúng trực tiếp `TAXONOMY_PROMPT_GUIDE` từ `src/config/taxonomy.ts`, yêu cầu tóm tắt tiếng Việt tự nhiên (giữ nguyên thuật ngữ/tags tiếng Anh), làm sạch markdown code fence trước khi `JSON.parse`, validate qua `AiClassificationSchema`, trả về `{ classification, provider }` và tự động fallback qua các tầng khi gặp HTTP `429`, `>= 500`, lỗi mạng, JSON hỏng hoặc sai schema (ném Error không chứa secret khi cả 4 provider đều thất bại).
- Tạo bộ unit test offline Vitest (`scripts/lib/__tests__/github.test.ts` và `scripts/lib/__tests__/classifier.test.ts`, mock `fetch`) kiểm chứng toàn bộ cơ chế tìm kiếm song song, khử trùng, Quality Gate, làm sạch README/404 và chuỗi fallback 4 AI provider.

## [0.1.4] - 2026-11-22 (Module 2 — Tầng Database Neon & Drizzle)
### Đã thiết lập
- Hoàn thiện `src/db/schema.ts` với bảng `tools` (đúng 20 cột chuẩn, `githubId` `bigint({ mode: "number" })` `NOT NULL UNIQUE`, mảng `text[]` mặc định `'{}'::text[]`), bảng `syncLogs` (`sync_logs`, đủ 7 cột chuẩn), 3 B-Tree indexes (`category`, `subCategory`, `stars`) và 3 GIN indexes (`secondarySubCategories`, `useCases`, `replaces`).
- Hoàn thiện `src/db/index.ts` với `sanitizeDatabaseUrl()` (validate PostgreSQL URL bằng Zod, xóa `channel_binding` không phân biệt hoa/thường và giữ `sslmode=require`, không lộ credential trong thông điệp lỗi), `resolveAppDatabaseUrl()`, `resolveMigrationDatabaseUrl()`, `createDb()`, `getDb()`, và lazy proxy `db` dùng HTTP driver `neon()` + `drizzle-orm/neon-http`.
- Hoàn thiện `drizzle.config.ts` nạp `.env.local` (fallback `.env`, chế độ `quiet`), ưu tiên `DATABASE_URL_UNPOOLED` (fallback `DATABASE_URL`) và chuẩn hóa qua `sanitizeDatabaseUrl()`.
- Tạo unit test `src/db/__tests__/db.test.ts` (15 tests kiểm chứng `sanitizeDatabaseUrl()`, URL resolvers, khởi tạo client `neon()` với mock, và metadata schema/indexes); xác nhận `npm test` (43/43 tests), `npx tsc --noEmit`, `npm run lint` pass 100%, và chạy `npx drizzle-kit push --force` đẩy schema lên Neon thành công (`Changes applied`).

## [0.1.3] - 2026-11-22 (Module 1 — Bộ Taxonomy gốc & Bộ kiểm duyệt AI)
### Đã thiết lập
- Hoàn thiện `src/config/taxonomy.ts` với đủ 7 nhóm lớn (`category`) và 25 ngách chuyên sâu (`sub_category`) kèm nhãn tiếng Việt và `hint` chi tiết đúng chuẩn `docs/PRD.md`; export đầy đủ `TAXONOMY`, `VALID_CATEGORIES`, `VALID_SUB_CATEGORIES`, `CATEGORY_MAP`, `SUB_CATEGORY_MAP`, `SUB_CATEGORY_TO_CATEGORY`, `isValidCategory`, `isValidSubCategory`, và `TAXONOMY_PROMPT_GUIDE`.
- Hoàn thiện `src/lib/validator.ts` với `AiClassificationSchema` chống bịa nhãn (`summary_vi` 10–500 ký tự, `category` lạ ép `'other'`, `sub_category` lạ ép `'uncategorized'`, `secondary_sub_categories` lọc hợp lệ + bỏ trùng `sub_category` + khử trùng lặp + tối đa 2 phần tử, `use_cases` 1–4 cụm từ, `replaces` 0–3 tên phần mềm, `usability` fallback `'dev-required'`), cùng `ToolIdParamSchema` và `ToolPatchSchema` (`.strict()`) cho `PATCH /api/tools/[id]`.
- Bổ sung unit test Vitest cho `src/config/__tests__/taxonomy.test.ts` và `src/lib/__tests__/validator.test.ts`; xác nhận `npm test`, `npx tsc --noEmit`, `npm run lint` pass 100%.

## [0.1.2] - 2026-11-22 (Mốc 2 — Kiểm chứng hạ tầng Vitest)
### Đã thiết lập
- Xác minh `vitest.config.ts` (alias `@` → `./src`) và script `"test": "vitest run"` trong `package.json` khớp với `tsconfig.json`.
- Tạo smoke test `src/lib/__tests__/smoke.test.ts` import qua alias `@/config/taxonomy` và xác nhận `npm test` + `npx tsc --noEmit` pass 100%.

## [0.1.1] - 2026-11-22 (Mốc 1 — Dựng khung xương dự án)
### Đã thiết lập
- Khởi tạo khung Next.js App Router (`--src-dir`, TypeScript, Tailwind CSS, alias `@/*`) bảo toàn toàn bộ tệp nền tảng (`AGENTS.md`, `.agents/`, `docs/`, `.gitignore`).
- Cài đặt dependencies (`lucide-react`, `@neondatabase/serverless`, `drizzle-orm`, `zod`) và devDependencies (`drizzle-kit`, `tsx`, `dotenv`, `vitest`, `@types/node`), cấu hình `vitest.config.ts` và scripts chuẩn trong `package.json`.
- Tạo `.env.example` liệt kê đủ 7 biến môi trường không chứa secret thật.
- Dựng toàn bộ cây thư mục và các file skeleton theo `docs/ARCHITECTURE.md` (chỉ gồm type/export signature tối giản, không `// TODO`, `npx tsc --noEmit` đạt 0 lỗi).

## [0.1.0] - 2026-11-22 (Mốc 0 — Kiến trúc & Hệ thống điều khiển)
### Đã thiết lập
- Khởi tạo `.gitignore` chặn `.agents/mcp_config.json`, `node_modules/`, `.env*` và mở ngoại lệ `!.env.example`; thiết lập cấu hình MCP Servers (`neon`, `chrome-devtools`).
- Khởi tạo Git repository với commit gốc `chore: initial commit`.
- Chốt thiết kế từ `/grill-me` và đồng bộ 100% theo đặc tả Mục D:
  - Bộ Taxonomy gốc 7 nhóm lớn (`category`) và 25 ngách (`sub_category`) kèm nhãn tiếng Việt và `hint` trong `src/config/taxonomy.ts`.
  - Schema `tools` (20 cột, B-Tree trên `category`/`subCategory`/`stars`, GIN index trên `secondarySubCategories`/`useCases`/`replaces`) và `sync_logs` (`ranAt`, `fetchedCount`, `aiProcessedCount`, `updatedStarsOnly`, `failedCount`, `errorSummary`).
  - `sanitizeDatabaseUrl()` loại `channel_binding`, `load-env.ts` import đầu tiên, GitHub 2 luồng + Quality Gate + `fetchCleanReadme` (2.500 ký tự), AI 4 tầng fallback + `AiClassificationSchema`, bỏ qua upsert khi cả 4 provider lỗi.
  - `PATCH /api/tools/[id]` (`isPinned`, `userNotes`, `subCategory`) bảo vệ bằng `x-admin-secret` (`timingSafeEqual` + UI Modal `sessionStorage`), UI `<RelativeTime />` chống hydration mismatch, `.github/workflows/daily-sync.yml`.
- Hoàn thiện 6 tài liệu `docs/`, `AGENTS.md`, 3 rule `.agents/rules/` và 4 Agent Skills `.agents/skills/`.

---

## Checklist tiến độ từng Module

- [x] **Mốc 0:** Tài liệu nền tảng (`docs/`), `AGENTS.md`, `.agents/rules/`, `.agents/skills/` và `.gitignore` (`!.env.example`)
- [x] **Module 1 — Khung xương Next.js & Cấu hình:** `package.json`, `.env.example`, `vitest.config.ts`, `src/config/taxonomy.ts` (7 nhóm / 25 ngách — xong), `src/lib/validator.ts` (`AiClassificationSchema` & PATCH schema — xong), `src/lib/auth.ts` (xong) + unit tests (`taxonomy.test.ts`, `validator.test.ts`, `auth.test.ts` — xong)
- [x] **Module 2 — Tầng Database (Neon + Drizzle):** `drizzle.config.ts`, `src/db/index.ts` (`sanitizeDatabaseUrl`), `src/db/schema.ts` (`tools`, `syncLogs`, B-Tree & 3 GIN indexes) + push schema lên Neon + unit tests
- [ ] **Module 3 — Worker AI & GitHub Sync:** `scripts/load-env.ts` (xong), `scripts/lib/github.ts` (xong), `scripts/lib/classifier.ts` (xong), `scripts/sync-tools.ts` (xong code + unit tests offline), `scripts/__tests__/*.test.ts` (xong); còn chạy thử đồng bộ thật trên Neon
- [x] **Module 4 — API Route:** `src/app/api/tools/[id]/route.ts` (`PATCH` + `ADMIN_SECRET` + `SUB_CATEGORY_MAP` đồng bộ `category` + `array_remove` trên `secondarySubCategories`) + unit tests (`route.test.ts`)
- [x] **Module 5 — Giao diện Radar & Nhật ký:** `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`, `src/app/logs/page.tsx`, `src/components/Sidebar.tsx`, `src/components/SearchToolbar.tsx`, `src/components/ToolCard.tsx`, `src/components/RelativeTime.tsx`, `src/lib/ui-helpers.ts` + unit tests (`ui-helpers.test.ts`) & build production Dark Mode
- [ ] **Module 6 — Tự động hóa & Ship:** `.github/workflows/daily-sync.yml` (xong), rà soát lint/typecheck/test/build toàn diện (chờ kiểm thử trình duyệt thực tế & ship)
