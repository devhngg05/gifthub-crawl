# Nhật ký thay đổi (`CHANGELOG.md`)

Tài liệu theo dõi phiên bản và tiến độ triển khai từng module của `github-tool-radar`. Mọi module hoàn thành phải cập nhật tệp này trước khi kết thúc phiên làm việc.

## [0.1.26] - 2026-11-23 (Tối ưu đếm Sidebar bằng `GROUP BY` & vá unhandled promise rejection trong `tools-page-query`)
### Đã tối ưu & Sửa lỗi
- **Gộp nhóm đếm Sidebar ngay trên PostgreSQL (`src/lib/queries/tools-page-query.ts`, `src/lib/ui-helpers.ts`):**
  - Chuyển `fetchSidebarCountRows()` sang `fetchSidebarCountBuckets()` (giữ alias tương thích ngược `fetchSidebarCountRows`) với câu truy vấn `SELECT sub_category, is_pinned, count(*)::int AS count FROM tools GROUP BY sub_category, is_pinned`, loại bỏ việc tải toàn bộ các dòng trong bảng `tools` về Node.js để đếm.
  - Mở rộng `ToolCountRow` (thêm `count?: number`), export `ToolCountBucket` và cập nhật `computeToolCounts()` cộng dồn theo trọng số bucket để cho kết quả 1–1 giống hệt dữ liệu thô (bao gồm `totalCount`, `pinnedCount`, `uncategorizedCount`, `categoryCounts`, `subCategoryCounts`) đồng thời bỏ qua bucket có `count <= 0` hoặc không hợp lệ.
- **Khắc phục unhandled promise rejection trong `queryToolsPageData` (`src/lib/queries/tools-page-query.ts`):**
  - Tách phần gọi `queryFilteredTools` kèm nhánh `catch` fallback `isMissingPgTrgmError` sang helper `queryFilteredToolsWithFallback()` và chạy song song với `fetchSidebarCountBuckets()` qua `Promise.all([...])`, bảo đảm mọi promise đều được gắn handler xử lý lỗi ngay lập tức.
- **Đánh giá caching `fetchNewsfeedPageData()` (`src/app/newsfeed/page.tsx`):**
  - Giữ `export const dynamic = "force-dynamic"` vì `/newsfeed` phụ thuộc `searchParams` và `new Date()`, đồng thời tránh giới hạn 2 MB của Next.js Data Cache / mất kiểu `Date` khi serialize toàn bộ `tools` cũng như tránh stale data khi worker `scripts/sync-tools.ts` cập nhật DB ngoài tiến trình Next.js.
- **Kiểm thử (`src/lib/__tests__/ui-helpers.test.ts`, `src/lib/__tests__/tools-page-query.test.ts`):**
  - Bổ sung unit test cho `computeToolCounts` với `ToolCountBucket`, kiểm chứng tương đương 100% giữa dữ liệu thô và dữ liệu đã `GROUP BY`, và edge cases (`[]`, `0`, số âm, `NaN`, số thập phân).
  - Tạo mới `tools-page-query.test.ts` kiểm chứng SQL `GROUP BY` + `count(*)::int`, happy path, fallback Tầng 2 (`isRelaxedSearch`), fallback `isMissingPgTrgmError` (`42883`), rethrow lỗi gốc, và không phát sinh `unhandledRejection` ở cả hai chiều lỗi bất đồng bộ.

## [0.1.25] - 2026-11-23 (Vá edge case `classifier` & tách module `transport.ts` / `fallback.ts`)
### Đã sửa lỗi & Tái cấu trúc
- **Cấu hình token batch cho `Groq-Qwen-27B` (`scripts/lib/classifier/providers.ts`):**
  - Bổ sung `GROQ_QWEN_BATCH_MAX_TOKENS = 4096` và gắn `batchMaxTokens` cho `Groq-Qwen-27B` (giữ nguyên `maxTokens: GROQ_QWEN_MAX_TOKENS` = `750` ở chế độ phân loại đơn lẻ).
- **Tách nhỏ `scripts/lib/classifier/index.ts` và vá edge case (`transport.ts`, `fallback.ts`, `index.ts`):**
  - Tách logic gọi HTTP & parse/validate JSON sang `scripts/lib/classifier/transport.ts`; tối ưu fallback HTTP 400 chỉ thử lại bỏ `response_format` khi body lỗi liên quan tới `response_format` / `json_object` / `json mode` / `structured output` (`isResponseFormatUnsupportedError`).
  - Tách vòng lặp fallback & cooldown sang `scripts/lib/classifier/fallback.ts`; luôn làm sạch lỗi bằng `redactSecrets(sanitizeErrorMessage(error), [provider.apiKey])` trước khi đẩy vào `failures` và `console.warn` ở cả vòng thử chính lẫn vòng retry (`waitRound`).
  - Cập nhật mốc thời gian cooldown trong `catch` của `waitRound` dùng `nowFn()` thực tế tại thời điểm phát sinh lỗi thay vì `effectiveNowMs`.
  - Bổ sung cơ chế fail-fast trong `classifyRepoBatch()` qua `areAllProvidersCoolingDownBeyondLimit()` để dừng gọi phân loại lẻ cho các repo thiếu còn lại khi mọi active provider đều đang cooldown vượt quá `maxCooldownWaitMs`.
  - Giữ nguyên toàn bộ public exports tại `scripts/lib/classifier/index.ts` và `scripts/lib/classifier.ts`.
- **Kiểm thử (`scripts/lib/__tests__/classifier.test.ts`):**
  - Bổ sung unit test cho `resolveProviderMaxTokens` của `Groq-Qwen-27B` (single vs batch), làm sạch secret ở vòng chính & `waitRound`, mốc `nowFn()` trong `waitRound`, điều kiện retry HTTP 400 có chọn lọc, và fail-fast của `classifyRepoBatch`.

## [0.1.24] - 2026-11-23 (Thay thế `x-admin-secret` phía trình duyệt bằng `HttpOnly` Signed Cookie Session & Fail-Closed Auth)
### Đã cập nhật & Bảo mật
- **Nâng cấp lõi xác thực (`src/lib/auth.ts`):**
  - Sửa lỗi bypass mặc định ngoài production: hệ thống fail-closed (`503`) ở mọi môi trường nếu thiếu `ADMIN_SECRET`, chỉ cho phép bypass ở local khi đồng thời `NODE_ENV !== "production"` và `ALLOW_DEV_ADMIN_BYPASS === "true"` (ghi `console.warn` tối đa 1 lần).
  - Giữ SHA-256 + `crypto.timingSafeEqual` để đối chiếu secret khi đăng nhập; bổ sung token phiên stateless ký bằng HMAC-SHA256 từ khóa dẫn xuất của `ADMIN_SECRET` (kèm `iat`, `exp`, `nonce`, kiểm tra chữ ký bằng `timingSafeEqual`).
  - Cấu hình cookie `gtr_admin_session` với cờ `HttpOnly`, `SameSite=Lax`, `Path=/`, và `Secure` khi `NODE_ENV === "production"`.
  - Bổ sung kiểm tra `Sec-Fetch-Site` + `Origin`/`Referer` cùng host (`verifySameOriginRequest`) để phòng chống CSRF cho `POST`/`PATCH`/`DELETE`.
