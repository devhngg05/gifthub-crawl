import { and, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  CATEGORY_SUB_CATEGORIES,
  TAXONOMY,
  VALID_SUB_CATEGORIES,
} from "@/config/taxonomy";
import {
  buildRelaxedToolSearchCondition,
  buildSearchRelevanceScore,
  buildSearchTextTermMatch,
  buildSuggestRelaxedSearchCondition,
  buildToolBaseFilterConditions,
  buildToolCategoryFilterCondition,
  buildToolOrderByClauses,
  buildToolSearchCondition,
  buildToolSubCategoryFilterCondition,
  isMissingPgTrgmError,
  matchesToolTaxonomyFilter,
} from "@/lib/tool-query";
import { computeToolCounts, type ToolCountRow } from "@/lib/ui-helpers";

function compileOrderBy(
  filters: Parameters<typeof buildToolOrderByClauses>[0],
  options?: Parameters<typeof buildToolOrderByClauses>[1],
): { sql: string; params: unknown[] } {
  const clauses = buildToolOrderByClauses(filters, options);
  return new PgDialect().sqlToQuery(sql.join(clauses, sql`, `));
}

describe("buildToolOrderByClauses — Drizzle PostgreSQL sort ordering", () => {
  it("orders sort='stars' by is_pinned DESC, stars DESC, last_pushed_at DESC NULLS LAST, id DESC", () => {
    const compiled = compileOrderBy({ sort: "stars" });

    expect(compiled.sql).toBe(
      '"tools"."is_pinned" desc, "tools"."stars" desc, "tools"."last_pushed_at" DESC NULLS LAST, "tools"."id" desc',
    );
    expect(compiled.params).toEqual([]);
  });

  it("orders sort='recent' by last_pushed_at DESC NULLS LAST first (ahead of is_pinned), followed by stars DESC, id DESC", () => {
    const compiled = compileOrderBy({ sort: "recent" });

    expect(compiled.sql).toBe(
      '"tools"."last_pushed_at" DESC NULLS LAST, "tools"."stars" desc, "tools"."id" desc',
    );
    expect(compiled.sql).not.toContain('"tools"."is_pinned"');
    expect(compiled.params).toEqual([]);
  });

  it("orders sort='name' by LOWER(name) ASC, followed by stars DESC, id DESC", () => {
    const compiled = compileOrderBy({ sort: "name" });

    expect(compiled.sql).toBe(
      'LOWER("tools"."name") ASC, "tools"."stars" desc, "tools"."id" desc',
    );
    expect(compiled.sql).not.toContain('"tools"."is_pinned"');
    expect(compiled.params).toEqual([]);
  });

  it("orders sort='relevance' strictly by relevanceScore DESC ahead of stars and id without is_pinned", () => {
    const score = buildSearchRelevanceScore("nối API");
    const compiled = compileOrderBy(
      { sort: "relevance", subCategory: "api-gateway-webhook" },
      { relevanceScore: score },
    );

    expect(compiled.sql).toContain("DESC");
    expect(compiled.sql).toContain("120");
    expect(compiled.sql).toContain('LN("tools"."stars" + 1) * 1.5');
    expect(compiled.sql).not.toContain('"tools"."is_pinned"');
  });

  it("prioritizes primary subCategory match ahead of sort='recent' and sort='name' ordering", () => {
    const compiledRecent = compileOrderBy({
      sort: "recent",
      subCategory: "ai-coding-agent",
    });

    expect(compiledRecent.sql).toBe(
      'CASE WHEN "tools"."sub_category" = $1 THEN 0 ELSE 1 END ASC, "tools"."last_pushed_at" DESC NULLS LAST, "tools"."stars" desc, "tools"."id" desc',
    );
    expect(compiledRecent.params).toEqual(["ai-coding-agent"]);

    const compiledName = compileOrderBy({
      sort: "name",
      subCategory: "ai-coding-agent",
    });

    expect(compiledName.sql).toBe(
      'CASE WHEN "tools"."sub_category" = $1 THEN 0 ELSE 1 END ASC, LOWER("tools"."name") ASC, "tools"."stars" desc, "tools"."id" desc',
    );
    expect(compiledName.params).toEqual(["ai-coding-agent"]);
  });

  it("omits CASE WHEN subCategory priority when subCategory is 'uncategorized'", () => {
    const compiled = compileOrderBy({
      sort: "stars",
      subCategory: "uncategorized",
    });

    expect(compiled.sql).toBe(
      '"tools"."is_pinned" desc, "tools"."stars" desc, "tools"."last_pushed_at" DESC NULLS LAST, "tools"."id" desc',
    );
    expect(compiled.params).toEqual([]);
  });
});

