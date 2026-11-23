import { desc, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SUB_CATEGORY_MAP, isValidSubCategory } from "@/config/taxonomy";
import { db } from "@/db";
import { tools } from "@/db/schema";
import { sanitizeErrorMessage } from "@/lib/sanitize-error";
import { parseSearchQuery, type ParsedSearchQuery } from "@/lib/search-engine";
import {
  buildSearchRelevanceScore,
  buildSuggestRelaxedSearchCondition,
  buildToolSearchCondition,
  isMissingPgTrgmError,
} from "@/lib/tool-query";

const SuggestQuerySchema = z.object({
  q: z.string().trim().max(120),
});

export interface SuggestedToolItem {
  id: number;
  name: string;
  fullName: string;
  summaryVi: string;
  subCategory: string;
  stars: number;
  usability: string;
}

export interface SuggestedCategoryItem {
  slug: string;
  label: string;
  categoryLabel: string;
}

async function fetchSuggestedTools(
  parsedQuery: ParsedSearchQuery,
  useTrgm: boolean,
): Promise<SuggestedToolItem[]> {
  const relevanceScore = buildSearchRelevanceScore(parsedQuery, { useTrgm });
  const strictCond = buildToolSearchCondition(parsedQuery);

  const selectColumns = {
    id: tools.id,
    name: tools.name,
    fullName: tools.fullName,
    summaryVi: tools.summaryVi,
    subCategory: tools.subCategory,
    stars: tools.stars,
    usability: tools.usability,
  };

  if (strictCond) {
    const strictRows = await db
      .select(selectColumns)
      .from(tools)
      .where(strictCond)
      .orderBy(sql`${relevanceScore} DESC`, desc(tools.stars), desc(tools.id))
      .limit(6);

    if (strictRows.length > 0) {
      return strictRows;
    }
  }

  const relaxedCond = buildSuggestRelaxedSearchCondition(parsedQuery, {
    useTrgm,
  });
  if (!relaxedCond) {
    return [];
  }

  const rawLower = parsedQuery.rawQuery.trim().toLowerCase();
  const phrase = parsedQuery.replaceTarget ?? parsedQuery.normalizedQuery;
  const trgmMatchOrder = sql`GREATEST(
    ${phrase.length >= 3 ? sql`COALESCE(word_similarity(${phrase}, ${tools.searchText}), 0)` : sql`0`},
    ${rawLower.length >= 3 ? sql`COALESCE(word_similarity(${rawLower}, LOWER(${tools.name})), 0)` : sql`0`},
    ${rawLower.length >= 3 ? sql`COALESCE(word_similarity(${rawLower}, LOWER(${tools.fullName})), 0)` : sql`0`}
  )`;

  return db
    .select(selectColumns)
    .from(tools)
    .where(relaxedCond)
    .orderBy(
      sql`${trgmMatchOrder} DESC`,
      sql`${relevanceScore} DESC`,
      desc(tools.stars),
      desc(tools.id),
    )
    .limit(6);
}

/**
 * API gợi ý tìm kiếm tức thì (`GET /api/tools/suggest?q=...`):
 * Trả tối đa 6 công cụ khớp nhất (Tầng 1 hoặc Tầng 2) và tối đa 3 ngách gợi ý từ từ điển song ngữ.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const rawQ = request.nextUrl.searchParams.get("q") ?? "";
  const parsedParam = SuggestQuerySchema.safeParse({ q: rawQ });

  if (!parsedParam.success) {
    return NextResponse.json(
      { error: "Invalid query parameter", details: parsedParam.error.flatten() },
      { status: 400 },
    );
  }

  const q = parsedParam.data.q;
  if (q.length < 2) {
    return NextResponse.json({ tools: [], categories: [] }, { status: 200 });
  }

  const parsedQuery = parseSearchQuery(q);
  if (!parsedQuery.normalizedQuery) {
    return NextResponse.json({ tools: [], categories: [] }, { status: 200 });
  }

  const categories: SuggestedCategoryItem[] = parsedQuery.matchedSubCategories
    .slice(0, 3)
    .filter((slug) => isValidSubCategory(slug))
    .map((slug) => ({
      slug,
      label: SUB_CATEGORY_MAP[slug].label,
      categoryLabel: SUB_CATEGORY_MAP[slug].categoryLabel,
    }));

  try {
    let suggestedTools: SuggestedToolItem[];
    try {
      suggestedTools = await fetchSuggestedTools(parsedQuery, true);
    } catch (error) {
      if (isMissingPgTrgmError(error)) {
        suggestedTools = await fetchSuggestedTools(parsedQuery, false);
      } else {
        throw error;
      }
    }

    return NextResponse.json(
      { tools: suggestedTools, categories },
      { status: 200 },
    );
  } catch (error) {
    const safeMessage = sanitizeErrorMessage(error);
    console.error("[GET /api/tools/suggest] Query failed:", safeMessage);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
