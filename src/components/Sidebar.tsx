"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Menu, Radar, X } from "lucide-react";
import { SidebarContent } from "@/components/SidebarContent";
import {
  SUB_CATEGORY_MAP,
  TAXONOMY,
  isValidCategory,
  isValidSubCategory,
} from "@/config/taxonomy";
import {
  DESKTOP_MEDIA_QUERY,
  acquireBodyScrollLock,
  shouldLockMobileDrawerScroll,
} from "@/lib/scroll-lock";
import type { ToolCounts, ToolFilters } from "@/lib/ui-helpers";

export interface SidebarProps {
  filters: ToolFilters;
  counts: ToolCounts;
}

const MOBILE_DRAWER_ID = "mobile-sidebar-drawer";

/**
 * Thanh điều hướng bên trái 2 tầng (10 nhóm lớn & 43 ngách con) lấy trực tiếp từ `TAXONOMY`,
 * hỗ trợ Drawer gọn trên thiết bị di động (tự đóng khi đổi URL hoặc chuyển lên desktop, hỗ trợ Escape & khóa cuộn có đếm tham chiếu).
 */
export function Sidebar({ filters, counts }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;

  const activeCategorySlug =
    filters.category && isValidCategory(filters.category)
      ? filters.category
      : filters.subCategory && isValidSubCategory(filters.subCategory)
        ? SUB_CATEGORY_MAP[filters.subCategory].category
        : null;

  const [mobileOpen, setMobileOpen] = useState(false);
  const [prevRouteKey, setPrevRouteKey] = useState(routeKey);
  const [prevActiveCategorySlug, setPrevActiveCategorySlug] =
    useState<string | null>(activeCategorySlug);
  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, boolean>
  >(() => Object.fromEntries(TAXONOMY.map((cat) => [cat.slug, true])));

  if (routeKey !== prevRouteKey) {
    setPrevRouteKey(routeKey);
    if (mobileOpen) {
      setMobileOpen(false);
    }
  }

  if (activeCategorySlug !== prevActiveCategorySlug) {
    setPrevActiveCategorySlug(activeCategorySlug);
    if (activeCategorySlug) {
      setExpandedCategories((prev) => ({
        ...prev,
        [activeCategorySlug]: true,
      }));
    }
  }

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }

    const desktopMedia = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const releaseScrollLock = shouldLockMobileDrawerScroll(
      mobileOpen,
      desktopMedia.matches,
    )
      ? acquireBodyScrollLock()
      : null;

    const handleMediaChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setMobileOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    };

    desktopMedia.addEventListener("change", handleMediaChange);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      releaseScrollLock?.();
      desktopMedia.removeEventListener("change", handleMediaChange);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileOpen]);

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
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <Radar className="h-4 w-4" />
          </span>
          <span className="truncate font-display text-sm font-extrabold tracking-tight text-zinc-100">
            Gifthub Crawl
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/logs"
            className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            Nhật ký
          </Link>
          <button
            type="button"
            onClick={() => {
              if (!window.matchMedia(DESKTOP_MEDIA_QUERY).matches) {
                setMobileOpen(true);
              }
            }}
            aria-expanded={mobileOpen}
            aria-controls={MOBILE_DRAWER_ID}
            aria-label="Mở menu danh mục"
            className="rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-200 hover:border-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Mobile slide-over drawer */}
      {mobileOpen && (
        <div
          id={MOBILE_DRAWER_ID}
          role="dialog"
          aria-modal="true"
          aria-label="Menu danh mục"
          className="fixed inset-0 z-50 flex lg:hidden"
        >
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 flex h-dvh w-80 max-w-[85vw] flex-col overflow-y-auto overscroll-contain border-r border-zinc-800 bg-zinc-950 shadow-2xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Đóng menu danh mục"
              className="absolute right-3 top-3.5 z-20 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
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
      <aside
        aria-label="Thanh điều hướng danh mục"
        className="hidden bg-zinc-950 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-72 lg:shrink-0 lg:self-start lg:flex-col lg:overflow-y-auto lg:overscroll-contain lg:border-r lg:border-zinc-800"
      >
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
