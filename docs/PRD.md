# PRD — `github-tool-radar`

## 1. Tuyên ngôn sản phẩm
`github-tool-radar` là ứng dụng web cá nhân Full-Stack giúp tự động thu thập, kiểm duyệt, phân loại bằng AI và lưu trữ các công cụ mã nguồn mở nổi bật trên GitHub (cả trụ cột lâu năm lẫn công cụ mới nổi), tối ưu cho việc tra cứu nhanh, ghim yêu thích và ghi chú theo nhu cầu kỹ thuật hàng ngày.

## 2. Tính năng MVP
1. **Radar Dashboard (`/`):**
   - Giao diện Dark Mode (`bg-zinc-950`, card `bg-zinc-900/60`, `border-zinc-800`, điểm nhấn `emerald-400/500`), hỗ trợ responsive mobile (drawer menu / sidebar gọn).
   - Server Component (`export const dynamic = "force-dynamic"`) đọc `searchParams` (`q`, `sub`, `level`, `sort`, `pinned`).
   - **Sidebar 2 tầng (`Sidebar.tsx`):** 7 nhóm lớn và 25 ngách con kèm số lượng công cụ hiện có ở từng ngách (đếm cả nhãn chính `subCategory` lẫn nhãn phụ `secondarySubCategories`), mục "Tất cả công cụ", "Đã ghim (Pinned)", "Chưa phân loại (`uncategorized`)" và link `/logs`.
   - **Thanh công cụ (`SearchToolbar.tsx`):** Ô tìm kiếm hỗ trợ phím tắt `Ctrl + K` (hoặc `/`), bộ lọc `usability` (`app-ready`, `cli-tool`, `dev-required`), sắp xếp (`stars` / mới cập nhật), đồng bộ toàn bộ lên URL Query Params.
   - **Thẻ công cụ (`ToolCard.tsx`):** Hiển thị tên repo (mở tab mới), số Star, ngôn ngữ, thời gian cập nhật tương đối bằng Client Component `<RelativeTime />` (SSR render `YYYY-MM-DD`, sau mount chuyển sang dạng tương đối tiếng Việt tránh Hydration Mismatch), `summaryVi`, các thẻ `useCases`, nhãn `Thay thế: ...` (nếu có), badge `usability` phân biệt màu, nút **Ghim yêu thích** và ô **Ghi chú cá nhân**.
2. **API cá nhân hóa (`PATCH /api/tools/[id]`):**
   - Chỉ cập nhật đúng 3 trường: `isPinned`, `userNotes`, hoặc chỉnh tay `subCategory` (đồng bộ `category` tương ứng).
   - Khi bật `ADMIN_SECRET`, UI mở Modal nhập Admin Key lưu ở `sessionStorage` và gửi qua header `x-admin-secret`.
3. **Worker đồng bộ (`scripts/sync-tools.ts` + GitHub Actions):**
   - Chạy song song 2 luồng tìm kiếm GitHub: Trụ cột (`stars:>1500 pushed:>[6 tháng trước] archived:false`) và Mới nổi (`stars:>500 created:>[30 ngày trước] archived:false`), qua Quality Gate và làm sạch README tối đa **2.500 ký tự đầu**.
   - Giới hạn phân loại AI theo `SYNC_LIMIT` (mặc định `20`; `workflow_dispatch` mặc định `"25"`).
   - Idempotency theo `readmeSha`, bảo toàn `isPinned` và `userNotes` khi UPSERT, bỏ qua không upsert vào `tools` nếu cả 4 AI provider đều thất bại.
4. **Trang giám sát (`/logs`):**
   - Hiển thị thống kê tổng quan (tổng số công cụ, số lượng `uncategorized`, lần đồng bộ gần nhất) và bảng lịch sử từ `sync_logs`.

## 3. Bộ danh mục gốc — Single Source of Truth (`src/config/taxonomy.ts`)
Định nghĩa chính xác **7 nhóm lớn (`category`)** và **25 ngách chuyên sâu (`sub_category`)** kèm nhãn tiếng Việt và `hint` chi tiết. Export đầy đủ: `TAXONOMY`, `VALID_CATEGORIES`, `VALID_SUB_CATEGORIES`, `SUB_CATEGORY_MAP`, và `TAXONOMY_PROMPT_GUIDE`.

