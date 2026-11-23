import { describe, expect, it } from "vitest";
import { TAXONOMY } from "@/config/taxonomy";
import {
  buildFilterUrl,
  buildGlobalSearchUrl,
  buildSuggestedToolUrl,
  computePagination,
  computeToolCounts,
  DEFAULT_PAGE_SIZE,
  escapeLikePattern,
  formatIsoDate,
  formatRelativeTimeVi,
  formatStars,
  getPaginationRange,
  getSafeExternalUrl,
  hasActiveFilters,
  parseToolSearchParams,
  parseUrlSearchParams,
  tokenizeSearchQuery,
  type ToolFilters,
} from "@/lib/ui-helpers";

describe("parseToolSearchParams", () => {
  it("trả về giá trị mặc định khi không có query params", () => {
    expect(parseToolSearchParams({})).toEqual({
      category: undefined,
      subCategory: undefined,
      usability: undefined,
      pinned: false,
      q: "",
      sort: "stars",
      page: 1,
    });
  });

  it("hỗ trợ đầy đủ bộ tham số chuẩn và loại bỏ giá trị không hợp lệ", () => {
    expect(
      parseToolSearchParams({
        category: "ai-llm",
        subCategory: "rag-ocr-extract",
        usability: "cli-tool",
        pinned: "true",
        q: "  vector db  ",
        sort: "recent",
        page: "3",
      }),
    ).toEqual({
      category: "ai-llm",
      subCategory: "rag-ocr-extract",
      usability: "cli-tool",
      pinned: true,
      q: "vector db",
      sort: "recent",
      page: 3,
    });

    expect(
      parseToolSearchParams({
        category: "invalid-cat",
        subCategory: "fake-sub",
        usability: "self-host",
        pinned: "false",
        sort: "unknown",
        page: "0",
      }),
    ).toEqual({
      category: undefined,
      subCategory: undefined,
      usability: undefined,
      pinned: false,
      q: "",
      sort: "stars",
      page: 1,
    });

    expect(parseToolSearchParams({ page: "-2" }).page).toBe(1);
    expect(parseToolSearchParams({ page: "1.5" }).page).toBe(1);
    expect(parseToolSearchParams({ page: "abc" }).page).toBe(1);
    expect(parseToolSearchParams({ page: ["4", "2"] }).page).toBe(4);
  });

  it("hỗ trợ alias sub/level và tham số uncategorized/other và mảng chuỗi", () => {
    expect(
      parseToolSearchParams({
        category: ["other", "ai-llm"],
        sub: "uncategorized",
        level: "app-ready",
        pinned: "1",
      }),
    ).toEqual({
      category: "other",
      subCategory: "uncategorized",
      usability: "app-ready",
      pinned: true,
      q: "",
      sort: "stars",
      page: 1,
    });
  });

  it("chuẩn hóa tham số sort ('relevance', 'stars', 'recent', 'name') và tự chọn relevance khi có q", () => {
    expect(parseToolSearchParams({ sort: "stars" }).sort).toBe("stars");
    expect(parseToolSearchParams({ sort: "recent" }).sort).toBe("recent");
    expect(parseToolSearchParams({ sort: "RECENT" }).sort).toBe("recent");
    expect(parseToolSearchParams({ sort: "  recent " }).sort).toBe("recent");
    expect(parseToolSearchParams({ sort: "name" }).sort).toBe("name");
    expect(parseToolSearchParams({ sort: "NAME" }).sort).toBe("name");
    expect(parseToolSearchParams({ sort: "  name " }).sort).toBe("name");
    expect(parseToolSearchParams({ q: "agent" }).sort).toBe("relevance");
    expect(parseToolSearchParams({ q: "agent", sort: "stars" }).sort).toBe(
      "stars",
    );
    expect(parseToolSearchParams({ sort: "relevance" }).sort).toBe("stars");
    expect(
      parseToolSearchParams({ sort: ["recent", "stars"] }).sort,
    ).toBe("recent");
    expect(parseToolSearchParams({ sort: "invalid" }).sort).toBe("stars");

    expect(
      parseUrlSearchParams(
        new URLSearchParams("category=ai-llm&sort=recent&q=agent&page=2"),
      ),
    ).toEqual({
      category: "ai-llm",
      subCategory: undefined,
      usability: undefined,
      pinned: false,
      q: "agent",
      sort: "recent",
      page: 2,
    });

    expect(parseUrlSearchParams(new URLSearchParams())).toEqual({
      category: undefined,
      subCategory: undefined,
      usability: undefined,
      pinned: false,
      q: "",
      sort: "stars",
      page: 1,
    });
  });
});

