import {
  TAXONOMY,
  isValidCategory,
  isValidSubCategory,
  type CategorySlug,
  type SubCategorySlug,
} from "@/config/taxonomy";
import {
  VALID_USABILITY_LEVELS,
  type UsabilityLevel,
} from "@/lib/validator";

export type ToolSort = "relevance" | "stars" | "recent" | "name";

export const DEFAULT_PAGE_SIZE = 24;

export interface ToolFilters {
  category?: CategorySlug | "other";
  subCategory?: SubCategorySlug | "uncategorized";
  usability?: UsabilityLevel;
  pinned: boolean;
  q: string;
  sort: ToolSort;
  page: number;
}

export interface PaginationMeta {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  offset: number;
  startItem: number;
  endItem: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export type PaginationItem = number | "ellipsis";

export type RawSearchParams = Record<string, string | string[] | undefined>;

export interface ToolCountRow {
  category?: string;
  subCategory: string;
  secondarySubCategories?: readonly string[];
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

  const rawSort = getSingleParam(rawParams.sort)?.trim().toLowerCase();
  const sort: ToolSort =
    rawSort === "recent"
      ? "recent"
      : rawSort === "name"
        ? "name"
        : rawSort === "stars"
          ? "stars"
          : q
            ? "relevance"
            : "stars";

