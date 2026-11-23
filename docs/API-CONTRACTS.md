# Hợp đồng API & Tích hợp (`API-CONTRACTS.md`)

## 1. API cá nhân hóa: `PATCH /api/tools/[id]` (`src/app/api/tools/[id]/route.ts`)
- **Xác thực & Chống CSRF (`src/lib/auth.ts`):**
  - Chặn CSRF cho các method thay đổi dữ liệu (`POST`/`PATCH`/`DELETE`/`PUT`) bằng kiểm tra `Sec-Fetch-Site` và đối chiếu host của `Origin`/`Referer` với host đích (`403` nếu khác nguồn).
  - **Fail-closed mặc định:** Nếu thiếu `ADMIN_SECRET`, từ chối với `503 Service Unavailable` ở mọi môi trường. Chỉ cho phép bypass ở local khi đồng thời `NODE_ENV !== 'production'` **và** `ALLOW_DEV_ADMIN_BYPASS === 'true'` (chỉ ghi `console.warn` đúng 1 lần duy nhất).
  - Phía trình duyệt xác thực hoàn toàn qua cookie phiên `HttpOnly` (`gtr_admin_session`, `SameSite=Lax`, `Path=/`, `Secure` khi `production`) được ký stateless bằng HMAC-SHA256 từ khóa dẫn xuất của `ADMIN_SECRET` (có trường `exp` hết hạn, kiểm tra chữ ký qua `crypto.timingSafeEqual`).
  - Trình duyệt **không** lưu secret vào `sessionStorage`/`localStorage` và **không** gửi header `x-admin-secret`; server chỉ giữ fallback `x-admin-secret` có kiểm soát cho script nội bộ.
- **Validation (`src/lib/validator.ts`):**
  - Path param `id`: `z.coerce.number().int().positive()` (sai → `400`).
  - Body schema (`.strict()`, tối thiểu 1 trường):
    ```ts
    z.object({
      isPinned: z.boolean().optional(),
      userNotes: z.string().max(2000).nullable().optional(),
      subCategory: z.enum(VALID_SUB_CATEGORIES).optional(),
    }).strict().refine((d) => Object.keys(d).length > 0)
    ```
  - Khi cập nhật `subCategory`, server tự động đồng bộ `category` tương ứng từ `TAXONOMY` trong `src/config/taxonomy.ts` và cập nhật `updatedAt`.
