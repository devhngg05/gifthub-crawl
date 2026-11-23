# Kiến trúc hệ thống (`ARCHITECTURE.md`)

## 1. Luồng dữ liệu tổng thể

```mermaid
flowchart LR
    GH["GitHub API (Trụ cột + Mới nổi & Quality Gate)"] -->|"Clean README <= 2500 chars + SHA"| WK["scripts/sync-tools.ts / /api/cron/sync"]
    WK -->|"Lease Lock (sync_logs id=-1) + Check dung lượng"| DB[("Neon PostgreSQL (tools, sync_logs)")]
    WK -->|"SHA mới/đổi (<= SYNC_LIMIT)"| AI["Fallback: Groq / Gemini / OpenRouter"]
    AI -->|"AiClassificationSchema hợp lệ"| DB
    AI -->|"Fail: bỏ qua upsert, ghi sync_logs"| DB
    WK -->|"Post-sync Prune (<= DB_PRUNE_BATCH_SIZE)"| DB
    DB -->|"Drizzle ORM (force-dynamic)"| UI["Next.js App Router (/, /newsfeed, /logs)"]
    UI -->|"PATCH + HttpOnly Cookie / x-admin-secret"| API["/api/tools/[id]"]
    API -->|"Chỉ sửa isPinned, userNotes, subCategory"| DB
```

## 2. Cấu trúc thư mục chuẩn

```text
.
├── .env.example
├── AGENTS.md
├── .agents/
│   ├── rules/
│   │   ├── core-security-stack.md
│   │   ├── db-worker-standards.md
│   │   └── ui-standards.md
│   └── skills/
│       ├── implement-feature/SKILL.md
│       ├── debug/SKILL.md
│       ├── explain-code/SKILL.md
│       └── build-and-ship/SKILL.md
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── DATA-SCHEMA.md
│   ├── API-CONTRACTS.md
│   ├── PROJECT-RULES.md
│   └── CHANGELOG.md
├── .github/workflows/
│   ├── ci.yml
│   └── daily-sync.yml
├── drizzle.config.ts
├── vercel.json                    # Cấu hình Vercel Cron (/api/cron/sync)
├── scripts/
│   ├── load-env.ts
│   ├── sync-tools.ts              # CLI entrypoint + re-export tương thích
│   ├── backfill-search-text.ts
│   └── lib/
│       ├── github.ts              # Barrel re-export
│       ├── github/
│       │   ├── streams.ts         # 24 luồng tìm kiếm & rotate/all
│       │   ├── readme-cleaner.ts  # Làm sạch & ưu tiên đoạn README
│       │   └── client.ts          # Gọi GitHub API & Quality Gate
│       ├── classifier.ts          # Barrel re-export (./classifier/index)
│       ├── classifier/
│       │   ├── providers.ts       # Cấu hình 10 tầng AI provider
│       │   ├── cooldown.ts        # Quản lý cooldown 429/5xx/timeout
│       │   ├── prompts.ts         # System/User prompt & parser JSON
│       │   └── index.ts           # Điều phối fallback lẻ & batch
│       └── sync/
│           ├── lock.ts            # Distributed Lease Lock (sync_logs id=-1)
│           ├── prune.ts           # Giám sát dung lượng DB & cắt tỉa sao thấp an toàn
│           ├── runner.ts          # Lõi điều phối runSync (dùng chung CLI & Vercel Cron)
│           ├── cron-config.ts     # Cấu hình micro-batch an toàn cho Vercel Cron
│           ├── upsert.ts          # Đối chiếu DB, upsert & sync_logs
│           └── reclassify.ts      # Luồng phân loại lại SYNC_RECLASSIFY
└── src/
    ├── config/
    │   └── taxonomy.ts
    ├── db/
    │   ├── index.ts
    │   └── schema.ts
    ├── hooks/
    │   ├── useSearchSuggest.ts    # Debounce, AbortController, phím tắt ↑/↓/Enter/Esc
    │   └── useToolMutations.ts    # PATCH /api/tools/[id] & AdminSecretModal
    ├── lib/
    │   ├── validator.ts
    │   ├── auth.ts
    │   ├── admin-secret-storage.ts
    │   ├── sanitize-error.ts
    │   ├── scroll-lock.ts
    │   ├── search-engine.ts       # Barrel re-export
    │   ├── search/
    │   │   ├── normalize.ts       # Chuẩn hóa tiếng Việt & stopwords
    │   │   ├── synonyms.ts        # Từ điển đồng nghĩa Việt–Anh & ngách
    │   │   ├── parser.ts          # parseSearchQuery, replaces & conceptGroups
    │   │   └── search-text.ts     # buildToolSearchText
    │   ├── tool-query.ts
    │   ├── ui-helpers.ts
    │   ├── newsfeed.ts            # Barrel re-export
    │   ├── newsfeed/
    │   │   ├── scoring.ts         # computeRadarScore & selectDiverseTools
    │   │   ├── quality.ts         # computeQualityRating & buildNewsfeedHighlight
    │   │   ├── toolkits.ts        # 6 Bộ công cụ & buildCuratedToolkits
    │   │   └── filters.ts         # parseNewsfeedParams, URL & buildNewsfeedData
    │   └── queries/
    │       ├── tools-page-query.ts # Truy vấn DB trang / & /newsfeed
    │       └── logs-query.ts       # Truy vấn DB trang /logs
    ├── components/
    │   ├── AdminSecretModal.tsx
    │   ├── Pagination.tsx
    │   ├── Sidebar.tsx
    │   ├── SidebarContent.tsx
    │   ├── SidebarCategoryTree.tsx
    │   ├── SearchToolbar.tsx
    │   ├── SearchSuggestDropdown.tsx
    │   ├── NewsfeedControls.tsx
    │   ├── NewsfeedItem.tsx
    │   ├── QualityStars.tsx
    │   ├── ToolkitShowcase.tsx
    │   ├── ToolCard.tsx
    │   ├── ToolCardHeader.tsx
    │   ├── ToolCardDetails.tsx
    │   ├── ToolNoteEditor.tsx
    │   └── RelativeTime.tsx
    └── app/
        ├── layout.tsx
        ├── loading.tsx
        ├── error.tsx
        ├── page.tsx
        ├── newsfeed/
        │   ├── page.tsx
        │   └── loading.tsx
        ├── logs/
        │   ├── page.tsx
        │   └── loading.tsx
        └── api/
            ├── cron/
            │   └── sync/
            │       └── route.ts
            ├── admin/
            │   └── session/
            │       └── route.ts
            └── tools/
                ├── suggest/
                │   └── route.ts
                └── [id]/
                    └── route.ts
```

