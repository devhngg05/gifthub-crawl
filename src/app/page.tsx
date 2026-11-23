import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  Flame,
  Info,
  RotateCcw,
  SearchX,
  Sparkles,
} from "lucide-react";
import { Pagination } from "@/components/Pagination";
import { SearchToolbar } from "@/components/SearchToolbar";
import { Sidebar } from "@/components/Sidebar";
import { ToolCard } from "@/components/ToolCard";
import {
  CATEGORY_MAP,
  SUB_CATEGORY_MAP,
  TAXONOMY,
  VALID_SUB_CATEGORIES,
  isValidCategory,
  isValidSubCategory,
} from "@/config/taxonomy";
import { queryToolsPageData } from "@/lib/queries/tools-page-query";
import {
  POPULAR_SEARCH_SUGGESTIONS,
  parseSearchQuery,
} from "@/lib/search-engine";
import {
  buildFilterUrl,
  buildGlobalSearchUrl,
  computePagination,
  DEFAULT_PAGE_SIZE,
  hasActiveFilters,
  parseToolSearchParams,
  type RawSearchParams,
  type ToolFilters,
} from "@/lib/ui-helpers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    absolute: "Gifthub Crawl",
  },
  description: `Gifthub Crawl — Khám phá, lọc, ghim và ghi chú các công cụ mã nguồn mở nổi bật trên GitHub được AI phân loại theo ${VALID_SUB_CATEGORIES.length} ngách chuyên sâu.`,
};

const USABILITY_LABELS: Record<NonNullable<ToolFilters["usability"]>, string> = {
  "app-ready": "Dùng ngay",
  "cli-tool": "CLI",
  "dev-required": "Cho Dev",
};