1. **`api-integration` (API & Tích hợp):**
   - `api-client-testing`: **Test & Debug API** — `REST/GraphQL/gRPC client, thay Postman/Insomnia`
   - `api-gateway-webhook`: **Nối API & Webhook** — `bắt webhook, tunneling localhost, proxy, thay ngrok`
   - `api-mock-docs`: **Mock Server & Docs** — `giả lập API, tự sinh tài liệu OpenAPI/Swagger`
   - `auth-payment`: **Auth & Thanh toán** — `OAuth, JWT, đăng nhập, cổng thanh toán`
2. **`automation-scraping` (Tự động hóa & Cào dữ liệu):**
   - `workflow-orchestration`: **Luồng Workflow** — `nối nhiều app/API kiểu n8n, Zapier`
   - `web-scraping-browser`: **Cào Web & Trình duyệt** — `crawler, browser automation, vượt anti-bot`
   - `chat-bot-notify`: **Bot & Thông báo** — `bot Telegram/Discord, đẩy thông báo tự động`
   - `desktop-rpa`: **Tự động hóa Desktop** — `macro chuột/phím, lập lịch tác vụ máy tính`
3. **`dev-engineering` (Phát triển Phần mềm):**
   - `ui-components-viz`: **UI, Icon & Biểu đồ** — `component UI, animation, vẽ sơ đồ/chart`
   - `database-orm`: **Database & ORM** — `quản trị DB, ORM, cache, đồng bộ dữ liệu`
   - `cli-dev-env`: **CLI & Môi trường Dev** — `terminal, Git, quản lý file .env`
   - `testing-monitoring`: **Test & Giám sát** — `test tự động, log viewer, đo hiệu năng`
4. **`ai-llm` (AI & Xử lý Tri thức):**
   - `local-llm-gateway`: **AI Local & Gateway** — `chạy LLM offline, gom nhiều API AI về 1 đầu mối`
   - `ai-coding-agent`: **AI Agent & Hỗ trợ Code** — `trợ lý lập trình, agent tự thực thi tác vụ`
   - `rag-ocr-extract`: **OCR & Bóc tách dữ liệu** — `đọc PDF/ảnh, OCR, kho tri thức RAG`
   - `ai-voice-vision`: **Giọng nói & Thị giác** — `STT, TTS, xử lý ảnh/video bằng AI`
5. **`media-docs` (Xử lý Media & Tài liệu):**
   - `video-audio-tools`: **Video & Âm thanh** — `tải video/nhạc, cắt ghép, nén, phụ đề`
   - `image-svg-tools`: **Ảnh & SVG** — `xóa nền, nén ảnh hàng loạt, tối ưu SVG`
   - `document-converter`: **Chuyển đổi Tài liệu** — `PDF, Word, Excel, Markdown, tạo Slide`
6. **`infra-security` (Hạ tầng, Mạng & Bảo mật):**
   - `self-host-deploy`: **Self-host & Deploy** — `deploy Docker/VPS tự động, thay Vercel/Heroku`
   - `network-proxy-vpn`: **Mạng, Proxy & VPN** — `VPN, proxy, DNS, đo kiểm mạng`
   - `security-vault`: **Bảo mật & Mật khẩu** — `quản lý mật khẩu, mã hóa, quét lỗ hổng`
7. **`productivity-os` (Năng suất & Tiện ích Máy):**
   - `pkm-study-notes`: **Ghi chú & Học tập** — `note, flashcard, quản lý công việc`
   - `os-desktop-utility`: **Tiện ích Hệ điều hành** — `quản lý cửa sổ, clipboard, launcher`
   - `file-sync-share`: **Đồng bộ & Truyền file** — `gửi file đa thiết bị, backup dữ liệu`

## 4. Phạm vi loại trừ (Out of Scope cho MVP)
- Không đăng nhập đa người dùng, OAuth hay phân quyền RBAC phức tạp.
- Không bổ sung trường ngoài đặc tả (`isBookmarked`, `personalNote`, `status`, `customTags`).
- Không dùng mock data/seed giả lập; không crawl nguồn ngoài GitHub API.
- Không cài đặt hoặc thay thế bằng Gemini API, Cerebras, Prisma hay MongoDB.