describe("buildSearchTextTermMatch — word boundary protection for short terms (<= 3 chars)", () => {
  it("enforces word-boundary space padding for short terms like 'ai' so it never matches 'tai lieu', 'cai dat', 'email', or 'main'", () => {
    const aiMatch = new PgDialect().sqlToQuery(buildSearchTextTermMatch("ai"));
    expect(aiMatch.sql).toBe(
      "(' ' || \"tools\".\"search_text\" || ' ') LIKE $1 ESCAPE '\\'",
    );
    expect(aiMatch.params).toEqual(["% ai %"]);

    // Simulate PostgreSQL `(' ' || search_text || ' ') LIKE '% ai %'` behavior
    const paddedUnrelated = " obsidian ghi chu tai lieu markdown cai dat email main ";
    const paddedAi = " ollama chay ai cuc bo local llm ";
    expect(paddedUnrelated.includes(" ai ")).toBe(false);
    expect(paddedAi.includes(" ai ")).toBe(true);

    const apiMatch = new PgDialect().sqlToQuery(buildSearchTextTermMatch("api"));
    expect(apiMatch.sql).toBe(
      "(' ' || \"tools\".\"search_text\" || ' ') LIKE $1 ESCAPE '\\'",
    );
    expect(apiMatch.params).toEqual(["% api %"]);
  });

  it("uses substring LIKE on normalized search_text for terms longer than 3 chars and escapes wildcards on name/replaces", () => {
    const compiled = new PgDialect().sqlToQuery(
      buildSearchTextTermMatch("100%_cli\\tool"),
    );
    expect(compiled.sql).toBe('"tools"."search_text" LIKE $1 ESCAPE \'\\\'');
    expect(compiled.params).toEqual(["%100 cli tool%"]);

    const directLike = new PgDialect().sqlToQuery(
      buildSearchTextTermMatch("workflow"),
    );
    expect(directLike.sql).toBe('"tools"."search_text" LIKE $1 ESCAPE \'\\\'');
    expect(directLike.params).toEqual(["%workflow%"]);
  });
});

