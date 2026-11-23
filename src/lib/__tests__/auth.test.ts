import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSessionToken,
  getAdminSessionCookieOptions,
  getAdminSessionStatus,
  resetAuthStateForTests,
  verifyAdminRequest,
  verifyAdminSecret,
  verifyAdminSessionToken,
  verifySameOriginRequest,
} from "@/lib/auth";

describe("auth security, signed session cookies, and CSRF checks", () => {
  beforeEach(() => {
    resetAuthStateForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetAuthStateForTests();
  });

  describe("verifyAdminSecret & fail-closed bypass rules", () => {
    it("authorizes when ADMIN_SECRET is configured and secret matches", () => {
      vi.stubEnv("ADMIN_SECRET", "super-secret-token-123");
      vi.stubEnv("NODE_ENV", "production");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = verifyAdminSecret("super-secret-token-123");

      expect(result).toEqual({ authorized: true, status: 200 });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("returns 401 when secret is missing, empty, or does not match (same and different lengths)", () => {
      vi.stubEnv("ADMIN_SECRET", "alpha-beta-gamma");
      vi.stubEnv("NODE_ENV", "production");

      expect(verifyAdminSecret(null)).toEqual({
        authorized: false,
        status: 401,
        error: "Unauthorized",
      });
      expect(verifyAdminSecret("")).toEqual({
        authorized: false,
        status: 401,
        error: "Unauthorized",
      });
      expect(verifyAdminSecret("alpha-beta-delta")).toEqual({
        authorized: false,
        status: 401,
        error: "Unauthorized",
      });
      expect(verifyAdminSecret("short")).toEqual({
        authorized: false,
        status: 401,
        error: "Unauthorized",
      });
    });

    it("fails closed with 503 in non-production when ADMIN_SECRET is missing and ALLOW_DEV_ADMIN_BYPASS is not true", () => {
      vi.stubEnv("ADMIN_SECRET", "   ");
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("ALLOW_DEV_ADMIN_BYPASS", "false");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      expect(verifyAdminSecret(null)).toEqual({
        authorized: false,
        status: 503,
        error: "ADMIN_SECRET is not configured",
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("fails closed with 503 in production even when ALLOW_DEV_ADMIN_BYPASS=true", () => {
      vi.stubEnv("ADMIN_SECRET", "");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ALLOW_DEV_ADMIN_BYPASS", "true");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      expect(verifyAdminSecret("any-header")).toEqual({
        authorized: false,
        status: 503,
        error: "ADMIN_SECRET is not configured",
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("bypasses auth in non-production ONLY when ALLOW_DEV_ADMIN_BYPASS=true and logs warning only once", () => {
      vi.stubEnv("ADMIN_SECRET", "");
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("ALLOW_DEV_ADMIN_BYPASS", "true");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      expect(verifyAdminSecret(null)).toEqual({ authorized: true, status: 200 });
      expect(verifyAdminSecret(null)).toEqual({ authorized: true, status: 200 });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0] ?? "")).toContain(
        "ALLOW_DEV_ADMIN_BYPASS=true",
      );
    });
  });

  describe("HMAC-SHA256 stateless session tokens", () => {
    it("creates and verifies a valid session token and rejects expired tokens", () => {
      vi.stubEnv("ADMIN_SECRET", "session-signing-secret");
      const issuedAtMs = Date.UTC(2026, 10, 23, 12, 0, 0);

      const token = createAdminSessionToken({
        nowMs: issuedAtMs,
        ttlSeconds: 60,
      });
      expect(token).toBeTruthy();

      expect(verifyAdminSessionToken(token, issuedAtMs + 59_000)).toBe(true);
      expect(verifyAdminSessionToken(token, issuedAtMs + 60_000)).toBe(false);
      expect(verifyAdminSessionToken(token, issuedAtMs + 120_000)).toBe(false);
    });

    it("rejects forged, tampered, malformed tokens, or tokens signed by a different secret", () => {
      vi.stubEnv("ADMIN_SECRET", "session-signing-secret");
      const nowMs = Date.UTC(2026, 10, 23, 12, 0, 0);
      const token = createAdminSessionToken({ nowMs })!;
      const [payloadB64, sigB64] = token.split(".");

      // Tamper payload
      const tamperedPayload = Buffer.from(
        JSON.stringify({ v: 1, iat: 1, exp: 9999999999, nonce: "evil" }),
      ).toString("base64url");
      expect(
        verifyAdminSessionToken(`${tamperedPayload}.${sigB64}`, nowMs),
      ).toBe(false);

      // Forged signature
      const flippedSig = `${sigB64.slice(0, -1)}${sigB64.endsWith("a") ? "b" : "a"}`;
      expect(verifyAdminSessionToken(`${payloadB64}.${flippedSig}`, nowMs)).toBe(
        false,
      );

      // Malformed formats
      expect(verifyAdminSessionToken(null, nowMs)).toBe(false);
      expect(verifyAdminSessionToken("", nowMs)).toBe(false);
      expect(verifyAdminSessionToken("not-a-token", nowMs)).toBe(false);
      expect(verifyAdminSessionToken(`${payloadB64}.a.b`, nowMs)).toBe(false);

      // Different secret
      vi.stubEnv("ADMIN_SECRET", "rotated-secret");
      expect(verifyAdminSessionToken(token, nowMs)).toBe(false);
    });

    it("returns null when creating token without ADMIN_SECRET", () => {
      vi.stubEnv("ADMIN_SECRET", "");
      expect(createAdminSessionToken()).toBeNull();
    });

    it("configures HttpOnly, SameSite=Lax, Path=/ and toggles Secure by NODE_ENV", () => {
      vi.stubEnv("NODE_ENV", "development");
      expect(getAdminSessionCookieOptions()).toEqual({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: false,
        maxAge: ADMIN_SESSION_TTL_SECONDS,
      });

      vi.stubEnv("NODE_ENV", "production");
      expect(getAdminSessionCookieOptions(0)).toEqual({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: true,
        maxAge: 0,
      });
    });
  });

  describe("verifySameOriginRequest (CSRF protection)", () => {
    it("allows matching Origin and Referer headers (including x-forwarded-host)", () => {
      const sameOriginReq = new NextRequest("http://localhost/api/tools/1", {
        method: "PATCH",
        headers: {
          host: "localhost:3000",
          origin: "http://localhost:3000",
          "sec-fetch-site": "same-origin",
        },
      });
      expect(verifySameOriginRequest(sameOriginReq)).toEqual({ valid: true });

      const forwardedReq = new NextRequest("http://internal/api/tools/1", {
        method: "PATCH",
        headers: {
          "x-forwarded-host": "radar.example.com, proxy.internal",
          origin: "https://radar.example.com",
        },
      });
      expect(verifySameOriginRequest(forwardedReq)).toEqual({ valid: true });

      const refererReq = new NextRequest("https://radar.example.com/api/tools/1", {
        method: "PATCH",
        headers: {
          host: "radar.example.com",
          referer: "https://radar.example.com/?pinned=true",
        },
      });
      expect(verifySameOriginRequest(refererReq)).toEqual({ valid: true });
    });

    it("blocks cross-site Sec-Fetch-Site, mismatched Origin, null Origin, and mismatched Referer", () => {
      const crossOrigin = new NextRequest("http://localhost/api/tools/1", {
        method: "PATCH",
        headers: {
          host: "localhost:3000",
          origin: "https://evil.example",
        },
      });
      expect(verifySameOriginRequest(crossOrigin).valid).toBe(false);

      const nullOrigin = new NextRequest("http://localhost/api/tools/1", {
        method: "PATCH",
        headers: {
          host: "localhost:3000",
          origin: "null",
        },
      });
      expect(verifySameOriginRequest(nullOrigin).valid).toBe(false);

      const crossReferer = new NextRequest("http://localhost/api/tools/1", {
        method: "PATCH",
        headers: {
          host: "localhost:3000",
          referer: "https://attacker.test/form.html",
        },
      });
      expect(verifySameOriginRequest(crossReferer).valid).toBe(false);

      const crossFetchSite = new NextRequest("http://localhost/api/tools/1", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          "sec-fetch-site": "cross-site",
        },
      });
      expect(verifySameOriginRequest(crossFetchSite).valid).toBe(false);
    });
  });

  describe("verifyAdminRequest & getAdminSessionStatus", () => {
    it("authorizes valid signed cookie on same-origin PATCH and blocks cross-origin with 403", () => {
      vi.stubEnv("ADMIN_SECRET", "cookie-secret-123");
      const token = createAdminSessionToken()!;

      const validReq = new NextRequest("http://localhost/api/tools/42", {
        method: "PATCH",
        headers: {
          host: "localhost",
          origin: "http://localhost",
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${token}`,
        },
      });
      expect(verifyAdminRequest(validReq)).toEqual({
        authorized: true,
        status: 200,
      });

      const csrfReq = new NextRequest("http://localhost/api/tools/42", {
        method: "PATCH",
        headers: {
          host: "localhost",
          origin: "https://evil.example",
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${token}`,
        },
      });
      expect(verifyAdminRequest(csrfReq).status).toBe(403);
    });

    it("supports controlled x-admin-secret fallback when enabled and disables it when requested", () => {
      vi.stubEnv("ADMIN_SECRET", "cli-secret-123");

      const headerReq = new NextRequest("http://localhost/api/tools/42", {
        method: "PATCH",
        headers: {
          "x-admin-secret": "cli-secret-123",
        },
      });

      expect(verifyAdminRequest(headerReq)).toEqual({
        authorized: true,
        status: 200,
      });
      expect(
        verifyAdminRequest(headerReq, { allowHeaderFallback: false }),
      ).toEqual({
        authorized: false,
        status: 401,
        error: "Unauthorized",
      });
    });

    it("reports session status without leaking secrets", () => {
      vi.stubEnv("ADMIN_SECRET", "status-secret-123");
      const token = createAdminSessionToken()!;

      const unauthReq = new NextRequest("http://localhost/api/admin/session");
      expect(getAdminSessionStatus(unauthReq)).toEqual({
        authenticated: false,
        authRequired: true,
      });

      const authReq = new NextRequest("http://localhost/api/admin/session", {
        headers: {
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${token}`,
        },
      });
      expect(getAdminSessionStatus(authReq)).toEqual({
        authenticated: true,
        authRequired: true,
      });

      vi.stubEnv("ADMIN_SECRET", "");
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("ALLOW_DEV_ADMIN_BYPASS", "false");
      expect(getAdminSessionStatus(unauthReq)).toEqual({
        authenticated: false,
        authRequired: true,
      });

      vi.stubEnv("ALLOW_DEV_ADMIN_BYPASS", "true");
      expect(getAdminSessionStatus(unauthReq)).toEqual({
        authenticated: true,
        authRequired: false,
      });
    });
  });
});
