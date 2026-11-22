---
trigger: always_on
---

# Quy tắc lõi: Bảo mật, Tech Stack & Chất lượng Code

1. **Khóa cứng Tech Stack:**
   - Chỉ sử dụng Next.js App Router (`--src-dir`, TypeScript, Tailwind CSS, `@/*`), `lucide-react`, Neon PostgreSQL (`@neondatabase/serverless`), Drizzle ORM (`drizzle-orm`, `drizzle-kit`), `zod`, `tsx`, `dotenv`, `vitest`.
   - AI Engine bắt buộc dùng chuẩn OpenAI-compatible (`/chat/completions`) qua 4 provider: `Groq-70B` → `Groq-8B-Fallback` → `GitHub-Models-4o-mini` → `OpenRouter-Free`.
   - **CẤM TUYỆT ĐỐI** cài đặt hoặc thay thế bằng Gemini API, Cerebras, Prisma hay MongoDB.

2. **Zero Mock Data & Hoàn chỉnh 100%:**
   - Mọi dữ liệu UI và API phải đọc/ghi thật từ Neon PostgreSQL. Cấm hardcode dữ liệu giả lập.
   - Cấm để `// TODO`, `FIXME`, stub rỗng hoặc logic dang dở trong bất kỳ tệp nào.

3. **Bảo mật `.env.local` & Secrets:**
   - **TUYỆT ĐỐI KHÔNG** tạo mới, sửa đổi hay ghi đè `.env.local` (chỉ tạo `.env.example` làm mẫu).
   - **TUYỆT ĐỐI KHÔNG** in giá trị API key, token, `DATABASE_URL` hay `ADMIN_SECRET` ra terminal/log và không commit vào Git.
   - Không bao giờ dùng tiền tố `NEXT_PUBLIC_` cho bất kỳ secret/admin key nào.

4. **Phạm vi dữ liệu cố định (`PATCH /api/tools/[id]`):**
   - Chỉ chấp nhận đúng 3 trường: `isPinned`, `userNotes`, `subCategory` (tự động đồng bộ `category` từ `src/config/taxonomy.ts`). Không tự ý thêm `isBookmarked`, `personalNote`, `status`, hay `customTags`.