describe("buildToolSearchCondition, buildRelaxedToolSearchCondition & buildSearchRelevanceScore", () => {
  it("returns undefined for empty or whitespace-only queries", () => {
    expect(buildToolSearchCondition("")).toBeUndefined();
    expect(buildToolSearchCondition("   \t\n ")).toBeUndefined();
    expect(buildRelaxedToolSearchCondition("")).toBeUndefined();
  });

  it("builds Tier 1 bilingual Concept Groups query for 'nối API' and replace-intent for 'thay thế notion'", () => {
    const noiApi = buildToolSearchCondition("nối API");
    expect(noiApi).toBeDefined();
    const compiledNoiApi = new PgDialect().sqlToQuery(noiApi!);
    expect(compiledNoiApi.params).toContain("% noi %");
    expect(compiledNoiApi.params).toContain("% api %");
    expect(compiledNoiApi.params).toContain("%webhook%");
    expect(compiledNoiApi.params).toContain("%workflow%");

    const replaceNotion = buildToolSearchCondition("thay thế notion");
    expect(replaceNotion).toBeDefined();
    const compiledReplace = new PgDialect().sqlToQuery(replaceNotion!);
    expect(compiledReplace.sql).toContain('unnest("tools"."replaces")');
    expect(compiledReplace.params).toContain("%notion%");
  });

  it("builds Tier 2 relaxed condition with pg_trgm word_similarity >= 0.35 and allows disabling pg_trgm", () => {
    const withTrgm = new PgDialect().sqlToQuery(
      buildRelaxedToolSearchCondition("posman", { useTrgm: true })!,
    );
    expect(withTrgm.sql).toContain(
      'word_similarity($2, "tools"."search_text") >= 0.35',
    );
    expect(withTrgm.params).toContain("posman");

    const withoutTrgm = new PgDialect().sqlToQuery(
      buildRelaxedToolSearchCondition("posman", { useTrgm: false })!,
    );
    expect(withoutTrgm.sql).not.toContain("word_similarity");
    expect(isMissingPgTrgmError({ code: "42883" })).toBe(true);
    expect(
      isMissingPgTrgmError(
        new Error("function word_similarity(unknown, text) does not exist"),
      ),
    ).toBe(true);
    expect(isMissingPgTrgmError(new Error("connection refused"))).toBe(false);
  });

  it("builds weighted relevance score with and without pg_trgm similarity", () => {
    const withTrgm = new PgDialect().sqlToQuery(
      buildSearchRelevanceScore("chạy AI local", { useTrgm: true }),
    );
    expect(withTrgm.sql).toContain("120");
    expect(withTrgm.sql).toContain("80");
    expect(withTrgm.sql).toContain("65");
    expect(withTrgm.sql).toContain("45");
    expect(withTrgm.sql).toContain("30");
    expect(withTrgm.sql).toContain("20");
    expect(withTrgm.sql).toContain("similarity(");
    expect(withTrgm.sql).toContain("word_similarity(");

    const withoutTrgm = new PgDialect().sqlToQuery(
      buildSearchRelevanceScore("chạy AI local", { useTrgm: false }),
    );
    expect(withoutTrgm.sql).not.toContain("word_similarity");
  });

  it("matches hyphenated and slashed repo names ('coding-interview-university' and 'jwasham/coding-interview-university') in Strict SQL and exact relevance scoring", () => {
    const byName = buildToolSearchCondition("coding-interview-university");
    expect(byName).toBeDefined();
    const compiledByName = new PgDialect().sqlToQuery(byName!);
    expect(compiledByName.sql).toContain('LOWER("tools"."name") =');
    expect(compiledByName.sql).toContain('LOWER("tools"."full_name") =');
    expect(compiledByName.sql).toContain('LOWER("tools"."name") LIKE');
    expect(compiledByName.sql).toContain('LOWER("tools"."full_name") LIKE');
    expect(compiledByName.sql).toContain(
      'regexp_replace(LOWER("tools"."name"), \'[^a-z0-9]+\', \' \', \'g\') LIKE',
    );
    expect(compiledByName.sql).toContain(
      'regexp_replace(LOWER("tools"."full_name"), \'[^a-z0-9]+\', \' \', \'g\') LIKE',
    );
    expect(compiledByName.params).toContain("coding-interview-university");
    expect(compiledByName.params).toContain("%coding-interview-university%");
    expect(compiledByName.params).toContain("%coding interview university%");

    const byFullName = buildToolSearchCondition(
      "jwasham/coding-interview-university",
    );
    expect(byFullName).toBeDefined();
    const compiledByFullName = new PgDialect().sqlToQuery(byFullName!);
    expect(compiledByFullName.params).toContain(
      "jwasham/coding-interview-university",
    );
    expect(compiledByFullName.params).toContain(
      "%jwasham/coding-interview-university%",
    );
    expect(compiledByFullName.params).toContain(
      "%jwasham coding interview university%",
    );

    const scoreByName = new PgDialect().sqlToQuery(
      buildSearchRelevanceScore("coding-interview-university"),
    );
    expect(scoreByName.sql).toContain("120");
    expect(scoreByName.sql).toContain('LOWER("tools"."name") =');
    expect(scoreByName.sql).toContain(
      'TRIM(regexp_replace(LOWER("tools"."name"), \'[^a-z0-9]+\', \' \', \'g\')) =',
    );
    expect(scoreByName.params).toContain("coding-interview-university");
    expect(scoreByName.params).toContain("coding interview university");

    const scoreByFullName = new PgDialect().sqlToQuery(
      buildSearchRelevanceScore("jwasham/coding-interview-university"),
    );
    expect(scoreByFullName.params).toContain(
      "jwasham/coding-interview-university",
    );
    expect(scoreByFullName.params).toContain(
      "jwasham coding interview university",
    );
  });

  it("builds tight suggest-only relaxed condition using word_similarity >= 0.45 without pulling broad concept groups or subCategories", () => {
    const typoCond = buildSuggestRelaxedSearchCondition(
      "coding-interview-universitx",
      { useTrgm: true },
    );
    expect(typoCond).toBeDefined();
    const compiled = new PgDialect().sqlToQuery(typoCond!);
    expect(compiled.sql).toContain(
      'word_similarity($1, "tools"."search_text") >= 0.45',
    );
    expect(compiled.sql).toContain(
      'word_similarity($2, LOWER("tools"."name")) >= 0.45',
    );
    expect(compiled.sql).toContain(
      'word_similarity($3, LOWER("tools"."full_name")) >= 0.45',
    );
    expect(compiled.sql).not.toContain("sub_category");
    expect(compiled.params).toEqual([
      "coding interview universitx",
      "coding-interview-universitx",
      "coding-interview-universitx",
    ]);

    expect(
      buildSuggestRelaxedSearchCondition("posman", { useTrgm: false }),
    ).toBeUndefined();
  });
});

