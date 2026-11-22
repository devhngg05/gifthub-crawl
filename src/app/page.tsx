import Link from "next/link";
import { and, arrayContains, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { RotateCcw, SearchX } from "lucide-react";
import { SearchToolbar } from "@/components/SearchToolbar";
import { Sidebar } from "@/components/Sidebar";
import { ToolCard } from "@/components/ToolCard";
import {
  CATEGORY_MAP,
  SUB_CATEGORY_MAP,
  isValidCategory,
  isValidSubCategory,
} from "@/config/taxonomy";
import { db } from "@/db";
import { tools } from "@/db/schema";
import {
  computeToolCounts,
  escapeLikePattern,
  hasActiveFilters,
  parseToolSearchParams,
  type RawSearchParams,
  type ToolFilters,
} from "@/lib/ui-helpers";

export const dynamic = "force-dynamic";

function buildPageHeading(filters: ToolFilters): {
  title: string;
  subtitle: string;
} {
  if (filters.subCategory === "uncategorized") {
    return {
      title: "Công cụ chưa phân loại",
      subtitle:
        "Các repository chưa khớp hoàn toàn với 25 ngách chuẩn, bạn có thể phân loại lại trực tiếp trên từng thẻ.",
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
      subtitle: "Các công cụ ngoài 7 nhóm danh mục chính.",
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
    title: "Radar công cụ GitHub",
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

  const conditions: SQL[] = [];

  if (filters.category) {
    conditions.push(eq(tools.category, filters.category));
  }

  if (filters.subCategory) {
    if (filters.subCategory === "uncategorized") {
      conditions.push(eq(tools.subCategory, "uncategorized"));
    } else {
      const subFilter = or(
        eq(tools.subCategory, filters.subCategory),
        arrayContains(tools.secondarySubCategories, [filters.subCategory]),
      );
      if (subFilter) {
        conditions.push(subFilter);
      }
    }
  }

  if (filters.usability) {
    conditions.push(eq(tools.usability, filters.usability));
  }

  if (filters.pinned) {
    conditions.push(eq(tools.isPinned, true));
  }

  if (filters.q) {
    const pattern = `%${escapeLikePattern(filters.q)}%`;
    const searchCondition = or(
      sql`${tools.name} ILIKE ${pattern} ESCAPE '\\'`,
      sql`${tools.fullName} ILIKE ${pattern} ESCAPE '\\'`,
      sql`${tools.summaryVi} ILIKE ${pattern} ESCAPE '\\'`,
      sql`EXISTS (SELECT 1 FROM unnest(${tools.useCases}) AS uc WHERE uc ILIKE ${pattern} ESCAPE '\\')`,
      sql`EXISTS (SELECT 1 FROM unnest(${tools.replaces}) AS rp WHERE rp ILIKE ${pattern} ESCAPE '\\')`,
    );
    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const orderByClauses: SQL[] = [];
  if (filters.subCategory && filters.subCategory !== "uncategorized") {
    orderByClauses.push(
      sql`CASE WHEN ${tools.subCategory} = ${filters.subCategory} THEN 0 ELSE 1 END ASC`,
    );
  }
  orderByClauses.push(desc(tools.isPinned));
  orderByClauses.push(
    filters.sort === "recent" ? desc(tools.lastPushedAt) : desc(tools.stars),
  );
  orderByClauses.push(desc(tools.id));

  const [items, countRows] = await Promise.all([
    db
      .select()
      .from(tools)
      .where(whereClause)
      .orderBy(...orderByClauses),
    db
      .select({
        category: tools.category,
        subCategory: tools.subCategory,
        secondarySubCategories: tools.secondarySubCategories,
        isPinned: tools.isPinned,
      })
      .from(tools),
  ]);

  const counts = computeToolCounts(countRows);
  const heading = buildPageHeading(filters);
  const filtersActive = hasActiveFilters(filters);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 lg:flex-row">
      <Sidebar filters={filters} counts={counts} />

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-6">
          {/* Page heading */}
          <header className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
              {heading.title}
            </h1>
            <p className="text-sm text-zinc-400">{heading.subtitle}</p>
          </header>

          {/* Search & filters */}
          <SearchToolbar filters={filters} resultCount={items.length} />

          {/* Results or empty state */}
          {items.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {items.map((tool) => (
                <ToolCard key={tool.id} tool={tool} />
              ))}
            </div>
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
                  : "Thử thay đổi từ khóa tìm kiếm, nới lỏng mức độ sử dụng hoặc đặt lại toàn bộ bộ lọc."}
              </p>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                {filtersActive && (
                  <Link
                    href="/"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
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
