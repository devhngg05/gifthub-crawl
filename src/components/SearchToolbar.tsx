"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownWideNarrow, Clock, RotateCcw, Search, Star, X } from "lucide-react";
import {
  buildFilterUrl,
  hasActiveFilters,
  type ToolFilters,
} from "@/lib/ui-helpers";
import type { UsabilityLevel } from "@/lib/validator";

export interface SearchToolbarProps {
  filters: ToolFilters;
  resultCount: number;
}

const USABILITY_OPTIONS: ReadonlyArray<{
  value?: UsabilityLevel;
  label: string;
}> = [
  { value: undefined, label: "Tất cả" },
  { value: "app-ready", label: "Dùng ngay" },
  { value: "cli-tool", label: "CLI" },
  { value: "dev-required", label: "Cho Dev" },
];

/**
 * Thanh tìm kiếm & bộ lọc nhanh đồng bộ với URL `searchParams`.
 * Hỗ trợ phím tắt `Ctrl + K` / `/`, debounce input 300ms, lọc `usability`, đổi `sort` và xóa bộ lọc.
 */
export function SearchToolbar({ filters, resultCount }: SearchToolbarProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [searchInput, setSearchInput] = useState(filters.q);
  const [prevFilterQ, setPrevFilterQ] = useState(filters.q);

  if (filters.q !== prevFilterQ) {
    setPrevFilterQ(filters.q);
    setSearchInput(filters.q);
  }

  // Keyboard shortcuts: Ctrl+K / Cmd+K or "/"
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable);

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }

      if (event.key === "/" && !isEditing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Debounced URL synchronization for search query
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === filters.q) {
      return;
    }

    const timer = window.setTimeout(() => {
      const nextUrl = buildFilterUrl(filters, { q: trimmed });
      router.replace(nextUrl, { scroll: false });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchInput, filters, router]);

  const filtersActive = hasActiveFilters(filters);

  return (
    <section
      aria-label="Tìm kiếm và lọc công cụ"
      className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        {/* Search input */}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            ref={inputRef}
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                inputRef.current?.blur();
              }
            }}
            placeholder="Tìm tên repo, mô tả tiếng Việt, công dụng hoặc phần mềm thay thế..."
            aria-label="Tìm kiếm công cụ"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pl-9 pr-20 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
          />

          <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
            {searchInput ? (
              <button
                type="button"
                onClick={() => {
                  setSearchInput("");
                  router.replace(buildFilterUrl(filters, { q: "" }), {
                    scroll: false,
                  });
                }}
                aria-label="Xóa từ khóa tìm kiếm"
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd className="hidden rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 sm:inline-block">
                Ctrl K
              </kbd>
            )}
          </div>
        </div>

        {/* Sort selector */}
        <div className="flex items-center gap-1.5 self-start rounded-lg border border-zinc-800 bg-zinc-950 p-1 md:self-auto">
          <span className="flex items-center gap-1 pl-2 pr-1 text-xs text-zinc-500">
            <ArrowDownWideNarrow className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sắp xếp:</span>
          </span>

          <Link
            href={buildFilterUrl(filters, { sort: "stars" })}
            scroll={false}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              filters.sort === "stars"
                ? "bg-emerald-500/15 text-emerald-300"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Star className="h-3 w-3" />
            <span>Ghim &amp; Sao cao</span>
          </Link>

          <Link
            href={buildFilterUrl(filters, { sort: "recent" })}
            scroll={false}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              filters.sort === "recent"
                ? "bg-emerald-500/15 text-emerald-300"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Clock className="h-3 w-3" />
            <span>Mới cập nhật</span>
          </Link>
        </div>
      </div>

      {/* Usability pills & result summary */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-zinc-500">Mức độ dùng:</span>
          {USABILITY_OPTIONS.map((option) => {
            const isActive = filters.usability === option.value;
            return (
              <Link
                key={option.label}
                href={buildFilterUrl(filters, { usability: option.value })}
                scroll={false}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                    : "border-zinc-800 bg-zinc-950/70 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                }`}
              >
                {option.label}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-3 text-xs text-zinc-400">
          <span>
            Tìm thấy{" "}
            <strong className="font-mono text-zinc-200">{resultCount}</strong>{" "}
            công cụ
          </span>

          {filtersActive && (
            <Link
              href="/"
              className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-300 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Xóa bộ lọc</span>
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