describe("buildFilterUrl & hasActiveFilters", () => {
  const baseFilters: ToolFilters = {
    category: undefined,
    subCategory: undefined,
    usability: undefined,
    pinned: false,
    q: "",
    sort: "stars",
    page: 1,
  };

  it("trả về '/' khi toàn bộ bộ lọc ở trạng thái mặc định", () => {
    expect(hasActiveFilters(baseFilters)).toBe(false);
    expect(hasActiveFilters({ ...baseFilters, page: 3 })).toBe(false);
    expect(buildFilterUrl(baseFilters, {})).toBe("/");
    expect(buildFilterUrl({ ...baseFilters, page: 3 }, { page: 1 })).toBe("/");
  });

  it("tạo query string gọn, tự chuyển relevance khi tìm và tự trả về stars khi xóa q", () => {
    const withCategory = buildFilterUrl(baseFilters, {
      category: "dev-engineering",
      q: "drizzle",
      sort: "recent",
    });
    expect(withCategory).toBe(
      "/?category=dev-engineering&q=drizzle&sort=recent",
    );

    const searchDefaultSort = buildFilterUrl(baseFilters, { q: "noi api" });
    expect(searchDefaultSort).toBe("/?q=noi+api");

    const explicitStarsWithQuery = buildFilterUrl(
      { ...baseFilters, q: "noi api", sort: "relevance" },
      { sort: "stars" },
    );
    expect(explicitStarsWithQuery).toBe("/?q=noi+api&sort=stars");

    const clearedQueryDropsRelevance = buildFilterUrl(
      { ...baseFilters, q: "noi api", sort: "relevance" },
      { q: "" },
    );
    expect(clearedQueryDropsRelevance).toBe("/");

    const switchedToSub = buildFilterUrl(
      { ...baseFilters, category: "dev-engineering", q: "drizzle", sort: "relevance" },
      { subCategory: "database-orm" },
    );
    expect(switchedToSub).toBe("/?subCategory=database-orm&q=drizzle");

    const switchedBackToCat = buildFilterUrl(
      { ...baseFilters, subCategory: "database-orm", pinned: true },
      { category: "ai-llm", pinned: false },
    );
    expect(switchedBackToCat).toBe("/?category=ai-llm");
  });

  it("bảo toàn toàn bộ bộ lọc khi chuyển trang và tự reset về trang 1 khi đổi filter/sort", () => {
    const filteredOnPage3: ToolFilters = {
      category: "dev-engineering",
      subCategory: undefined,
      usability: "cli-tool",
      pinned: true,
      q: "terminal",
      sort: "recent",
      page: 3,
    };

    expect(buildFilterUrl(filteredOnPage3, { page: 4 })).toBe(
      "/?category=dev-engineering&usability=cli-tool&pinned=true&q=terminal&sort=recent&page=4",
    );
    expect(buildFilterUrl(filteredOnPage3, { page: 1 })).toBe(
      "/?category=dev-engineering&usability=cli-tool&pinned=true&q=terminal&sort=recent",
    );

    // Đổi bất kỳ bộ lọc hoặc sort/search từ trang 3 đều tự động reset page về 1
    expect(buildFilterUrl(filteredOnPage3, { q: "fzf" })).toBe(
      "/?category=dev-engineering&usability=cli-tool&pinned=true&q=fzf&sort=recent",
    );
    expect(buildFilterUrl(filteredOnPage3, { sort: "stars" })).toBe(
      "/?category=dev-engineering&usability=cli-tool&pinned=true&q=terminal&sort=stars",
    );
    expect(buildFilterUrl(filteredOnPage3, { usability: "app-ready" })).toBe(
      "/?category=dev-engineering&usability=app-ready&pinned=true&q=terminal&sort=recent",
    );
    expect(buildFilterUrl(filteredOnPage3, { category: "ai-llm" })).toBe(
      "/?category=ai-llm&usability=cli-tool&pinned=true&q=terminal&sort=recent",
    );
  });

  it("chuyển đổi sort ('stars' <-> 'recent' <-> 'name') mà vẫn bảo toàn toàn bộ bộ lọc hiện hành", () => {
    const filtered: ToolFilters = {
      category: "dev-engineering",
      subCategory: undefined,
      usability: "cli-tool",
      pinned: true,
      q: "terminal",
      sort: "stars",
      page: 1,
    };

    const toRecent = buildFilterUrl(filtered, { sort: "recent" });
    expect(toRecent).toBe(
      "/?category=dev-engineering&usability=cli-tool&pinned=true&q=terminal&sort=recent",
    );

    const parsedRecent = parseUrlSearchParams(
      new URLSearchParams(toRecent.slice(2)),
    );
    expect(parsedRecent.sort).toBe("recent");

    const updatedQueryWhileRecent = buildFilterUrl(parsedRecent, {
      q: "fzf",
    });
    expect(updatedQueryWhileRecent).toBe(
      "/?category=dev-engineering&usability=cli-tool&pinned=true&q=fzf&sort=recent",
    );

    const updatedUsabilityWhileRecent = buildFilterUrl(parsedRecent, {
      usability: "app-ready",
    });
    expect(updatedUsabilityWhileRecent).toBe(
      "/?category=dev-engineering&usability=app-ready&pinned=true&q=terminal&sort=recent",
    );

    const toName = buildFilterUrl(parsedRecent, { sort: "name" });
    expect(toName).toBe(
      "/?category=dev-engineering&usability=cli-tool&pinned=true&q=terminal&sort=name",
    );

    const backToStars = buildFilterUrl(parsedRecent, { sort: "stars" });
    expect(backToStars).toBe(
      "/?category=dev-engineering&usability=cli-tool&pinned=true&q=terminal&sort=stars",
    );
  });

  it("nhận diện đúng khi có bộ lọc đang bật", () => {
    expect(hasActiveFilters({ ...baseFilters, pinned: true })).toBe(true);
    expect(hasActiveFilters({ ...baseFilters, q: "orm" })).toBe(true);
    expect(hasActiveFilters({ ...baseFilters, sort: "recent" })).toBe(true);
    expect(hasActiveFilters({ ...baseFilters, sort: "name" })).toBe(true);
    expect(
      hasActiveFilters({ ...baseFilters, usability: "dev-required" }),
    ).toBe(true);
  });

  it("buildSuggestedToolUrl & buildGlobalSearchUrl luôn tạo URL sạch /?q=... và xóa toàn bộ category/subCategory/pinned/usability/sort/page", () => {
    const suggestedUrl = buildSuggestedToolUrl(
      "jwasham/coding-interview-university",
    );
    expect(suggestedUrl).toBe("/?q=jwasham%2Fcoding-interview-university");

    const parsed = parseUrlSearchParams(
      new URLSearchParams(suggestedUrl.slice(2)),
    );
    expect(parsed).toEqual({
      category: undefined,
      subCategory: undefined,
      usability: undefined,
      pinned: false,
      q: "jwasham/coding-interview-university",
      sort: "relevance",
      page: 1,
    });

    expect(buildSuggestedToolUrl("  vercel/next.js  ")).toBe(
      "/?q=vercel%2Fnext.js",
    );
    expect(buildGlobalSearchUrl("coding-interview-university")).toBe(
      "/?q=coding-interview-university",
    );
    expect(buildGlobalSearchUrl("   ")).toBe("/");
  });
});