- **API Phiên Quản trị (`src/app/api/admin/session/route.ts`) & `PATCH /api/tools/[id]` (`src/app/api/tools/[id]/route.ts`):**
  - Tạo mới `GET` / `POST` / `DELETE /api/admin/session` (kèm `Cache-Control: no-store`, giới hạn tốc độ brute-force theo IP trả `429` + `Retry-After` và độ trễ nhẹ khi sai).
  - Chuyển `PATCH /api/tools/[id]` sang `verifyAdminRequest()` xác thực bằng `HttpOnly` cookie session + kiểm tra CSRF (chỉ giữ fallback header `x-admin-secret` có kiểm soát cho script nội bộ).
- **Loại bỏ lưu trữ secret trên trình duyệt (`src/hooks/useToolMutations.ts`, `src/components/AdminSecretModal.tsx`, `src/lib/ui-helpers.ts`):**
  - Xóa bỏ hoàn toàn `src/lib/admin-secret-storage.ts` (không còn dùng `sessionStorage`/`localStorage` hay gửi `x-admin-secret` từ trình duyệt).
  - Cập nhật `useToolMutations` gọi `POST /api/admin/session` để lấy cookie phiên trước khi gửi lại `PATCH /api/tools/[id]`, và cập nhật nội dung `AdminSecretModal`.
- **Kiểm thử & Tài liệu (`auth.test.ts`, `session/__tests__/route.test.ts`, `tools/[id]/__tests__/route.test.ts`, `AdminSecretModal.test.tsx`, `.env.example`, `docs/API-CONTRACTS.md`):**
  - Bổ sung unit test cho cookie hợp lệ, chữ ký giả, token hết hạn, đăng xuất, CSRF sai `Origin`, brute-force `429`, và điều kiện `ALLOW_DEV_ADMIN_BYPASS`.

## [0.1.23] - 2026-11-23 (Tối ưu PostgreSQL Schema với `timestamptz`, Index quy mô lớn & Quy trình Drizzle Migration)
### Đã cập nhật
- **Schema PostgreSQL & Indexes (`src/db/schema.ts`):**
  - Chuyển toàn bộ cột thời gian sang `timestamp(..., { withTimezone: true })` (`timestamptz`): `tools.lastPushedAt`, `tools.createdAt`, `tools.updatedAt` (kèm `.$onUpdate(() => new Date())`) và `sync_logs.ranAt`.
  - Bổ sung 4 index mới trên `tools` (tổng 10 index): GIN trigram `tools_search_text_trgm_idx` (`gin_trgm_ops` trên `search_text`), composite B-Tree `tools_pinned_stars_pushed_idx` (`is_pinned DESC, stars DESC, last_pushed_at DESC NULLS LAST, id DESC`), composite B-Tree `tools_last_pushed_at_idx` (`last_pushed_at DESC NULLS LAST, stars DESC, id DESC`), và B-Tree `tools_created_at_idx` (`created_at DESC`).
  - Bổ sung index `sync_logs_ran_at_idx` (`ran_at DESC`) cho bảng `sync_logs`.
- **Drizzle SQL Migration & Scripts (`drizzle.config.ts`, `drizzle/`, `package.json`):**
  - Cấu hình bảng theo dõi migration (`drizzle.__drizzle_migrations`) trong `drizzle.config.ts` và sinh migration khởi tạo `drizzle/0000_init_schema.sql` (kèm `CREATE EXTENSION IF NOT EXISTS "pg_trgm";` ở đầu file trước các câu lệnh tạo bảng/index) cùng snapshot `drizzle/meta/`.
  - Bổ sung `db:migrate` và `db:check` vào `package.json` bên cạnh `db:generate`, `db:push`, `db:studio`.
- **Kiểm thử, CI & Tài liệu (`src/db/__tests__/db.test.ts`, `.github/workflows/ci.yml`, `docs/DATA-SCHEMA.md`, `docs/CHANGELOG.md`):**
  - Mở rộng `db.test.ts` kiểm tra `withTimezone`, `onUpdateFn`, toàn bộ 10 index trên `tools` + `sync_logs_ran_at_idx`, tính hợp lệ của `drizzle/meta/_journal.json` & file SQL migration, và kiểm tra không lệch schema offline (`generateDrizzleJson` + `generateMigration` === `[]`).
  - Bổ sung bước `npm run db:check` vào `.github/workflows/ci.yml` và hướng dẫn chi tiết cho DB mới + kịch bản nâng cấp an toàn DB production trong `docs/DATA-SCHEMA.md`.

## [0.1.22] - 2026-11-23 (Đồng bộ nhãn giao diện: Gifthub Crawl, Ghim & Nhiều sao nhất & tab Tiềm năng)
### Đã cập nhật
- **Thương hiệu hiển thị & Metadata (`src/app/layout.tsx`, `src/app/page.tsx`, `src/app/newsfeed/page.tsx`, `src/app/newsfeed/loading.tsx`, `src/app/logs/page.tsx`, `src/components/Sidebar.tsx`, `src/components/SidebarContent.tsx`):**
  - Đồng bộ tên thương hiệu hiển thị chính và metadata (`title`, `template`, `description`, `aria-label`, nút quay lại, header Sidebar/Mobile) từ `Gifthub` sang **`Gifthub Crawl`**, giữ nguyên route, tên biến, DB và tài nguyên kỹ thuật.
- **Nhãn sắp xếp mặc định (`src/components/SearchToolbar.tsx`, `src/lib/tool-query.ts`):**
  - Đổi nhãn hiển thị tùy chọn `sort = "stars"` từ `"Ghim & Sao cao"` sang **`"Ghim & Nhiều sao nhất"`** (không thay đổi logic truy vấn SQL).
- **Nhãn tab `gems` trên Newsfeed (`src/lib/newsfeed/filters.ts`, `src/lib/newsfeed/quality.ts`):**
  - Đổi nhãn tab `gems` trong `NEWSFEED_TABS` từ `"Ngọc ẩn"` sang **`"Tiềm năng"`** và đồng bộ badge lý do trong `buildNewsfeedHighlight()` sang **`"Tiềm năng"`** (giữ nguyên route key `gems` và điều kiện lọc `300 <= stars <= 6000` + hoạt động `<= 45` ngày).
- **Kiểm thử & Tài liệu (`src/lib/__tests__/newsfeed.test.ts`, `src/components/__tests__/SearchToolbar.test.tsx`, `docs/PRD.md`, `README.md`, `docs/CHANGELOG.md`):**
  - Cập nhật kỳ vọng chuỗi `"Tiềm năng"` cùng kiểm tra `NEWSFEED_TABS` trong `newsfeed.test.ts`, bổ sung test nhãn `"Ghim & Nhiều sao nhất"` trong `SearchToolbar.test.tsx`, đồng bộ mô tả tab trong `docs/PRD.md` và `README.md`.

