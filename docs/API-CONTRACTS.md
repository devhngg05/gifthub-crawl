# Hợp đồng API & Tích hợp (`API-CONTRACTS.md`)

## 1. API cá nhân hóa: `PATCH /api/tools/[id]` (`src/app/api/tools/[id]/route.ts`)
- **Xác thực (`src/lib/auth.ts`):**
  - Nếu `ADMIN_SECRET` được khai báo (hoặc `NODE_ENV === 'production'`), bắt buộc kiểm tra header `x-admin-secret` khớp giá trị bằng `crypto.timingSafeEqual` (so sánh SHA-256 digest đồng độ dài). Nếu `production` mà thiếu `ADMIN_SECRET`, trả `503` (fail-closed).
  - Nếu `ADMIN_SECRET` trống ở local dev (`NODE_ENV !== 'production'`), bypass kèm `console.warn`.
  - Phía UI mở Modal nhập Admin Key lưu ở `sessionStorage` và gửi qua header `x-admin-secret` (cấm dùng `NEXT_PUBLIC_*`).
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
- **Mã phản hồi:** `200 OK` (`{ tool }`), `400 Bad Request`, `401 Unauthorized`, `404 Not Found`, `503 Service Unavailable`, `500 Internal Server Error`.

## 2. Bộ kiểm duyệt AI (`src/lib/validator.ts` — `AiClassificationSchema`)
- `summary_vi`: string (10–500 ký tự).
- `category`: ép về `'other'` nếu không thuộc `VALID_CATEGORIES` (7 nhóm).
- `sub_category`: ép về `'uncategorized'` nếu không thuộc `VALID_SUB_CATEGORIES` (25 ngách).
- `secondary_sub_categories`: lọc giữ slug thuộc `VALID_SUB_CATEGORIES`, bỏ trùng lặp, bỏ phần tử trùng `sub_category`, tối đa 2 phần tử.
- `use_cases`: mảng 1–4 cụm từ tiếng Việt dạng "động từ + đối tượng".
- `replaces`: mảng 0–3 tên phần mềm thương mại thay thế.
- `usability`: enum `'app-ready' | 'cli-tool' | 'dev-required'`, `.catch('dev-required')`.

## 3. GitHub Search & README (`scripts/lib/github.ts`)
- **Headers:** `Accept: application/vnd.github+json`, `Authorization: Bearer ${process.env.GITHUB_TOKEN}`, `X-GitHub-Api-Version: 2022-11-28`.
- **2 luồng Search song song:**
  1. **Trụ cột:** `stars:>1500 pushed:>[6 tháng trước] archived:false`
  2. **Mới nổi:** `stars:>500 created:>[30 ngày trước] archived:false`
- **Gộp & Quality Gate:** Khử trùng theo `repo.id`; loại bỏ repo thiếu `description`, `archived === true`, hoặc `topics` chứa: `awesome`, `awesome-list`, `roadmap`, `books`, `interview-questions`, `tutorial`, `cheatsheet`.
- **`fetchCleanReadme(fullName)`:** Tải `/repos/{fullName}/readme`, giải mã base64, dùng Regex xóa thẻ HTML, ảnh Markdown, badges, rút gọn khoảng trắng, cắt tối đa **2.500 ký tự đầu**, trả `{ sha, text }`.

## 4. AI Multi-Provider Fallback (`scripts/lib/classifier.ts`)
- Lọc mảng `PROVIDERS` bỏ provider thiếu API key trong env; gọi `${baseUrl}/chat/completions` với `temperature: 0.2`, `max_tokens: 4096` (>= 2048 cho model reasoning):
  1. `Groq-120B`: `https://api.groq.com/openai/v1` | `openai/gpt-oss-120b` | `GROQ_API_KEY` (có `response_format: { type: "json_object" }`, tự retry bỏ tham số này nếu HTTP `400`)
  2. `Groq-Qwen-27B`: `https://api.groq.com/openai/v1` | `qwen/qwen3.8-27b` | `GROQ_API_KEY` (có `response_format: { type: "json_object" }`, tự retry bỏ tham số này nếu HTTP `400`)
  3. `Groq-20B-Fast`: `https://api.groq.com/openai/v1` | `openai/gpt-oss-20b` | `GROQ_API_KEY` (có `response_format: { type: "json_object" }`, tự retry bỏ tham số này nếu HTTP `400`)
  4. `OpenRouter-Free`: `https://openrouter.ai/api/v1` | `google/gemma-4-31b-it:free` | `OPENROUTER_API_KEY` (không gửi `response_format` để tương thích free router)
- Fallback sang provider kế tiếp khi gặp HTTP non-2xx (kèm log `endpointUrl` + body lỗi đã sanitize tối đa 200 ký tự), lỗi mạng hoặc JSON lỗi; lọc `<think>...</think>`, gỡ markdown code fence và bóc JSON object trước `JSON.parse` + `AiClassificationSchema`.
- Luôn tóm tắt tiếng Việt tự nhiên (giữ nguyên tên công nghệ/thuật ngữ tiếng Anh). Nếu cả 4 provider lỗi → bỏ qua không upsert repo vào `tools`.
