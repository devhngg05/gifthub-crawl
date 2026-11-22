# Quy chuẩn dự án (`PROJECT-RULES.md`)

Mọi mã nguồn và quy trình phát triển của `github-tool-radar` phải tuân thủ tuyệt đối các quy tắc sau (Single Source of Truth):

## 1. Khóa cứng Tech Stack
- **Web Framework:** Next.js App Router (`--src-dir`, TypeScript, Tailwind CSS, alias `@/*`), icon `lucide-react`.
- **Database:** Neon PostgreSQL qua `@neondatabase/serverless` và Drizzle ORM (`drizzle-orm`, `drizzle-kit`).
- **Validation, Worker & Test:** `zod`, `tsx`, `dotenv`, `vitest`.
- **AI Engine:** Chỉ dùng chuẩn OpenAI-compatible (`/chat/completions`) qua 4 provider: `Groq-70B` → `Groq-8B-Fallback` → `GitHub-Models-4o-mini` → `OpenRouter-Free`.
- **Cấm tuyệt đối:** Không cài đặt hoặc thay thế bằng Gemini API, Cerebras, Prisma hay MongoDB.

## 2. Chất lượng mã nguồn & Zero Mock Data
- **Zero Mock Data:** Mọi màn hình (`/` và `/logs`) đọc dữ liệu thật từ Neon PostgreSQL. Không tạo mảng dữ liệu giả lập hay fallback mock UI.
- **Hoàn chỉnh 100%:** Nghiêm cấm để `// TODO`, `FIXME`, stub rỗng hoặc logic chưa hoàn thiện trong bất kỳ file nào.
- **Validation ở mọi ranh giới:** Mọi request API, phản hồi AI JSON và biến môi trường quan trọng phải được validate bằng `zod`.
- **Kiểm thử bắt buộc:** Mọi logic cốt lõi (`taxonomy`, `validator`, `auth`, `sanitizeDatabaseUrl`, `classifier` parsing, `github` query builder, API route) phải có unit test chạy qua `vitest` (mock HTTP/DB ở tầng test, không mock dữ liệu ứng dụng).

## 3. Bảo mật tuyệt đối
- **Bảo vệ `.env.local`:** Tệp `.env.local` do người dùng tự quản lý ở thư mục gốc. **TUYỆT ĐỐI KHÔNG** tạo mới/ghi đè `.env.local`, không in giá trị secret (`DATABASE_URL`, `GROQ_API_KEY`, `GITHUB_TOKEN`, `OPENROUTER_API_KEY`, `ADMIN_SECRET`) ra stdout/terminal/log và không commit lên Git. Chỉ duy trì `.env.example` làm mẫu không chứa secret thật.
- **Không lộ secret ở Client Bundle:** Không dùng tiền tố `NEXT_PUBLIC_` cho bất kỳ secret/key nào. Admin Key được người dùng nhập qua Modal lưu ở `sessionStorage` và gửi qua header `x-admin-secret`.
- **So sánh an toàn:** `ADMIN_SECRET` luôn được kiểm tra bằng `crypto.timingSafeEqual`; môi trường `production` bắt buộc fail-closed nếu thiếu `ADMIN_SECRET`.

## 4. Xử lý lỗi & Độ tin cậy
- Worker `scripts/sync-tools.ts` phải bọc `try/catch` cho từng repository (per-repo isolation) để một repo lỗi không làm sập toàn bộ batch; kết quả luôn được ghi nhận đầy đủ vào `sync_logs`.
- Không sử dụng `console.log` gỡ lỗi bừa bãi trong production code; chỉ log cấu trúc rõ ràng trong worker và `console.warn` / `console.error` có kiểm soát ở server khi cần thiết (không kèm secret).
