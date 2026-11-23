import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockLimit, mockSelect, mockWhere } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
  const mockWhere = vi.fn((condition?: SQL) => {
    void condition;
    return { orderBy: mockOrderBy };
  });
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { mockLimit, mockSelect, mockWhere };
});

vi.mock("@/db", () => ({
  db: {
    select: mockSelect,
  },
}));

import { GET } from "@/app/api/tools/suggest/route";

describe("GET /api/tools/suggest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty suggestions immediately for queries shorter than 2 chars without querying DB", async () => {
    const req = new NextRequest("http://localhost/api/tools/suggest?q=a");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tools: [], categories: [] });
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("returns 400 when q exceeds 120 characters", async () => {
    const longQ = "a".repeat(121);
    const req = new NextRequest(`http://localhost/api/tools/suggest?q=${longQ}`);
    const res = await GET(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid query parameter");
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("returns up to 6 matching tools and up to 3 suggested sub-categories from parseSearchQuery", async () => {
    const fakeTools = [
      {
        id: 1,
        name: "n8n",
        fullName: "n8n-io/n8n",
        summaryVi: "Nền tảng tự động hóa workflow và nối API.",
        subCategory: "workflow-orchestration",
        stars: 50000,
        usability: "app-ready",
      },
    ];
    mockLimit.mockResolvedValueOnce(fakeTools);

    const req = new NextRequest(
      `http://localhost/api/tools/suggest?q=${encodeURIComponent("nối API")}`,
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      tools: typeof fakeTools;
      categories: Array<{ slug: string; label: string; categoryLabel: string }>;
    };
    expect(json.tools).toEqual(fakeTools);
    expect(json.categories.length).toBeGreaterThan(0);
    expect(json.categories.length).toBeLessThanOrEqual(3);
    expect(json.categories.map((c) => c.slug)).toContain("api-gateway-webhook");
    expect(mockLimit).toHaveBeenCalledWith(6);
  });

  it("never runs or merges Tier 2 relaxed search when Tier 1 strict returns >= 1 tool for 'coding-interview-university'", async () => {
    const codingInterviewTool = {
      id: 5,
      name: "coding-interview-university",
      fullName: "jwasham/coding-interview-university",
      summaryVi: "Kế hoạch tự học khoa học máy tính chuẩn bị phỏng vấn.",
      subCategory: "code-quality-docs",
      stars: 364828,
      usability: "dev-required",
    };

    mockLimit.mockResolvedValueOnce([codingInterviewTool]);

    const req = new NextRequest(
      "http://localhost/api/tools/suggest?q=coding-interview-university",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      tools: typeof codingInterviewTool[];
    };
    expect(json.tools).toEqual([codingInterviewTool]);
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockLimit).toHaveBeenCalledTimes(1);
  });

  it("falls back to Tier 2 relaxed search using tight trigram threshold when Tier 1 returns 0 rows", async () => {
    const relaxedRow = {
      id: 7,
      name: "bruno",
      fullName: "usebruno/bruno",
      summaryVi: "Trình test REST/GraphQL API thay Postman.",
      subCategory: "api-client-testing",
      stars: 28000,
      usability: "app-ready",
    };

    mockLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([relaxedRow]);

    const req = new NextRequest("http://localhost/api/tools/suggest?q=posman");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tools).toEqual([relaxedRow]);
    expect(mockLimit).toHaveBeenCalledTimes(2);

    const relaxedWhereArg = mockWhere.mock.calls[1]?.[0];
    expect(relaxedWhereArg).toBeDefined();
    const compiledRelaxed = new PgDialect().sqlToQuery(relaxedWhereArg!);
    expect(compiledRelaxed.sql).toContain(">= 0.45");
    expect(compiledRelaxed.sql).not.toContain("sub_category");
  });

  it("falls back gracefully without pg_trgm if DB throws SQLSTATE 42883, and returns safe 500 on unexpected errors", async () => {
    const relaxedRow = {
      id: 8,
      name: "hoppscotch",
      fullName: "hoppscotch/hoppscotch",
      summaryVi: "API development ecosystem.",
      subCategory: "api-client-testing",
      stars: 65000,
      usability: "app-ready",
    };

    mockLimit
      .mockRejectedValueOnce({ code: "42883", message: "function word_similarity does not exist" })
      .mockResolvedValueOnce([relaxedRow]);

    const resOk = await GET(
      new NextRequest("http://localhost/api/tools/suggest?q=postman"),
    );
    expect(resOk.status).toBe(200);
    expect((await resOk.json()).tools).toEqual([relaxedRow]);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockLimit.mockRejectedValueOnce(
      new Error("postgresql://admin:supersecret@ep-demo.neon.tech/neondb"),
    );

    const resErr = await GET(
      new NextRequest("http://localhost/api/tools/suggest?q=ollama"),
    );
    expect(resErr.status).toBe(500);
    expect(await resErr.json()).toEqual({ error: "Internal server error" });
    expect(String(errorSpy.mock.calls[0]?.[1])).not.toContain("supersecret");
  });
});
