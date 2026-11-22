import { describe, expect, it } from "vitest";
import {
  buildFilterUrl,
  computeToolCounts,
  escapeLikePattern,
  formatIsoDate,
  formatRelativeTimeVi,
  formatStars,
  hasActiveFilters,
  parseToolSearchParams,
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
      }),
    ).toEqual({
      category: "ai-llm",
      subCategory: "rag-ocr-extract",
      usability: "cli-tool",
      pinned: true,
      q: "vector db",
      sort: "recent",
    });

    expect(
      parseToolSearchParams({
        category: "invalid-cat",
        subCategory: "fake-sub",
        usability: "self-host",
        pinned: "false",
        sort: "unknown",
      }),
    ).toEqual({
      category: undefined,
      subCategory: undefined,
      usability: undefined,
      pinned: false,
      q: "",
      sort: "stars",
    });
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
  };

  it("trả về '/' khi toàn bộ bộ lọc ở trạng thái mặc định", () => {
    expect(hasActiveFilters(baseFilters)).toBe(false);
    expect(buildFilterUrl(baseFilters, {})).toBe("/");
  });

  it("tạo query string gọn và tự tách category khỏi subCategory khi chuyển tầng", () => {
    const withCategory = buildFilterUrl(baseFilters, {
      category: "dev-engineering",
      q: "drizzle",
      sort: "recent",
    });
    expect(withCategory).toBe(
      "/?category=dev-engineering&q=drizzle&sort=recent",
    );

    const switchedToSub = buildFilterUrl(
      { ...baseFilters, category: "dev-engineering", q: "drizzle" },
      { subCategory: "database-orm" },
    );
    expect(switchedToSub).toBe("/?subCategory=database-orm&q=drizzle");

    const switchedBackToCat = buildFilterUrl(
      { ...baseFilters, subCategory: "database-orm", pinned: true },
      { category: "ai-llm", pinned: false },
    );
    expect(switchedBackToCat).toBe("/?category=ai-llm");
  });

  it("nhận diện đúng khi có bộ lọc đang bật", () => {
    expect(hasActiveFilters({ ...baseFilters, pinned: true })).toBe(true);
    expect(hasActiveFilters({ ...baseFilters, q: "orm" })).toBe(true);
    expect(hasActiveFilters({ ...baseFilters, sort: "recent" })).toBe(true);
    expect(
      hasActiveFilters({ ...baseFilters, usability: "dev-required" }),
    ).toBe(true);
  });
});

describe("computeToolCounts", () => {
  it("đếm đúng tổng số, đã ghim, uncategorized, category và cả nhãn phụ không trùng", () => {
    const counts = computeToolCounts([
      {
        category: "ai-llm",
        subCategory: "local-llm-gateway",
        secondarySubCategories: ["ai-coding-agent", "local-llm-gateway"],
        isPinned: true,
      },
      {
        category: "dev-engineering",
        subCategory: "cli-dev-env",
        secondarySubCategories: ["ai-coding-agent"],
        isPinned: false,
      },
      {
        category: "other",
        subCategory: "uncategorized",
        secondarySubCategories: [],
        isPinned: true,
      },
    ]);

    expect(counts).toEqual({
      totalCount: 3,
      pinnedCount: 2,
      uncategorizedCount: 1,
      categoryCounts: {
        "ai-llm": 1,
        "dev-engineering": 1,
        other: 1,
      },
      subCategoryCounts: {
        "local-llm-gateway": 1,
        "ai-coding-agent": 2,
        "cli-dev-env": 1,
        uncategorized: 1,
      },
    });
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
});