- **Mã phản hồi:** `200 OK` (`{ tool }`), `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `503 Service Unavailable`, `500 Internal Server Error`.

## 2. Bộ kiểm duyệt AI (`src/lib/validator.ts` — `AiClassificationSchema`)
- `summary_vi`: string (10–500 ký tự).
- `category`: tự động đồng bộ từ `SUB_CATEGORY_MAP[sub_category].category` khi `sub_category` hợp lệ (khác `'uncategorized'`); nếu `'uncategorized'` thì giữ `category` hợp lệ trong `VALID_CATEGORIES` (10 nhóm) hoặc ép `'other'`.
- `sub_category`: ép về `'uncategorized'` nếu không thuộc `VALID_SUB_CATEGORIES` (43 ngách, bảo toàn 100% 25 ngách cũ).
- `secondary_sub_categories`: lọc giữ slug thuộc `VALID_SUB_CATEGORIES`, bỏ trùng lặp, bỏ phần tử trùng `sub_category`, tối đa 2 phần tử.
- `use_cases`: mảng 1–4 cụm từ tiếng Việt dạng "động từ + đối tượng".
- `replaces`: mảng 0–3 tên phần mềm thương mại thay thế.
- `usability`: enum `'app-ready' | 'cli-tool' | 'dev-required'`, `.catch('dev-required')`.

## 3. GitHub Search, Metadata & README (`scripts/lib/github.ts`)
- **Headers:** `Accept: application/vnd.github+json`, `Authorization: Bearer ${process.env.GITHUB_TOKEN}`, `X-GitHub-Api-Version: 2022-11-28`.
- **24 luồng Search phân trang (`per_page=100`, `page=1..3`, giãn cách tuần tự `2500ms`/request, `GITHUB_STREAM_MODE=rotate` mặc định chạy 5 luồng lõi + 7 luồng chủ đề xoay vòng theo khung 6h UTC; `GITHUB_STREAM_MODE=all` chạy đủ 24 luồng):**
  1. **5 luồng lõi (`pushed:>[12 tháng trước]` / `rising` `60 ngày`, `archived:false`):**
     - `pillarTop` (`stars:>10000`), `pillarMid` (`stars:3000..10000`), `pillarBase` (`stars:1000..3000`), `pillarLow` (`stars:500..1500`), `rising` (`stars:>300 created:>[60 ngày]`).
  2. **19 luồng chủ đề thực dụng (`archived:false`):** `cli`, `self-hosted`, `developer-tools`, `ai-agent`, `database`, `security`, `privacy`, `productivity`, `automation`, `monitoring`, `networking`, `media`, `desktop-app`, `mcp`, `local-llm`, `docker`, `analytics`, `note-taking`, `open-source-alternative`.
- **Gộp & Quality Gate:** Dừng phân trang sớm khi trang trả về `< per_page` item; gộp round-robin interleaving, khử trùng theo `repo.id`; giữ nguyên Quality Gate chặn repo thiếu `description`, `archived === true`, hoặc `topics` rác.
- **`fetchRepoMetadata(fullName)`:** Tải `/repos/{owner}/{repo}` (kèm `homepage`, `topics`, `description`, `language`) phục vụ đồng bộ và `SYNC_RECLASSIFY`.
- **`fetchCleanReadme(fullName)` & `cleanReadmeText()`:** Giải mã base64, lọc bỏ HTML comments, `<script>`/`<style>`/`<svg>`/`<picture>`/`<video>`/`<audio>`, badges, ảnh Markdown, thanh liên kết đa ngôn ngữ, mục lục (Table of Contents), và ưu tiên giữ Intro + Features + Installation/Usage trước khi cắt tối đa **2.500 ký tự**.

## 4. AI Multi-Provider Fallback, Batch & Reclassify (`scripts/lib/classifier.ts`, `scripts/sync-tools.ts`)
- Truyền đầy đủ ngữ cảnh repo (`fullName`, `description`, `homepage`, `language`, `topics`, README sạch) cùng luật phân loại nghiêm ngặt (không gán bừa `ai-coding-agent`, phân biệt rõ `security-vault` vs `security-privacy`, ranh giới `usability`, hạn chế `uncategorized`).
- Hỗ trợ cả phân loại lẻ `classifyRepo()` (`DEFAULT_TIMEOUT_MS = 25_000`) và phân loại lô `classifyRepoBatch()` (`DEFAULT_BATCH_TIMEOUT_MS = 45_000`, fallback lẻ cho từng repo thiếu nếu batch trả thiếu phần tử).
- Worker `scripts/sync-tools.ts` hỗ trợ `SYNC_RECLASSIFY=none|uncategorized|all` và `SYNC_BATCH_SIZE` (mặc định `5`, tối đa `20`), tải metadata + README song song nhẹ (`RECLASSIFY_FETCH_CONCURRENCY = 5`) và chỉ cập nhật 9 trường AI (`category`, `subCategory`, `secondarySubCategories`, `usability`, `summaryVi`, `useCases`, `replaces`, `readmeSha`, `updatedAt`) — bảo toàn tuyệt đối `isPinned` và `userNotes`.
- Nén kích thước request AI: dùng `TAXONOMY_COMPACT_GUIDE` (10 nhóm / 43 ngách dạng `slug: từ khóa cốt lõi`), giới hạn README tối đa **`1.200` ký tự** cho phân loại lẻ và **`600` ký tự/repo** cho `classifyRepoBatch()`.
- Lọc mảng `PROVIDERS` bỏ provider thiếu API key trong env; gọi `${baseUrl}/chat/completions` với `temperature: 0.2`, `AbortSignal.timeout(25_000)` cho phân loại lẻ (`DEFAULT_BATCH_TIMEOUT_MS = 45_000` cho batch):
  1. `Gemini-3.5-Flash-Lite`: `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-3.5-flash-lite` | `GEMINI_API_KEY` (`max_tokens: 2048` lẻ / `4096` batch)
  2. `Gemini-3.1-Flash-Lite`: `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-3.1-flash-lite` | `GEMINI_API_KEY` (`max_tokens: 2048` lẻ / `4096` batch)
  3. `Groq-120B`: `https://api.groq.com/openai/v1` | `openai/gpt-oss-120b` | `GROQ_API_KEY`
  4. `Groq-20B-Fast`: `https://api.groq.com/openai/v1` | `openai/gpt-oss-20b` | `GROQ_API_KEY`
  5. `Groq-Qwen-27B`: `https://api.groq.com/openai/v1` | `qwen/qwen3.8-27b` | `GROQ_API_KEY` (`max_tokens: 750`)
  6. `Gemini-3.5-Flash`: `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-3.5-flash` | `GEMINI_API_KEY` (`max_tokens: 2048` lẻ / `4096` batch)
  7. `Gemini-3.6-Flash`: `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-3.6-flash` | `GEMINI_API_KEY` (`max_tokens: 2048` lẻ / `4096` batch)
  8. `Gemini-3.8-Flash`: `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-3.8-flash` | `GEMINI_API_KEY` (`max_tokens: 2048` lẻ / `4096` batch)
  9. `OpenRouter-Free`: `https://openrouter.ai/api/v1` | `google/gemma-4-31b-it:free` | `OPENROUTER_API_KEY` (không gửi `response_format`)
  10. `OpenRouter-Free-Backup`: `https://openrouter.ai/api/v1` | `google/gemma-4-26b-a4b-it:free` | `OPENROUTER_API_KEY` (không gửi `response_format`)