## [0.1.21] - 2026-11-23 (Thiết lập kiểm thử React Component trên Vitest 5 & Bộ test hành vi UI)
### Đã bổ sung
- **Hạ tầng kiểm thử React Component (`package.json`, `vitest.config.ts`, `src/test/setup-dom.ts`):**
  - Cài đặt các gói `devDependencies` (`@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `@testing-library/dom`, `jsdom`, `@vitejs/plugin-react`).
  - Cấu hình `test.projects` trong `vitest.config.ts` tách biệt 2 môi trường độc lập: project `node` (`src/**/*.test.ts`, `scripts/**/*.test.ts` chạy thuần trên `node`) và project `components` (`src/**/*.test.tsx` chạy trên `jsdom` kèm `@vitejs/plugin-react` và `src/test/setup-dom.ts` tự động `cleanup()` + nạp `@testing-library/jest-dom/vitest`).
  - Xác nhận `.github/workflows/ci.yml` (`npm test`) thực thi trọn vẹn cả Backend tests lẫn Component tests.
- **Bộ test hành vi thực chất cho 3 Component tương tác (`src/components/__tests__/`):**
  - `AdminSecretModal.test.tsx`: kiểm chứng mở/ẩn modal, trim & submit secret thành công kèm nhả khóa cuộn `body`, thông báo lỗi khi nhập rỗng hoặc từ prop `errorMessage`, đóng an toàn bằng nút `Hủy`/`X`/backdrop/`Escape`, và khóa tương tác khi `isSaving=true`.
  - `ToolNoteEditor.test.tsx`: kiểm chứng hiển thị ghi chú ban đầu & bộ đếm ký tự `/2000`, chỉnh sửa nội dung, bấm `Lưu` gọi handler với nội dung mới kèm vô hiệu hóa control trong lúc đang lưu, bấm `Hủy` khôi phục nội dung ban đầu không gọi lưu, và hiển thị/xử lý nút `Xóa`.
  - `SearchToolbar.test.tsx`: mock `next/navigation`, `next/link` và `global.fetch`; kiểm chứng debounce `200ms` gọi `GET /api/tools/suggest?q=...` và render ngách/công cụ gợi ý, chọn công cụ điều hướng về URL sạch `/?q=<fullName>` (xóa bộ lọc cũ) & đóng dropdown, bấm nút `X` hoặc xóa trắng input nhấn `Enter` xóa `q` khỏi URL & đóng dropdown, và điều hướng bàn phím `ArrowDown` → `Enter` / `Escape`.

## [0.1.20] - 2026-11-23 (Pure Refactoring — Tái cấu trúc module hóa lõi, hooks, components & tầng queries)
### Đã tái cấu trúc (không thay đổi hành vi nghiệp vụ, giao diện, SQL query hay API contract)
- **Tách nhỏ các module xử lý lõi & giữ barrel re-export tương thích 100%:**
  - `src/lib/search-engine.ts` → `src/lib/search/` (`normalize.ts`, `synonyms.ts`, `parser.ts`, `search-text.ts`) + barrel `search-engine.ts`.
  - `src/lib/newsfeed.ts` → `src/lib/newsfeed/` (`scoring.ts`, `quality.ts`, `toolkits.ts`, `filters.ts`) + barrel `newsfeed.ts`.
  - `scripts/lib/classifier.ts` → `scripts/lib/classifier/` (`providers.ts`, `cooldown.ts`, `prompts.ts`, `index.ts`) + barrel `classifier.ts`.
  - `scripts/lib/github.ts` → `scripts/lib/github/` (`streams.ts`, `readme-cleaner.ts`, `client.ts`) + barrel `github.ts`.
  - `scripts/sync-tools.ts` → tách helper DB & phân loại lại sang `scripts/lib/sync/` (`upsert.ts`, `reclassify.ts`), giữ `import "./load-env";` ở dòng 1 và `@/db` cùng toàn bộ re-export tương thích trên entrypoint `scripts/sync-tools.ts`.
- **Tách custom hooks & subcomponents cho UI:**
  - `src/components/SearchToolbar.tsx` → tách `src/hooks/useSearchSuggest.ts` (debounce 200ms, `AbortController`, điều hướng phím `↑/↓/Enter/Escape`, phím tắt `Ctrl + K`/`/`) và `src/components/SearchSuggestDropdown.tsx`.
  - `src/components/ToolCard.tsx` → tách `src/hooks/useToolMutations.ts` (Ghim, Ghi chú, Đổi ngách qua `PATCH /api/tools/[id]` + `AdminSecretModal`) và `src/components/ToolCardHeader.tsx`.
  - `src/components/SidebarContent.tsx` → tách `src/components/SidebarCategoryTree.tsx` cho cây 10 nhóm / 43 ngách đóng mở.
- **Tách tầng truy vấn DB thuần & làm gọn Pages:**
  - Tạo `src/lib/queries/tools-page-query.ts` (`fetchSidebarCountRows`, `queryToolsPageData`, `fetchNewsfeedPageData`) và `src/lib/queries/logs-query.ts` (`fetchLogsPageData`).
  - Làm gọn `src/app/page.tsx`, `src/app/newsfeed/page.tsx` và `src/app/logs/page.tsx` để chỉ đọc `searchParams`, gọi hàm query và ráp layout.
- **Tài liệu:** Cập nhật cấu trúc thư mục và mô tả kiến trúc phân lớp trong `docs/ARCHITECTURE.md` và `docs/CHANGELOG.md`.

## [0.1.19] - 2026-11-23 (Chuẩn hóa README.md, GitHub Actions CI, dọn vệ sinh Repo & vá dứt điểm tìm kiếm tên repo)
### Đã bổ sung & dọn dẹp
- **Tài liệu gốc dự án (`README.md`):**
  - Tạo mới `README.md` chuẩn Production trình bày giá trị cốt lõi, badges tech stack/CI, tính năng nổi bật (24 luồng GitHub + 10 tầng AI fallback, tìm kiếm song ngữ Việt–Anh + `pg_trgm`, Newsfeed với Ngôi sao chất lượng `★★★` & 6 Bộ công cụ, cây 10 nhóm / 43 ngách 1–1, bảo mật `ADMIN_SECRET`), bảng Tech Stack, placeholder Demo/Screenshot, hướng dẫn cài đặt & chạy local copy-paste đầy đủ và mục lục dẫn tới toàn bộ tài liệu trong `docs/`.
- **Kiểm thử tự động CI (`.github/workflows/ci.yml`):**
  - Thiết lập workflow chạy trên `push` và `pull_request` nhánh `main` với `concurrency` (`cancel-in-progress: true`), `node-version: 24` (`cache: npm`), thực thi tuần tự `npm ci` → `npm run lint` → `npm run typecheck` → `npm test` → `npm run build` (dùng biến môi trường giả tối thiểu khi build, không yêu cầu kết nối DB thật).
- **Vệ sinh repository (`.gitignore`):**
  - Bổ sung `*.zip` vào `.gitignore` (cùng `.env*`, `!.env.example`, `*.tsbuildinfo` sẵn có) và xóa `project-latest.zip` khỏi thư mục gốc.

### Đã sửa lỗi (tìm kiếm tên repo có `-` / `/`, gợi ý dropdown & giữ bộ lọc danh mục)
- **Strict Search & Relevance Score (`src/lib/tool-query.ts`, `src/lib/__tests__/tool-query.test.ts`):**
  - Tách riêng `rawLower` (giữ `-`, `_`, `.`, `/`) song song với bản chuẩn hóa khoảng trắng trong `buildDirectRepoNameMatch()`, đảm bảo truy vấn tên repo thật như `coding-interview-university` hoặc `jwasham/coding-interview-university` luôn khớp Strict và nhận đầy đủ điểm `+120`/`+80` trong `buildSearchRelevanceScore()`.
  - Tách `buildSuggestRelaxedSearchCondition()` dùng ngưỡng chặt `word_similarity >= 0.45` trên `search_text`, `name`, `full_name` riêng cho `/api/tools/suggest`.
- **API Gợi ý tức thì (`src/app/api/tools/suggest/route.ts`, `src/app/api/tools/suggest/__tests__/route.test.ts`):**
  - Trả về ngay kết quả Strict khi có `>= 1` bản ghi (tuyệt đối không gọi hay trộn nhánh Relaxed), chỉ fallback khi Strict trả về `0` kết quả.
- **UI điều hướng gợi ý & tìm kiếm toàn kho (`src/lib/ui-helpers.ts`, `src/components/SearchToolbar.tsx`, `src/app/page.tsx`, `src/lib/__tests__/ui-helpers.test.ts`):**
  - Thêm `buildGlobalSearchUrl()` và `buildSuggestedToolUrl()` điều hướng chọn công cụ gợi ý thẳng về URL sạch `/?q=<fullName>` (xóa toàn bộ `category`, `subCategory`, `pinned`, `usability`, `page`, `sort`), đồng thời bổ sung nút **"Tìm trên toàn bộ kho"** trên banner nới lỏng / trạng thái 0 kết quả khi đang lọc hẹp.

## [0.1.18] - 2026-11-23 (Tái thiết kế `/newsfeed` tối giản Editorial Minimalist & Hệ thống Ngôi sao chất lượng)
### Đã nâng cấp
- **Hệ thống đánh giá Ngôi sao chất lượng & chống lạm phát sao (`src/lib/newsfeed.ts`):**
  - Tách `computeIntrinsicScore(tool, now)` (không cộng điểm `createdAt` để tránh repo mới cào đồng loạt đạt 3 sao) và bổ sung `computeQualityRating(tool, now)` trả về `{ tier: 0 | 1 | 2 | 3, label, reasons }`:
    - `★★★` (`"Xuất sắc"`): `intrinsicScore >= 92`, `pushedDays <= 30`, và (`stars >= 3000` hoặc `stars >= 1000` kèm `app-ready` / `replaces`).
    - `★★` (`"Chất lượng cao"`): `intrinsicScore >= 72` và `pushedDays <= 90`.
    - `★` (`"Đáng chú ý"`): `intrinsicScore >= 55`; repo `uncategorized` luôn giữ `tier: 0`.
  - Sinh `2–3` lý do tiếng Việt ngắn gọn (`reasons`) cho tooltip và mở rộng `parseNewsfeedParams` / `buildNewsfeedUrl` / `buildNewsfeedData` thêm bộ lọc `quality=high|top`, `pulse.topRatedCount` và `CuratedToolkit.ratedTools`.
- **Tái thiết kế `/newsfeed` 4 tầng tối giản (`max-w-4xl`, `src/app/newsfeed/page.tsx`, `src/app/newsfeed/loading.tsx`):**
  - **Header 1 dòng:** Gỡ bỏ 3 Pulse Stat Cards cồng kềnh, thay bằng dòng tóm tắt gọn (`Cập nhật <RelativeTime /> · X repo xuất sắc (★★★) bấm lọc nhanh ?quality=top · Y mới tuần này`).
  - **Bộ công cụ tuyển chọn (`src/components/ToolkitShowcase.tsx`):** Thu gọn thành 1 khối duy nhất với thanh chọn ngang 6 bộ (`shortTitle`), nút `Thu gọn / Mở rộng` và lưới `2×2` hiển thị 4 công cụ tinh hoa nhất của bộ đang chọn.
  - **Thanh lọc 1 hàng (`src/components/NewsfeedControls.tsx`):** 5 tab gạch chân tối giản (`Đáng chú ý`, `Mới vào`, `Ngọc ẩn`, `Thay bản trả phí`, `Dùng ngay`) kèm nút gạt `★ Chỉ repo chất lượng (★★+)` và 2 `<select>` dark-mode (`Thời gian`, `Danh mục`).
  - **Dòng tin 1 cột (`src/components/NewsfeedItem.tsx`, `src/components/QualityStars.tsx`):** Thay `ToolCard` trên `/newsfeed` bằng danh sách 1 cột 3 lớp thông tin phân tách rõ ngôi sao chất lượng vàng tô đặc với số sao GitHub xám rỗng, giữ nguyên 100% `ToolCard.tsx` ở trang `/` và `src/db/schema.ts`.
- **Kiểm thử & Tài liệu:** Mở rộng `src/lib/__tests__/newsfeed.test.ts` phủ đủ 4 mức sao, các mốc biên, chống `uncategorized`/lạm phát `createdAt` và bộ lọc `quality=high|top`; cập nhật `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md`.

## [0.1.17] - 2026-11-23 (Trang Newsfeed `/newsfeed`, Bộ máy Radar Score & 6 Bộ công cụ tự động)
### Đã xây dựng
- **Bộ máy tuyển chọn & chấm điểm tự động (`src/lib/newsfeed.ts`):**
  - Không sửa `src/db/schema.ts`, đọc 100% dữ liệu thật từ Neon PostgreSQL (`NewsfeedToolRow = Omit<ToolRow, "searchText">`).
  - `computeRadarScore(tool, now)` cân bằng độ phổ biến log-scale, độ sôi động `lastPushedAt`, độ mới phát hiện `createdAt`, mức độ dùng ngay (`usability`), phần thưởng có `replaces` (`+10`) và phạt `-25` cho `uncategorized`/`other`.
  - `selectDiverseTools(scoredTools, limit, maxPerCategory)` giữ đa dạng nhóm lớn ở luồng `spotlight` và tự backfill đủ `limit`.
  - Hỗ trợ 5 luồng lọc (`spotlight`, `fresh`, `gems` `300..6000` sao trong 45 ngày, `alternatives`, `ready`), auto-relax `window` (`7d`/`30d` -> `all`) kèm `didRelaxWindow`, chống xung đột `ready` + `dev-required`, cắt gọn badge `"Thay thế ..."` vượt quá `22` ký tự (`buildNewsfeedHighlight()`), và lắp ghép **6 Bộ công cụ thực chiến (`buildCuratedToolkits`)** ưu tiên đa dạng `subCategory` và tự ẩn bộ dưới 2 công cụ.
- **Trang `/newsfeed` & UI (`src/app/newsfeed/page.tsx`, `src/app/newsfeed/loading.tsx`, `ToolkitShowcase.tsx`, `NewsfeedControls.tsx`, `ToolCard.tsx`):**
  - Bố cục rộng `max-w-6xl` đồng bộ `/logs`, tối ưu truy vấn DB bỏ qua cột `searchText`, hiển thị Pulse Bar 3 chỉ số thật + `<RelativeTime />`, lưới 6 Bộ công cụ 1/2/3 cột, thanh 5 tab + bộ lọc dark-mode (tự ẩn `"Cho Dev"` khi ở tab `ready`) và tối đa 24 `ToolCard` kèm `highlightBadge` tùy chọn (giữ nguyên trang `/`).
- **Điều hướng toàn site (`SidebarContent.tsx`, `src/app/page.tsx`, `src/app/logs/page.tsx`):**
  - Thêm mục nổi bật `Newsfeed` (`/newsfeed`) trong `SidebarContent.tsx` dùng `usePathname()` cho trạng thái active chuẩn xác trên cả Desktop & Mobile Drawer, kèm nút chuyển nhanh 1 chạm giữa `/` ↔ `/newsfeed` ↔ `/logs`.
- **Kiểm thử & Tài liệu:** Tạo `src/lib/__tests__/newsfeed.test.ts` và cập nhật `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md`.

## [0.1.16] - 2026-11-23 (Hệ thống tìm kiếm ngữ nghĩa song ngữ Việt–Anh, `search_text` + `pg_trgm`, Relevance Ranking & Instant Suggest)
### Đã nâng cấp
- **Cột chỉ mục `search_text` & Script Backfill (`src/db/schema.ts`, `src/config/taxonomy.ts`, `scripts/backfill-search-text.ts`):**
  - Thêm cột `search_text` (`NOT NULL DEFAULT ''`) vào bảng `tools` (tổng 21 cột), tách từ khóa tích cực song ngữ (`POSITIVE_CATEGORY_KEYWORDS`, `POSITIVE_SUB_CATEGORY_KEYWORDS`) loại bỏ hoàn toàn mệnh đề phủ định gây nhiễu.
  - Tự động tính và cập nhật `search_text` ở mọi điểm ghi DB: UPSERT & `SYNC_RECLASSIFY` trong `scripts/sync-tools.ts`, chỉnh sửa `subCategory`/`userNotes` trong `PATCH /api/tools/[id]`.
  - Tạo mới `scripts/backfill-search-text.ts` bật `pg_trgm`, tạo GIN index `tools_search_text_trgm_idx` và backfill `search_text` theo batch `100`.
- **Bộ máy phân tích truy vấn song ngữ (`src/lib/search-engine.ts`):**
  - Chuẩn hóa `normalizeSearchText()` (`đ/Đ -> d`, bỏ dấu NFD, lowercase), bỏ soft stopwords thông minh, nhận diện ý định thay thế (`"thay thế notion"`, `"giống postman"`, `"alternative to ..."`), và mở rộng từ điển đồng nghĩa >50 nhóm khái niệm Việt ↔ Anh + ánh xạ ngách Taxonomy.
- **Chấm điểm độ phù hợp, khớp ranh giới từ & Fallback 2 tầng (`src/lib/tool-query.ts`, `src/lib/ui-helpers.ts`, `src/app/page.tsx`):**
  - Bắt buộc khớp ranh giới từ `(' ' || search_text || ' ') LIKE '% <term> %'` cho từ khóa ngắn `<= 3` ký tự (`ai`, `api`, `cli`, `ui`, `db`, `ocr`...) để không khớp nhầm `"ai"` vào `"tai lieu"`, `"cai dat"`, `"email"`.
  - Bổ sung `sort = "relevance"` (*"Phù hợp nhất"*) tự bật khi tìm kiếm và tự rơi về `stars` khi xóa `q`; sắp xếp theo `buildSearchRelevanceScore` giảm dần trước (không để `isPinned` che lấp độ liên quan).
  - Bổ sung Fallback Tầng 2 (nới lỏng Concept Group / `word_similarity >= 0.35`, kèm xử lý an toàn khi chưa bật `pg_trgm`), banner thông báo tìm kiếm mở rộng và chip gợi ý khi 0 kết quả.
- **API Gợi ý tức thì & SearchToolbar (`src/app/api/tools/suggest/route.ts`, `src/components/SearchToolbar.tsx`):**
  - Tạo `GET /api/tools/suggest?q=...` trả tối đa 6 công cụ & 3 ngách gợi ý; `SearchToolbar` debounce 200ms kèm `AbortController`, hỗ trợ `↑`/`↓`/`Enter`/`Escape`, `/` và `Ctrl + K`, không tự navigate giữa chừng khi đang gõ xem dropdown gợi ý.
- **Unit Test:** Tạo mới `search-engine.test.ts` và `suggest/__tests__/route.test.ts`; cập nhật `tool-query.test.ts`, `ui-helpers.test.ts`, `db.test.ts`, `route.test.ts`, `sync-tools.test.ts`.

## [0.1.15] - 2026-11-23 (Chuỗi 10 tầng AI Gemini/Groq/OpenRouter, nén token prompt & cooldown 5xx/429)
### Đã tối ưu
- **Chuỗi 10 tầng AI Provider & `max_tokens` tách bạch (`scripts/lib/classifier.ts`, `docs/API-CONTRACTS.md`):**
  - Bổ sung `Gemini-3.1-Flash-Lite` (`gemini-3.1-flash-lite`, tầng #2) và `Gemini-3.6-Flash` (`gemini-3.6-flash`, tầng #7), hoàn thiện chuỗi 10 tầng: `Gemini-3.5-Flash-Lite` → `Gemini-3.1-Flash-Lite` → `Groq-120B` → `Groq-20B-Fast` → `Groq-Qwen-27B` → `Gemini-3.5-Flash` → `Gemini-3.6-Flash` → `Gemini-3.8-Flash` → `OpenRouter-Free` → `OpenRouter-Free-Backup`.
  - Áp dụng `maxTokens: 2048` (lẻ) / `4096` (batch) cho toàn bộ 5 tầng Gemini và `750` cho `Groq-Qwen-27B`.
- **Nén 50–60% token mỗi request (`src/config/taxonomy.ts`, `scripts/lib/classifier.ts`):**
  - Thêm `TAXONOMY_COMPACT_GUIDE` (`2.637` ký tự cho 10 nhóm / 43 ngách), rút gọn system prompt và giới hạn README đưa vào prompt còn tối đa `1.200` ký tự (phân loại lẻ) / `600` ký tự/repo (`classifyRepoBatch`).
- **Chống retry tức thì 429 & Cooldown `5xx` (`scripts/lib/classifier.ts`):**
  - Không retry ngay vào provider vừa trả `HTTP 429`; chờ `minRemainingMs + 1000 ms` theo provider sắp hồi (tối đa `2` vòng chờ `<= 65s`/repo).
  - Bổ sung cooldown lỗi server `5xx` (`500..599`): nghỉ `120_000 ms` lần đầu, tăng lên `300_000 ms` từ lần liên tiếp thứ 2+, tự reset bộ đếm về `0` khi gọi thành công `200 OK`.

## [0.1.14] - 2026-11-23 (Taxonomy 10 nhóm / 43 ngách, nâng độ chính xác AI, 24 luồng GitHub & SYNC_RECLASSIFY)
### Đã nâng cấp
- **Mở rộng Taxonomy giữ tương thích ngược 100% (`src/config/taxonomy.ts`, `src/lib/validator.ts`, `src/app/page.tsx`):**
  - Mở rộng từ `7 nhóm / 25 ngách` lên **`10 nhóm / 43 ngách`**, giữ nguyên toàn bộ 7 `category` slug và 25 `subCategory` slug cũ tại đúng nhóm cha để không làm hỏng dữ liệu đang có trong Neon PostgreSQL.
  - Tách rạch ròi nhóm `ai-llm` (`local-llm-gateway`, `ai-chat-ui`, `ai-coding-agent`, `ai-workflow-mcp`, `rag-ocr-extract`, `ai-voice-vision`), bổ sung 3 nhóm mới (`security-privacy`, `data-analytics`, `cms-collab-business`) và phân tách rõ `security-vault` với nhóm `security-privacy`.
  - `AiClassificationSchema` tự đồng bộ `category` theo `SUB_CATEGORY_MAP[sub_category].category` khi `sub_category` hợp lệ để loại bỏ lệch nhóm cha/ngách con.
- **Làm sạch README thông minh & Mở rộng 24 luồng GitHub (`scripts/lib/github.ts`):**
  - Nâng cấp `cleanReadmeText()` xóa `<svg>`, `<picture>`, `<video>`, `<audio>`, comments, badges, ảnh Markdown, thanh chuyển ngôn ngữ và mục lục (Table of Contents), đồng thời ưu tiên giữ Intro + Features + Installation/Usage trước khi cắt tại `2.500` ký tự.
  - Mở rộng lên 24 luồng tìm kiếm (5 luồng lõi gồm cả `pillarLow` `500..1500` + 19 luồng chủ đề), hỗ trợ `GITHUB_STREAM_MODE=rotate` (mặc định: 5 lõi + 7 chủ đề xoay vòng mỗi 6h UTC) và `all` (toàn bộ 24 luồng) hoặc `GITHUB_STREAMS`, giữ `requestDelayMs = 2500`.
  - Bổ sung `homepage` vào `GitHubRepoItem` và hàm `fetchRepoMetadata()`.
- **Nâng chất lượng Prompt & Batch Classification (`scripts/lib/classifier.ts`):**
  - Truyền thêm `homepage` vào `buildUserPrompt()`, siết chặt luật phân loại chống gán bừa `ai-coding-agent`, định nghĩa rõ ranh giới `usability` (`app-ready`, `cli-tool`, `dev-required`).
  - Bổ sung `classifyRepoBatch()` dùng chung chuỗi 8 provider fallback + `providerCooldowns`, tự fallback phân loại lẻ từng repo nếu thiếu phần tử.
- **Chế độ phân loại lại kho cũ `SYNC_RECLASSIFY` (`scripts/sync-tools.ts`, `.env.example`, `docs/`):**
  - Thêm `SYNC_RECLASSIFY=none|uncategorized|all` và `SYNC_BATCH_SIZE` (mặc định `5`, tối đa `20`), tải `fetchRepoMetadata()` + `fetchCleanReadme()` song song nhẹ (`concurrency = 5`), phân loại theo lô qua `classifyRepoBatch()` và chỉ cập nhật 9 trường AI (`buildReclassifyUpdateSet`), bảo toàn tuyệt đối `isPinned` và `userNotes`.

## [0.1.13] - 2026-11-23 (Ưu tiên 3 tầng Gemini Flash OpenAI-compatible & bảo vệ cắt cụt JSON)
### Đã nâng cấp
- **Bổ sung 3 tầng Gemini ưu tiên cao nhất (`scripts/lib/classifier.ts`, `docs/API-CONTRACTS.md`):**
  - Thêm `Gemini-3.8-Flash` (`gemini-3.8-flash`), `Gemini-3.5-Flash` (`gemini-3.5-flash`) và `Gemini-3.5-Flash-Lite` (`gemini-3.5-flash-lite`) qua endpoint OpenAI-compatible `https://generativelanguage.googleapis.com/v1beta/openai` (`apiKeyEnv: "GEMINI_API_KEY"`), tự động bỏ qua nếu chưa cấu hình `GEMINI_API_KEY` và giữ nguyên chuỗi fallback Groq/OpenRouter phía sau (`Groq-120B` → `Groq-Qwen-27B` → `Groq-20B-Fast` → `OpenRouter-Free` → `OpenRouter-Free-Backup`).
  - Hỗ trợ `maxTokens` theo provider (đặt `4096` >= `2048` cho cả 3 tầng Gemini để tránh đứt JSON khi model reasoning trả kèm `thought_signature`), đọc `finish_reason` trong response và báo lỗi rõ ràng `"Truncated JSON returned by model (finish_reason: length)"` để fallback sang tầng kế tiếp khi JSON bị cắt cụt, đồng thời giữ nguyên bộ lọc `<think>...</think>` và markdown code fence.
- **Bảo mật & GitHub Actions (`.github/workflows/daily-sync.yml`, `.env.example`, `src/lib/sanitize-error.ts`, `src/lib/__tests__/sanitize-error.test.ts`):**
  - Khai báo `GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}` trong bước chạy `scripts/sync-tools.ts` trên GitHub Actions và thêm `GEMINI_API_KEY=` vào `.env.example`.
  - Bổ sung pattern che khóa Google/Gemini (`AIza...`) vào `redactSecrets()`.
- **Log tiến độ trực tiếp & Timeout an toàn (`scripts/lib/github.ts`, `scripts/lib/classifier.ts`, `scripts/sync-tools.ts`, `.env.example`):**
  - Bổ sung log tiến độ theo từng stream/trang (`[github] Stream X/9 (...) — page Y/Z...`) và tổng repo hợp lệ sau khử trùng, hỗ trợ biến môi trường `GITHUB_PAGES_PER_QUERY` (mặc định `3`, phạm vi `1..10`) qua `parsePagesPerQuery()`, cùng `AbortSignal.timeout(20_000)` cho mọi request GitHub API.
  - Sắp xếp lại chuỗi 8 provider tối ưu tốc độ (`Gemini-3.5-Flash-Lite` → `Groq-120B` → `Groq-20B-Fast` → `Groq-Qwen-27B` → `Gemini-3.5-Flash` → `Gemini-3.8-Flash` → `OpenRouter-Free` → `OpenRouter-Free-Backup`), đặt fail-fast timeout `25_000` ms (`DEFAULT_TIMEOUT_MS`) / `45_000` ms (`DEFAULT_BATCH_TIMEOUT_MS`), bổ sung cooldown `180_000` ms cho `TimeoutError`/`AbortError`, tăng dần cooldown `HTTP 429` quota ngày (`PerDay` / `exceeded your current quota`) từ `60_000` ms lên `1_800_000` ms khi lặp lại 2 lần liên tiếp và reset bộ đếm khi gọi thành công.
  - Chuẩn hóa log chờ cooldown (`[classifier] Tất cả provider đang cooldown, chờ Xs...`) và log các mốc chính trong `sync-tools.ts` (`Đã tìm thấy N ứng viên, đang đối chiếu DB...`, `Đang tải README & phân loại lô K (... repo)...`).
- **Kiểm thử (`scripts/lib/__tests__/classifier.test.ts`):**
  - Cập nhật unit test cho chuỗi 8 provider mới, kịch bản tự bỏ qua khi thiếu `GEMINI_API_KEY`, payload `thought_signature`, fallback khi gặp `finish_reason: "length"` và che secret đầy đủ qua `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

## [0.1.12] - 2026-11-23 (Mở rộng quy mô kho dữ liệu lên hàng trăm–hàng nghìn công cụ thật & Phân trang trang chủ)
### Đã nâng cấp
- **Mở rộng nguồn cào GitHub & Phân trang Search API (`scripts/lib/github.ts`, `scripts/lib/__tests__/github.test.ts`):**
  - Chuyển sang 9 luồng tìm kiếm chuyên biệt: 3 dải sao trụ cột (`stars:>10000`, `stars:3000..10000`, `stars:1000..3000` kèm `pushed:>[12 tháng trước] archived:false`), 1 luồng mới nổi (`stars:>300 created:>[60 ngày trước] archived:false`) và 5 luồng chủ đề thực dụng (`topic:cli`, `topic:self-hosted`, `topic:developer-tools`, `topic:ai-agent`, `topic:database` với `stars:>500 archived:false`).
  - Hỗ trợ phân trang `per_page=100` và `pagesPerQuery=3` (`page=1..3`, dừng sớm khi trang trả `< per_page` item), gửi tuần tự giãn cách `DEFAULT_SEARCH_REQUEST_DELAY_MS = 2500` ms giữa các request Search API để tránh chạm giới hạn 30 req/phút trong khi vẫn giữ nguyên Quality Gate và khử trùng theo `repo.id`.
- **Tăng tầng dự phòng AI & Tối ưu Worker (`scripts/lib/classifier.ts`, `scripts/sync-tools.ts`, `.env.example`, `docs/API-CONTRACTS.md`):**
  - Bổ sung tầng dự phòng thứ 5 `OpenRouter-Free-Backup` (`google/gemma-4-26b-a4b-it:free`) ngay sau `OpenRouter-Free` (`google/gemma-4-31b-it:free`), áp dụng chung header OpenRouter và cập nhật `docs/API-CONTRACTS.md`.
  - Hỗ trợ cấu hình nhịp nghỉ qua env `SYNC_DELAY_MS` (validate bằng Zod qua `parseSyncDelayMs()`, mặc định nâng lên `4000` ms) để giảm chạm trần 8.000 TPM của Groq khi chạy lô lớn.
  - Chia batch truy vấn `existing` theo từng chunk `EXISTING_QUERY_CHUNK_SIZE = 500` repo và dừng vòng lặp sớm (`break`) khi gặp repo mới sau khi đã chạm `SYNC_LIMIT`.
- **Tăng tần suất tự động tích lũy (`.github/workflows/daily-sync.yml`):**
  - Đổi lịch `cron` sang 4 lần/ngày (`0 1,7,13,19 * * *`), mặc định `SYNC_LIMIT: "40"`, `SYNC_DELAY_MS: "4000"`, `timeout-minutes: 30` và thêm `concurrency` (`cancel-in-progress: false`) tránh chồng lấn lượt chạy.
- **Phân trang PostgreSQL trên trang chủ (`src/lib/ui-helpers.ts`, `src/components/Pagination.tsx`, `src/app/page.tsx`, `src/lib/__tests__/ui-helpers.test.ts`):**
  - Thêm tham số URL `page` (mặc định `1`, `DEFAULT_PAGE_SIZE = 24`), `computePagination()` và `getPaginationRange()` dùng `LIMIT`/`OFFSET` trực tiếp trên PostgreSQL kèm truy vấn đếm tổng song song.
  - Tạo mới `Pagination.tsx` giữ nguyên toàn bộ bộ lọc (`category`, `subCategory`, `usability`, `pinned`, `q`, `sort`) khi chuyển trang, đồng thời `buildFilterUrl()` tự động reset về trang 1 khi đổi bộ lọc, tìm kiếm hoặc sắp xếp từ `Sidebar` / `SearchToolbar`.
- **Kiểm thử & Kiểm chứng:**
  - Cập nhật và bổ sung unit tests trong `github.test.ts`, `classifier.test.ts`, `sync-tools.test.ts` và `ui-helpers.test.ts`; kiểm tra đầy đủ `npm test`, `npm run typecheck`, `npm run lint` và `npm run build`.

## [0.1.11] - 2026-11-23 (Sửa triệt để Sort, mở rộng Crawler 8 luồng & Đổi thương hiệu Gifthub Crawl / Gifthub Tool)
### Đã sửa lỗi (Root Cause Analysis — Tính năng Sắp xếp `sort`)
- **Truy vấn Drizzle PostgreSQL (`src/lib/tool-query.ts`, `src/app/page.tsx`):**
  - Tách helper server `buildToolOrderByClauses()` tách biệt rõ `sort = "recent"` (`last_pushed_at DESC NULLS LAST, stars DESC, id DESC`) và `sort = "stars"` (`is_pinned DESC, stars DESC, last_pushed_at DESC NULLS LAST, id DESC`), khắc phục lỗi `isPinned` che lấp thứ tự thời gian khi chọn `"Mới cập nhật"` và lỗi `NULLS FIRST` mặc định của PostgreSQL.
- **Đồng bộ URL & Chống race condition (`src/components/SearchToolbar.tsx`, `src/lib/ui-helpers.ts`):**
  - Đọc trực tiếp trạng thái sống từ `useSearchParams()` qua `parseUrlSearchParams()`, dùng `latestFiltersRef` và `debounceTimerRef` để hủy ngay timer tìm kiếm đang chờ khi bấm đổi `sort` / `usability` / `Xóa bộ lọc`, loại bỏ tình trạng timer cũ ghi đè ngược `sort=recent` về mặc định.
  - Chuyển 2 nút Sắp xếp sang `<button type="button">` bọc `useTransition` + `optimisticSort` với `router.push(..., { scroll: false })` để phản hồi tức thì và giữ nguyên từ khóa `searchInput` đang gõ; chuẩn hóa `parseToolSearchParams()` nhận `sort` không phân biệt hoa thường.
- **Unit test hồi quy (`src/lib/__tests__/ui-helpers.test.ts`, `src/lib/__tests__/tool-query.test.ts`):**
  - Khóa chặt hành vi `parseToolSearchParams`, `parseUrlSearchParams`, `buildFilterUrl` khi chuyển `stars` ↔ `recent` và kiểm chứng SQL `ORDER BY` biên dịch từ `PgDialect`.

### Đã nâng cấp (Mở rộng nguồn cào & Tối ưu batch `SYNC_LIMIT` lớn)
- **Mở rộng GitHub Crawler (`scripts/lib/github.ts`, `scripts/lib/__tests__/github.test.ts`):**
  - Tăng `DEFAULT_PER_PAGE` từ `50` lên `100` và mở rộng từ 2 lên 8 luồng tìm kiếm (`pillar`, `rising`, `cli`, `devtools`, `selfHosted`, `database`, `automation`, `productivity`) chạy theo batch `DEFAULT_SEARCH_CONCURRENCY = 2` (giãn cách `200ms`), gộp bằng **round-robin interleaving** để phủ đều cả 7 nhóm danh mục trong khi vẫn giữ nguyên Quality Gate lọc topics rác và khử trùng theo `repo.id`.
- **Gia cố AI Fallback & Rate-Limit (`scripts/lib/classifier.ts`, `scripts/sync-tools.ts`, `scripts/lib/__tests__/classifier.test.ts`, `scripts/__tests__/sync-tools.test.ts`):**
  - Bổ sung `parseRateLimitRetryAfterMs()` đọc `Retry-After` / thông điệp TPM của Groq và cơ chế `providerCooldowns` theo phiên chạy: tự động bỏ qua provider vừa chạm HTTP `429` chuyển ngay sang `Groq-Qwen-27B` → `Groq-20B-Fast` → `OpenRouter-Free`, và tự chờ hồi quota khi cả 4 tầng đều đang cooldown.
  - Bỏ qua gọi `fetchCleanReadme` cho repo cũ sau khi đã chạm `SYNC_LIMIT` (vẫn cập nhật `stars`/`lastPushedAt` và giữ nguyên `readmeSha` để lượt sau phân loại lại), bổ sung unit test offline mô phỏng batch `SYNC_LIMIT=35` gặp `429`.

### Đã cập nhật (Nhận diện thương hiệu & Favicon)
- **Thương hiệu & Metadata (`src/components/Sidebar.tsx`, `src/components/SidebarContent.tsx`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/logs/page.tsx`):**
  - Đổi chữ logo ở Header Mobile & Desktop Sidebar sang **`Gifthub Crawl`**, đổi tiêu đề `<h1>` trang chủ `/` sang **`Gifthub Tool`**, và đồng bộ `metadata` (`title`, `title.template`, `description`) toàn site.
