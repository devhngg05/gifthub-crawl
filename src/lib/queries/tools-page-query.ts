import { and, desc, gt, sql, type SQL } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/db";
import { syncLogs, tools, type ToolRow } from "@/db/schema";
import type { NewsfeedToolRow } from "@/lib/newsfeed";
import type { ParsedSearchQuery } from "@/lib/search-engine";
import {
  buildRelaxedToolSearchCondition,
  buildSearchRelevanceScore,
  buildToolBaseFilterConditions,
  buildToolOrderByClauses,
  buildToolSearchCondition,
  isMissingPgTrgmError,
} from "@/lib/tool-query";
import {
  computePagination,
  computeToolCounts,
  DEFAULT_PAGE_SIZE,
  type ToolCountBucket,
  type ToolCounts,
  type ToolFilters,
} from "@/lib/ui-helpers";

/** Tag cache chung cho các truy vấn đọc dữ liệu công cụ công khai. */
export const TOOLS_CACHE_TAG = "tools";

/** Thời gian tự làm mới cache truy vấn công khai (300 giây). */
export const TOOLS_CACHE_REVALIDATE_SECONDS = 300;

/**
 * Tạo danh sách phần khóa cache bao gồm đầy đủ tham số lọc, tìm kiếm, sắp xếp và phân trang
 * để `unstable_cache` không trả nhầm kết quả giữa các bộ lọc khác nhau.
 */
export function buildFilteredToolsCacheKey(
  filters: ToolFilters,
  parsedQuery: ParsedSearchQuery,
): string[] {
  return [
    "tools-filtered-list",
    `category:${filters.category ?? ""}`,
    `subCategory:${filters.subCategory ?? ""}`,
    `usability:${filters.usability ?? ""}`,
    `pinned:${filters.pinned ? "1" : "0"}`,
    `q:${encodeURIComponent(filters.q)}`,
    `normalizedQ:${encodeURIComponent(parsedQuery.normalizedQuery)}`,
    `sort:${filters.sort}`,
    `page:${filters.page}`,
  ];
}

const getCachedSidebarCountBuckets = unstable_cache(
  async (): Promise<ToolCountBucket[]> =>
    db
      .select({
        subCategory: tools.subCategory,
        isPinned: tools.isPinned,
        count: sql<number>`count(*)::int`,
      })
      .from(tools)
      .groupBy(tools.subCategory, tools.isPinned),
  ["tools-sidebar-counts"],
  {
    revalidate: TOOLS_CACHE_REVALIDATE_SECONDS,
    tags: [TOOLS_CACHE_TAG],
  },
);

/** Truy vấn gộp nhóm ngay trên PostgreSQL phục vụ đếm số lượng 1–1 trên Sidebar (`totalCount`, `pinnedCount`, `uncategorizedCount`, từng nhóm/ngách). */
export async function fetchSidebarCountBuckets(): Promise<ToolCountBucket[]> {
  return getCachedSidebarCountBuckets();
}

/** Alias tương thích ngược cho `fetchSidebarCountBuckets`. */
export const fetchSidebarCountRows = fetchSidebarCountBuckets;

async function queryFilteredTools(params: {
  baseConditions: readonly SQL[];
  filters: ToolFilters;
  parsedQuery: ParsedSearchQuery;
  useTrgm: boolean;
}): Promise<{
  filteredTotal: number;
  items: ToolRow[];
  isRelaxedSearch: boolean;
}> {
  const { baseConditions, filters, parsedQuery, useTrgm } = params;
  const hasQuery = parsedQuery.normalizedQuery.length > 0;
  const relevanceScore = hasQuery
    ? buildSearchRelevanceScore(parsedQuery, { useTrgm })
    : undefined;
  const orderByClauses = buildToolOrderByClauses(filters, { relevanceScore });

  const strictSearchCond = hasQuery
    ? buildToolSearchCondition(parsedQuery)
    : undefined;
  const strictWhereConditions = strictSearchCond
    ? [...baseConditions, strictSearchCond]
    : [...baseConditions];
  const strictWhereClause =
    strictWhereConditions.length > 0
      ? and(...strictWhereConditions)
      : undefined;

  const strictCountRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tools)
    .where(strictWhereClause);

  const strictTotal = strictCountRows[0]?.count ?? 0;

  if (strictTotal > 0 || !hasQuery) {
    const pagination = computePagination(
      strictTotal,
      filters.page,
      DEFAULT_PAGE_SIZE,
    );
    const items =
      strictTotal > 0
        ? await db
            .select()
            .from(tools)
            .where(strictWhereClause)
            .orderBy(...orderByClauses)
            .limit(DEFAULT_PAGE_SIZE)
            .offset(pagination.offset)
        : [];
    return {
      filteredTotal: strictTotal,
      items,
      isRelaxedSearch: false,
    };
  }

  // Tầng 2 (Fallback tự động khi Tầng 1 trả về 0 kết quả)
  const relaxedCond = buildRelaxedToolSearchCondition(parsedQuery, { useTrgm });
  if (!relaxedCond) {
    return { filteredTotal: 0, items: [], isRelaxedSearch: false };
  }

  const relaxedConditions = [...baseConditions, relaxedCond];
  const relaxedWhereClause = and(...relaxedConditions);

  const relaxedCountRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tools)
    .where(relaxedWhereClause);

  const relaxedTotal = relaxedCountRows[0]?.count ?? 0;
  if (relaxedTotal === 0) {
    return { filteredTotal: 0, items: [], isRelaxedSearch: false };
  }

  const relaxedPagination = computePagination(
    relaxedTotal,
    filters.page,
    DEFAULT_PAGE_SIZE,
  );
  const items = await db
    .select()
    .from(tools)
    .where(relaxedWhereClause)
    .orderBy(...orderByClauses)
    .limit(DEFAULT_PAGE_SIZE)
    .offset(relaxedPagination.offset);

  return {
    filteredTotal: relaxedTotal,
    items,
    isRelaxedSearch: true,
  };
}

