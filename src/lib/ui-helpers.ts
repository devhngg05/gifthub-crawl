import {
  isValidCategory,
  isValidSubCategory,
  type CategorySlug,
  type SubCategorySlug,
} from "@/config/taxonomy";
import {
  VALID_USABILITY_LEVELS,
  type UsabilityLevel,
} from "@/lib/validator";

export type ToolSort = "stars" | "recent";

export interface ToolFilters {
  category?: CategorySlug | "other";
  subCategory?: SubCategorySlug | "uncategorized";
  usability?: UsabilityLevel;
  pinned: boolean;
  q: string;
  sort: ToolSort;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

export interface ToolCountRow {
  category: string;
  subCategory: string;
  secondarySubCategories: string[];
  isPinned: boolean;
}

export interface ToolCounts {
  totalCount: number;
  pinnedCount: number;
  uncategorizedCount: number;
  categoryCounts: Record<string, number>;
  subCategoryCounts: Record<string, number>;
}

const VALID_USABILITY_SET = new Set<string>(VALID_USABILITY_LEVELS);

function getSingleParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * Chuẩn hóa `searchParams` từ Next.js thành đối tượng bộ lọc an toàn.
 * Hỗ trợ đồng thời tên chuẩn (`subCategory`, `usability`) và alias (`sub`, `level`).
 */
export function parseToolSearchParams(rawParams: RawSearchParams): ToolFilters {
  const rawCategory = getSingleParam(rawParams.category)?.trim();
  const category: CategorySlug | "other" | undefined =
    rawCategory && (isValidCategory(rawCategory) || rawCategory === "other")
      ? rawCategory
      : undefined;

  const rawSub = getSingleParam(rawParams.subCategory ?? rawParams.sub)?.trim();
  const subCategory: SubCategorySlug | "uncategorized" | undefined =
    rawSub && (isValidSubCategory(rawSub) || rawSub === "uncategorized")
      ? rawSub
      : undefined;

  const rawUsability = getSingleParam(
    rawParams.usability ?? rawParams.level,
  )?.trim();
  const usability: UsabilityLevel | undefined =
    rawUsability && VALID_USABILITY_SET.has(rawUsability)
      ? (rawUsability as UsabilityLevel)
      : undefined;

  const rawPinned = getSingleParam(rawParams.pinned)?.trim();
  const pinned = rawPinned === "true" || rawPinned === "1";

  const q = (getSingleParam(rawParams.q) ?? "").trim();

  const rawSort = getSingleParam(rawParams.sort)?.trim();
  const sort: ToolSort = rawSort === "recent" ? "recent" : "stars";

  return {
    category,
    subCategory,
    usability,
    pinned,
    q,
    sort,
  };
}

/**
 * Tạo URL `/` sạch sẽ từ trạng thái lọc hiện tại và phần cập nhật.
 * Tự động loại bỏ tham số rỗng/mặc định và tránh xung đột giữa `category` với `subCategory`.
 */
export function buildFilterUrl(
  current: ToolFilters,
  updates: Partial<ToolFilters>,
): string {
  const merged: ToolFilters = {
    ...current,
    ...updates,
  };

  if (
    "subCategory" in updates &&
    updates.subCategory !== undefined &&
    !("category" in updates)
  ) {
    merged.category = undefined;
  }

  if (
    "category" in updates &&
    updates.category !== undefined &&
    !("subCategory" in updates)
  ) {
    merged.subCategory = undefined;
  }

  const params = new URLSearchParams();

  if (merged.category) {
    params.set("category", merged.category);
  }
  if (merged.subCategory) {
    params.set("subCategory", merged.subCategory);
  }
  if (merged.usability) {
    params.set("usability", merged.usability);
  }
  if (merged.pinned) {
    params.set("pinned", "true");
  }

  const trimmedQuery = merged.q.trim();
  if (trimmedQuery) {
    params.set("q", trimmedQuery);
  }
  if (merged.sort === "recent") {
    params.set("sort", "recent");
  }

  const queryString = params.toString();
  return queryString ? `/?${queryString}` : "/";
}

/** Kiểm tra có bất kỳ bộ lọc hoặc chế độ sắp xếp khác mặc định đang bật hay không. */
export function hasActiveFilters(filters: ToolFilters): boolean {
  return Boolean(
    filters.category ||
      filters.subCategory ||
      filters.usability ||
      filters.pinned ||
      filters.q.trim() ||
      filters.sort === "recent",
  );
}

/**
 * Tổng hợp số lượng công cụ theo nhóm lớn, ngách con (gồm cả nhãn chính & phụ không trùng lặp),
 * số lượng đã ghim và số lượng chưa phân loại từ dữ liệu thật trong DB.
 */
export function computeToolCounts(rows: readonly ToolCountRow[]): ToolCounts {
  const categoryCounts: Record<string, number> = {};
  const subCategoryCounts: Record<string, number> = {};
  let pinnedCount = 0;
  let uncategorizedCount = 0;

  for (const row of rows) {
    if (row.isPinned) {
      pinnedCount += 1;
    }
    if (row.subCategory === "uncategorized") {
      uncategorizedCount += 1;
    }

    if (row.category) {
      categoryCounts[row.category] = (categoryCounts[row.category] ?? 0) + 1;
    }

    const uniqueSubCategories = new Set<string>();
    if (row.subCategory) {
      uniqueSubCategories.add(row.subCategory);
    }
    for (const sec of row.secondarySubCategories ?? []) {
      if (sec) {
        uniqueSubCategories.add(sec);
      }
    }

    for (const subSlug of uniqueSubCategories) {
      subCategoryCounts[subSlug] = (subCategoryCounts[subSlug] ?? 0) + 1;
    }
  }

  return {
    totalCount: rows.length,
    pinnedCount,
    uncategorizedCount,
    categoryCounts,
    subCategoryCounts,
  };
}

/** Format số sao GitHub gọn (vd: `999` -> `"999"`, `12500` -> `"12.5k"`, `1200000` -> `"1.2M"`). */
export function formatStars(stars: number): string {
  const safeStars = Number.isFinite(stars) ? Math.max(0, Math.floor(stars)) : 0;
  if (safeStars < 1000) {
    return String(safeStars);
  }
  if (safeStars < 1_000_000) {
    return `${(safeStars / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${(safeStars / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** Trả về chuỗi `YYYY-MM-DD` ổn định (UTC) phục vụ SSR tránh Hydration Mismatch. */
export function formatIsoDate(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate.slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

/** Chuyển mốc ISO date sang chuỗi thời gian tương đối tiếng Việt trên client. */
export function formatRelativeTimeVi(
  isoDate: string,
  now: Date = new Date(),
): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return formatIsoDate(isoDate);
  }

  const diffMs = now.getTime() - parsed.getTime();
  if (diffMs < 0) {
    return "vừa xong";
  }

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) {
    return "vừa xong";
  }

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin} phút trước`;
  }

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return `${diffHours} giờ trước`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays} ngày trước`;
  }

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return `${diffMonths} tháng trước`;
  }

  const diffYears = Math.max(1, Math.floor(diffDays / 365));
  return `${diffYears} năm trước`;
}

/** Escape ký tự đặc biệt (`\`, `%`, `_`) trước khi đưa vào PostgreSQL `ILIKE ... ESCAPE '\'`. */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}
