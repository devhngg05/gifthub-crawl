import {
  and,
  arrayOverlaps,
  desc,
  eq,
  inArray,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  CATEGORY_SUB_CATEGORIES,
  SUB_CATEGORY_MAP,
  VALID_SUB_CATEGORIES,
  isValidCategory,
  isValidSubCategory,
} from "@/config/taxonomy";
import { tools } from "@/db/schema";
import {
  normalizeSearchText,
  parseSearchQuery,
  type ParsedSearchQuery,
} from "@/lib/search-engine";
import { escapeLikePattern, type ToolFilters } from "@/lib/ui-helpers";

/**
 * Tạo điều kiện SQL lọc theo danh mục cha dựa trên tập ngách con chuẩn trong `CATEGORY_SUB_CATEGORIES`,
 * bảo đảm khớp 1–1 với tổng `subCategoryCounts` ngay cả khi cột `category` cũ bị lệch.
 */
export function buildToolCategoryFilterCondition(
  category: ToolFilters["category"],
): SQL | undefined {
  if (!category) {
    return undefined;
  }
  if (isValidCategory(category)) {
    return inArray(tools.subCategory, [...CATEGORY_SUB_CATEGORIES[category]]);
  }
  if (category === "other") {
    return notInArray(tools.subCategory, [...VALID_SUB_CATEGORIES]);
  }
  return undefined;
}

/**
 * Tạo điều kiện SQL lọc theo ngách con dựa duy nhất trên `tools.subCategory` chính
 * (không kéo thêm `secondarySubCategories`) để số kết quả luôn khớp 100% badge Sidebar.
 */
export function buildToolSubCategoryFilterCondition(
  subCategory: ToolFilters["subCategory"],
): SQL | undefined {
  if (!subCategory) {
    return undefined;
  }
  if (subCategory === "uncategorized") {
    return notInArray(tools.subCategory, [...VALID_SUB_CATEGORIES]);
  }
  if (isValidSubCategory(subCategory)) {
    return eq(tools.subCategory, subCategory);
  }
  return undefined;
}

/**
 * Tổng hợp các điều kiện SQL nền cho danh sách công cụ trang `/` từ bộ lọc Sidebar/Toolbar.
 */
export function buildToolBaseFilterConditions(
  filters: Pick<ToolFilters, "category" | "subCategory" | "usability" | "pinned">,
): SQL[] {
  const conditions: SQL[] = [];

  const categoryCond = buildToolCategoryFilterCondition(filters.category);
  if (categoryCond) {
    conditions.push(categoryCond);
  }

  const subCategoryCond = buildToolSubCategoryFilterCondition(
    filters.subCategory,
  );
  if (subCategoryCond) {
    conditions.push(subCategoryCond);
  }

  if (filters.usability) {
    conditions.push(eq(tools.usability, filters.usability));
  }

  if (filters.pinned) {
    conditions.push(eq(tools.isPinned, true));
  }

  return conditions;
}

/**
 * Bộ kiểm tra ngữ nghĩa tương đương 1–1 với `buildToolCategoryFilterCondition` và
 * `buildToolSubCategoryFilterCondition` trên dữ liệu hàng để kiểm toán nhất quán.
 */
export function matchesToolTaxonomyFilter(
  row: { subCategory: string },
  filter: Pick<ToolFilters, "category" | "subCategory">,
): boolean {
  if (filter.category) {
    if (isValidCategory(filter.category)) {
      if (
        !isValidSubCategory(row.subCategory) ||
        SUB_CATEGORY_MAP[row.subCategory].category !== filter.category
      ) {
        return false;
      }
    } else if (filter.category === "other") {
      if (isValidSubCategory(row.subCategory)) {
        return false;
      }
    }
  }

  if (filter.subCategory) {
    if (filter.subCategory === "uncategorized") {
      if (isValidSubCategory(row.subCategory)) {
        return false;
      }
    } else if (isValidSubCategory(filter.subCategory)) {
      if (row.subCategory !== filter.subCategory) {
        return false;
      }
    }
  }

  return true;
}

function resolveParsedQuery(query: string | ParsedSearchQuery): ParsedSearchQuery {
  return typeof query === "string" ? parseSearchQuery(query) : query;
}

/**
 * Khớp từ khóa trên `search_text`:
 * - Với từ ngắn (<= 3 ký tự như `ai`, `ui`, `db`, `cli`, `api`, `ocr`): bắt buộc khớp ranh giới nguyên từ `(' ' || search_text || ' ') LIKE '% <term> %'` để tránh khớp nhầm `"ai"` vào `"tai lieu"`, `"cai dat"`, `"email"`.
 * - Với từ dài (>= 4 ký tự): dùng `LIKE '%<term>%'` tận dụng GIN `pg_trgm` index.
 */
