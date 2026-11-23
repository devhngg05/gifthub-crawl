import { PgDialect } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolRow } from "@/db/schema";
import {
  ADMIN_SESSION_COOKIE_NAME,
  createAdminSessionToken,
  resetAuthStateForTests,
} from "@/lib/auth";

const {
  mockRevalidateTag,
  mockSelectLimit,
  mockSelect,
  mockReturning,
  mockWhere,
  mockSet,
  mockUpdate,
} = vi.hoisted(() => {
  const mockRevalidateTag = vi.fn();
  const mockSelectLimit = vi.fn();
  const mockSelectWhere = vi.fn(() => ({ limit: mockSelectLimit }));
  const mockFrom = vi.fn(() => ({ where: mockSelectWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  const mockReturning = vi.fn();
  const mockWhere = vi.fn(() => ({ returning: mockReturning }));
  const mockSet = vi.fn((values: Record<string, unknown>) => {
    void values;
    return { where: mockWhere };
  });
  const mockUpdate = vi.fn(() => ({ set: mockSet }));
  return {
    mockRevalidateTag,
    mockSelectLimit,
    mockSelect,
    mockReturning,
    mockWhere,
    mockSet,
    mockUpdate,
  };
});

vi.mock("next/cache", () => ({
  revalidateTag: mockRevalidateTag,
}));

vi.mock("@/db", () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
  },
}));

import { PATCH } from "@/app/api/tools/[id]/route";

