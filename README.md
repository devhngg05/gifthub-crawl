# Gifthub (Gifthub Crawl)

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Neon PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-00E599?logo=postgresql&logoColor=white)](https://neon.tech/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle-ORM-C5F74F)](https://orm.drizzle.team/)
[![Vitest](https://img.shields.io/badge/Tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![CI](https://github.com/<OWNER>/<REPO>/actions/workflows/ci.yml/badge.svg)](https://github.com/<OWNER>/<REPO>/actions/workflows/ci.yml)

**Gifthub (Gifthub Crawl)** là nền tảng web cá nhân Full-Stack giúp tự động thu thập, kiểm duyệt, phân loại và tóm tắt tiếng Việt các công cụ mã nguồn mở nổi bật trên GitHub bằng pipeline AI đa tầng, tối ưu cho việc tìm kiếm ngữ nghĩa song ngữ, theo dõi xu hướng trên Newsfeed và quản lý ghi chú kỹ thuật hàng ngày.

---

## Tính năng nổi bật

- **Pipeline cào 24 luồng GitHub & AI Fallback 10 tầng (`scripts/sync-tools.ts`):**
  - Thu thập từ **5 luồng lõi** (`pillarTop`, `pillarMid`, `pillarBase`, `pillarLow`, `rising`) và **19 luồng chủ đề thực dụng** (`GITHUB_STREAM_MODE=rotate|all`), đi qua Quality Gate, làm sạch README thông minh (tối đa `2.500` ký tự) và khử trùng theo `repo.id`.
  - Hỗ trợ **idempotency theo `readmeSha`** (chỉ cập nhật sao/ngày push nếu README không đổi, bảo toàn tuyệt đối `isPinned` và `userNotes`), hỗ trợ phân loại theo lô (`classifyRepoBatch`) và chế độ tái phân loại `SYNC_RECLASSIFY`.
  - Chuỗi AI OpenAI-compatible (`/chat/completions`) **10 tầng fallback** qua Gemini, Groq và OpenRouter, nén prompt bằng `TAXONOMY_COMPACT_GUIDE`, cooldown thông minh cho `429` / `5xx` / timeout và kiểm duyệt chặt chẽ đầu ra JSON bằng `zod` (`AiClassificationSchema`).
- **Hệ thống tìm kiếm thông minh song ngữ Việt–Anh (`src/lib/search-engine.ts`, `src/lib/tool-query.ts`):**
  - Chỉ mục `search_text` kết hợp extension PostgreSQL `pg_trgm` (GIN index `tools_search_text_trgm_idx`), từ điển đồng nghĩa **>50 nhóm khái niệm Việt ↔ Anh** và nhận diện ý định thay thế (`"thay thế notion"`, `"alternative to ..."`).
  - Khớp chính xác tên repo giữ nguyên `-`, `_`, `/` song song bản chuẩn hóa, bảo vệ ranh giới nguyên từ cho từ ngắn `<= 3` ký tự (`ai`, `api`, `cli`, `db`, `ocr`), chấm điểm độ phù hợp (`sort=relevance`), fallback Tầng 2 kèm nút **"Tìm trên toàn bộ kho"** khi đang lọc danh mục hẹp.
  - API gợi ý tức thì `GET /api/tools/suggest` trả tối đa 6 công cụ & 3 ngách gợi ý; chỉ fallback sang `word_similarity >= 0.45` khi truy vấn Strict trả về 0 kết quả để tránh kéo repo rác nhiều sao.
- **Trang Newsfeed tối giản Editorial Minimalist (`/newsfeed`, `src/lib/newsfeed.ts`):**
  - Bố cục 1 cột `max-w-4xl` tính điểm `computeRadarScore` và **Ngôi sao chất lượng (`★` / `★★` / `★★★`)** tách biệt với sao GitHub thông qua `computeIntrinsicScore` chống lạm phát sao.
  - Khu vực **6 Bộ công cụ tuyển chọn (`ToolkitShowcase`)** có thể thu gọn/mở rộng, thanh lọc 5 tab (`Đáng chú ý`, `Mới vào`, `Tiềm năng`, `Thay bản trả phí`, `Dùng ngay`), lọc nhanh `quality=high|top`, theo thời gian và danh mục.
- **Cây danh mục 10 nhóm / 43 ngách chuẩn kế toán 1–1 (`src/config/taxonomy.ts`):**
  - Số đếm trên Sidebar khớp 100% với kết quả lọc theo `subCategory` chính (`categoryCounts` bằng đúng tổng `subCategoryCounts` con), hỗ trợ phân trang PostgreSQL (`24` công cụ/trang), 4 chế độ sắp xếp và trang giám sát đồng bộ `/logs` (`sync_logs`).
- **Quản trị Ghim, Ghi chú & Phân loại lại an toàn (`PATCH /api/tools/[id]`):**
  - Chỉ cho phép cập nhật 3 trường (`isPinned`, `userNotes`, `subCategory` tự đồng bộ `category` và `search_text`).
  - Xác thực `ADMIN_SECRET` bằng `crypto.timingSafeEqual` (fail-closed `503` khi thiếu secret ở `production`), nhập key qua Modal lưu tại `sessionStorage` và gửi qua header `x-admin-secret` (không lộ secret trong client bundle).

---

## Kiến trúc & Tech Stack

| Tầng hệ thống | Công nghệ & Thành phần chính |
| :--- | :--- |
| **Web Framework & UI** | Next.js 16 (App Router, `--src-dir`), React 19, TypeScript 5, Tailwind CSS 4, `lucide-react` |
| **Database & ORM** | Neon PostgreSQL (`@neondatabase/serverless` HTTP driver), Drizzle ORM (`drizzle-orm`, `drizzle-kit`), `pg_trgm` + GIN Indexes |
| **Tìm kiếm & Xếp hạng** | `search_text` chuẩn hóa, từ điển song ngữ Việt–Anh, SQL `buildSearchRelevanceScore`, `GET /api/tools/suggest` |
| **Worker & AI Pipeline** | `tsx` + `dotenv`, GitHub REST/Search API (24 luồng), OpenAI-compatible 10 tầng (`Gemini`, `Groq`, `OpenRouter`), `zod` |
| **Bảo mật & Giám sát** | `crypto.timingSafeEqual`, HTTP security headers (`next.config.ts`), `sanitizeErrorMessage`, bảng `sync_logs` (`/logs`) |
| **Kiểm thử & CI/CD** | Vitest, ESLint, TypeScript `tsc --noEmit`, GitHub Actions (`.github/workflows/ci.yml` & `daily-sync.yml`) |

---

## Demo & Ảnh chụp màn hình

> [!NOTE]
> Cập nhật liên kết bản deploy và ảnh chụp giao diện thực tế sau khi đẩy lên GitHub / Vercel.

- **Live Demo:** `[Điền link Vercel tại đây](https://your-app.vercel.app)`
- **Trang chủ (`/`) — Tìm kiếm song ngữ & Cây danh mục 10 nhóm / 43 ngách:**

```text
![Gifthub Dashboard Screenshot](./docs/screenshots/home.png)
```

- **Trang Newsfeed (`/newsfeed`) — Ngôi sao chất lượng & 6 Bộ công cụ tuyển chọn:**

```text
![Gifthub Newsfeed Screenshot](./docs/screenshots/newsfeed.png)
```

---

## Hướng dẫn chạy Local

### 1. Clone repository & cài đặt dependencies

```bash
git clone https://github.com/<OWNER>/<REPO>.git
cd gifthub-crawl
npm install
```

### 2. Cấu hình biến môi trường

Sao chép mẫu cấu hình sang `.env.local` (tệp này đã được `.gitignore` chặn commit):

```bash
cp .env.example .env.local
```

| Biến môi trường | Mức độ | Mô tả ngắn |
| :--- | :--- | :--- |
| `DATABASE_URL` | **Bắt buộc** | Chuỗi kết nối Neon PostgreSQL (app & sync worker) |
| `GEMINI_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY` | **Bắt buộc khi chạy sync** | Cần tối thiểu 1 khóa AI provider để phân loại repository |
| `ADMIN_SECRET` | **Bắt buộc ở `production`** | Khóa quản trị dùng cho `PATCH /api/tools/[id]` (dev local có thể bỏ trống) |
| `DATABASE_URL_UNPOOLED` | Tùy chọn | URL trực tiếp dùng cho `drizzle-kit push` (nếu thiếu sẽ fallback `DATABASE_URL`) |
| `GITHUB_TOKEN` | Tùy chọn | GitHub Personal Access Token giúp tăng rate limit khi chạy `npm run sync` |
| `SYNC_LIMIT`, `SYNC_BATCH_SIZE`, `SYNC_RECLASSIFY`, `SYNC_DELAY_MS` | Tùy chọn | Tinh chỉnh số repo mỗi lượt (`20`), kích thước lô (`5`), chế độ tái phân loại (`none`), độ trễ (`4000` ms) |
| `GITHUB_PAGES_PER_QUERY`, `GITHUB_STREAM_MODE` | Tùy chọn | Số trang mỗi luồng (`3`) và chế độ luồng (`rotate` hoặc `all`) |

### 3. Khởi tạo Schema & Chỉ mục tìm kiếm `pg_trgm`

```bash
npx drizzle-kit push
npx tsx scripts/backfill-search-text.ts
```

### 4. Khởi chạy Web UI

```bash
npm run dev
```

Truy cập `http://localhost:3000` (trang chủ `/`), `http://localhost:3000/newsfeed` và `http://localhost:3000/logs`.

### 5. Chạy thử Worker đồng bộ & Bộ kiểm thử

- **Đồng bộ mẫu 10 repository từ GitHub:**

```bash
# macOS / Linux (bash/zsh)
SYNC_LIMIT=10 npm run sync

# Windows PowerShell
$env:SYNC_LIMIT="10"; npm run sync
```

- **Kiểm tra chất lượng mã nguồn (Test, Typecheck, Lint, Build):**

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

---

## Tài liệu kỹ thuật (`docs/`)

- [PRD.md](docs/PRD.md) — Yêu cầu sản phẩm, tính năng MVP và phạm vi loại trừ.
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — Kiến trúc tổng thể, luồng dữ liệu và cấu trúc thư mục.
- [API-CONTRACTS.md](docs/API-CONTRACTS.md) — Đặc tả API (`PATCH /api/tools/[id]`, `GET /api/tools/suggest`), GitHub Search & chuỗi AI Fallback.
- [DATA-SCHEMA.md](docs/DATA-SCHEMA.md) — Thiết kế bảng `tools`, `sync_logs`, index GIN/`pg_trgm` và cơ chế UPSERT idempotent.
- [PROJECT-RULES.md](docs/PROJECT-RULES.md) — Quy chuẩn Tech Stack, bảo mật secrets và tiêu chuẩn kiểm thử bắt buộc.
- [CHANGELOG.md](docs/CHANGELOG.md) — Nhật ký thay đổi và tiến độ hoàn thiện qua từng phiên bản.
