import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const ADMIN_SESSION_COOKIE_NAME = "gtr_admin_session";
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;

const SESSION_KEY_CONTEXT = "gtr-admin-session-v1";
const MUTATING_METHODS = new Set(["POST", "PATCH", "DELETE", "PUT"]);

let hasLoggedDevBypassWarning = false;

export interface AdminAuthResult {
  authorized: boolean;
  status: 200 | 401 | 403 | 503;
  error?: string;
}

export interface AdminSessionStatus {
  authenticated: boolean;
  authRequired: boolean;
}

export interface SameOriginResult {
  valid: boolean;
  error?: string;
}

interface AdminSessionPayload {
  v: 1;
  iat: number;
  exp: number;
  nonce: string;
}

/** Đặt lại trạng thái cảnh báo nội bộ cho các bài kiểm thử. */
export function resetAuthStateForTests(): void {
  hasLoggedDevBypassWarning = false;
}

/** Đọc giá trị `ADMIN_SECRET` đã chuẩn hóa khoảng trắng từ môi trường. */
export function getConfiguredAdminSecret(): string {
  return process.env.ADMIN_SECRET?.trim() ?? "";
}

/**
 * Chỉ cho phép bypass xác thực ở local dev khi:
 * 1) `ADMIN_SECRET` chưa được cấu hình,
 * 2) `NODE_ENV !== "production"`, và
 * 3) `ALLOW_DEV_ADMIN_BYPASS === "true"`.
 */
export function isDevAdminBypassEnabled(): boolean {
  return (
    getConfiguredAdminSecret().length === 0 &&
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_DEV_ADMIN_BYPASS === "true"
  );
}

function warnDevBypassOnce(): void {
  if (hasLoggedDevBypassWarning) {
    return;
  }
  hasLoggedDevBypassWarning = true;
  console.warn(
    "[auth] ADMIN_SECRET is not configured; bypassing admin authentication because ALLOW_DEV_ADMIN_BYPASS=true in non-production mode.",
  );
}

function deriveSessionSigningKey(configuredSecret: string): Buffer {
  return createHmac("sha256", SESSION_KEY_CONTEXT)
    .update(configuredSecret, "utf8")
    .digest();
}

/**
 * Xác thực giá trị `secretValue` với `process.env.ADMIN_SECRET`.
 * - So sánh digest SHA-256 bằng `crypto.timingSafeEqual` để tránh rò rỉ timing/độ dài.
 * - Mặc định fail-closed (503) ở mọi môi trường khi thiếu `ADMIN_SECRET`.
 * - Chỉ bypass khi `NODE_ENV !== "production"` và `ALLOW_DEV_ADMIN_BYPASS === "true"`.
 */
export function verifyAdminSecret(
  secretValue: string | null,
): AdminAuthResult {
  const configuredSecret = getConfiguredAdminSecret();

  if (configuredSecret.length === 0) {
    if (isDevAdminBypassEnabled()) {
      warnDevBypassOnce();
      return { authorized: true, status: 200 };
    }

    return {
      authorized: false,
      status: 503,
      error: "ADMIN_SECRET is not configured",
    };
  }

  if (!secretValue) {
    return { authorized: false, status: 401, error: "Unauthorized" };
  }

  const expectedDigest = createHash("sha256")
    .update(configuredSecret, "utf8")
    .digest();
  const providedDigest = createHash("sha256")
    .update(secretValue, "utf8")
    .digest();

  if (timingSafeEqual(expectedDigest, providedDigest)) {
    return { authorized: true, status: 200 };
  }

  return { authorized: false, status: 401, error: "Unauthorized" };
}

/**
 * Tạo stateless session token ký bằng HMAC-SHA256 từ khóa dẫn xuất của `ADMIN_SECRET`.
 * Trả về `null` nếu `ADMIN_SECRET` chưa được cấu hình.
 */
export function createAdminSessionToken(options?: {
  nowMs?: number;
  ttlSeconds?: number;
}): string | null {
  const configuredSecret = getConfiguredAdminSecret();
  if (configuredSecret.length === 0) {
    return null;
  }

  const nowMs = options?.nowMs ?? Date.now();
  const ttlSeconds = options?.ttlSeconds ?? ADMIN_SESSION_TTL_SECONDS;
  const iat = Math.floor(nowMs / 1000);
  const payload: AdminSessionPayload = {
    v: 1,
    iat,
    exp: iat + ttlSeconds,
    nonce: randomBytes(16).toString("base64url"),
  };

  const payloadB64Url = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signingKey = deriveSessionSigningKey(configuredSecret);
  const signatureB64Url = createHmac("sha256", signingKey)
    .update(payloadB64Url, "utf8")
    .digest("base64url");

  return `${payloadB64Url}.${signatureB64Url}`;
}

/**
 * Xác minh chữ ký HMAC-SHA256 (qua `timingSafeEqual`) và thời hạn `exp` của session token.
 */