function getActiveScopeLabel(filters: ToolFilters): string | null {
  const parts: string[] = [];

  if (filters.subCategory === "uncategorized") {
    parts.push("Chưa phân loại");
  } else if (filters.subCategory && isValidSubCategory(filters.subCategory)) {
    parts.push(SUB_CATEGORY_MAP[filters.subCategory].label);
  } else if (filters.category === "other") {
    parts.push("Nhóm khác");
  } else if (filters.category && isValidCategory(filters.category)) {
    parts.push(CATEGORY_MAP[filters.category].label);
  }

  if (filters.pinned) {
    parts.push("Công cụ đã ghim");
  }

  if (filters.usability) {
    parts.push(USABILITY_LABELS[filters.usability]);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

function buildPageHeading(filters: ToolFilters): {
  title: string;
  subtitle: string;
} {
  if (filters.subCategory === "uncategorized") {
    return {
      title: "Công cụ chưa phân loại",
      subtitle: `Các repository chưa khớp hoàn toàn với ${VALID_SUB_CATEGORIES.length} ngách chuẩn, bạn có thể phân loại lại trực tiếp trên từng thẻ.`,
    };
  }

  if (filters.subCategory && isValidSubCategory(filters.subCategory)) {
    const meta = SUB_CATEGORY_MAP[filters.subCategory];
    return {
      title: meta.label,
      subtitle: `${meta.categoryLabel} · ${meta.hint}`,
    };
  }

  if (filters.category === "other") {
    return {
      title: "Nhóm khác",
      subtitle: `Các công cụ ngoài ${TAXONOMY.length} nhóm danh mục chính.`,
    };
  }

  if (filters.category && isValidCategory(filters.category)) {
    const cat = CATEGORY_MAP[filters.category];
    return {
      title: cat.label,
      subtitle: `Bao gồm ${cat.subCategories.length} ngách chuyên sâu trong nhóm ${cat.label}.`,
    };
  }

  if (filters.pinned) {
    return {
      title: "Công cụ đã ghim",
      subtitle: "Danh sách các công cụ bạn đã đánh dấu ưu tiên theo dõi.",
    };
  }

  return {
    title: "Gifthub Crawl",
    subtitle:
      "Khám phá, lọc và ghi chú các công cụ mã nguồn mở nổi bật được AI phân loại từ GitHub.",
  };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const resolvedParams = await searchParams;
  const filters = parseToolSearchParams(resolvedParams);
  const parsedQuery = parseSearchQuery(filters.q);

  const { filteredTotal, items, isRelaxedSearch, counts } =
    await queryToolsPageData(filters, parsedQuery);
  const pagination = computePagination(
    filteredTotal,
    filters.page,
    DEFAULT_PAGE_SIZE,
  );

  const heading = buildPageHeading(filters);
  const filtersActive = hasActiveFilters(filters);
  const activeScopeLabel = getActiveScopeLabel(filters);
  const hasScopeFilters = Boolean(
    filters.category ||
      filters.subCategory ||
      filters.pinned ||
      filters.usability,
  );

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-zinc-950 text-zinc-100 lg:flex-row">
      <Sidebar filters={filters} counts={counts} />

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-6">
          {/* Page heading */}
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-100">
                {heading.title}
              </h1>
              <p className="text-sm text-zinc-400">{heading.subtitle}</p>
            </div>

            <nav
              aria-label="Chuyển trang nhanh"
              className="flex flex-wrap items-center gap-2"
            >
              <Link
                href="/newsfeed"
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition-colors hover:border-emerald-500/50 hover:bg-emerald-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                <Flame className="h-3.5 w-3.5 text-emerald-400" />
                <span>Newsfeed</span>
              </Link>
              <Link
                href="/logs"
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                <Activity className="h-3.5 w-3.5 text-sky-400" />
                <span>Nhật ký</span>
              </Link>
            </nav>
          </header>

          {/* Search & filters */}
          <SearchToolbar filters={filters} resultCount={filteredTotal} />

          {/* Tier 2 relaxed search notice */}
          {isRelaxedSearch && filters.q && (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200"
            >
              <span className="flex items-center gap-2">
                <Info className="h-4 w-4 shrink-0 text-amber-400" />
                <span>
                  Không có kết quả khớp hoàn toàn cho{" "}
                  <strong className="font-semibold text-amber-100">
                    «{filters.q}»
                  </strong>
                  {activeScopeLabel ? (
                    <>
                      {" "}
                      trong bộ lọc{" "}
                      <strong className="font-semibold text-amber-100">
                        «{activeScopeLabel}»
                      </strong>
                    </>
                  ) : null}{" "}
                  — đang hiển thị các công cụ liên quan gần nhất.
                </span>
              </span>
              <div className="flex flex-wrap items-center gap-3">
                {hasScopeFilters && (
                  <Link
                    href={buildGlobalSearchUrl(filters.q)}
                    className="inline-flex items-center gap-1 rounded-md border border-amber-400/40 bg-amber-400/15 px-2.5 py-1 font-medium text-amber-100 transition-colors hover:bg-amber-400/25"
                  >
                    Tìm trên toàn bộ kho
                  </Link>
                )}
                <Link
                  href={buildFilterUrl(filters, { q: "" })}
                  className="font-medium text-amber-300 underline-offset-2 hover:underline"
                >
                  Xóa từ khóa
                </Link>
              </div>
            </div>
          )}

          {/* Results or empty state */}
          {items.length > 0 ? (
            <>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {items.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} />
                ))}
              </div>
              <Pagination
                filters={filters}
                currentPage={pagination.currentPage}
                totalPages={pagination.totalPages}
                totalItems={filteredTotal}
                startItem={pagination.startItem}
                endItem={pagination.endItem}
              />
            </>
          ) : (
            <section className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-16 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-400">
                <SearchX className="h-6 w-6" />
              </div>
              <h2 className="text-base font-semibold text-zinc-200">
                {counts.totalCount === 0
                  ? "Chưa có công cụ nào trong cơ sở dữ liệu"
                  : "Không tìm thấy công cụ khớp bộ lọc"}
              </h2>
              <p className="mt-1 max-w-md text-sm text-zinc-400">
                {counts.totalCount === 0
                  ? "Hãy chạy worker đồng bộ (npm run sync) để thu thập và phân loại repository từ GitHub."
                  : filters.q && activeScopeLabel
                    ? `Không có công cụ nào khớp «${filters.q}» trong bộ lọc «${activeScopeLabel}». Bạn có thể tìm trên toàn bộ kho hoặc nới lỏng bộ lọc.`
                    : "Thử đổi sang từ khóa tiếng Việt/tiếng Anh khác, nới lỏng bộ lọc hoặc chọn nhanh một gợi ý bên dưới."}
              </p>

              {counts.totalCount > 0 && filters.q && (
                <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
                    <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Gợi ý thử:</span>
                  </span>
                  {POPULAR_SEARCH_SUGGESTIONS.map((suggestion) => (
                    <Link
                      key={suggestion}
                      href={buildFilterUrl(
                        { ...filters, category: undefined, subCategory: undefined },
                        { q: suggestion },
                      )}
                      className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
                    >
                      {suggestion}
                    </Link>
                  ))}
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                {counts.totalCount > 0 && filters.q && hasScopeFilters && (
                  <Link
                    href={buildGlobalSearchUrl(filters.q)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
                  >
                    <span>Tìm trên toàn bộ kho</span>
                  </Link>
                )}
                {filters.q && (
                  <Link
                    href={buildFilterUrl(filters, { q: "" })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-200 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
                  >
                    <span>Xóa từ khóa</span>
                  </Link>
                )}
                {filtersActive && (
                  <Link
                    href="/"
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors ${
                      counts.totalCount > 0 && filters.q && hasScopeFilters
                        ? "border border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-emerald-500/40 hover:text-emerald-300"
                        : "bg-emerald-600 text-white hover:bg-emerald-500"
                    }`}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Xóa toàn bộ bộ lọc</span>
                  </Link>
                )}
                <Link
                  href="/logs"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
                >
                  <span>Xem nhật ký đồng bộ</span>
                </Link>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