describe("computeToolCounts", () => {
  it("đếm đúng chuẩn kế toán 1–1 theo subCategory chính, không cộng secondarySubCategories và tự suy danh mục cha từ TAXONOMY", () => {
    const counts = computeToolCounts([
      {
        category: "ai-llm",
        subCategory: "local-llm-gateway",
        secondarySubCategories: ["ai-coding-agent", "local-llm-gateway"],
        isPinned: true,
      },
      {
        // Bản ghi cũ bị lệch cột category trong DB, vẫn phải tính vào nhóm cha chuẩn của cli-dev-env (dev-engineering)
        category: "cms-collab-business",
        subCategory: "cli-dev-env",
        secondarySubCategories: ["ai-coding-agent", "bi-analytics-dashboard"],
        isPinned: false,
      },
      {
        category: "other",
        subCategory: "uncategorized",
        secondarySubCategories: [],
        isPinned: true,
      },
      {
        // Slug ngách cũ không còn trong 43 ngách chuẩn được quy vào uncategorizedCount
        category: "other",
        subCategory: "legacy-deprecated-sub",
        isPinned: false,
      },
    ]);

    expect(counts.totalCount).toBe(4);
    expect(counts.pinnedCount).toBe(2);
    expect(counts.uncategorizedCount).toBe(2);
    expect(counts.subCategoryCounts).toEqual({
      "local-llm-gateway": 1,
      "cli-dev-env": 1,
      uncategorized: 2,
    });
    expect(counts.categoryCounts["ai-llm"]).toBe(1);
    expect(counts.categoryCounts["dev-engineering"]).toBe(1);
    expect(counts.categoryCounts["cms-collab-business"]).toBe(0);
    expect(counts.categoryCounts.other).toBeUndefined();

    // Bất biến 1: Mỗi danh mục cha bằng đúng tổng các ngách con thuộc cha đó
    for (const cat of TAXONOMY) {
      const subSum = cat.subCategories.reduce(
        (acc, sub) => acc + (counts.subCategoryCounts[sub.slug] ?? 0),
        0,
      );
      expect(counts.categoryCounts[cat.slug]).toBe(subSum);
    }

    // Bất biến 2: Tổng tất cả danh mục cha + chưa phân loại === tổng công cụ
    const totalCategorySum = Object.values(counts.categoryCounts).reduce(
      (acc, count) => acc + count,
      0,
    );
    expect(totalCategorySum + counts.uncategorizedCount).toBe(counts.totalCount);
  });
});