describe("Sidebar Filter SQL Builders — Single Source of Truth", () => {
  it("filters subCategory strictly by tools.sub_category without pulling secondary_sub_categories", () => {
    const cond = buildToolSubCategoryFilterCondition("data-pipeline-etl");
    expect(cond).toBeDefined();
    const compiled = new PgDialect().sqlToQuery(cond!);

    expect(compiled.sql).toBe('"tools"."sub_category" = $1');
    expect(compiled.params).toEqual(["data-pipeline-etl"]);
    expect(compiled.sql).not.toContain("secondary_sub_categories");
  });

  it("filters parent category using all canonical subCategories from CATEGORY_SUB_CATEGORIES instead of raw tools.category", () => {
    const cond = buildToolCategoryFilterCondition("data-analytics");
    expect(cond).toBeDefined();
    const compiled = new PgDialect().sqlToQuery(cond!);

    expect(compiled.sql).toBe('"tools"."sub_category" in ($1, $2, $3)');
    expect(compiled.params).toEqual([...CATEGORY_SUB_CATEGORIES["data-analytics"]]);
    expect(compiled.sql).not.toContain('"tools"."category"');
  });

  it("filters 'uncategorized' and 'other' by excluding all 43 VALID_SUB_CATEGORIES", () => {
    const uncatCond = buildToolSubCategoryFilterCondition("uncategorized");
    const otherCond = buildToolCategoryFilterCondition("other");
    expect(uncatCond).toBeDefined();
    expect(otherCond).toBeDefined();

    const compiledUncat = new PgDialect().sqlToQuery(uncatCond!);
    const compiledOther = new PgDialect().sqlToQuery(otherCond!);

    expect(compiledUncat.sql).toContain('"tools"."sub_category" not in');
    expect(compiledUncat.params).toEqual([...VALID_SUB_CATEGORIES]);
    expect(compiledOther.sql).toBe(compiledUncat.sql);
    expect(compiledOther.params).toEqual(compiledUncat.params);
  });

  it("assembles combined base filter conditions cleanly via buildToolBaseFilterConditions", () => {
    const empty = buildToolBaseFilterConditions({
      category: undefined,
      subCategory: undefined,
      usability: undefined,
      pinned: false,
    });
    expect(empty).toHaveLength(0);

    const combined = buildToolBaseFilterConditions({
      category: "cms-collab-business",
      subCategory: "crm-erp-finance",
      usability: "app-ready",
      pinned: true,
    });
    expect(combined).toHaveLength(4);
    const compiled = new PgDialect().sqlToQuery(and(...combined)!);
    expect(compiled.sql).toContain('"tools"."sub_category" in');
    expect(compiled.sql).toContain('"tools"."sub_category" =');
    expect(compiled.sql).toContain('"tools"."usability" =');
    expect(compiled.sql).toContain('"tools"."is_pinned" =');
    expect(compiled.sql).not.toContain("secondary_sub_categories");
  });
});