- **Favicon mới (`src/app/icon.svg`):**
  - Xóa `src/app/favicon.ico` mặc định cũ và tạo `src/app/icon.svg` thiết kế hình học chữ G + tia radar màu xanh `emerald` (`#10b981` / `#34d399`) trên nền tối `#09090b`/`#18181b` sắc nét ở cả Dark Mode lẫn Light Mode trên tab Chrome.

## [0.1.10] - 2026-11-22 (Sửa triệt để lỗi cuộn trang & nâng cấp bộ font Dark Mode)
### Đã sửa lỗi (Root Cause Analysis)
- **Mở khóa chiều cao cuộn trang (`src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`, `src/app/logs/page.tsx`, `src/app/loading.tsx`):**
  - Gỡ bỏ `h-full` / `min-h-full` cố định chiều cao 1 viewport trên `<html>` và `<body>`, chuyển hoàn toàn sang `min-h-dvh` và `overflow-x-clip` để tài liệu giãn nở tự nhiên theo nội dung mà vẫn không phá hỏng `position: sticky`.
  - Hoàn thiện kiến trúc cuộn 2 cột cho Desktop Sidebar (`lg:sticky lg:top-0 lg:h-dvh lg:self-start lg:overflow-y-auto lg:overscroll-contain`) kết hợp `min-h-full` và bỏ `overflow-y-auto` lồng nhau trong `SidebarContent.tsx` để tránh double-scroll.