describe("formatStars, formatIsoDate, formatRelativeTimeVi & escapeLikePattern", () => {
  it("format số sao gọn đúng chuẩn", () => {
    expect(formatStars(0)).toBe("0");
    expect(formatStars(999)).toBe("999");
    expect(formatStars(1000)).toBe("1k");
    expect(formatStars(12500)).toBe("12.5k");
    expect(formatStars(1_000_000)).toBe("1M");
    expect(formatStars(2_340_000)).toBe("2.3M");
  });

  it("format YYYY-MM-DD ổn định cho SSR", () => {
    expect(formatIsoDate("2026-11-22T14:30:00.000Z")).toBe("2026-11-22");
    expect(formatIsoDate("invalid-date")).toBe("invalid-da");
  });

  it("format thời gian tương đối tiếng Việt chính xác", () => {
    const now = new Date("2026-11-22T12:00:00.000Z");
    expect(formatRelativeTimeVi("2026-11-22T11:59:30.000Z", now)).toBe(
      "vừa xong",
    );
    expect(formatRelativeTimeVi("2026-11-22T11:45:00.000Z", now)).toBe(
      "15 phút trước",
    );
    expect(formatRelativeTimeVi("2026-11-22T09:00:00.000Z", now)).toBe(
      "3 giờ trước",
    );
    expect(formatRelativeTimeVi("2026-11-20T12:00:00.000Z", now)).toBe(
      "2 ngày trước",
    );
    expect(formatRelativeTimeVi("2026-08-20T12:00:00.000Z", now)).toBe(
      "3 tháng trước",
    );
    expect(formatRelativeTimeVi("2024-11-20T12:00:00.000Z", now)).toBe(
      "2 năm trước",
    );
  });

  it("escape các ký tự wildcard của SQL ILIKE", () => {
    expect(escapeLikePattern("100%_test\\path")).toBe("100\\%\\_test\\\\path");
  });

  it("tách từ khóa tìm kiếm thông minh, bỏ trùng không phân biệt hoa thường và giới hạn số từ", () => {
    expect(tokenizeSearchQuery("")).toEqual([]);
    expect(tokenizeSearchQuery("   \t\n  ")).toEqual([]);
    expect(tokenizeSearchQuery("  Ghi   chú   markdown  ghi  MARKDOWN ")).toEqual([
      "Ghi",
      "chú",
      "markdown",
    ]);
    expect(
      tokenizeSearchQuery("one two three four five six seven eight nine ten"),
    ).toEqual([
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
    ]);
    expect(tokenizeSearchQuery("a b c d", 2)).toEqual(["a", "b"]);
  });

  it("lọc URL ngoài an toàn qua getSafeExternalUrl", () => {
    expect(getSafeExternalUrl("https://github.com/vercel/next.js")).toBe(
      "https://github.com/vercel/next.js",
    );
    expect(getSafeExternalUrl("  http://example.com/docs  ")).toBe(
      "http://example.com/docs",
    );
    expect(getSafeExternalUrl("javascript:alert(1)")).toBe("#");
    expect(getSafeExternalUrl("data:text/html,<script>alert(1)</script>")).toBe(
      "#",
    );
    expect(getSafeExternalUrl("vbscript:msgbox(1)")).toBe("#");
    expect(getSafeExternalUrl("   ")).toBe("#");
    expect(getSafeExternalUrl("not-a-valid-url")).toBe("#");
  });
});