  const rawPage = getSingleParam(rawParams.page)?.trim();
  const parsedPage =
    rawPage && /^\d+$/.test(rawPage) ? Number(rawPage) : Number.NaN;
  const page =
    Number.isSafeInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  return {
    category,
    subCategory,
    usability,
    pinned,
    q,
    sort,
    page,
  };
}

/**
 * Chuyển đổi `URLSearchParams` / `ReadonlyURLSearchParams` thành `ToolFilters` chuẩn hóa.
 */
export function parseUrlSearchParams(searchParams: {
  entries(): IterableIterator<[string, string]>;
}): ToolFilters {
  const raw: RawSearchParams = {};
  for (const [key, value] of searchParams.entries()) {
    if (!(key in raw)) {
      raw[key] = value;
    }
  }
  return parseToolSearchParams(raw);
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

  const hasFilterChange =
    "category" in updates ||
    "subCategory" in updates ||
    "usability" in updates ||
    "pinned" in updates ||
    "q" in updates ||
    "sort" in updates;

  if (hasFilterChange && !("page" in updates)) {
    merged.page = 1;
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

  if ("q" in updates && !("sort" in updates)) {
    if (!trimmedQuery && merged.sort === "relevance") {
      merged.sort = "stars";
    } else if (trimmedQuery && !current.q.trim() && merged.sort === "stars") {
      merged.sort = "relevance";
    }
  }

  if (!trimmedQuery && merged.sort === "relevance") {
    merged.sort = "stars";
  }

  if (trimmedQuery) {
    params.set("q", trimmedQuery);
  }

  const defaultSortForUrl: ToolSort = trimmedQuery ? "relevance" : "stars";
  if (merged.sort !== defaultSortForUrl) {
    params.set("sort", merged.sort);
  }

  const safePage =
    Number.isSafeInteger(merged.page) && merged.page > 1 ? merged.page : 1;
  if (safePage > 1) {
    params.set("page", String(safePage));
  }

  const queryString = params.toString();
  return queryString ? `/?${queryString}` : "/";
}

/**
 * Tạo URL tìm kiếm toàn bộ kho sạch sẽ (`/?q=...`), xóa bỏ mọi bộ lọc danh mục, ngách, ghim, mức độ dùng, sort và page.
 */
export function buildGlobalSearchUrl(q: string): string {
  const trimmed = q.trim();
  if (!trimmed) {
    return "/";
  }
  return `/?q=${encodeURIComponent(trimmed)}`;
}

/**
 * Tạo URL điều hướng khi người dùng chọn một công cụ cụ thể từ dropdown gợi ý (`/?q=<fullName>`).
 */
export function buildSuggestedToolUrl(fullName: string): string {
  return buildGlobalSearchUrl(fullName);
}

/**
 * Tính toán thông số phân trang an toàn (tự kẹp `currentPage` trong `1..totalPages`).
 */
export function computePagination(
  totalItems: number,
  requestedPage: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): PaginationMeta {
  const safePageSize = Number.isFinite(pageSize)
    ? Math.max(1, Math.floor(pageSize))
    : DEFAULT_PAGE_SIZE;
  const safeTotal = Number.isFinite(totalItems)
    ? Math.max(0, Math.floor(totalItems))
    : 0;
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const normalizedRequested = Number.isFinite(requestedPage)
    ? Math.max(1, Math.floor(requestedPage))
    : 1;
  const currentPage = Math.min(normalizedRequested, totalPages);
  const offset = (currentPage - 1) * safePageSize;
  const startItem = safeTotal === 0 ? 0 : offset + 1;
  const endItem = Math.min(safeTotal, offset + safePageSize);

  return {
    currentPage,
    totalPages,
    pageSize: safePageSize,
    offset,
    startItem,
    endItem,
    hasPrev: currentPage > 1,
    hasNext: currentPage < totalPages,
  };
}

/**
 * Tạo dải nút phân trang gọn (tối đa 7 mục gồm trang đầu, trang cuối, cửa sổ quanh trang hiện tại và `"ellipsis"`).
 */
export function getPaginationRange(
  currentPage: number,
  totalPages: number,
): PaginationItem[] {
  const safeTotalPages = Math.max(1, Math.floor(totalPages));
  const safeCurrentPage = Math.min(
    Math.max(1, Math.floor(currentPage)),
    safeTotalPages,
  );

  if (safeTotalPages <= 7) {
    return Array.from({ length: safeTotalPages }, (_, idx) => idx + 1);
  }

  const pages = new Set<number>([1, safeTotalPages]);
  const windowStart = Math.max(2, safeCurrentPage - 1);
  const windowEnd = Math.min(safeTotalPages - 1, safeCurrentPage + 1);

  if (safeCurrentPage <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  } else if (safeCurrentPage >= safeTotalPages - 2) {
    pages.add(safeTotalPages - 3);
    pages.add(safeTotalPages - 2);
    pages.add(safeTotalPages - 1);
  } else {
    for (let p = windowStart; p <= windowEnd; p += 1) {
      pages.add(p);
    }
  }

  const sortedPages = Array.from(pages)
    .filter((p) => p >= 1 && p <= safeTotalPages)
    .sort((a, b) => a - b);

  const items: PaginationItem[] = [];
  for (let i = 0; i < sortedPages.length; i += 1) {
    const page = sortedPages[i];
    const prev = sortedPages[i - 1];
    if (prev !== undefined && page - prev > 1) {
      if (page - prev === 2) {
        items.push(prev + 1);
      } else {
        items.push("ellipsis");
      }
    }
    items.push(page);
  }

  return items;
}

/** Kiểm tra có bất kỳ bộ lọc hoặc chế độ sắp xếp khác mặc định đang bật hay không. */
export function hasActiveFilters(filters: ToolFilters): boolean {
  const defaultSort: ToolSort = filters.q.trim() ? "relevance" : "stars";
  return Boolean(
    filters.category ||
      filters.subCategory ||
      filters.usability ||
      filters.pinned ||
      filters.q.trim() ||
      filters.sort !== defaultSort,
  );
}

/**
 * Tổng hợp số lượng công cụ theo chuẩn kế toán 1–1 tuyệt đối từ `subCategory` chính:
 * - Mỗi công cụ chỉ đóng góp đúng 1 vào ngách chính (hoặc `uncategorized` nếu không thuộc 43 ngách chuẩn).
 * - Không cộng dồn `secondarySubCategories` vào số đếm Sidebar.
 * - `categoryCounts` bằng tổng `subCategoryCounts` của toàn bộ ngách con thuộc danh mục cha đó trong `TAXONOMY`.
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

    if (isValidSubCategory(row.subCategory)) {
      subCategoryCounts[row.subCategory] =
        (subCategoryCounts[row.subCategory] ?? 0) + 1;
    } else {
      uncategorizedCount += 1;
      subCategoryCounts.uncategorized =
        (subCategoryCounts.uncategorized ?? 0) + 1;
    }
  }

  for (const cat of TAXONOMY) {
    let sum = 0;
    for (const sub of cat.subCategories) {
      sum += subCategoryCounts[sub.slug] ?? 0;
    }
    categoryCounts[cat.slug] = sum;
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

/** Tách từ khóa tìm kiếm theo khoảng trắng, bỏ trùng không phân biệt hoa thường và giới hạn số từ. */
export function tokenizeSearchQuery(
  query: string,
  maxTokens: number = 8,
): string[] {
  const trimmed = query.trim();
  if (!trimmed || maxTokens <= 0) {
    return [];
  }

  const limit = Math.floor(maxTokens);
  const seen = new Set<string>();
  const tokens: string[] = [];

  for (const part of trimmed.split(/\s+/)) {
    if (!part) {
      continue;
    }
    const normalized = part.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    tokens.push(part);
    if (tokens.length >= limit) {
      break;
    }
  }

  return tokens;
}

/** Chỉ cho phép URL ngoài dùng giao thức `https:` hoặc `http:`, trả về `"#"` nếu không hợp lệ. */
export function getSafeExternalUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "#";
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.href;
    }
    return "#";
  } catch {
    return "#";
  }
}

/** Ánh xạ mã trạng thái HTTP từ `PATCH /api/tools/[id]` sang thông báo tiếng Việt thân thiện. */
export function mapToolPatchErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return "Dữ liệu gửi lên không hợp lệ.";
    case 404:
      return "Công cụ không còn tồn tại trong cơ sở dữ liệu.";
    case 500:
      return "Lỗi máy chủ nội bộ, vui lòng thử lại sau.";
    case 503:
      return "Máy chủ chưa cấu hình ADMIN_SECRET ở môi trường production.";
    default:
      return `Lỗi cập nhật (HTTP ${status}).`;
  }
}
