"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Flame, HelpCircle, Layers, Pin, Radar } from "lucide-react";
import { SidebarCategoryTree } from "@/components/SidebarCategoryTree";
import {
  buildFilterUrl,
  type ToolCounts,
  type ToolFilters,
} from "@/lib/ui-helpers";

export interface SidebarContentProps {
  filters: ToolFilters;
  counts: ToolCounts;
  expandedCategories: Record<string, boolean>;
  onToggleCategory: (slug: string) => void;
  onNavigate?: () => void;
}

/**
 * Nội dung cây điều hướng danh mục 2 tầng dùng chung cho cả Desktop Sidebar và Mobile Drawer.
 */
export function SidebarContent({
  filters,
  counts,
  expandedCategories,
  onToggleCategory,
  onNavigate,
}: SidebarContentProps) {
  const pathname = usePathname();
  const isNewsfeedActive = pathname === "/newsfeed";
  const isAllActive =
    pathname === "/" &&
    !filters.category &&
    !filters.subCategory &&
    !filters.pinned;
  const isPinnedActive = pathname === "/" && filters.pinned;
  const isUncategorizedActive =
    pathname === "/" && filters.subCategory === "uncategorized";

  return (
    <div className="flex min-h-full flex-col bg-zinc-950 text-zinc-200">
      {/* Brand header */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-4">
        <Link
          href="/"
          onClick={onNavigate}
          className="group flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 transition-colors group-hover:bg-emerald-500/20">
            <Radar className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-extrabold tracking-tight text-zinc-100">
              Gifthub Crawl
            </p>
            <p className="truncate text-[11px] text-zinc-400">
              Khám phá công cụ nguồn mở
            </p>
          </div>
        </Link>
      </div>

      {/* Scrollable navigation */}
      <nav
        aria-label="Bộ lọc danh mục"
        className="flex-1 space-y-5 px-3 py-4"
      >
        {/* Quick filters */}
        <div className="space-y-1">
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            Tổng quan
          </p>

          <Link
            href="/newsfeed"
            onClick={onNavigate}
            aria-current={isNewsfeedActive ? "page" : undefined}
            className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
              isNewsfeedActive
                ? "border border-emerald-500/30 bg-emerald-500/10 font-medium text-emerald-300"
                : "text-zinc-200 hover:bg-zinc-900 hover:text-emerald-300"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Flame className="h-4 w-4 shrink-0 text-emerald-400" />
              <span className="truncate">Newsfeed</span>
            </span>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
              Hot
            </span>
          </Link>

          <Link
            href={buildFilterUrl(filters, {
              category: undefined,
              subCategory: undefined,
              pinned: false,
            })}
            onClick={onNavigate}
            aria-current={isAllActive ? "page" : undefined}
            className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
              isAllActive
                ? "border border-emerald-500/30 bg-emerald-500/10 font-medium text-emerald-300"
                : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Layers className="h-4 w-4 shrink-0" />
              <span className="truncate">Tất cả công cụ</span>
            </span>
            <span className="rounded-md bg-zinc-900 px-1.5 py-0.5 font-mono text-xs tabular-nums text-zinc-300">
              {counts.totalCount}
            </span>
          </Link>

          <Link
            href={buildFilterUrl(filters, {
              category: undefined,
              subCategory: undefined,
              pinned: !filters.pinned,
            })}
            onClick={onNavigate}
            aria-current={isPinnedActive ? "page" : undefined}
            className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
              isPinnedActive
                ? "border border-emerald-500/30 bg-emerald-500/10 font-medium text-emerald-300"
                : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Pin className="h-4 w-4 shrink-0" />
              <span className="truncate">Đã ghim</span>
            </span>
            <span className="rounded-md bg-zinc-900 px-1.5 py-0.5 font-mono text-xs tabular-nums text-zinc-300">
              {counts.pinnedCount}
            </span>
          </Link>

          <Link
            href={buildFilterUrl(filters, {
              category: undefined,
              subCategory: "uncategorized",
              pinned: false,
            })}
            onClick={onNavigate}
            aria-current={isUncategorizedActive ? "page" : undefined}
            className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
              isUncategorizedActive
                ? "border border-amber-500/30 bg-amber-500/10 font-medium text-amber-300"
                : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <HelpCircle className="h-4 w-4 shrink-0" />
              <span className="truncate">Chưa phân loại</span>
            </span>
            <span className="rounded-md bg-zinc-900 px-1.5 py-0.5 font-mono text-xs tabular-nums text-zinc-400">
              {counts.uncategorizedCount}
            </span>
          </Link>
        </div>

        <SidebarCategoryTree
          filters={filters}
          counts={counts}
          expandedCategories={expandedCategories}
          onToggleCategory={onToggleCategory}
          onNavigate={onNavigate}
        />
      </nav>

      {/* Footer link to Sync Logs */}
      <div className="border-t border-zinc-800/80 p-3">
        <Link
          href="/logs"
          onClick={onNavigate}
          className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-emerald-500/40 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        >
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-400" />
            <span>Nhật ký đồng bộ</span>
          </span>
          <span className="font-mono text-[11px] tabular-nums text-zinc-400">
            /logs
          </span>
        </Link>
      </div>
    </div>
  );
}
