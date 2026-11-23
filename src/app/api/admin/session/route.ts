import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ADMIN_SESSION_COOKIE_NAME,
  createAdminSessionToken,
  getAdminSessionCookieOptions,
  getAdminSessionStatus,
  isDevAdminBypassEnabled,
  verifyAdminSecret,
  verifySameOriginRequest,
} from "@/lib/auth";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const FAILED_LOGIN_DELAY_MS = 250;
const MAX_RATE_LIMIT_ENTRIES = 500;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

const AdminSessionLoginSchema = z
  .object({
    secret: z.string().trim().min(1).max(512),
  })
  .strict();

interface RateLimitRecord {
  failures: number;
  windowStartMs: number;
}

const failedAttemptsByIp = new Map<string, RateLimitRecord>();

/** Đặt lại bộ đếm giới hạn tốc độ đăng nhập phục vụ unit test. */
export function resetSessionRateLimitForTests(): void {
  failedAttemptsByIp.clear();
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function pruneExpiredRateLimits(nowMs: number): void {
  if (failedAttemptsByIp.size <= MAX_RATE_LIMIT_ENTRIES) {
    return;
  }
  for (const [ip, record] of failedAttemptsByIp.entries()) {
    if (nowMs - record.windowStartMs >= RATE_LIMIT_WINDOW_MS) {
      failedAttemptsByIp.delete(ip);
    }
  }
}

function checkRateLimit(
  ip: string,
  nowMs: number,
): { blocked: boolean; retryAfterSeconds: number } {
  const record = failedAttemptsByIp.get(ip);
  if (!record) {
    return { blocked: false, retryAfterSeconds: 0 };
  }

  const elapsed = nowMs - record.windowStartMs;
  if (elapsed >= RATE_LIMIT_WINDOW_MS) {
    failedAttemptsByIp.delete(ip);
    return { blocked: false, retryAfterSeconds: 0 };
  }

  if (record.failures >= MAX_FAILED_ATTEMPTS) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 1000),
    );
    return { blocked: true, retryAfterSeconds };
  }

  return { blocked: false, retryAfterSeconds: 0 };
}

function recordFailedAttempt(ip: string, nowMs: number): void {
  pruneExpiredRateLimits(nowMs);
  const existing = failedAttemptsByIp.get(ip);
  if (!existing || nowMs - existing.windowStartMs >= RATE_LIMIT_WINDOW_MS) {
    failedAttemptsByIp.set(ip, { failures: 1, windowStartMs: nowMs });
    return;
  }
  existing.failures += 1;
}

async function applyFailedLoginDelay(): Promise<void> {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, FAILED_LOGIN_DELAY_MS));
}

/** Kiểm tra trạng thái phiên đăng nhập quản trị hiện tại mà không làm lộ secret. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(getAdminSessionStatus(request), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

/** Xác thực `secret` và cấp cookie phiên `HttpOnly` ký HMAC-SHA256. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.valid) {
    return NextResponse.json(
      { error: csrf.error ?? "Cross-origin request blocked" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const nowMs = Date.now();
  const clientIp = getClientIp(request);
  const rateLimit = checkRateLimit(clientIp, nowMs);
  if (rateLimit.blocked) {
    return NextResponse.json(
      { error: "Too many failed attempts" },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const parsed = AdminSessionLoginSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request payload", details: parsed.error.flatten() },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const auth = verifyAdminSecret(parsed.data.secret);
  if (auth.status === 503) {
    return NextResponse.json(
      { error: auth.error ?? "ADMIN_SECRET is not configured" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  if (!auth.authorized) {
    recordFailedAttempt(clientIp, nowMs);
    await applyFailedLoginDelay();
    return NextResponse.json(
      { error: auth.error ?? "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  failedAttemptsByIp.delete(clientIp);

  if (isDevAdminBypassEnabled()) {
    return NextResponse.json(
      { authenticated: true, authRequired: false },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }

  const token = createAdminSessionToken({ nowMs });
  if (!token) {
    return NextResponse.json(
      { error: "ADMIN_SECRET is not configured" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const response = NextResponse.json(
    { authenticated: true, authRequired: true },
    { status: 200, headers: NO_STORE_HEADERS },
  );
  response.cookies.set(
    ADMIN_SESSION_COOKIE_NAME,
    token,
    getAdminSessionCookieOptions(),
  );
  return response;
}

/** Đăng xuất quản trị bằng cách xóa cookie phiên `HttpOnly`. */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.valid) {
    return NextResponse.json(
      { error: csrf.error ?? "Cross-origin request blocked" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const response = NextResponse.json(
    { authenticated: false },
    { status: 200, headers: NO_STORE_HEADERS },
  );
  response.cookies.set(
    ADMIN_SESSION_COOKIE_NAME,
    "",
    getAdminSessionCookieOptions(0),
  );
  return response;
}