- **Cooldown & Retry thông minh:**
  - Provider gặp `TimeoutError` / `AbortError` nghỉ `180_000 ms` (3 phút).
  - Provider gặp lỗi server `5xx` (`500..599`) nghỉ `120_000 ms` (2 phút) lần đầu và tăng lên `300_000 ms` (5 phút) từ lần liên tiếp thứ 2+.
  - Provider gặp `HTTP 429` nghỉ `60_000 ms` (hoặc theo `Retry-After`, tối đa `90_000 ms`), tăng lên `1_800_000 ms` (30 phút) khi lỗi hết quota ngày lặp lại 2 lần liên tiếp. Mọi bộ đếm lỗi tự reset về `0` khi gọi thành công `200 OK`.
  - **Không retry ngay** vào provider vừa `429`: kết thúc vòng 1, nếu các provider đang cooldown có `minRemainingMs <= 65_000 ms`, chờ `minRemainingMs + 1000 ms` rồi thử lại tối đa **2 vòng chờ/repo** trước khi báo `All AI providers failed`.
- Fallback sang provider kế tiếp khi gặp HTTP non-2xx (kèm log `endpointUrl` + body lỗi đã sanitize tối đa 200 ký tự), lỗi mạng/timeout, `finish_reason: "length"` làm đứt JSON hoặc JSON/schema lỗi; lọc `<think>...</think>`, gỡ markdown code fence và bóc JSON object trước `JSON.parse` + `AiClassificationSchema`.
- Luôn tóm tắt tiếng Việt tự nhiên (giữ nguyên tên công nghệ/thuật ngữ tiếng Anh). Nếu cả 10 provider lỗi → bỏ qua không upsert repo vào `tools`.

## 5. API Gợi ý Tìm kiếm: `GET /api/tools/suggest` (`src/app/api/tools/suggest/route.ts`)
- **Validation:** Query param `q` validate qua Zod (`z.string().trim().max(120)` — vượt quá 120 ký tự trả `400`).
- **Ngưỡng ngắn:** Nếu `q.length < 2` hoặc rỗng sau chuẩn hóa, trả ngay `200 OK` `{ tools: [], categories: [] }` không truy vấn DB.
- **Kết quả trả về (`200 OK`):**
  - `categories`: tối đa **3** ngách gợi ý suy luận từ từ điển đồng nghĩa song ngữ `parseSearchQuery(q)` (`{ slug, label, categoryLabel }`).
  - `tools`: tối đa **6** công cụ khớp nhất theo Tầng 1 (tự fallback Tầng 2 nếu Tầng 1 = 0, hỗ trợ chịu lỗi nếu DB chưa bật `pg_trgm`) sắp theo `buildSearchRelevanceScore DESC, stars DESC, id DESC` (`{ id, name, fullName, summaryVi, subCategory, stars, usability }`).