## 3. Thành phần kỹ thuật cốt lõi
- **Database Driver (`src/db/index.ts`, `drizzle.config.ts`):** `sanitizeDatabaseUrl()` xóa `channel_binding` khỏi URL (giữ `sslmode=require`); app dùng HTTP driver `neon()` với `DATABASE_URL`; Drizzle migration ưu tiên `DATABASE_URL_UNPOOLED` (fallback `DATABASE_URL`).
- **Tầng truy vấn & nghiệp vụ tách lớp (`src/lib/`):** Các module lớn được chia nhỏ đơn trách nhiệm vào `src/lib/search/`, `src/lib/newsfeed/`, và truy vấn DB thuần đặt tại `src/lib/queries/` (`tools-page-query.ts`, `logs-query.ts`), duy trì barrel re-export (`src/lib/search-engine.ts`, `src/lib/newsfeed.ts`) để tương thích ngược hoàn toàn.
- **Worker, Distributed Lock & Auto-Pruning (`scripts/load-env.ts`, `scripts/sync-tools.ts`, `scripts/lib/sync/`):** `import "./load-env";` luôn đặt ở dòng đầu tiên của `scripts/sync-tools.ts`; lõi `runSync()` nằm ở `scripts/lib/sync/runner.ts` (không phụ thuộc `dotenv`) để dùng chung giữa CLI worker và Vercel Serverless (`/api/cron/sync`). Khóa chống chạy đè (`lock.ts`) dùng bản ghi lease nguyên tử `sync_logs` (`id = -1`, TTL `SYNC_LOCK_TTL_SECONDS`, ẩn khỏi UI với `id > 0`) phù hợp với Neon HTTP driver phi trạng thái. Cuối mỗi lượt sync, `prune.ts` kiểm tra dung lượng DB (`pg_database_size`), xóa tối đa 1 lô `DB_PRUNE_BATCH_SIZE` repo sao thấp chưa ghim/chưa có ghi chú, giữ sàn `DB_MIN_TOOLS_KEEP`, best-effort `VACUUM (ANALYZE) tools`, dọn `sync_logs` vượt `SYNC_LOGS_MAX_ROWS`, và truyền ngưỡng sao sàn (`minEligibleStars`) để lượt sync không cào lại repo sao thấp khi DB gần đầy.
- **Vercel Cron (`/api/cron/sync`, `vercel.json`):** Route handler bảo vệ bằng `CRON_SECRET` (`Authorization: Bearer`, `crypto.timingSafeEqual`, fail-closed `503`), chạy micro-batch `SYNC_LIMIT <= 5` trong trần `maxDuration = 60`.
- **UI & Custom Hooks (`src/app/`, `src/components/`, `src/hooks/`):** Dark Mode (`bg-zinc-950`, card `bg-zinc-900/60`, `border-zinc-800`, `emerald-400/500`), `export const dynamic = "force-dynamic"`, tách logic client sang custom hooks (`useSearchSuggest.ts`, `useToolMutations.ts`) và subcomponents (`SearchSuggestDropdown.tsx`, `ToolCardHeader.tsx`, `SidebarCategoryTree.tsx`); các `page.tsx` (`/`, `/newsfeed`, `/logs`) chỉ đọc `searchParams`, gọi hàm query và ráp layout.
- **GitHub Actions (`.github/workflows/daily-sync.yml`):** Chạy liên tục mỗi 2 giờ (`cron: "0 */2 * * *"`), tự động kích hoạt ngay sau khi Vercel báo `deployment_status` thành công (`state == 'success'`), và hỗ trợ `workflow_dispatch` (`sync_limit`, `prune_only`) với `concurrency` (`group: github-tool-radar-sync`, `cancel-in-progress: false`), mặc định `SYNC_LIMIT: "12"`, `SYNC_BATCH_SIZE: "5"`.
