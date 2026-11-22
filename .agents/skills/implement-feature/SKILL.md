---
name: implement-feature
description: >-
  Use this skill when implementing any single module or feature in github-tool-radar
  from docs/ specifications through complete code, Vitest unit tests, and CHANGELOG updates.
---

# Implement Feature Skill

Quy trình chuẩn triển khai **đúng 1 module** theo kỷ luật Single Source of Truth.

## Các bước thực hiện bắt buộc

1. **Đọc tài liệu gốc liên quan (`docs/`):**
   - Kiểm tra `docs/PROJECT-RULES.md`, `docs/ARCHITECTURE.md`, `docs/DATA-SCHEMA.md`, `docs/API-CONTRACTS.md`, `docs/PRD.md` và `docs/CHANGELOG.md` để xác định phạm vi module, schema, kiểu dữ liệu và điều kiện biên.
2. **Lập kế hoạch gọn cho đúng 1 module:**
   - Liệt kê các tệp tạo/sửa, dependency cần thiết, điểm chạm DB/API/UI và danh sách test case sẽ kiểm chứng.
   - Không mở rộng phạm vi sang các module khác hoặc thêm field ngoài đặc tả.
3. **Viết code hoàn chỉnh 100%:**
   - Tuân thủ tuyệt đối Tech Stack đã khóa; không dùng mock data ở ứng dụng; không để `// TODO` hoặc placeholder.
   - Áp dụng Zod validation ở ranh giới API/AI/env; không động vào `.env.local` và không in secret ra log.
4. **Viết & chạy Unit Test (`vitest`):**
   - Tạo unit test tương ứng cho logic mới (ví dụ `*.test.ts`), chạy `npx vitest run <test-file>` (hoặc `npm test`) cùng kiểm tra type-check `npx tsc --noEmit`.
   - Với UI/API có thể kiểm chứng thêm bằng Chrome DevTools hoặc request kiểm thử cục bộ khi server chạy.
5. **Cập nhật `docs/CHANGELOG.md`:**
   - Đánh dấu `[x]` mục hoàn thành và ghi tóm tắt thay đổi vào mục phiên bản hiện tại trong `docs/CHANGELOG.md`.
