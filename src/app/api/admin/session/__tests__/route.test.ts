import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DELETE,
  GET,
  POST,
  resetSessionRateLimitForTests,
} from "@/app/api/admin/session/route";
import {
  ADMIN_SESSION_COOKIE_NAME,
  createAdminSessionToken,
  resetAuthStateForTests,
  verifyAdminSessionToken,
} from "@/lib/auth";

function makeSessionRequest(
  method: "GET" | "POST" | "DELETE",
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    cookie?: string;
  } = {},
): NextRequest {
  const headers: Record<string, string> = {
    host: "localhost",
    ...options.headers,
  };
  if (options.cookie) {
    headers.cookie = options.cookie;
  }
  if (method === "POST" && !("content-type" in headers)) {
    headers["content-type"] = "application/json";
  }

  return new NextRequest("http://localhost/api/admin/session", {
    method,
    headers,
    body:
      method === "POST" && options.body !== undefined
        ? typeof options.body === "string"
          ? options.body
          : JSON.stringify(options.body)
        : undefined,
  });
}

describe("/api/admin/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthStateForTests();
    resetSessionRateLimitForTests();
    vi.stubEnv("ADMIN_SECRET", "super-secret-admin-key");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetAuthStateForTests();
    resetSessionRateLimitForTests();
  });

  describe("GET /api/admin/session", () => {
    it("returns unauthenticated when cookie is missing and never exposes secret", async () => {
      const res = await GET(makeSessionRequest("GET"));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");

      const body = await res.json();
      expect(body).toEqual({ authenticated: false, authRequired: true });
      expect(JSON.stringify(body)).not.toContain("super-secret-admin-key");
    });

    it("returns authenticated=true for a valid signed cookie and false for forged/expired cookies", async () => {
      const validToken = createAdminSessionToken()!;
      const validRes = await GET(
        makeSessionRequest("GET", {
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${validToken}`,
        }),
      );
      expect(validRes.status).toBe(200);
      expect(await validRes.json()).toEqual({
        authenticated: true,
        authRequired: true,
      });

      const forgedRes = await GET(
        makeSessionRequest("GET", {
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=forged.signature`,
        }),
      );
      expect(await forgedRes.json()).toEqual({
        authenticated: false,
        authRequired: true,
      });

      const expiredToken = createAdminSessionToken({
        nowMs: Date.now() - 120_000,
        ttlSeconds: 30,
      })!;
      const expiredRes = await GET(
        makeSessionRequest("GET", {
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${expiredToken}`,
        }),
      );
      expect(await expiredRes.json()).toEqual({
        authenticated: false,
        authRequired: true,
      });
    });

    it("reflects fail-closed when ADMIN_SECRET is empty and bypass only when ALLOW_DEV_ADMIN_BYPASS=true", async () => {
      vi.stubEnv("ADMIN_SECRET", "");
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("ALLOW_DEV_ADMIN_BYPASS", "false");

      const closedRes = await GET(makeSessionRequest("GET"));
      expect(await closedRes.json()).toEqual({
        authenticated: false,
        authRequired: true,
      });

      vi.stubEnv("ALLOW_DEV_ADMIN_BYPASS", "true");
      const bypassRes = await GET(makeSessionRequest("GET"));
      expect(await bypassRes.json()).toEqual({
        authenticated: true,
        authRequired: false,
      });
    });
  });

  describe("POST /api/admin/session", () => {
    it("sets an HttpOnly SameSite=Lax Path=/ signed cookie on valid secret", async () => {
      const res = await POST(
        makeSessionRequest("POST", {
          body: { secret: "super-secret-admin-key" },
          headers: { origin: "http://localhost" },
        }),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({
        authenticated: true,
        authRequired: true,
      });

      const cookie = res.cookies.get(ADMIN_SESSION_COOKIE_NAME);
      expect(cookie?.value).toBeTruthy();
      expect(verifyAdminSessionToken(cookie?.value)).toBe(true);

      const setCookieHeader = res.headers.get("set-cookie") ?? "";
      expect(setCookieHeader).toContain(`${ADMIN_SESSION_COOKIE_NAME}=`);
      expect(setCookieHeader).toMatch(/HttpOnly/i);
      expect(setCookieHeader).toMatch(/SameSite=Lax/i);
      expect(setCookieHeader).toContain("Path=/");
      expect(setCookieHeader).not.toMatch(/;\s*Secure/i);
    });

    it("adds the Secure flag to Set-Cookie in production", async () => {
      vi.stubEnv("NODE_ENV", "production");

      const res = await POST(
        makeSessionRequest("POST", {
          body: { secret: "super-secret-admin-key" },
          headers: { origin: "http://localhost" },
        }),
      );

      expect(res.status).toBe(200);
      const setCookieHeader = res.headers.get("set-cookie") ?? "";
      expect(setCookieHeader).toMatch(/;\s*Secure/i);
      expect(setCookieHeader).toMatch(/HttpOnly/i);
    });

    it("rejects wrong secret with 401 and enforces per-IP rate limit (429 + Retry-After)", async () => {
      for (let i = 0; i < 5; i += 1) {
        const res = await POST(
          makeSessionRequest("POST", {
            body: { secret: "wrong-secret" },
            headers: {
              origin: "http://localhost",
              "x-forwarded-for": "203.0.113.10",
            },
          }),
        );
        expect(res.status).toBe(401);
        expect(res.cookies.get(ADMIN_SESSION_COOKIE_NAME)).toBeUndefined();
      }

      const blockedRes = await POST(
        makeSessionRequest("POST", {
          body: { secret: "super-secret-admin-key" },
          headers: {
            origin: "http://localhost",
            "x-forwarded-for": "203.0.113.10",
          },
        }),
      );
      expect(blockedRes.status).toBe(429);
      expect(Number(blockedRes.headers.get("retry-after"))).toBeGreaterThan(0);

      // Different IP is still allowed
      const otherIpRes = await POST(
        makeSessionRequest("POST", {
          body: { secret: "super-secret-admin-key" },
          headers: {
            origin: "http://localhost",
            "x-forwarded-for": "203.0.113.99",
          },
        }),
      );
      expect(otherIpRes.status).toBe(200);
    });

    it("returns 400 for malformed JSON or invalid body schema", async () => {
      const badJsonRes = await POST(
        makeSessionRequest("POST", {
          body: "{bad-json",
          headers: { origin: "http://localhost" },
        }),
      );
      expect(badJsonRes.status).toBe(400);

      const emptySecretRes = await POST(
        makeSessionRequest("POST", {
          body: { secret: "   " },
          headers: { origin: "http://localhost" },
        }),
      );
      expect(emptySecretRes.status).toBe(400);

      const extraFieldRes = await POST(
        makeSessionRequest("POST", {
          body: { secret: "super-secret-admin-key", extra: true },
          headers: { origin: "http://localhost" },
        }),
      );
      expect(extraFieldRes.status).toBe(400);
    });

    it("returns 403 on cross-origin POST (CSRF protection)", async () => {
      const res = await POST(
        makeSessionRequest("POST", {
          body: { secret: "super-secret-admin-key" },
          headers: { origin: "https://evil.example" },
        }),
      );
      expect(res.status).toBe(403);
      expect(res.cookies.get(ADMIN_SESSION_COOKIE_NAME)).toBeUndefined();
    });

    it("returns 503 when ADMIN_SECRET is missing without bypass", async () => {
      vi.stubEnv("ADMIN_SECRET", "");
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("ALLOW_DEV_ADMIN_BYPASS", "false");

      const res = await POST(
        makeSessionRequest("POST", {
          body: { secret: "anything" },
          headers: { origin: "http://localhost" },
        }),
      );
      expect(res.status).toBe(503);
    });
  });

  describe("DELETE /api/admin/session", () => {
    it("clears the HttpOnly session cookie with Max-Age=0", async () => {
      const validToken = createAdminSessionToken()!;
      const res = await DELETE(
        makeSessionRequest("DELETE", {
          headers: { origin: "http://localhost" },
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${validToken}`,
        }),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ authenticated: false });

      const setCookieHeader = res.headers.get("set-cookie") ?? "";
      expect(setCookieHeader).toContain(`${ADMIN_SESSION_COOKIE_NAME}=;`);
      expect(setCookieHeader).toMatch(/Max-Age=0/i);
      expect(setCookieHeader).toMatch(/HttpOnly/i);
    });

    it("returns 403 on cross-origin DELETE (CSRF protection)", async () => {
      const res = await DELETE(
        makeSessionRequest("DELETE", {
          headers: { origin: "https://evil.example" },
        }),
      );
      expect(res.status).toBe(403);
    });
  });
});