async function queryFilteredToolsWithFallback(params: {
  baseConditions: readonly SQL[];
  filters: ToolFilters;
  parsedQuery: ParsedSearchQuery;
}): Promise<{
  filteredTotal: number;
  items: ToolRow[];
  isRelaxedSearch: boolean;
}> {
  const { baseConditions, filters, parsedQuery } = params;

  try {
    return await queryFilteredTools({
      baseConditions,
      filters,
      parsedQuery,
      useTrgm: true,
    });
  } catch (error) {
    if (isMissingPgTrgmError(error)) {
      return queryFilteredTools({
        baseConditions,
        filters,
        parsedQuery,
        useTrgm: false,
      });
    }
    throw error;
  }
}

async function getCachedFilteredTools(
  filters: ToolFilters,
  parsedQuery: ParsedSearchQuery,
): Promise<{
  filteredTotal: number;
  items: ToolRow[];
  isRelaxedSearch: boolean;
}> {
  const cachedQuery = unstable_cache(
    async () => {
      const baseConditions = buildToolBaseFilterConditions(filters);
      return queryFilteredToolsWithFallback({
        baseConditions,
        filters,
        parsedQuery,
      });
    },
    buildFilteredToolsCacheKey(filters, parsedQuery),
    {
      revalidate: TOOLS_CACHE_REVALIDATE_SECONDS,
      tags: [TOOLS_CACHE_TAG],
    },
  );

  return cachedQuery();
}

/**
 * Truy vấn dữ liệu trang chủ `/` từ Neon PostgreSQL:
 * chạy song song đếm Sidebar 1–1 (đã GROUP BY) và lọc/phân trang 2 tầng (tự fallback khi chưa bật `pg_trgm`),
 * cả hai đều được cache qua `unstable_cache` (300 giây, tag `"tools"`).
 */
export async function queryToolsPageData(
  filters: ToolFilters,
  parsedQuery: ParsedSearchQuery,
): Promise<{
  filteredTotal: number;
  items: ToolRow[];
  isRelaxedSearch: boolean;
  counts: ToolCounts;
}> {
  const [queryResult, countBuckets] = await Promise.all([
    getCachedFilteredTools(filters, parsedQuery),
    fetchSidebarCountBuckets(),
  ]);

  return {
    ...queryResult,
    counts: computeToolCounts(countBuckets),
  };
}

const getCachedNewsfeedPageData = unstable_cache(
  async (): Promise<{
    allTools: NewsfeedToolRow[];
    latestRanAtIso: string | null;
  }> => {
    const [allTools, latestLogs] = await Promise.all([
      db
        .select({
          id: tools.id,
          githubId: tools.githubId,
          name: tools.name,
          fullName: tools.fullName,
          htmlUrl: tools.htmlUrl,
          stars: tools.stars,
          language: tools.language,
          lastPushedAt: tools.lastPushedAt,
          readmeSha: tools.readmeSha,
          summaryVi: tools.summaryVi,
          category: tools.category,
          subCategory: tools.subCategory,
          secondarySubCategories: tools.secondarySubCategories,
          useCases: tools.useCases,
          replaces: tools.replaces,
          usability: tools.usability,
          isPinned: tools.isPinned,
          userNotes: tools.userNotes,
          createdAt: tools.createdAt,
          updatedAt: tools.updatedAt,
        })
        .from(tools) satisfies Promise<NewsfeedToolRow[]>,
      db
        .select({ ranAt: syncLogs.ranAt })
        .from(syncLogs)
        .where(gt(syncLogs.id, 0))
        .orderBy(desc(syncLogs.ranAt))
        .limit(1),
    ]);

    const latestLog = latestLogs[0];
    const latestRanAtIso = latestLog
      ? latestLog.ranAt instanceof Date
        ? latestLog.ranAt.toISOString()
        : String(latestLog.ranAt)
      : null;

    return { allTools, latestRanAtIso };
  },
  ["tools-newsfeed-data"],
  {
    revalidate: TOOLS_CACHE_REVALIDATE_SECONDS,
    tags: [TOOLS_CACHE_TAG],
  },
);

/** Truy vấn toàn bộ công cụ (lược bỏ `searchText`) và thời điểm đồng bộ gần nhất cho trang `/newsfeed`. */
export async function fetchNewsfeedPageData(): Promise<{
  allTools: NewsfeedToolRow[];
  latestRanAtIso: string | null;
}> {
  return getCachedNewsfeedPageData();
}