describe("Sidebar Accounting Audit Invariants (1-to-1 consistency)", () => {
  const sampleInventory: ToolCountRow[] = [
    // Nhóm Dữ liệu, BI & Phân tích (có nhiều secondarySubCategories chéo nhau + 1 bản ghi bị lệch cột category)
    {
      category: "data-analytics",
      subCategory: "data-pipeline-etl",
      secondarySubCategories: [
        "bi-analytics-dashboard",
        "data-science-notebooks",
      ],
      isPinned: true,
    },
    {
      category: "data-analytics",
      subCategory: "data-pipeline-etl",
      secondarySubCategories: ["bi-analytics-dashboard"],
      isPinned: false,
    },
    {
      // Bản ghi cũ bị lệch cột category -> vẫn phải quy về data-analytics theo subCategory chính
      category: "dev-engineering",
      subCategory: "bi-analytics-dashboard",
      secondarySubCategories: ["data-pipeline-etl", "data-science-notebooks"],
      isPinned: false,
    },
    {
      category: "data-analytics",
      subCategory: "data-science-notebooks",
      secondarySubCategories: ["data-pipeline-etl", "bi-analytics-dashboard"],
      isPinned: false,
    },
    // Nhóm Web, Cộng tác & Vận hành (có nhiều secondarySubCategories trùng chéo)
    {
      category: "cms-collab-business",
      subCategory: "cms-blog-ecommerce",
      secondarySubCategories: ["team-chat-collab", "crm-erp-finance"],
      isPinned: false,
    },
    {
      category: "cms-collab-business",
      subCategory: "team-chat-collab",
      secondarySubCategories: ["cms-blog-ecommerce"],
      isPinned: true,
    },
    {
      // Bản ghi cũ lệch category
      category: "productivity-os",
      subCategory: "crm-erp-finance",
      secondarySubCategories: ["cms-blog-ecommerce", "team-chat-collab"],
      isPinned: false,
    },
    // Một số nhóm khác
    {
      category: "ai-llm",
      subCategory: "local-llm-gateway",
      secondarySubCategories: ["ai-chat-ui", "ai-workflow-mcp"],
      isPinned: true,
    },
    {
      category: "ai-llm",
      subCategory: "ai-coding-agent",
      secondarySubCategories: ["cli-dev-env"],
      isPinned: false,
    },
    {
      category: "api-integration",
      subCategory: "api-client-testing",
      secondarySubCategories: ["api-mock-docs"],
      isPinned: false,
    },
    // Chưa phân loại & slug legacy ngoài taxonomy
    {
      category: "other",
      subCategory: "uncategorized",
      secondarySubCategories: ["bi-analytics-dashboard"],
      isPinned: false,
    },
    {
      category: "other",
      subCategory: "legacy-removed-sub",
      secondarySubCategories: ["cms-blog-ecommerce"],
      isPinned: false,
    },
  ];

  it("satisfies Invariant 1: every parent categoryCount === sum(subCategoryCounts of its children)", () => {
    const counts = computeToolCounts(sampleInventory);

    for (const cat of TAXONOMY) {
      const childrenSum = cat.subCategories.reduce(
        (sum, sub) => sum + (counts.subCategoryCounts[sub.slug] ?? 0),
        0,
      );
      expect(counts.categoryCounts[cat.slug]).toBe(childrenSum);
    }

    expect(counts.categoryCounts["data-analytics"]).toBe(4);
    expect(counts.categoryCounts["cms-collab-business"]).toBe(3);
  });

  it("satisfies Invariant 2: sum(all categoryCounts) + uncategorizedCount === totalCount", () => {
    const counts = computeToolCounts(sampleInventory);

    const allCategorySum = TAXONOMY.reduce(
      (sum, cat) => sum + (counts.categoryCounts[cat.slug] ?? 0),
      0,
    );
    expect(allCategorySum + counts.uncategorizedCount).toBe(counts.totalCount);
    expect(counts.totalCount).toBe(sampleInventory.length);
  });

  it("satisfies Invariant 3: filtered count matches Sidebar badge 100% for every category, subCategory, uncategorized, and all", () => {
    const counts = computeToolCounts(sampleInventory);

    // 1. Tất cả công cụ
    const allFiltered = sampleInventory.filter((row) =>
      matchesToolTaxonomyFilter(row, {}),
    );
    expect(allFiltered).toHaveLength(counts.totalCount);

    // 2. Chưa phân loại & Nhóm khác
    const uncatFiltered = sampleInventory.filter((row) =>
      matchesToolTaxonomyFilter(row, { subCategory: "uncategorized" }),
    );
    expect(uncatFiltered).toHaveLength(counts.uncategorizedCount);

    const otherFiltered = sampleInventory.filter((row) =>
      matchesToolTaxonomyFilter(row, { category: "other" }),
    );
    expect(otherFiltered).toHaveLength(counts.uncategorizedCount);

    // 3. Toàn bộ 10 danh mục cha & 43 ngách con
    for (const cat of TAXONOMY) {
      const catFiltered = sampleInventory.filter((row) =>
        matchesToolTaxonomyFilter(row, { category: cat.slug }),
      );
      expect(catFiltered).toHaveLength(counts.categoryCounts[cat.slug] ?? 0);

      for (const sub of cat.subCategories) {
        const subFiltered = sampleInventory.filter((row) =>
          matchesToolTaxonomyFilter(row, { subCategory: sub.slug }),
        );
        expect(subFiltered).toHaveLength(
          counts.subCategoryCounts[sub.slug] ?? 0,
        );
      }
    }
  });
});
