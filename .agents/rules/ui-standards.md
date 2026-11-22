---
trigger: glob
globs: "src/app/**,src/components/**"
---

# Quy chuẩn Giao diện & App Router (`ui-standards`)

1. **Ngôn ngữ & Giao diện Dark Mode:**
   - Bảng màu chuẩn: `bg-zinc-950`, card `bg-zinc-900/60`, viền `border-zinc-800`, điểm nhấn `emerald-400/500`, hỗ trợ responsive mobile (drawer menu / sidebar gọn). Icon dùng `lucide-react`.
   - Giao diện và `summaryVi`, `useCases` hiển thị bằng **tiếng Việt**; tên công nghệ, ngôn ngữ lập trình và `replaces` giữ nguyên.

2. **Server Components & Truy vấn thật:**
   - `src/app/page.tsx` và `src/app/logs/page.tsx` phải khai báo `export const dynamic = "force-dynamic"`, truy vấn trực tiếp Neon qua Drizzle ORM (không mock data).
   - Truy vấn lọc `sub` trên `page.tsx`: quét `subCategory = sub OR sub = ANY(secondarySubCategories)`, ưu tiên nhãn chính lên trên, sau đó `isPinned DESC, stars DESC`.
   - Tìm kiếm `q`: quét `ILIKE` trên `name`, `fullName`, `summaryVi`, `useCases` và `replaces`.

3. **Sidebar, SearchToolbar & URL Query Params:**
   - Đồng bộ toàn bộ bộ lọc (`q`, `sub`, `level`, `sort`, `pinned`) qua URL Query Params.
   - `Sidebar.tsx` hiển thị 2 tầng (7 nhóm lớn / 25 ngách con kèm tổng số lượng đếm cả nhãn chính lẫn phụ), "Tất cả công cụ", "Đã ghim (Pinned)", "Chưa phân loại (`uncategorized`)" và link `/logs`.
   - `SearchToolbar.tsx` hỗ trợ phím tắt `Ctrl + K` (hoặc `/`), lọc `usability` (`app-ready`, `cli-tool`, `dev-required`) và sắp xếp (`stars` / mới cập nhật).

4. **ToolCard & Chống Hydration Mismatch:**
   - `ToolCard.tsx` hiển thị tên repo (mở tab mới), `stars`, `language`, `<RelativeTime />` (SSR render `YYYY-MM-DD`, sau mount `useEffect` đổi sang thời gian tương đối tiếng Việt), `summaryVi`, thẻ `useCases`, nhãn `Thay thế: ...`, badge `usability` phân biệt màu, nút **Ghim yêu thích** và ô **Ghi chú cá nhân**.
   - Khi gọi `PATCH /api/tools/[id]` (chỉ 3 field `isPinned`, `userNotes`, `subCategory`), nếu cần/nhận `401`, mở Modal nhập Admin Key lưu ở `sessionStorage` và gửi qua header `x-admin-secret`.
