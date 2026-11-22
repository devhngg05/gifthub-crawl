# AGENTS.md — Điều phối dự án `github-tool-radar`

Bạn đang làm việc trên dự án Full-Stack Production **`github-tool-radar`** (Next.js App Router, Neon PostgreSQL, Drizzle ORM, OpenAI-compatible AI Pipeline, Vitest).

## Nguồn chân lý bắt buộc (Single Source of Truth)

Mọi thiết kế, schema, API contract và quy chuẩn code được nhúng trực tiếp từ `docs/`:

@[Project Rules](docs/PROJECT-RULES.md)

@docs/ARCHITECTURE.md

@docs/DATA-SCHEMA.md

@docs/API-CONTRACTS.md

## Tài liệu tham chiếu bổ sung (đọc khi cần ngữ cảnh sản phẩm & tiến độ)
- Yêu cầu sản phẩm, Taxonomy & Out of Scope: `docs/PRD.md`
- Nhật ký thay đổi & checklist tiến độ module: `docs/CHANGELOG.md`

## Bộ kỹ năng (Agent Skills trong `.agents/skills/`)
- `implement-feature`: Đọc `docs/` liên quan → lập plan cho đúng 1 module → code hoàn chỉnh 100% → chạy unit test Vitest → cập nhật `docs/CHANGELOG.md`.
- `debug`: Phân tích nguyên nhân gốc rễ (Root Cause Analysis) từ log / `sync_logs` / test / Chrome DevTools trước khi sửa.
- `explain-code`: Giải thích luồng dữ liệu, câu truy vấn SQL/Drizzle và ranh giới bảo mật của module.
- `build-and-ship`: Chạy lint, type-check, `npm test`, `npm run build`, rà soát không lộ secret/`console.log` rác và đề xuất commit message.