export function buildSearchTextTermMatch(rawTerm: string): SQL {
  const normalized = normalizeSearchText(rawTerm);
  const escaped = escapeLikePattern(normalized);
  if (normalized.length <= 3) {
    const boundedPattern = `% ${escaped} %`;
    return sql`(' ' || ${tools.searchText} || ' ') LIKE ${boundedPattern} ESCAPE '\\'`;
  }
  const pattern = `%${escaped}%`;
  return sql`${tools.searchText} LIKE ${pattern} ESCAPE '\\'`;
}

function buildDirectRepoNameMatch(
  rawLower: string,
  normalizedPhrase: string,
): SQL {
  const clauses: SQL[] = [];

  if (rawLower.length > 0) {
    const rawPattern = `%${escapeLikePattern(rawLower)}%`;
    clauses.push(
      sql`LOWER(${tools.name}) = ${rawLower}`,
      sql`LOWER(${tools.fullName}) = ${rawLower}`,
      sql`LOWER(${tools.name}) LIKE ${rawPattern} ESCAPE '\\'`,
      sql`LOWER(${tools.fullName}) LIKE ${rawPattern} ESCAPE '\\'`,
    );
  }

  if (normalizedPhrase.length > 0) {
    const normPattern = `%${escapeLikePattern(normalizedPhrase)}%`;
    clauses.push(
      sql`regexp_replace(LOWER(${tools.name}), '[^a-z0-9]+', ' ', 'g') LIKE ${normPattern} ESCAPE '\\'`,
      sql`regexp_replace(LOWER(${tools.fullName}), '[^a-z0-9]+', ' ', 'g') LIKE ${normPattern} ESCAPE '\\'`,
    );
  }

  if (clauses.length === 0) {
    return sql`FALSE`;
  }
  return clauses.length === 1 ? clauses[0] : or(...clauses)!;
}

function buildReplacesMatch(phrase: string): SQL {
  const escaped = escapeLikePattern(phrase);
  if (phrase.length <= 3) {
    const bounded = `% ${escaped} %`;
    return sql`EXISTS (SELECT 1 FROM unnest(${tools.replaces}) AS rp WHERE (' ' || LOWER(rp) || ' ') LIKE ${bounded} ESCAPE '\\')`;
  }
  const pattern = `%${escaped}%`;
  return sql`EXISTS (SELECT 1 FROM unnest(${tools.replaces}) AS rp WHERE LOWER(rp) LIKE ${pattern} ESCAPE '\\')`;
}

function buildConceptGroupCondition(group: readonly string[]): SQL {
  const termConds = group.map((term) => buildSearchTextTermMatch(term));
  return termConds.length === 1 ? termConds[0] : or(...termConds)!;
}

function buildAllConceptGroupsCondition(
  groups: readonly (readonly string[])[],
): SQL | undefined {
  if (groups.length === 0) {
    return undefined;
  }
  const groupConds = groups.map((group) => buildConceptGroupCondition(group));
  return groupConds.length === 1 ? groupConds[0] : and(...groupConds);
}

function buildMatchedSubCategoriesCondition(
  subCategories: readonly string[],
): SQL | undefined {
  if (subCategories.length === 0) {
    return undefined;
  }
  const list = [...subCategories];
  return or(
    inArray(tools.subCategory, list),
    arrayOverlaps(tools.secondarySubCategories, list),
  );
}

/**
 * Tầng 1 (Strict): Khớp trực tiếp `name`/`fullName` (cả chuỗi gốc giữ `-`/`_`/`/` lẫn bản chuẩn hóa khoảng trắng),
 * hoặc khớp đủ toàn bộ các Concept Groups (đồng nghĩa Việt–Anh), hoặc ý định `"thay thế X"` qua `replaces`/`search_text`.
 */
export function buildToolSearchCondition(
  query: string | ParsedSearchQuery,
): SQL | undefined {
  const parsed = resolveParsedQuery(query);
  const rawLower = parsed.rawQuery.trim().toLowerCase();
  if (!parsed.normalizedQuery && !rawLower) {
    return undefined;
  }

  const alternatives: SQL[] = [
    buildDirectRepoNameMatch(rawLower, parsed.normalizedQuery),
  ];

  const allConcepts = buildAllConceptGroupsCondition(parsed.conceptGroups);
  if (allConcepts) {
    alternatives.push(allConcepts);
  }

  if (parsed.isReplaceIntent && parsed.replaceTarget) {
    alternatives.push(buildDirectRepoNameMatch("", parsed.replaceTarget));
    alternatives.push(buildReplacesMatch(parsed.replaceTarget));
    alternatives.push(buildSearchTextTermMatch(parsed.replaceTarget));
  }

  return alternatives.length === 1 ? alternatives[0] : or(...alternatives);
}