- **Sửa cơ chế khóa cuộn `body` (`src/lib/scroll-lock.ts`, `src/components/Sidebar.tsx`, `src/components/AdminSecretModal.tsx`):**
  - Tạo tiện ích `acquireBodyScrollLock()` có đếm tham chiếu (reference-counted) kèm kiểm tra `shouldLockMobileDrawerScroll()` ngăn tình trạng kẹt `overflow: hidden` khi Mobile Drawer và `AdminSecretModal` đóng không theo thứ tự LIFO.
  - Tự động đóng Mobile Drawer khi chuyển URL (`usePathname()` + `useSearchParams()`) hoặc khi resize màn hình lên desktop (`>= 1024px` qua `matchMedia`), đồng thời chỉ khóa `body` khi thực sự đang ở màn hình mobile/tablet.
  - Tách `useEffect` khóa cuộn của `AdminSecretModal.tsx` chạy theo vòng đời mount/unmount (`[]`) thay vì phụ thuộc `[isSaving, onClose]`.
  - Bổ sung bộ unit test hồi quy `src/lib/__tests__/scroll-lock.test.ts`.

### Đã nâng cấp (Typography Tailwind CSS v4)
- **Nạp bộ 2 Google Fonts hỗ trợ đầy đủ tiếng Việt (`src/app/layout.tsx`, `src/app/globals.css`):**
  - `Plus_Jakarta_Sans` (`400`, `500`, `600`, `700`, `800`, `--font-plus-jakarta`) → gắn cho cả `--font-sans` và `--font-display` trong `@theme inline` cho toàn bộ văn bản UI tiếng Việt, logo (`font-display font-extrabold tracking-tight`) và `<h1>` (`font-display font-bold tracking-tight`).
  - `IBM_Plex_Mono` (`400`, `500`, `600`, `--font-ibm-plex-mono`) → `--font-mono` kết hợp `tabular-nums` cho tên repo trên `ToolCard`, số sao (`stars`), badge đếm số lượng trên Sidebar, bộ đếm ký tự/kết quả tìm kiếm, slug kỹ thuật và số liệu thống kê `/logs`.

