"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  HelpCircle,
  Layers,
  Menu,
  Pin,
  Radar,
  X,
} from "lucide-react";
import { TAXONOMY } from "@/config/taxonomy";
import {
  buildFilterUrl,
  type ToolCounts,
  type ToolFilters,
} from "@/lib/ui-helpers";

export interface SidebarProps {
  filters: ToolFilters;
  counts: ToolCounts;
}

interface SidebarContentProps {
  filters: ToolFilters;
  counts: ToolCounts;
  expandedCategories: Record<string, boolean>;
  onToggleCategory: (slug: string) => void;
  onNavigate?: () => void;
}

function SidebarContent({
  filters,
  counts,
  expandedCategories,
  onToggleCategory,
  onNavigate,
}: SidebarContentProps) {
  const isAllActive =
    !filters.category && !filters.subCategory && !filters.pinned;
  const isPinnedActive = filters.pinned;
  const isUncategorizedActive = filters.subCategory === "uncategorized";

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      {/* Brand header */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-4">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-2.5 group"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 transition-colors group-hover:bg-emerald-500/20">
            <Radar className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight text-zinc-100">
              GitHub Tool Radar
            </p>
            <p className="text-[11px] text-zinc-500">
              AI-Curated OSS Discovery
            </p>
          </div>
        </Link>
      </div>

      {/* Scrollable navigation */}
      <nav
        aria-label="Bộ lọc danh mục"
        className="flex-1 space-y-5 overflow-y-auto px-3 py-4"
      >
        {/* Quick filters */}
        <div className="space-y-1">
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Tổng quan
          </p>

          <Link
            href={buildFilterUrl(filters, {
              category: undefined,
              subCategory: undefined,
              pinned: false,
            })}
            onClick={onNavigate}
            className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors ${
              isAllActive
                ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 font-medium"
                : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
            }`}
          >
            <span className="flex items-center gap-2">
              <Layers className="h-4 w-4 shrink-0" />
              <span>Tất cả công cụ</span>
            </span>
            <span className="rounded-md bg-zinc-900 px-1.5 py-0.5 text-xs font-mono text-zinc-400">
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
            className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors ${
              isPinnedActive
                ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 font-medium"
                : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
            }`}
          >
            <span className="flex items-center gap-2">
              <Pin className="h-4 w-4 shrink-0" />
              <span>Đã ghim</span>
            </span>
            <span className="rounded-md bg-zinc-900 px-1.5 py-0.5 text-xs font-mono text-zinc-400">
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
            className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors ${
              isUncategorizedActive
                ? "border border-amber-500/30 bg-amber-500/10 text-amber-300 font-medium"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-2">
              <HelpCircle className="h-4 w-4 shrink-0" />
              <span>Chưa phân loại</span>
            </span>
            <span className="rounded-md bg-zinc-900 px-1.5 py-0.5 text-xs font-mono text-zinc-500">
              {counts.uncategorizedCount}
            </span>
          </Link>
        </div>

        {/* 2-level taxonomy tree */}
        <div className="space-y-1.5">
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Danh mục ({TAXONOMY.length} nhóm)
          </p>

          {TAXONOMY.map((cat) => {
            const hasActiveSub = cat.subCategories.some(
              (sub) => sub.slug === filters.subCategory,
            );
            const isExpanded =
              (expandedCategories[cat.slug] ?? true) ||
              filters.category === cat.slug ||
              hasActiveSub;
            const isCategoryActive =
              filters.category === cat.slug && !filters.subCategory;
            const catCount = counts.categoryCounts[cat.slug] ?? 0;

            return (
              <div key={cat.slug} className="space-y-0.5">
                <div
                  className={`flex items-center rounded-lg transition-colors ${
                    isCategoryActive
                      ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "text-zinc-300 hover:bg-zinc-900/80"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onToggleCategory(cat.slug)}
                    aria-label={
                      isExpanded ? `Thu gọn ${cat.label}` : `Mở rộng ${cat.label}`
                    }
                    className="p-1.5 text-zinc-500 hover:text-zinc-200"
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
                    className="flex flex-1 items-center justify-between py-1.5 pr-2.5 text-xs font-medium"
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      <span className="truncate">{cat.label}</span>
                    </span>
                    <span className="ml-2 rounded bg-zinc-900 px-1.5 py-0.5 text-[11px] font-mono text-zinc-400">
                      {catCount}
                    </span>
                  </Link>
                </div>

                {isExpanded && (
                  <div className="ml-3.5 space-y-0.5 border-l border-zinc-800/80 pl-2.5">
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
                          className={`flex items-center justify-between rounded-md px-2 py-1.5 text-xs transition-colors ${
                            isSubActive
                              ? "bg-emerald-500/15 text-emerald-300 font-medium"
                              : "text-zinc-400 hover:bg-zinc-900/70 hover:text-zinc-200"
                          }`}
                        >
                          <span className="truncate">{sub.label}</span>
                          <span
                            className={`ml-2 font-mono text-[11px] ${
                              isSubActive ? "text-emerald-300" : "text-zinc-500"
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
      </nav>

      {/* Footer link to Sync Logs */}
      <div className="border-t border-zinc-800/80 p-3">
        <Link
          href="/logs"
          onClick={onNavigate}
          className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
        >
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-400" />
            <span>Nhật ký đồng bộ</span>
          </span>
          <span className="font-mono text-[11px] text-zinc-500">/logs</span>
        </Link>
      </div>
    </div>
  );
}

/**
 * Thanh điều hướng bên trái 2 tầng (7 nhóm lớn & 25 ngách con) lấy trực tiếp từ `TAXONOMY`,
 * hỗ trợ Drawer gọn trên thiết bị di động.
 */
export function Sidebar({ filters, counts }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, boolean>
  >(() => Object.fromEntries(TAXONOMY.map((cat) => [cat.slug, true])));

  const handleToggleCategory = (slug: string) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [slug]: !(prev[slug] ?? true),
    }));
  };

  return (
    <>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <Radar className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-zinc-100">
            GitHub Tool Radar
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <Link
            href="/logs"
            className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-700"
          >
            Logs
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Mở menu danh mục"
            className="rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-200 hover:border-zinc-700"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Mobile slide-over drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 flex h-full w-80 max-w-[85vw] flex-col border-r border-zinc-800 bg-zinc-950 shadow-2xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Đóng menu danh mục"
              className="absolute right-3 top-3.5 z-20 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            >
              <X className="h-4 w-4" />
            </button>
            <SidebarContent
              filters={filters}
              counts={counts}
              expandedCategories={expandedCategories}
              onToggleCategory={handleToggleCategory}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      )}

      {/* Desktop sticky sidebar */}
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-72 lg:shrink-0 lg:flex-col lg:border-r lg:border-zinc-800">
        <SidebarContent
          filters={filters}
          counts={counts}
          expandedCategories={expandedCategories}
          onToggleCategory={handleToggleCategory}
        />
      </aside>
    </>
  );
}