function makeToolRow(overrides: Partial<ToolRow> = {}): ToolRow {
  const now = new Date("2026-11-22T10:00:00.000Z");
  return {
    id: 42,
    githubId: 123456,
    name: "drizzle-orm",
    fullName: "drizzle-team/drizzle-orm",
    htmlUrl: "https://github.com/drizzle-team/drizzle-orm",
    stars: 28000,
    language: "TypeScript",
    lastPushedAt: now,
    readmeSha: "abc123",
    summaryVi: "ORM TypeScript nhẹ và an toàn kiểu dữ liệu cho SQL.",
    category: "dev-engineering",
    subCategory: "database-orm",
    secondarySubCategories: ["cli-dev-env"],
    useCases: ["Truy vấn SQL an toàn kiểu"],
    replaces: ["Prisma"],
    usability: "dev-required",
    isPinned: false,
    userNotes: null,
    searchText: "drizzle orm drizzle team drizzle orm",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makePatchRequest(
  id: string,
  body: unknown,
  options: {
    headers?: Record<string, string>;
    cookie?: string;
  } = {},
): [NextRequest, { params: Promise<{ id: string }> }] {
  const isRawString = typeof body === "string";
  const headers: Record<string, string> = {
    host: "localhost",
    "content-type": "application/json",
    ...options.headers,
  };
  if (options.cookie) {
    headers.cookie = options.cookie;
  }

  const request = new NextRequest(`http://localhost/api/tools/${id}`, {
    method: "PATCH",
    headers,
    body: isRawString ? body : JSON.stringify(body),
  });

  return [request, { params: Promise.resolve({ id }) }];
}

function makeSessionCookieHeader(token?: string): string {
  const resolved = token ?? createAdminSessionToken()!;
  return `${ADMIN_SESSION_COOKIE_NAME}=${resolved}`;
}

function getSetPayload(callIndex = 0): Record<string, unknown> {
  const payload = mockSet.mock.calls[callIndex]?.[0];
  expect(payload).toBeDefined();
  return payload!;
}

describe("PATCH /api/tools/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthStateForTests();
    vi.stubEnv("ADMIN_SECRET", "test-admin-secret");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetAuthStateForTests();
  });

  it("returns 401 when session cookie and header are missing, forged, or expired without touching DB", async () => {
    const [missingReq, missingCtx] = makePatchRequest("42", { isPinned: true });
    const missingRes = await PATCH(missingReq, missingCtx);
    expect(missingRes.status).toBe(401);
    expect(await missingRes.json()).toEqual({ error: "Unauthorized" });

    const [forgedReq, forgedCtx] = makePatchRequest(
      "42",
      { isPinned: true },
      {
        headers: { origin: "http://localhost" },
        cookie: makeSessionCookieHeader("tampered.signature"),
      },
    );
    const forgedRes = await PATCH(forgedReq, forgedCtx);
    expect(forgedRes.status).toBe(401);

    const expiredToken = createAdminSessionToken({
      nowMs: Date.now() - 120_000,
      ttlSeconds: 10,
    })!;
    const [expiredReq, expiredCtx] = makePatchRequest(
      "42",
      { isPinned: true },
      {
        headers: { origin: "http://localhost" },
        cookie: makeSessionCookieHeader(expiredToken),
      },
    );
    const expiredRes = await PATCH(expiredReq, expiredCtx);
    expect(expiredRes.status).toBe(401);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("returns 403 on cross-origin PATCH even with a valid session cookie (CSRF protection)", async () => {
    const [req, ctx] = makePatchRequest(
      "42",
      { isPinned: true },
      {
        headers: { origin: "https://evil.example" },
        cookie: makeSessionCookieHeader(),
      },
    );
    const res = await PATCH(req, ctx);

    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("supports controlled x-admin-secret header fallback for internal scripts", async () => {
    mockReturning.mockResolvedValueOnce([makeToolRow({ isPinned: true })]);

    const [req, ctx] = makePatchRequest(
      "42",
      { isPinned: true },
      { headers: { "x-admin-secret": "test-admin-secret" } },
    );
    const res = await PATCH(req, ctx);

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("fails closed with 503 in both dev and production when ADMIN_SECRET is missing without ALLOW_DEV_ADMIN_BYPASS=true", async () => {
    vi.stubEnv("ADMIN_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_ADMIN_BYPASS", "false");

    const [devReq, devCtx] = makePatchRequest("42", { isPinned: true });
    expect((await PATCH(devReq, devCtx)).status).toBe(503);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_DEV_ADMIN_BYPASS", "true");
    const [prodReq, prodCtx] = makePatchRequest("42", { isPinned: true });
    expect((await PATCH(prodReq, prodCtx)).status).toBe(503);

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("bypasses auth in non-production when ADMIN_SECRET is missing and ALLOW_DEV_ADMIN_BYPASS=true", async () => {
    vi.stubEnv("ADMIN_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_ADMIN_BYPASS", "true");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockReturning.mockResolvedValueOnce([makeToolRow({ isPinned: true })]);

    const [req, ctx] = makePatchRequest("42", { isPinned: true });
    const res = await PATCH(req, ctx);

    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for invalid tool id params", async () => {
    const cookie = makeSessionCookieHeader();
    for (const badId of ["0", "-5", "abc", "3.14"]) {
      const [req, ctx] = makePatchRequest(
        badId,
        { isPinned: true },
        { headers: { origin: "http://localhost" }, cookie },
      );
      const res = await PATCH(req, ctx);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid tool id");
    }
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("returns 400 when request body is malformed JSON", async () => {
    const [req, ctx] = makePatchRequest("42", "{not-valid-json", {
      headers: { origin: "http://localhost" },
      cookie: makeSessionCookieHeader(),
    });
    const res = await PATCH(req, ctx);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("returns 400 for empty body, forbidden extra fields, unknown subCategory, or oversized userNotes", async () => {
    const cookie = makeSessionCookieHeader();
    const invalidPayloads: unknown[] = [
      {},
      { isPinned: true, isBookmarked: true },
      { personalNote: "forbidden" },
      { subCategory: "uncategorized" },
      { subCategory: "non-existent-sub" },
      { userNotes: "x".repeat(2001) },
    ];

    for (const payload of invalidPayloads) {
      const [req, ctx] = makePatchRequest("42", payload, {
        headers: { origin: "http://localhost" },
        cookie,
      });
      const res = await PATCH(req, ctx);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid request payload");
      expect(json.details).toBeDefined();
    }
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("returns 404 when no tool matches the given id", async () => {
    mockReturning.mockResolvedValueOnce([]);

    const [req, ctx] = makePatchRequest(
      "9999",
      { isPinned: true },
      {
        headers: { origin: "http://localhost" },
        cookie: makeSessionCookieHeader(),
      },
    );
    const res = await PATCH(req, ctx);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Tool not found" });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledTimes(1);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("returns 200 when updating isPinned only using signed HttpOnly cookie without overwriting category/subCategory", async () => {
    const updatedRow = makeToolRow({ isPinned: true });
    mockReturning.mockResolvedValueOnce([updatedRow]);

    const [req, ctx] = makePatchRequest(
      "42",
      { isPinned: true },
      {
        headers: { origin: "http://localhost" },
        cookie: makeSessionCookieHeader(),
      },
    );
    const res = await PATCH(req, ctx);

    expect(res.status).toBe(200);
    expect(mockRevalidateTag).toHaveBeenCalledTimes(1);
    expect(mockRevalidateTag).toHaveBeenCalledWith("tools", { expire: 0 });
    const json = await res.json();
    expect(json.tool.id).toBe(42);
    expect(json.tool.isPinned).toBe(true);

    const setPayload = getSetPayload(0);
    expect(setPayload.isPinned).toBe(true);
    expect(setPayload.updatedAt).toBeInstanceOf(Date);
    expect("category" in setPayload).toBe(false);
    expect("subCategory" in setPayload).toBe(false);
    expect("secondarySubCategories" in setPayload).toBe(false);
    expect("searchText" in setPayload).toBe(false);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("returns 200 when updating userNotes with a string or null and recalculates searchText", async () => {
    const cookie = makeSessionCookieHeader();
    mockSelectLimit.mockResolvedValueOnce([makeToolRow()]);
    mockReturning.mockResolvedValueOnce([
      makeToolRow({ userNotes: "Dùng cho backend dự án mới" }),
    ]);

    const [req1, ctx1] = makePatchRequest(
      "42",
      { userNotes: "Dùng cho backend dự án mới" },
      { headers: { origin: "http://localhost" }, cookie },
    );
    const res1 = await PATCH(req1, ctx1);
    expect(res1.status).toBe(200);
    expect(getSetPayload(0).userNotes).toBe("Dùng cho backend dự án mới");
    expect(String(getSetPayload(0).searchText)).toContain(
      "dung cho backend du an moi",
    );

    mockSelectLimit.mockResolvedValueOnce([
      makeToolRow({ userNotes: "Ghi chú cũ" }),
    ]);
    mockReturning.mockResolvedValueOnce([makeToolRow({ userNotes: null })]);
    const [req2, ctx2] = makePatchRequest(
      "42",
      { userNotes: null },
      { headers: { origin: "http://localhost" }, cookie },
    );
    const res2 = await PATCH(req2, ctx2);
    expect(res2.status).toBe(200);
    expect(getSetPayload(1).userNotes).toBeNull();
    expect(String(getSetPayload(1).searchText)).not.toContain("ghi chu cu");
    expect(mockRevalidateTag).toHaveBeenCalledTimes(2);
    expect(mockRevalidateTag).toHaveBeenNthCalledWith(1, "tools", {
      expire: 0,
    });
    expect(mockRevalidateTag).toHaveBeenNthCalledWith(2, "tools", {
      expire: 0,
    });
  });

  it("returns 200 when updating subCategory and atomically syncs category, removes duplicate, and updates searchText", async () => {
    mockSelectLimit.mockResolvedValueOnce([makeToolRow()]);
    const updatedRow = makeToolRow({
      isPinned: true,
      userNotes: "Cập nhật phân loại chuẩn",
      category: "dev-engineering",
      subCategory: "database-orm",
      secondarySubCategories: ["cli-dev-env"],
    });
    mockReturning.mockResolvedValueOnce([updatedRow]);

    const [req, ctx] = makePatchRequest(
      "42",
      {
        isPinned: true,
        userNotes: "Cập nhật phân loại chuẩn",
        subCategory: "database-orm",
      },
      {
        headers: { origin: "http://localhost" },
        cookie: makeSessionCookieHeader(),
      },
    );
    const res = await PATCH(req, ctx);

    expect(res.status).toBe(200);
    expect(mockRevalidateTag).toHaveBeenCalledTimes(1);
    expect(mockRevalidateTag).toHaveBeenCalledWith("tools", { expire: 0 });
    const json = await res.json();
    expect(json.tool.category).toBe("dev-engineering");
    expect(json.tool.subCategory).toBe("database-orm");
    expect(json.tool.isPinned).toBe(true);
    expect(json.tool.userNotes).toBe("Cập nhật phân loại chuẩn");

    const setPayload = getSetPayload(0);

    expect(setPayload.isPinned).toBe(true);
    expect(setPayload.userNotes).toBe("Cập nhật phân loại chuẩn");
    expect(setPayload.subCategory).toBe("database-orm");
    expect(setPayload.category).toBe("dev-engineering");
    expect(String(setPayload.searchText)).toContain("database orm");
    expect(String(setPayload.searchText)).toContain("cap nhat phan loai chuan");
    expect(setPayload.updatedAt).toBeInstanceOf(Date);

    const compiled = new PgDialect().sqlToQuery(
      setPayload.secondarySubCategories as Parameters<
        PgDialect["sqlToQuery"]
      >[0],
    );
    expect(compiled.sql).toContain("array_remove(");
    expect(compiled.sql).toContain('"secondary_sub_categories"');
    expect(compiled.sql).toContain("::text");
    expect(compiled.params).toEqual(["database-orm"]);
  });

  it("returns 200 when updating subCategory alone across category boundaries", async () => {
    mockSelectLimit.mockResolvedValueOnce([makeToolRow()]);
    const updatedRow = makeToolRow({
      category: "ai-llm",
      subCategory: "ai-coding-agent",
      secondarySubCategories: [],
    });
    mockReturning.mockResolvedValueOnce([updatedRow]);

    const [req, ctx] = makePatchRequest(
      "42",
      { subCategory: "ai-coding-agent" },
      {
        headers: { origin: "http://localhost" },
        cookie: makeSessionCookieHeader(),
      },
    );
    const res = await PATCH(req, ctx);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tool.category).toBe("ai-llm");
    expect(json.tool.subCategory).toBe("ai-coding-agent");

    const setPayload = getSetPayload(0);
    expect(setPayload.subCategory).toBe("ai-coding-agent");
    expect(setPayload.category).toBe("ai-llm");
    expect(String(setPayload.searchText)).toContain("ai coding agent");
    expect(setPayload.updatedAt).toBeInstanceOf(Date);
    expect("isPinned" in setPayload).toBe(false);
    expect("userNotes" in setPayload).toBe(false);
  });

  it("returns 500 when database throws an unexpected error and redacts credentials in logs", async () => {
    mockReturning.mockRejectedValueOnce(
      new Error(
        "Connection failed for postgresql://admin:topsecret@ep-demo.neon.tech/neondb?sslmode=require",
      ),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const [req, ctx] = makePatchRequest(
      "42",
      { isPinned: true },
      {
        headers: { origin: "http://localhost" },
        cookie: makeSessionCookieHeader(),
      },
    );
    const res = await PATCH(req, ctx);

    expect(res.status).toBe(500);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ error: "Internal server error" });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[1]).toBe(
      "Connection failed for [REDACTED_DATABASE_URL]",
    );
    expect(String(errorSpy.mock.calls[0]?.[1])).not.toContain("topsecret");
  });
});