/**
 * Tầng 2 (Relaxed Fallback cho trang `/` khi Tầng 1 trả về 0 kết quả):
 * Khớp ít nhất 1 Concept Group quan trọng, ngách gợi ý, hoặc `word_similarity >= 0.35` (chịu lỗi gõ sai).
 */
export function buildRelaxedToolSearchCondition(
  query: string | ParsedSearchQuery,
  options: { useTrgm?: boolean } = {},
): SQL | undefined {
  const parsed = resolveParsedQuery(query);
  if (!parsed.normalizedQuery) {
    return undefined;
  }

  const useTrgm = options.useTrgm ?? true;
  const alternatives: SQL[] = [];

  for (const group of parsed.conceptGroups) {
    alternatives.push(buildConceptGroupCondition(group));
  }

  const subCatCond = buildMatchedSubCategoriesCondition(
    parsed.matchedSubCategories,
  );
  if (subCatCond) {
    alternatives.push(subCatCond);
  }

  if (useTrgm && parsed.normalizedQuery.length >= 3) {
    alternatives.push(
      sql`word_similarity(${parsed.normalizedQuery}, ${tools.searchText}) >= 0.35`,
    );
  }

  if (alternatives.length === 0) {
    return undefined;
  }

  return alternatives.length === 1 ? alternatives[0] : or(...alternatives);
}

/**
 * Tầng 2 riêng cho API gợi ý (`GET /api/tools/suggest`) khi Tầng 1 trả về 0 kết quả:
 * Chỉ dùng `word_similarity >= 0.45` trên `search_text`, `name`, `full_name` để chịu lỗi gõ sai
 * mà không kéo theo repo rác nhiều sao chỉ vì trùng 1 từ đơn hoặc cùng ngách.
 */
export function buildSuggestRelaxedSearchCondition(
  query: string | ParsedSearchQuery,
  options: { useTrgm?: boolean } = {},
): SQL | undefined {
  const useTrgm = options.useTrgm ?? true;
  if (!useTrgm) {
    return undefined;
  }

  const parsed = resolveParsedQuery(query);
  const rawLower = parsed.rawQuery.trim().toLowerCase();
  const phrase = parsed.replaceTarget ?? parsed.normalizedQuery;

  if (phrase.length < 3 && rawLower.length < 3) {
    return undefined;
  }

  const alternatives: SQL[] = [];
  if (phrase.length >= 3) {
    alternatives.push(
      sql`word_similarity(${phrase}, ${tools.searchText}) >= 0.45`,
    );
  }
  if (rawLower.length >= 3) {
    alternatives.push(
      sql`word_similarity(${rawLower}, LOWER(${tools.name})) >= 0.45`,
      sql`word_similarity(${rawLower}, LOWER(${tools.fullName})) >= 0.45`,
    );
  }

  return alternatives.length === 1 ? alternatives[0] : or(...alternatives);
}

/**
 * Tính điểm độ phù hợp (Relevance Score) bằng SQL để xếp hạng kết quả khi tìm kiếm.
 * Kết hợp khớp chính xác tên (`+120`), chứa tên (`+80`), cụm từ/thay thế (`+65`),
 * đủ từ gốc (`+45`), đủ nhóm đồng nghĩa (`+30`), đúng ngách (`+20`), độ tương đồng pg_trgm (`+15`) và `ln(stars+1)*1.5`.
 */
