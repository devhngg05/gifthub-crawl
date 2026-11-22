import { createHash, timingSafeEqual } from "node:crypto";

export interface AdminAuthResult {
  authorized: boolean;
  status: 200 | 401 | 503;
  error?: string;
}

/**
 * Xác thực header `x-admin-secret` với `process.env.ADMIN_SECRET`.
 * - So sánh digest SHA-256 bằng `crypto.timingSafeEqual` để tránh rò rỉ timing/độ dài.
 * - Môi trường `production` bắt buộc fail-closed (503) khi thiếu `ADMIN_SECRET`.
 * - Local dev (`NODE_ENV !== "production"`) cho phép bypass kèm cảnh báo 1 dòng.
 */
export function verifyAdminSecret(
  headerValue: string | null,
): AdminAuthResult {
  const configuredSecret = process.env.ADMIN_SECRET?.trim() ?? "";
  const isProduction = process.env.NODE_ENV === "production";

  if (configuredSecret.length === 0) {
    if (isProduction) {
      return {
        authorized: false,
        status: 503,
        error: "ADMIN_SECRET is not configured in production",
      };
    }

    console.warn(
      "[auth] ADMIN_SECRET is not configured; bypassing admin authentication in non-production mode.",
    );
    return { authorized: true, status: 200 };
  }

  if (!headerValue) {
    return { authorized: false, status: 401, error: "Unauthorized" };
  }

  const expectedDigest = createHash("sha256")
    .update(configuredSecret, "utf8")
    .digest();
  const providedDigest = createHash("sha256")
    .update(headerValue, "utf8")
    .digest();

  if (timingSafeEqual(expectedDigest, providedDigest)) {
    return { authorized: true, status: 200 };
  }

  return { authorized: false, status: 401, error: "Unauthorized" };
}