export function verifyAdminSessionToken(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  const configuredSecret = getConfiguredAdminSecret();
  if (configuredSecret.length === 0 || !token) {
    return false;
  }

  const dotIndex = token.indexOf(".");
  if (dotIndex <= 0 || dotIndex !== token.lastIndexOf(".")) {
    return false;
  }

  const payloadB64Url = token.slice(0, dotIndex);
  const sigB64Url = token.slice(dotIndex + 1);
  if (!payloadB64Url || !sigB64Url) {
    return false;
  }

  const signingKey = deriveSessionSigningKey(configuredSecret);
  const expectedSig = createHmac("sha256", signingKey)
    .update(payloadB64Url, "utf8")
    .digest();
  const providedSig = Buffer.from(sigB64Url, "base64url");

  if (
    providedSig.length !== expectedSig.length ||
    providedSig.toString("base64url") !== sigB64Url
  ) {
    return false;
  }

  if (!timingSafeEqual(providedSig, expectedSig)) {
    return false;
  }

  try {
    const decoded = Buffer.from(payloadB64Url, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as Partial<AdminSessionPayload> | null;
    if (!parsed || typeof parsed !== "object") {
      return false;
    }

    if (
      parsed.v !== 1 ||
      !Number.isSafeInteger(parsed.iat) ||
      !Number.isSafeInteger(parsed.exp) ||
      typeof parsed.nonce !== "string" ||
      parsed.nonce.length === 0
    ) {
      return false;
    }

    const iat = parsed.iat as number;
    const exp = parsed.exp as number;
    if (iat > exp) {
      return false;
    }

    const nowSec = Math.floor(nowMs / 1000);
    return exp > nowSec;
  } catch {
    return false;
  }
}

/** Trả về cấu hình cờ bảo mật cho cookie phiên quản trị. */
export function getAdminSessionCookieOptions(
  maxAgeSeconds: number = ADMIN_SESSION_TTL_SECONDS,
) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeSeconds,
  };
}

function getExpectedRequestHost(request: Request | NextRequest): string {
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  if (forwardedHost) {
    return forwardedHost;
  }

  const hostHeader = request.headers.get("host")?.trim().toLowerCase();
  if (hostHeader) {
    return hostHeader;
  }

  try {
    return new URL(request.url).host.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Kiểm tra `Sec-Fetch-Site`, `Origin` và `Referer` khớp host đích để chống CSRF
 * cho các route thay đổi dữ liệu (`POST`/`PATCH`/`DELETE`).
 */
export function verifySameOriginRequest(
  request: Request | NextRequest,
): SameOriginResult {
  const expectedHost = getExpectedRequestHost(request);
  if (!expectedHost) {
    return { valid: false, error: "Invalid request host" };
  }

  const secFetchSite = request.headers
    .get("sec-fetch-site")
    ?.trim()
    .toLowerCase();
  if (secFetchSite === "cross-site") {
    return { valid: false, error: "Cross-origin request blocked" };
  }

  const originHeader = request.headers.get("origin")?.trim();
  if (originHeader) {
    if (originHeader === "null") {
      return { valid: false, error: "Invalid Origin header" };
    }
    try {
      const parsedOrigin = new URL(originHeader);
      if (
        parsedOrigin.protocol !== "http:" &&
        parsedOrigin.protocol !== "https:"
      ) {
        return { valid: false, error: "Invalid Origin header" };
      }
      if (parsedOrigin.host.toLowerCase() !== expectedHost) {
        return { valid: false, error: "Cross-origin request blocked" };
      }
      return { valid: true };
    } catch {
      return { valid: false, error: "Invalid Origin header" };
    }
  }

  const refererHeader = request.headers.get("referer")?.trim();
  if (refererHeader) {
    try {
      const parsedReferer = new URL(refererHeader);
      if (
        (parsedReferer.protocol !== "http:" &&
          parsedReferer.protocol !== "https:") ||
        parsedReferer.host.toLowerCase() !== expectedHost
      ) {
        return { valid: false, error: "Cross-origin request blocked" };
      }
      return { valid: true };
    } catch {
      return { valid: false, error: "Cross-origin request blocked" };
    }
  }

  return { valid: true };
}

/**
 * Xác thực request API quản trị theo thứ tự:
 * 1) Chống CSRF với method thay đổi dữ liệu,
 * 2) Fail-closed nếu thiếu `ADMIN_SECRET` (chỉ bypass dev khi bật `ALLOW_DEV_ADMIN_BYPASS=true`),
 * 3) Cookie phiên `HttpOnly` đã ký,
 * 4) Fallback header `x-admin-secret` có kiểm soát cho script nội bộ (khi `allowHeaderFallback` không tắt).
 */
export function verifyAdminRequest(
  request: NextRequest,
  options?: { allowHeaderFallback?: boolean },
): AdminAuthResult {
  if (MUTATING_METHODS.has(request.method.toUpperCase())) {
    const csrf = verifySameOriginRequest(request);
    if (!csrf.valid) {
      return {
        authorized: false,
        status: 403,
        error: csrf.error ?? "Cross-origin request blocked",
      };
    }
  }

  const configuredSecret = getConfiguredAdminSecret();
  if (configuredSecret.length === 0) {
    if (isDevAdminBypassEnabled()) {
      warnDevBypassOnce();
      return { authorized: true, status: 200 };
    }

    return {
      authorized: false,
      status: 503,
      error: "ADMIN_SECRET is not configured",
    };
  }

  const sessionToken = request.cookies.get(ADMIN_SESSION_COOKIE_NAME)?.value;
  if (verifyAdminSessionToken(sessionToken)) {
    return { authorized: true, status: 200 };
  }

  if (options?.allowHeaderFallback !== false) {
    const headerSecret = request.headers.get("x-admin-secret");
    if (headerSecret && verifyAdminSecret(headerSecret).authorized) {
      return { authorized: true, status: 200 };
    }
  }

  return { authorized: false, status: 401, error: "Unauthorized" };
}

/** Trả về trạng thái xác thực hiện tại cho `GET /api/admin/session` (không lộ secret). */
export function getAdminSessionStatus(
  request: NextRequest,
): AdminSessionStatus {
  if (isDevAdminBypassEnabled()) {
    return { authenticated: true, authRequired: false };
  }

  if (getConfiguredAdminSecret().length === 0) {
    return { authenticated: false, authRequired: true };
  }

  const sessionToken = request.cookies.get(ADMIN_SESSION_COOKIE_NAME)?.value;
  return {
    authenticated: verifyAdminSessionToken(sessionToken),
    authRequired: true,
  };
}