describe("computePagination & getPaginationRange", () => {
  it("tính đúng offset, phạm vi mục và kẹp trang vượt giới hạn an toàn", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(24);

    expect(computePagination(0, 3)).toEqual({
      currentPage: 1,
      totalPages: 1,
      pageSize: 24,
      offset: 0,
      startItem: 0,
      endItem: 0,
      hasPrev: false,
      hasNext: false,
    });

    expect(computePagination(50, 2)).toEqual({
      currentPage: 2,
      totalPages: 3,
      pageSize: 24,
      offset: 24,
      startItem: 25,
      endItem: 48,
      hasPrev: true,
      hasNext: true,
    });

    // Trang vượt quá tổng số trang -> kẹp về trang cuối (trang 3)
    expect(computePagination(50, 99)).toEqual({
      currentPage: 3,
      totalPages: 3,
      pageSize: 24,
      offset: 48,
      startItem: 49,
      endItem: 50,
      hasPrev: true,
      hasNext: false,
    });
  });

  it("tạo dải nút phân trang gọn với ellipsis chính xác", () => {
    expect(getPaginationRange(1, 1)).toEqual([1]);
    expect(getPaginationRange(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(getPaginationRange(1, 12)).toEqual([1, 2, 3, 4, "ellipsis", 12]);
    expect(getPaginationRange(6, 12)).toEqual([
      1,
      "ellipsis",
      5,
      6,
      7,
      "ellipsis",
      12,
    ]);
    expect(getPaginationRange(11, 12)).toEqual([1, "ellipsis", 9, 10, 11, 12]);
  });
});