export function buildSearchRelevanceScore(
  query: string | ParsedSearchQuery,
  options: { useTrgm?: boolean } = {},
): SQL<number> {
  const parsed = resolveParsedQuery(query);
  const rawLower = parsed.rawQuery.trim().toLowerCase();
  if (!parsed.normalizedQuery && !rawLower) {
    return sql<number>`0`;
  }

  const useTrgm = options.useTrgm ?? true;
  const phrase = parsed.replaceTarget ?? parsed.normalizedQuery;

  const exactClauses: SQL[] = [];
  if (rawLower.length > 0) {
    exactClauses.push(
      sql`LOWER(${tools.name}) = ${rawLower}`,
      sql`LOWER(${tools.fullName}) = ${rawLower}`,
    );
  }
  if (phrase.length > 0) {
    const normalizedNameExpr = sql`TRIM(regexp_replace(LOWER(${tools.name}), '[^a-z0-9]+', ' ', 'g'))`;
    const normalizedFullNameExpr = sql`TRIM(regexp_replace(LOWER(${tools.fullName}), '[^a-z0-9]+', ' ', 'g'))`;
    exactClauses.push(
      sql`${normalizedNameExpr} = ${phrase}`,
      sql`${normalizedFullNameExpr} = ${phrase}`,
    );
  }
  const exactNameCond =
    exactClauses.length === 0
      ? sql`FALSE`
      : exactClauses.length === 1
        ? exactClauses[0]
        : or(...exactClauses)!;

  const containsNameCond = buildDirectRepoNameMatch(rawLower, phrase);
  const phraseOrReplacesCond = phrase
    ? or(buildSearchTextTermMatch(phrase), buildReplacesMatch(phrase))!
    : sql`FALSE`;

  const coreTokenConds = parsed.coreTokens.map((token) =>
    buildSearchTextTermMatch(token),
  );
  const allCoreTokensCond =
    coreTokenConds.length === 0
      ? sql`FALSE`
      : coreTokenConds.length === 1
        ? coreTokenConds[0]
        : and(...coreTokenConds)!;

  const allConceptsCond =
    buildAllConceptGroupsCondition(parsed.conceptGroups) ?? sql`FALSE`;

  const subCatCond =
    buildMatchedSubCategoriesCondition(parsed.matchedSubCategories) ??
    sql`FALSE`;

  const trgmScoreExpr = useTrgm
    ? sql`(GREATEST(COALESCE(similarity(${tools.searchText}, ${parsed.normalizedQuery}), 0), COALESCE(word_similarity(${parsed.normalizedQuery}, ${tools.searchText}), 0)) * 15)`
    : sql`0`;

  return sql<number>`(
    CASE WHEN ${exactNameCond} THEN 120 ELSE 0 END
    + CASE WHEN ${containsNameCond} THEN 80 ELSE 0 END
    + CASE WHEN ${phraseOrReplacesCond} THEN 65 ELSE 0 END
    + CASE WHEN ${allCoreTokensCond} THEN 45 ELSE 0 END
    + CASE WHEN ${allConceptsCond} THEN 30 ELSE 0 END
    + CASE WHEN ${subCatCond} THEN 20 ELSE 0 END
    + ${trgmScoreExpr}
    + LN(${tools.stars} + 1) * 1.5
  )::double precision`;
}

/** Kiểm tra lỗi PostgreSQL thiếu hàm `pg_trgm` (`42883` / `function ... does not exist`). */
export function isMissingPgTrgmError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeErr = error as { code?: unknown; message?: unknown };
  if (maybeErr.code === "42883") {
    return true;
  }
  const message =
    typeof maybeErr.message === "string" ? maybeErr.message.toLowerCase() : "";
  return (
    message.includes("word_similarity") ||
    message.includes("similarity(") ||
    (message.includes("42883") && message.includes("does not exist"))
  );
}

/**
 * Dựng danh sách mệnh đề ORDER BY chuẩn PostgreSQL cho bảng `tools`.
 * - `sort = "relevance"` (khi có `q`): sắp theo điểm relevance giảm dần trước (không để `isPinned` che lấp độ liên quan).
 * - `sort = "recent"` ("Mới cập nhật"): `last_pushed_at DESC NULLS LAST`, `stars DESC`, `id DESC`.
 * - `sort = "name"` ("Tên A → Z"): `LOWER(name) ASC`, `stars DESC`, `id DESC`.
 * - `sort = "stars"` ("Ghim & Nhiều sao nhất"): `is_pinned DESC`, `stars DESC`, `last_pushed_at DESC NULLS LAST`, `id DESC`.
 */
export function buildToolOrderByClauses(
  filters: Pick<ToolFilters, "subCategory" | "sort">,
  options: { relevanceScore?: SQL } = {},
): SQL[] {
  if (filters.sort === "relevance" && options.relevanceScore) {
    return [
      sql`${options.relevanceScore} DESC`,
      desc(tools.stars),
      desc(tools.id),
    ];
  }

  const clauses: SQL[] = [];

  if (filters.subCategory && filters.subCategory !== "uncategorized") {
    clauses.push(
      sql`CASE WHEN ${tools.subCategory} = ${filters.subCategory} THEN 0 ELSE 1 END ASC`,
    );
  }

  if (filters.sort === "recent") {
    clauses.push(sql`${tools.lastPushedAt} DESC NULLS LAST`);
    clauses.push(desc(tools.stars));
    clauses.push(desc(tools.id));
  } else if (filters.sort === "name") {
    clauses.push(sql`LOWER(${tools.name}) ASC`);
    clauses.push(desc(tools.stars));
    clauses.push(desc(tools.id));
  } else {
    clauses.push(desc(tools.isPinned));
    clauses.push(desc(tools.stars));
    clauses.push(sql`${tools.lastPushedAt} DESC NULLS LAST`);
    clauses.push(desc(tools.id));
  }

  return clauses;
}