## [0.1.9] - 2026-11-22 (Kiểm toán & gia cố chất lượng sản xuất — 20 hạng mục P1/P2)
### Đã cải tiến
- **UI/UX, Responsive & Edge States:**
  - Chuyển `min-h-screen` / `lg:h-screen` sang `min-h-dvh` / `lg:h-dvh` và `h-dvh` trên Mobile Drawer (`page.tsx`, `logs/page.tsx`, `Sidebar.tsx`).
  - Bổ sung `min-w-0`, `break-words`, `[overflow-wrap:anywhere]` chống tràn ngang ở khung hình 375px cho `ToolCard`, `SidebarContent`, `SearchToolbar` và cột lỗi `/logs`.
  - Tạo mới 3 boundary Dark Mode đồng bộ: `src/app/loading.tsx`, `src/app/error.tsx` và `src/app/logs/loading.tsx`.
  - Vô hiệu hóa nút mở ghi chú và `<textarea>` khi `isSaving` đang chạy.
- **Kiến trúc & Bảo trì:**
  - Tách `ToolCard.tsx` (596 dòng) và `Sidebar.tsx` (400 dòng) thành các module gọn < 350 dòng: `src/lib/admin-secret-storage.ts`, `src/components/AdminSecretModal.tsx`, `src/components/ToolNoteEditor.tsx`, `src/components/ToolCardDetails.tsx`, `src/components/SidebarContent.tsx`.
  - Tách dependency primitive trong `useEffect` debounce của `SearchToolbar.tsx` và tránh gọi trùng `router.replace` khi nhấn nút xóa tìm kiếm.
  - Gom logic che secret trùng lặp vào `src/lib/sanitize-error.ts`, dùng chung cho `scripts/sync-tools.ts`, `scripts/lib/classifier.ts` và `src/app/api/tools/[id]/route.ts`.
