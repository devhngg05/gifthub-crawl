---
name: debug
description: >-
  Use this skill when diagnosing bugs, failing tests, sync worker errors, database
  issues, or UI hydration/network failures using systematic Root Cause Analysis before fixing.
---

# Debug Skill (Root Cause Analysis)

Quy trình tìm và xử lý tận gốc nguyên nhân sự cố, **nghiêm cấm** sửa mò hoặc vá víu che triệu chứng.

## Các bước thực hiện bắt buộc

1. **Thu thập bằng chứng thực tế:**
   - Đọc đầy đủ stack trace, output từ `vitest`, terminal log, bảng `sync_logs` trên Neon, hoặc console/network từ Chrome DevTools.
   - Xác định bước tái hiện lỗi tối thiểu (minimal reproduction).
2. **Phân tích nguyên nhân gốc rễ (Root Cause Analysis):**
   - Truy vết ngược từ điểm lỗi qua luồng dữ liệu được mô tả trong `docs/ARCHITECTURE.md`, `docs/DATA-SCHEMA.md` và `docs/API-CONTRACTS.md`.
   - Kiểm tra các điểm dễ lỗi đặc thù của dự án: tham số `channel_binding=require` trên Neon URL, `load-env.ts` chưa được import đầu tiên, Zod schema không khớp output AI hoặc body PATCH, mismatch SSR/Client thời gian tương đối, hoặc thiếu header `x-admin-secret`.
3. **Sửa triệt để đúng nguyên nhân:**
   - Không xóa/skip test, không nới lỏng type thành `any` hay tắt rule lint để né lỗi.
   - Đảm bảo bản sửa không phá vỡ bất kỳ quy tắc bảo mật hoặc contract nào trong `docs/`.
4. **Viết Regression Test & Xác minh:**
   - Bổ sung ít nhất 1 unit test tái hiện đúng bug vừa gặp để chặn tái phát.
   - Chạy lại bộ test liên quan và `npx tsc --noEmit` để xác nhận lỗi đã dứt điểm.
