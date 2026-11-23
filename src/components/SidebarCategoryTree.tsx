"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight, FolderGit2 } from "lucide-react";
import { TAXONOMY } from "@/config/taxonomy";
import {
  buildFilterUrl,
  type ToolCounts,
  type ToolFilters,
} from "@/lib/ui-helpers";

export interface SidebarCategoryTreeProps {
  filters: ToolFilters;
  counts: ToolCounts;
  expandedCategories: Record<string, boolean>;
  onToggleCategory: (slug: string) => void;
  onNavigate?: () => void;
}

/**
 * Cây điều hướng 10 nhóm lớn và 43 ngách chuyên sâu kèm trạng thái đóng/mở và bộ đếm số lượng công cụ.
 */
export function SidebarCategoryTree({
  filters,
  counts,
  expandedCategories,
  onToggleCategory,
  onNavigate,
}: SidebarCategoryTreeProps) {
  return (
    <div className="space-y-1.5">
      <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
        Danh mục ({TAXONOMY.length} nhóm)
      </p>

      {TAXONOMY.map((cat) => {
        const isExpanded = expandedCategories[cat.slug] ?? true;
        const isCategoryActive =
          filters.category === cat.slug && !filters.subCategory;
        const catCount = counts.categoryCounts[cat.slug] ?? 0;

        return (
          <div key={cat.slug} className="space-y-0.5">
            <div
              className={`flex min-w-0 items-center rounded-lg transition-colors ${
                isCategoryActive
                  ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "text-zinc-300 hover:bg-zinc-900/80"
              }`}
            >
              <button
                type="button"
                onClick={() => onToggleCategory(cat.slug)}
                aria-expanded={isExpanded}
                aria-controls={`sidebar-cat-${cat.slug}`}
                aria-label={
                  isExpanded ? `Thu gọn ${cat.label}` : `Mở rộng ${cat.label}`
                }
                className="shrink-0 cursor-pointer rounded p-1.5 text-zinc-400 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>

              <Link
                href={buildFilterUrl(filters, {
                  category: cat.slug,
                  subCategory: undefined,
                  pinned: false,
                })}
                onClick={onNavigate}
                aria-current={isCategoryActive ? "page" : undefined}
                className="flex min-w-0 flex-1 items-center justify-between rounded py-1.5 pr-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                  <span className="truncate">{cat.label}</span>
                </span>
                <span className="ml-2 shrink-0 rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-zinc-400">
                  {catCount}
                </span>
              </Link>
            </div>

            {isExpanded && (
              <div
                id={`sidebar-cat-${cat.slug}`}
                className="ml-3.5 space-y-0.5 border-l border-zinc-800/80 pl-2.5"
              >
                {cat.subCategories.map((sub) => {
                  const isSubActive = filters.subCategory === sub.slug;
                  const subCount = counts.subCategoryCounts[sub.slug] ?? 0;

                  return (
                    <Link
                      key={sub.slug}
                      href={buildFilterUrl(filters, {
                        subCategory: sub.slug,
                        category: undefined,
                        pinned: false,
                      })}
                      onClick={onNavigate}
                      title={sub.hint}
                      aria-current={isSubActive ? "page" : undefined}
                      className={`flex min-w-0 items-center justify-between rounded-md px-2 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                        isSubActive
                          ? "bg-emerald-500/15 font-medium text-emerald-300"
                          : "text-zinc-400 hover:bg-zinc-900/70 hover:text-zinc-200"
                      }`}
                    >
                      <span className="truncate">{sub.label}</span>
                      <span
                        className={`ml-2 shrink-0 font-mono text-[11px] tabular-nums ${
                          isSubActive ? "text-emerald-300" : "text-zinc-400"
                        }`}
                      >
                        {subCount}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
