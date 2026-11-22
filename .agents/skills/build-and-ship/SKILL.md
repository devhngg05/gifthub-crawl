---
name: build-and-ship
description: >-
  Use this skill before committing or shipping changes in github-tool-radar to run lint,
  type-check, unit tests, production build, security hygiene checks, and draft a commit message.
---

# Build and Ship Skill

Quy trình kiểm định chất lượng và an toàn trước khi chốt commit hoặc đẩy mã nguồn.

## Các bước thực hiện bắt buộc

1. **Chạy toàn bộ cổng kiểm tra kỹ thuật:**
   - Lint: `npm run lint`
   - Type-check: `npx tsc --noEmit`
   - Unit Tests: `npm test` (Vitest)
   - Production Build: `npm run build`
   - Dừng và sửa triệt để nếu bất kỳ lệnh nào thất bại (cấm bỏ qua kiểm tra).
2. **Rà soát vệ sinh mã nguồn & bảo mật:**
   - Chạy `git status` và `git diff` để xác minh **không** có `.env.local`, `.agents/mcp_config.json`, API key hay chuỗi kết nối DB nằm trong vùng tracked/staged.
   - Tìm kiểm tra không còn `// TODO`, mock data hay `console.log` gỡ lỗi thừa trong `src/`.
3. **Kiểm tra đồng bộ tài liệu:**
   - Xác nhận `docs/CHANGELOG.md` đã ghi nhận đủ thay đổi của module vừa hoàn thành.
4. **Đề xuất Commit Message chuẩn:**
   - Trình bày kết quả từng bước kiểm tra (pass/fail) và đề xuất commit message theo chuẩn Conventional Commits (ví dụ: `feat(db): add Drizzle schema with GIN indexes and URL sanitizer`). Chỉ chạy `git commit` khi người dùng yêu cầu.
