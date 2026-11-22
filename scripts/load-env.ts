import dotenv from "dotenv";

/** Nạp biến môi trường từ `.env.local` (chạy an toàn trên CI khi thiếu tệp). */
export function loadEnv(): void {
  dotenv.config({ path: ".env.local", quiet: true });
}

loadEnv();
