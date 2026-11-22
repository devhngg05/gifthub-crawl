# Nhật ký thay đổi (`CHANGELOG.md`)

Tài liệu theo dõi phiên bản và tiến độ triển khai từng module của `github-tool-radar`. Mọi module hoàn thành phải cập nhật tệp này trước khi kết thúc phiên làm việc.

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
- [ ] **Module 1 — Khung xương Next.js & Cấu hình:** `package.json`, `.env.example`, `vitest.config.ts`, `src/config/taxonomy.ts` (7 nhóm / 25 ngách — xong), `src/lib/validator.ts` (`AiClassificationSchema` & PATCH schema — xong), `src/lib/auth.ts` (chưa làm) + unit tests (`taxonomy.test.ts`, `validator.test.ts` — xong)
- [ ] **Module 2 — Tầng Database (Neon + Drizzle):** `drizzle.config.ts`, `src/db/index.ts` (`sanitizeDatabaseUrl`), `src/db/schema.ts` (`tools`, `syncLogs`, B-Tree & 3 GIN indexes) + push schema lên Neon + unit tests
- [ ] **Module 3 — Worker AI & GitHub Sync:** `scripts/load-env.ts`, `scripts/lib/github.ts`, `scripts/lib/classifier.ts`, `scripts/sync-tools.ts` + unit tests + chạy thử đồng bộ thật
- [ ] **Module 4 — API Route:** `src/app/api/tools/[id]/route.ts` (`PATCH` + `ADMIN_SECRET` + `SUB_CATEGORY_MAP` đồng bộ `category`) + unit tests
- [ ] **Module 5 — Giao diện Radar & Nhật ký:** `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/logs/page.tsx`, `src/components/Sidebar.tsx`, `src/components/SearchToolbar.tsx`, `src/components/ToolCard.tsx`, `src/components/RelativeTime.tsx` + kiểm chứng Dark Mode & Hydration
- [ ] **Module 6 — Tự động hóa & Ship:** `.github/workflows/daily-sync.yml`, rà soát lint/typecheck/test/build toàn diện
