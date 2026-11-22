import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyAdminSecret } from "@/lib/auth";

describe("verifyAdminSecret", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("authorizes when ADMIN_SECRET is configured and x-admin-secret matches", () => {
    vi.stubEnv("ADMIN_SECRET", "super-secret-token-123");
    vi.stubEnv("NODE_ENV", "production");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = verifyAdminSecret("super-secret-token-123");

    expect(result).toEqual({ authorized: true, status: 200 });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns 401 when ADMIN_SECRET is configured and header is missing or empty", () => {
    vi.stubEnv("ADMIN_SECRET", "super-secret-token-123");
    vi.stubEnv("NODE_ENV", "development");

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
  });

  it("returns 401 when ADMIN_SECRET is configured and header does not match (same and different lengths)", () => {
    vi.stubEnv("ADMIN_SECRET", "alpha-beta-gamma");
    vi.stubEnv("NODE_ENV", "production");

    // Cùng độ dài (16 ký tự) nhưng khác nội dung
    expect(verifyAdminSecret("alpha-beta-delta")).toEqual({
      authorized: false,
      status: 401,
      error: "Unauthorized",
    });
    // Khác độ dài
    expect(verifyAdminSecret("short")).toEqual({
      authorized: false,
      status: 401,
      error: "Unauthorized",
    });
  });

  it("bypasses auth with a single non-secret warning in non-production when ADMIN_SECRET is empty", () => {
    vi.stubEnv("ADMIN_SECRET", "   ");
    vi.stubEnv("NODE_ENV", "development");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = verifyAdminSecret(null);

    expect(result).toEqual({ authorized: true, status: 200 });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const loggedMessage = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(loggedMessage).toContain("ADMIN_SECRET");
  });

  it("fails closed with 503 in production when ADMIN_SECRET is unset or empty", () => {
    vi.stubEnv("ADMIN_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = verifyAdminSecret("any-provided-header");

    expect(result).toEqual({
      authorized: false,
      status: 503,
      error: "ADMIN_SECRET is not configured in production",
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