- **Backfill & `pg_trgm` (`scripts/backfill-search-text.ts`):** Chạy thủ công để bật `pg_trgm`, tạo `tools_search_text_trgm_idx` và cập nhật `search_text` cho toàn bộ công cụ đang có trong DB.

## 6. API Phiên Quản trị: `/api/admin/session` (`src/app/api/admin/session/route.ts`)
- **Header chung:** Luôn trả về `Cache-Control: no-store` và tuyệt đối không lộ `ADMIN_SECRET`.
- **`GET /api/admin/session`:** Trả về `200 OK` với `{ authenticated: boolean, authRequired: boolean }`.
- **`POST /api/admin/session`:**
  - Kiểm tra CSRF cùng nguồn (`Origin`/`Referer`/`Sec-Fetch-Site`, sai → `403`).
  - Giới hạn brute-force theo IP (`429 Too Many Requests` + header `Retry-After` sau 5 lần sai trong cửa sổ 15 phút; kèm làm chậm nhẹ 250ms khi sai ngoài môi trường `test`).
  - Validate body `{ secret: string }` (Zod `.strict()`, trim `1..512` ký tự, sai → `400`), kiểm tra `ADMIN_SECRET` qua SHA-256 + `crypto.timingSafeEqual` (`401` nếu sai, `503` nếu thiếu `ADMIN_SECRET` và không bật bypass).
  - Nếu hợp lệ: cấp cookie `gtr_admin_session` (`HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` khi `NODE_ENV === 'production'`, `Max-Age=43200`) và trả về `200 OK` `{ authenticated: true, authRequired: true }` (hoặc `authRequired: false` khi bypass dev đang bật).
- **`DELETE /api/admin/session`:** Kiểm tra CSRF (`403` nếu sai nguồn), xóa cookie `gtr_admin_session` (`Max-Age=0`) và trả về `200 OK` `{ authenticated: false }`.

## 7. API Vercel Cron Micro-Batch Sync: `GET | POST /api/cron/sync` (`src/app/api/cron/sync/route.ts`)
- **Cấu hình Runtime & Cache:** `export const dynamic = "force-dynamic"`, `export const maxDuration = 60`, mọi phản hồi kèm `Cache-Control: no-store`.
- **Xác thực (`src/lib/auth.ts` — `verifyCronRequest`):**
  - Bắt buộc header `Authorization: Bearer <CRON_SECRET>`, đối chiếu digest SHA-256 bằng `crypto.timingSafeEqual`.
  - **Fail-closed tuyệt đối:** Thiếu `CRON_SECRET` trả `503 Service Unavailable`; thiếu/sai định dạng/sai token trả `401 Unauthorized`.
- **Cấu hình Micro-Batch (`scripts/lib/sync/cron-config.ts`):**
  - Ép trần `SYNC_LIMIT` trong khoảng `1..5` (`CRON_MAX_SYNC_LIMIT = 5`), `SYNC_BATCH_SIZE = 5`, `SYNC_DELAY_MS = 0`, `SYNC_RECLASSIFY = "none"`, `maxCooldownWaitMs = 5_000`, `aiTimeoutMs = 20_000`, `lockTtlSeconds = 120`, `lockOwner = "vercel-cron"`.
  - Giới hạn lấy ứng viên nhẹ nhàng gồm 2 luồng (`rising` + 1 luồng xoay vòng theo giờ UTC), `pagesPerQuery = 1`, `perPage = 50`, `requestDelayMs = 300`, `timeoutMs = 10_000` để hoàn tất gọn dưới 60 giây trên Vercel Serverless.
- **Mã phản hồi:**
  - `200 OK`: `{ ok: true, skipped: false, summary }` hoặc `{ ok: true, skipped: true, reason: "lock_held", summary }` khi đã có worker khác giữ khóa phân tán.
  - `401 Unauthorized`, `503 Service Unavailable`, `500 Internal Server Error` (`{ ok: false, error: "Sync execution failed" }`, log server đã sanitize).