- **Nghiệp vụ, Dữ liệu & Bảo mật:**
  - Ánh xạ mã lỗi HTTP (`400`, `404`, `500`, `503`) và lỗi mạng sang tiếng Việt rõ ràng; hiển thị lỗi trực tiếp trên `AdminSecretModal` khi thử lại từ modal; chặn double-submit và bỏ qua `PATCH` khi ghi chú không đổi.
  - Tối ưu `src/app/logs/page.tsx` dùng 1 truy vấn SQL tổng hợp (`COUNT(*)` + `FILTER`) thay cho quét toàn bộ bảng `tools`.
  - Bổ sung `getSafeExternalUrl()` trong `src/lib/ui-helpers.ts` và siết `GitHubRepoItemSchema.html_url` chỉ nhận `https:` trong `scripts/lib/github.ts`.
  - Tạo `.env.example` (không chứa secret) và cấu hình security HTTP headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) trong `next.config.ts`.
- **Hiệu năng, SEO, A11y & Nội dung:**
  - Nạp subset `"vietnamese"` cho `Geist` và `Geist_Mono` trong `src/app/layout.tsx`; bổ sung `metadata` riêng cho `/` và `/logs` (kèm `robots: noindex, nofollow` cho `/logs`).
  - Hoàn thiện A11y & Semantic HTML (`<h2>` trong `<article>`, `scope="col"`, `aria-label`, `aria-expanded`, `aria-current`, `Escape` + khóa cuộn nền cho Drawer/Modal, `focus-visible:ring-2`) và nâng độ tương phản từ `text-zinc-500` lên `text-zinc-400`.
  - Việt hóa đồng bộ toàn bộ giao diện, xóa 5 file SVG rác mặc định trong `public/`, bổ sung unit test (`sanitize-error.test.ts`, `ui-helpers.test.ts`, `github.test.ts`, `route.test.ts`).

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
