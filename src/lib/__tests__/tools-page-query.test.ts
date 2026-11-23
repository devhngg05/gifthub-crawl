import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncLogs, tools, type ToolRow } from "@/db/schema";
import type { NewsfeedToolRow } from "@/lib/newsfeed";
import { parseSearchQuery } from "@/lib/search-engine";
import type { ToolCountBucket, ToolFilters } from "@/lib/ui-helpers";

interface RecordedSelectCall {
  fields: Record<string, unknown> | undefined;
  type: "groupBy" | "count" | "items" | "newsfeedTools" | "latestSyncLog";
  fromTable: unknown;
  groupByCols?: unknown[];
  whereClause: SQL | undefined;
  orderByClauses?: unknown[];
  limit?: number;
  offset?: number;
}

interface RecordedCacheCall {
  keyParts: string[] | undefined;
  options: { revalidate?: number | false; tags?: string[] } | undefined;
}

const {
  recordedCalls,
  recordedCacheCalls,
  mockUnstableCache,
  setDbMockHandlers,
  resetDbMockHandlers,
  mockSelect,
} = vi.hoisted(() => {
  const recordedCalls: RecordedSelectCall[] = [];
  const recordedCacheCalls: RecordedCacheCall[] = [];

  const mockUnstableCache = vi.fn(
    <T extends (...args: never[]) => Promise<unknown>>(
      cb: T,
      keyParts?: string[],
      options?: { revalidate?: number | false; tags?: string[] },
    ): T => {
      recordedCacheCalls.push({ keyParts, options });
      return cb;
    },
  );

  type GroupByHandler = () => Promise<ToolCountBucket[]>;
  type CountHandler = (ctx: {
    whereClause: SQL | undefined;
    callIndex: number;
  }) => Promise<Array<{ count: number }>>;
  type ItemsHandler = (ctx: {
    whereClause: SQL | undefined;
    orderByClauses: unknown[];
    limit: number;
    offset: number;
    callIndex: number;
  }) => Promise<ToolRow[]>;
  type NewsfeedToolsHandler = () => Promise<NewsfeedToolRow[]>;
  type LatestSyncLogHandler = () => Promise<Array<{ ranAt: Date | string }>>;

  let groupByHandler: GroupByHandler = async () => [];
  let countHandler: CountHandler = async () => [{ count: 0 }];
  let itemsHandler: ItemsHandler = async () => [];
  let newsfeedToolsHandler: NewsfeedToolsHandler = async () => [];
  let latestSyncLogHandler: LatestSyncLogHandler = async () => [];
  let countCallIndex = 0;
  let itemsCallIndex = 0;

  function setDbMockHandlers(handlers: {
    onGroupBy?: GroupByHandler;
    onCount?: CountHandler;
    onItems?: ItemsHandler;
    onNewsfeedTools?: NewsfeedToolsHandler;
    onLatestSyncLog?: LatestSyncLogHandler;
  }) {
    if (handlers.onGroupBy) {
      groupByHandler = handlers.onGroupBy;
    }
    if (handlers.onCount) {
      countHandler = handlers.onCount;
    }
    if (handlers.onItems) {
      itemsHandler = handlers.onItems;
    }
    if (handlers.onNewsfeedTools) {
      newsfeedToolsHandler = handlers.onNewsfeedTools;
    }
    if (handlers.onLatestSyncLog) {
      latestSyncLogHandler = handlers.onLatestSyncLog;
    }
  }

  function resetDbMockHandlers() {
    recordedCalls.length = 0;
    countCallIndex = 0;
    itemsCallIndex = 0;
    groupByHandler = async () => [];
    countHandler = async () => [{ count: 0 }];
    itemsHandler = async () => [];
    newsfeedToolsHandler = async () => [];
    latestSyncLogHandler = async () => [];
  }

  const mockSelect = vi.fn((fields?: Record<string, unknown>) => ({
    from: vi.fn((fromTable: unknown) => ({
      then<TResult1 = NewsfeedToolRow[], TResult2 = never>(
        onfulfilled?:
          | ((value: NewsfeedToolRow[]) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | null,
      ) {
        recordedCalls.push({
          fields,
          type: "newsfeedTools",
          fromTable,
          whereClause: undefined,
        });
        return newsfeedToolsHandler().then(onfulfilled, onrejected);
      },
      groupBy: vi.fn((...groupByCols: unknown[]) => {
        recordedCalls.push({
          fields,
          type: "groupBy",
          fromTable,
          groupByCols,
          whereClause: undefined,
        });
        return groupByHandler();
      }),
      where: vi.fn((whereClause?: SQL) => ({
        then<TResult1 = Array<{ count: number }>, TResult2 = never>(
          onfulfilled?:
            | ((value: Array<{ count: number }>) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?:
            | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
            | null,
        ) {
          const idx = countCallIndex++;
          recordedCalls.push({
            fields,
            type: "count",
            fromTable,
            whereClause,
          });
          return countHandler({ whereClause, callIndex: idx }).then(
            onfulfilled,
            onrejected,
          );
        },
        orderBy: vi.fn((...orderByClauses: unknown[]) => ({
          limit: vi.fn((limit: number) => ({
            then<
              TResult1 = Array<{ ranAt: Date | string }>,
              TResult2 = never,
            >(
              onfulfilled?:
                | ((
                    value: Array<{ ranAt: Date | string }>,
                  ) => TResult1 | PromiseLike<TResult1>)
                | null,
              onrejected?:
                | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
                | null,
            ) {
              recordedCalls.push({
                fields,
                type: "latestSyncLog",
                fromTable,
                whereClause,
                orderByClauses,
                limit,
              });
              return latestSyncLogHandler().then(onfulfilled, onrejected);
            },
            offset: vi.fn((offset: number) => {
              const idx = itemsCallIndex++;
              recordedCalls.push({
                fields,
                type: "items",
                fromTable,
                whereClause,
                orderByClauses,
                limit,
                offset,
              });
              return itemsHandler({
                whereClause,
                orderByClauses,
                limit,
                offset,
                callIndex: idx,
              });
            }),
          })),
        })),
      })),
    })),
  }));

  return {
    recordedCalls,
    recordedCacheCalls,
    mockUnstableCache,
    setDbMockHandlers,
    resetDbMockHandlers,
    mockSelect,
  };
});

vi.mock("next/cache", () => ({
  unstable_cache: mockUnstableCache,
}));

vi.mock("@/db", () => ({
  db: {
    select: mockSelect,
  },
}));

import {
  TOOLS_CACHE_REVALIDATE_SECONDS,
  TOOLS_CACHE_TAG,
  buildFilteredToolsCacheKey,
  fetchNewsfeedPageData,
  fetchSidebarCountBuckets,
  fetchSidebarCountRows,
  queryToolsPageData,
} from "@/lib/queries/tools-page-query";

const initialCacheCalls = recordedCacheCalls.slice();

function compileSql(expr: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(expr);
}

function makeToolRow(overrides: Partial<ToolRow> = {}): ToolRow {
  const now = new Date("2026-11-22T10:00:00.000Z");
  return {
    id: 1,
    githubId: 1001,
    name: "drizzle-orm",
    fullName: "drizzle-team/drizzle-orm",
    htmlUrl: "https://github.com/drizzle-team/drizzle-orm",
    stars: 28000,
    language: "TypeScript",
    lastPushedAt: now,
    readmeSha: "sha-1",
    summaryVi: "ORM nhẹ và an toàn kiểu dữ liệu cho SQL.",
    category: "dev-engineering",
    subCategory: "database-orm",
    secondarySubCategories: [],
    useCases: ["ORM TypeScript"],
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

const defaultFilters: ToolFilters = {
  category: undefined,
  subCategory: undefined,
  usability: undefined,
  pinned: false,
  q: "",
  sort: "stars",
  page: 1,
};

function flushAsyncTicks(delayMs = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

describe("fetchSidebarCountBuckets & queryToolsPageData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockHandlers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchSidebarCountBuckets truy vấn GROUP BY (subCategory, isPinned) kèm count(*)::int và giữ alias tương thích", async () => {
    const sampleBuckets: ToolCountBucket[] = [
      { subCategory: "database-orm", isPinned: true, count: 2 },
      { subCategory: "database-orm", isPinned: false, count: 5 },
      { subCategory: "uncategorized", isPinned: false, count: 3 },
    ];
    setDbMockHandlers({
      onGroupBy: async () => sampleBuckets,
    });

    const buckets = await fetchSidebarCountBuckets();
    expect(buckets).toEqual(sampleBuckets);
    expect(fetchSidebarCountRows).toBe(fetchSidebarCountBuckets);

    expect(recordedCalls).toHaveLength(1);
    const call = recordedCalls[0];
    expect(call?.type).toBe("groupBy");
    expect(call?.fromTable).toBe(tools);
    expect(call?.groupByCols).toEqual([tools.subCategory, tools.isPinned]);
    expect(call?.fields?.subCategory).toBe(tools.subCategory);
    expect(call?.fields?.isPinned).toBe(tools.isPinned);

    const compiledCount = compileSql(call?.fields?.count as SQL);
    expect(compiledCount.sql).toBe("count(*)::int");
  });

  it("queryToolsPageData chạy song song truy vấn lọc và đếm bucket Sidebar ở happy path", async () => {
    const sampleItems = [
      makeToolRow({ id: 1, isPinned: true }),
      makeToolRow({ id: 2, name: "prisma", fullName: "prisma/prisma" }),
    ];
    setDbMockHandlers({
      onGroupBy: async () => [
        { subCategory: "database-orm", isPinned: true, count: 2 },
        { subCategory: "database-orm", isPinned: false, count: 8 },
        { subCategory: "ai-coding-agent", isPinned: false, count: 4 },
        { subCategory: "legacy-sub", isPinned: true, count: 1 },
      ],
      onCount: async () => [{ count: 15 }],
      onItems: async () => sampleItems,
    });

    const result = await queryToolsPageData(defaultFilters, parseSearchQuery(""));

    expect(result.filteredTotal).toBe(15);
    expect(result.items).toEqual(sampleItems);
    expect(result.isRelaxedSearch).toBe(false);
    expect(result.counts.totalCount).toBe(15);
    expect(result.counts.pinnedCount).toBe(3);
    expect(result.counts.uncategorizedCount).toBe(1);
    expect(result.counts.subCategoryCounts).toEqual({
      "database-orm": 10,
      "ai-coding-agent": 4,
      uncategorized: 1,
    });
    expect(result.counts.categoryCounts["dev-engineering"]).toBe(10);
    expect(result.counts.categoryCounts["ai-llm"]).toBe(4);
  });

  it("tự động fallback sang Tầng 2 (isRelaxedSearch: true) khi Tầng 1 trả về 0 kết quả", async () => {
    const relaxedItem = makeToolRow({
      id: 9,
      subCategory: "ai-coding-agent",
      category: "ai-llm",
    });

    setDbMockHandlers({
      onGroupBy: async () => [
        { subCategory: "ai-coding-agent", isPinned: false, count: 1 },
      ],
      onCount: async ({ callIndex }) => {
        // Lần 0: Tầng 1 (strict) = 0; Lần 1: Tầng 2 (relaxed) = 1
        return callIndex === 0 ? [{ count: 0 }] : [{ count: 1 }];
      },
      onItems: async () => [relaxedItem],
    });

    const filters: ToolFilters = {
      ...defaultFilters,
      q: "lap trinh ai",
      sort: "relevance",
    };
    const result = await queryToolsPageData(
      filters,
      parseSearchQuery(filters.q),
    );

    expect(result.filteredTotal).toBe(1);
    expect(result.items).toEqual([relaxedItem]);
    expect(result.isRelaxedSearch).toBe(true);
    expect(result.counts.totalCount).toBe(1);
    expect(recordedCalls.filter((c) => c.type === "count")).toHaveLength(2);
    expect(recordedCalls.filter((c) => c.type === "items")).toHaveLength(1);
  });

  it("tự động fallback sang useTrgm=false khi PostgreSQL báo thiếu pg_trgm (42883)", async () => {
    const pgTrgmErr = Object.assign(
      new Error("function word_similarity(text, text) does not exist"),
      { code: "42883" },
    );
    const fallbackItem = makeToolRow({ id: 12, name: "ollama" });

    setDbMockHandlers({
      onGroupBy: async () => [
        { subCategory: "local-llm-gateway", isPinned: false, count: 1 },
      ],
      onCount: async ({ callIndex }) => {
        // callIndex 0: Tầng 1 (useTrgm: true) trả về 0
        // callIndex 1: Tầng 2 (useTrgm: true) lỗi thiếu word_similarity -> catch chuyển sang useTrgm: false
        // callIndex 2: Tầng 1 (useTrgm: false) trả về 0
        // callIndex 3: Tầng 2 (useTrgm: false) trả về 1
        if (callIndex === 1) {
          throw pgTrgmErr;
        }
        if (callIndex === 3) {
          return [{ count: 1 }];
        }
        return [{ count: 0 }];
      },
      onItems: async () => [fallbackItem],
    });

    const filters: ToolFilters = {
      ...defaultFilters,
      q: "local llm",
      sort: "relevance",
    };
    const result = await queryToolsPageData(
      filters,
      parseSearchQuery(filters.q),
    );

    expect(result.filteredTotal).toBe(1);
    expect(result.items).toEqual([fallbackItem]);
    expect(result.isRelaxedSearch).toBe(true);

    const itemsCall = recordedCalls.find((c) => c.type === "items");
    const orderSql = itemsCall?.orderByClauses
      ?.map((clause) => compileSql(clause as SQL).sql)
      .join(" ");
    expect(orderSql).not.toContain("word_similarity");
    expect(orderSql).not.toContain("similarity(");
  });

  it("không phát sinh unhandledRejection khi queryFilteredTools lỗi trước và fetchSidebarCountBuckets reject trễ", async () => {
    const primaryErr = new Error("Primary tools query failed");
    const delayedCountErr = new Error("Delayed sidebar count failed");
    const unhandledSpy = vi.fn();
    process.on("unhandledRejection", unhandledSpy);

    try {
      setDbMockHandlers({
        onCount: async () => {
          throw primaryErr;
        },
        onGroupBy: () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(delayedCountErr), 10);
          }),
      });

      await expect(
        queryToolsPageData(defaultFilters, parseSearchQuery("")),
      ).rejects.toThrow("Primary tools query failed");

      await flushAsyncTicks(30);
      expect(unhandledSpy).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandledSpy);
    }
  });

  it("không phát sinh unhandledRejection khi fetchSidebarCountBuckets lỗi trước và queryFilteredTools reject trễ", async () => {
    const countErr = new Error("Sidebar count failed first");
    const delayedQueryErr = new Error("Delayed filtered query failed");
    const unhandledSpy = vi.fn();
    process.on("unhandledRejection", unhandledSpy);

    try {
      setDbMockHandlers({
        onGroupBy: async () => {
          throw countErr;
        },
        onCount: () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(delayedQueryErr), 10);
          }),
      });

      await expect(
        queryToolsPageData(defaultFilters, parseSearchQuery("")),
      ).rejects.toThrow("Sidebar count failed first");

      await flushAsyncTicks(30);
      expect(unhandledSpy).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandledSpy);
    }
  });

  it("ném lại đúng lỗi gốc khi chỉ một nhánh gặp lỗi không phải pg_trgm", async () => {
    const dbFailure = new Error("Neon connection timeout");
    setDbMockHandlers({
      onGroupBy: async () => [
        { subCategory: "database-orm", isPinned: false, count: 2 },
      ],
      onCount: async () => {
        throw dbFailure;
      },
    });

    await expect(
      queryToolsPageData(defaultFilters, parseSearchQuery("")),
    ).rejects.toBe(dbFailure);
  });

  it("bọc fetchSidebarCountBuckets, fetchNewsfeedPageData và queryToolsPageData bằng unstable_cache với revalidate 300s và tag tools", async () => {
    expect(TOOLS_CACHE_REVALIDATE_SECONDS).toBe(300);
    expect(TOOLS_CACHE_TAG).toBe("tools");

    expect(initialCacheCalls).toEqual(
      expect.arrayContaining([
        {
          keyParts: ["tools-sidebar-counts"],
          options: { revalidate: 300, tags: ["tools"] },
        },
        {
          keyParts: ["tools-newsfeed-data"],
          options: { revalidate: 300, tags: ["tools"] },
        },
      ]),
    );

    const filters: ToolFilters = {
      category: "ai-llm",
      subCategory: "ai-coding-agent",
      usability: "app-ready",
      pinned: true,
      q: "claude, code",
      sort: "relevance",
      page: 2,
    };
    const parsedQuery = parseSearchQuery(filters.q);

    await queryToolsPageData(filters, parsedQuery);

    expect(mockUnstableCache).toHaveBeenCalledTimes(1);
    expect(mockUnstableCache).toHaveBeenCalledWith(
      expect.any(Function),
      buildFilteredToolsCacheKey(filters, parsedQuery),
      { revalidate: 300, tags: ["tools"] },
    );
  });

  it("buildFilteredToolsCacheKey tạo khóa cache khác nhau cho mọi tham số lọc, tìm kiếm, sắp xếp và trang", () => {
    const baseFilters: ToolFilters = { ...defaultFilters };
    const baseKey = buildFilteredToolsCacheKey(
      baseFilters,
      parseSearchQuery(baseFilters.q),
    ).join(",");

    const variants: ToolFilters[] = [
      { ...baseFilters, category: "ai-llm" },
      { ...baseFilters, subCategory: "database-orm" },
      { ...baseFilters, usability: "cli-tool" },
      { ...baseFilters, pinned: true },
      { ...baseFilters, q: "drizzle" },
      { ...baseFilters, q: "drizzle,orm" },
      { ...baseFilters, sort: "recent" },
      { ...baseFilters, page: 3 },
    ];

    const keys = new Set<string>([baseKey]);
    for (const variant of variants) {
      const key = buildFilteredToolsCacheKey(
        variant,
        parseSearchQuery(variant.q),
      ).join(",");
      expect(keys.has(key)).toBe(false);
      keys.add(key);
    }
  });

  it("fetchNewsfeedPageData trả về danh sách công cụ và thời điểm đồng bộ mới nhất dạng ISO", async () => {
    const sampleTool = makeToolRow({ id: 99, name: "goose" });
    const ranAt = new Date("2026-11-23T12:00:00.000Z");

    setDbMockHandlers({
      onNewsfeedTools: async () => [sampleTool],
      onLatestSyncLog: async () => [{ ranAt }],
    });

    const result = await fetchNewsfeedPageData();
    expect(result.allTools).toEqual([sampleTool]);
    expect(result.latestRanAtIso).toBe("2026-11-23T12:00:00.000Z");

    const newsfeedCall = recordedCalls.find((c) => c.type === "newsfeedTools");
    const syncCall = recordedCalls.find((c) => c.type === "latestSyncLog");
    expect(newsfeedCall?.fromTable).toBe(tools);
    expect(syncCall?.fromTable).toBe(syncLogs);
    expect(syncCall?.limit).toBe(1);

    setDbMockHandlers({
      onNewsfeedTools: async () => [],
      onLatestSyncLog: async () => [],
    });

    const emptyResult = await fetchNewsfeedPageData();
    expect(emptyResult).toEqual({ allTools: [], latestRanAtIso: null });
  });
});
