"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  Check,
  ChevronDown,
  Clock,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  X,
  type LucideIcon,
} from "lucide-react";
import { SearchSuggestDropdown } from "@/components/SearchSuggestDropdown";
import { useSearchSuggest } from "@/hooks/useSearchSuggest";
import {
  buildFilterUrl,
  hasActiveFilters,
  parseUrlSearchParams,
  type ToolFilters,
  type ToolSort,
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

const SORT_OPTIONS: ReadonlyArray<{
  value: ToolSort;
  label: string;
  icon: LucideIcon;
  requiresQuery?: boolean;
}> = [
  {
    value: "relevance",
    label: "Phù hợp nhất",
    icon: Sparkles,
    requiresQuery: true,
  },
  { value: "stars", label: "Ghim & Nhiều sao nhất", icon: Star },
  { value: "recent", label: "Mới cập nhật", icon: Clock },
  { value: "name", label: "Tên A → Z", icon: ArrowDownAZ },
];

/**
 * Thanh tìm kiếm thông minh & bộ lọc đồng bộ URL `searchParams`:
 * - Gõ để xem dropdown gợi ý tức thì (`GET /api/tools/suggest`, debounce 200ms + `AbortController`, không tự navigate gây nháy dropdown).
 * - Điều hướng trang dứt khoát khi bấm `Enter`, bấm nút `Tìm`, chọn mục gợi ý, hoặc xóa từ khóa (`X`).
 * - Hỗ trợ phím tắt `Ctrl + K` / `/`, điều hướng gợi ý bằng `↑` / `↓` / `Escape`, và sắp xếp `"Phù hợp nhất"` tự bật khi có `q`.
 */
export function SearchToolbar({ resultCount }: SearchToolbarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const liveFilters = useMemo(
    () => parseUrlSearchParams(searchParams),
    [searchParams],
  );

  const {
    searchWrapperRef,
    inputRef,
    searchInput,
    isSuggestOpen,
    isSuggestLoading,
    suggestTools,
    suggestCategories,
    suggestOptions,
    highlightedIndex,
    cancelPendingSuggest,
    closeSuggest,
    resetSuggest,
    commitSearch,
    handleInputChange,
    handleInputFocus,
    handleInputKeyDown,
    handleSelectOption,
    handleClearSearch,
  } = useSearchSuggest(liveFilters);

  const sortMenuRef = useRef<HTMLDivElement>(null);
  const sortTriggerRef = useRef<HTMLButtonElement>(null);

  const [isSortOpen, setIsSortOpen] = useState(false);
  const [isSortPending, startSortTransition] = useTransition();
  const [optimisticSort, setOptimisticSort] = useState<ToolSort | null>(null);

  const activeSort: ToolSort =
    isSortPending && optimisticSort ? optimisticSort : liveFilters.sort;

  const visibleSortOptions = useMemo(
    () =>
      SORT_OPTIONS.filter(
        (opt) =>
          !opt.requiresQuery ||
          Boolean(liveFilters.q) ||
          activeSort === opt.value,
      ),
    [liveFilters.q, activeSort],
  );

  const activeSortOption =
    visibleSortOptions.find((opt) => opt.value === activeSort) ??
    visibleSortOptions[0];

  // Close sort dropdown on outside click / Escape
  useEffect(() => {
    if (!isSortOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        sortMenuRef.current &&
        !sortMenuRef.current.contains(target)
      ) {
        setIsSortOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsSortOpen(false);
        sortTriggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSortOpen]);

  const handleSortChange = (nextSort: ToolSort) => {
    setIsSortOpen(false);
    cancelPendingSuggest();
    closeSuggest();

    const trimmedQuery = searchInput.trim();
    const nextUrl = buildFilterUrl(liveFilters, {
      q: trimmedQuery,
      sort: nextSort,
    });
    const currentUrl = buildFilterUrl(liveFilters, {});
    if (nextUrl === currentUrl) {
      return;
    }

    setOptimisticSort(nextSort);
    startSortTransition(() => {
      router.push(nextUrl, { scroll: false });
    });
  };

  const filtersActive = hasActiveFilters(liveFilters);

  return (
    <section
      aria-label="Tìm kiếm và lọc công cụ"
      className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        {/* Search input + Instant Suggest Dropdown */}
        <div ref={searchWrapperRef} className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isSuggestOpen}
            aria-controls="search-suggest-listbox"
            aria-activedescendant={
              highlightedIndex >= 0
                ? `search-suggest-option-${highlightedIndex}`
                : undefined
            }
            enterKeyHint="search"
            value={searchInput}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={handleInputFocus}
            onKeyDown={handleInputKeyDown}
            placeholder="Tìm tự nhiên (vd: nối API, cào web, thay thế notion, chạy AI local)..."
            aria-label="Tìm kiếm công cụ"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pl-9 pr-28 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
          />

          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {isSuggestLoading && (
              <Loader2
                aria-hidden="true"
                className="h-3.5 w-3.5 animate-spin text-emerald-400"
              />
            )}

            {searchInput ? (
              <button
                type="button"
                onClick={handleClearSearch}
                aria-label="Xóa từ khóa tìm kiếm"
                className="cursor-pointer rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd className="hidden rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 sm:inline-block">
                Ctrl K
              </kbd>
            )}

            <button
              type="button"
              onClick={() => commitSearch(searchInput)}
              aria-label="Thực hiện tìm kiếm"
              className="cursor-pointer rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-1 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              Tìm
            </button>
          </div>

          <SearchSuggestDropdown
            isOpen={isSuggestOpen && suggestOptions.length > 0}
            suggestCategories={suggestCategories}
            suggestTools={suggestTools}
            highlightedIndex={highlightedIndex}
            onSelectOption={handleSelectOption}
          />
        </div>

        {/* Sort dropdown */}
        <div ref={sortMenuRef} className="relative self-start md:self-auto">
          <button
            ref={sortTriggerRef}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={isSortOpen}
            aria-controls="sort-options-listbox"
            aria-busy={isSortPending}
            onClick={() => setIsSortOpen((prev) => !prev)}
            className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
              isSortOpen ? "border-emerald-500/60" : "border-zinc-800"
            }`}
          >
            <ArrowDownWideNarrow className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <span className="text-zinc-400">Sắp xếp:</span>
            <span className="text-zinc-100">{activeSortOption.label}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${
                isSortOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {isSortOpen && (
            <div
              id="sort-options-listbox"
              role="listbox"
              aria-label="Chọn thứ tự sắp xếp"
              className="absolute right-0 top-full z-50 mt-1.5 min-w-48 rounded-lg border border-zinc-700 bg-zinc-950 p-1 shadow-2xl"
            >
              {visibleSortOptions.map((option) => {
                const Icon = option.icon;
                const isSelected = activeSort === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSortChange(option.value)}
                    className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                      isSelected
                        ? "bg-emerald-500/15 font-medium text-emerald-300"
                        : "text-zinc-200 hover:bg-zinc-900 hover:text-white"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span>{option.label}</span>
                    </span>
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Usability pills & result summary */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-zinc-400">Mức độ dùng:</span>
          {USABILITY_OPTIONS.map((option) => {
            const isActive = liveFilters.usability === option.value;
            return (
              <Link
                key={option.label}
                href={buildFilterUrl(liveFilters, {
                  q: searchInput.trim(),
                  usability: option.value,
                })}
                prefetch={false}
                scroll={false}
                onClick={() => {
                  cancelPendingSuggest();
                  closeSuggest();
                }}
                aria-current={isActive ? "true" : undefined}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
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
            <strong className="font-mono tabular-nums text-zinc-200">
              {resultCount}
            </strong>{" "}
            công cụ
          </span>

          {filtersActive && (
            <Link
              href="/"
              prefetch={false}
              onClick={resetSuggest}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-300 transition-colors hover:border-emerald-500/40 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
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
