---
name: explain-code
description: >-
  Use this skill when the user asks how a module, data pipeline, SQL/Drizzle query,
  API route, or UI component works in github-tool-radar.
---

# Explain Code Skill

Quy trình giải thích mạch lạc kiến trúc, luồng dữ liệu và quyết định thiết kế dựa trên mã nguồn thực tế.

## Các bước thực hiện

1. **Đọc mã nguồn & tài liệu đối chiếu:**
   - Đọc trực tiếp các file liên quan trong `src/` hoặc `scripts/` cùng mục tương ứng trong `docs/ARCHITECTURE.md`, `docs/DATA-SCHEMA.md`, `docs/API-CONTRACTS.md`.
2. **Trình bày theo 4 phần rõ ràng (bằng tiếng Việt):**
   - **Luồng dữ liệu đầu-cuối (Data Flow):** Đầu vào → xử lý/biến đổi → lưu trữ hoặc render đầu ra.
   - **Truy vấn SQL / Drizzle & Index:** Chỉ ra bảng nào (`tools`, `sync_logs`), điều kiện UPSERT/Idempotency, và index B-Tree/GIN nào được dùng.
   - **Xử lý lỗi & Bảo mật:** Nêu rõ validation Zod, `try/catch` cô lập, `timingSafeEqual` hoặc cách tránh Hydration Mismatch nếu có.
   - **Liên kết nguồn:** Gắn link đường dẫn tệp và dòng code thực tế vừa đọc (tuyệt đối không suy đoán chi tiết không quan sát thấy).
