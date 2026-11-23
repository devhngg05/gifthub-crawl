import { PgDialect } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolRow } from "@/db/schema";

const {
  mockSelectLimit,
  mockSelect,
  mockReturning,
  mockWhere,
  mockSet,
  mockUpdate,
} = vi.hoisted(() => {
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
    mockSelectLimit,
    mockSelect,
    mockReturning,
    mockWhere,
    mockSet,
    mockUpdate,
  };
});

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
  headers: Record<string, string> = {},
): [NextRequest, { params: Promise<{ id: string }> }] {
  const isRawString = typeof body === "string";
  const request = new NextRequest(`http://localhost/api/tools/${id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: isRawString ? body : JSON.stringify(body),
  });

  return [request, { params: Promise.resolve({ id }) }];
}

function getSetPayload(callIndex = 0): Record<string, unknown> {
  const payload = mockSet.mock.calls[callIndex]?.[0];
  expect(payload).toBeDefined();
  return payload!;
}

describe("PATCH /api/tools/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ADMIN_SECRET", "test-admin-secret");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns 401 when x-admin-secret header is missing or invalid without touching DB", async () => {
    const [missingReq, missingCtx] = makePatchRequest("42", { isPinned: true });
    const missingRes = await PATCH(missingReq, missingCtx);

    expect(missingRes.status).toBe(401);
    expect(await missingRes.json()).toEqual({ error: "Unauthorized" });

    const [wrongReq, wrongCtx] = makePatchRequest(
      "42",
      { isPinned: true },
      { "x-admin-secret": "wrong-secret" },
    );
    const wrongRes = await PATCH(wrongReq, wrongCtx);

    expect(wrongRes.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 503 in production when ADMIN_SECRET is missing without touching DB", async () => {
    vi.stubEnv("ADMIN_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");

    const [req, ctx] = makePatchRequest(
      "42",
      { isPinned: true },
      { "x-admin-secret": "anything" },
    );
    const res = await PATCH(req, ctx);

    expect(res.status).toBe(503);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid tool id params", async () => {
    for (const badId of ["0", "-5", "abc", "3.14"]) {
      const [req, ctx] = makePatchRequest(
        badId,
        { isPinned: true },
        { "x-admin-secret": "test-admin-secret" },
      );
      const res = await PATCH(req, ctx);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid tool id");
    }
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when request body is malformed JSON", async () => {
    const [req, ctx] = makePatchRequest("42", "{not-valid-json", {
      "x-admin-secret": "test-admin-secret",
    });
    const res = await PATCH(req, ctx);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 for empty body, forbidden extra fields, unknown subCategory, or oversized userNotes", async () => {
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
        "x-admin-secret": "test-admin-secret",
      });
      const res = await PATCH(req, ctx);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid request payload");
      expect(json.details).toBeDefined();
    }
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when no tool matches the given id", async () => {
    mockReturning.mockResolvedValueOnce([]);

    const [req, ctx] = makePatchRequest(
      "9999",
      { isPinned: true },
      { "x-admin-secret": "test-admin-secret" },
    );
    const res = await PATCH(req, ctx);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Tool not found" });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledTimes(1);
  });

  it("returns 200 when updating isPinned only without overwriting category/subCategory", async () => {
    const updatedRow = makeToolRow({ isPinned: true });
    mockReturning.mockResolvedValueOnce([updatedRow]);

    const [req, ctx] = makePatchRequest(
      "42",
      { isPinned: true },
      { "x-admin-secret": "test-admin-secret" },
    );
    const res = await PATCH(req, ctx);

    expect(res.status).toBe(200);
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
    mockSelectLimit.mockResolvedValueOnce([makeToolRow()]);
    mockReturning.mockResolvedValueOnce([
      makeToolRow({ userNotes: "Dùng cho backend dự án mới" }),
    ]);

    const [req1, ctx1] = makePatchRequest(
      "42",
      { userNotes: "Dùng cho backend dự án mới" },
      { "x-admin-secret": "test-admin-secret" },
    );
    const res1 = await PATCH(req1, ctx1);
    expect(res1.status).toBe(200);
    expect(getSetPayload(0).userNotes).toBe("Dùng cho backend dự án mới");
    expect(String(getSetPayload(0).searchText)).toContain("dung cho backend du an moi");

    mockSelectLimit.mockResolvedValueOnce([
      makeToolRow({ userNotes: "Ghi chú cũ" }),
    ]);
    mockReturning.mockResolvedValueOnce([makeToolRow({ userNotes: null })]);
    const [req2, ctx2] = makePatchRequest(
      "42",
      { userNotes: null },
      { "x-admin-secret": "test-admin-secret" },
    );
    const res2 = await PATCH(req2, ctx2);
    expect(res2.status).toBe(200);
    expect(getSetPayload(1).userNotes).toBeNull();
    expect(String(getSetPayload(1).searchText)).not.toContain("ghi chu cu");
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
      { "x-admin-secret": "test-admin-secret" },
    );
    const res = await PATCH(req, ctx);

    expect(res.status).toBe(200);
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
      { "x-admin-secret": "test-admin-secret" },
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
      { "x-admin-secret": "test-admin-secret" },
    );
    const res = await PATCH(req, ctx);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[1]).toBe(
      "Connection failed for [REDACTED_DATABASE_URL]",
    );
    expect(String(errorSpy.mock.calls[0]?.[1])).not.toContain("topsecret");
  });
});
