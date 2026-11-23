"use client";

import { FolderGit2, Star } from "lucide-react";
import type {
  SuggestCategoryItem,
  SuggestOption,
  SuggestToolItem,
} from "@/hooks/useSearchSuggest";
import { formatStars } from "@/lib/ui-helpers";

export interface SearchSuggestDropdownProps {
  isOpen: boolean;
  suggestCategories: readonly SuggestCategoryItem[];
  suggestTools: readonly SuggestToolItem[];
  highlightedIndex: number;
  onSelectOption: (option: SuggestOption) => void;
}

/**
 * Dropdown hiển thị ngách gợi ý và công cụ phù hợp tức thì khi người dùng gõ vào thanh tìm kiếm.
 */
export function SearchSuggestDropdown({
  isOpen,
  suggestCategories,
  suggestTools,
  highlightedIndex,
  onSelectOption,
}: SearchSuggestDropdownProps) {
  if (!isOpen || (suggestCategories.length === 0 && suggestTools.length === 0)) {
    return null;
  }

  return (
    <div
      id="search-suggest-listbox"
      role="listbox"
      aria-label="Gợi ý tìm kiếm"
      className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-96 overflow-y-auto overscroll-contain rounded-xl border border-zinc-700 bg-zinc-950 p-1.5 shadow-2xl"
    >
      {suggestCategories.length > 0 && (
        <div className="pb-1">
          <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Ngách gợi ý
          </p>
          {suggestCategories.map((cat, idx) => {
            const isHighlighted = highlightedIndex === idx;
            return (
              <button
                key={cat.slug}
                id={`search-suggest-option-${idx}`}
                type="button"
                role="option"
                aria-selected={isHighlighted}
                onClick={() => onSelectOption({ kind: "category", item: cat })}
                className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                  isHighlighted
                    ? "bg-emerald-500/20 text-emerald-200"
                    : "text-zinc-200 hover:bg-zinc-900"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  <span className="truncate font-medium">{cat.label}</span>
                </span>
                <span className="shrink-0 text-[11px] text-zinc-400">
                  {cat.categoryLabel}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {suggestTools.length > 0 && (
        <div
          className={
            suggestCategories.length > 0 ? "border-t border-zinc-800 pt-1" : ""
          }
        >
          <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Công cụ phù hợp
          </p>
          {suggestTools.map((tool, tIdx) => {
            const optionIdx = suggestCategories.length + tIdx;
            const isHighlighted = highlightedIndex === optionIdx;
            return (
              <button
                key={tool.id}
                id={`search-suggest-option-${optionIdx}`}
                type="button"
                role="option"
                aria-selected={isHighlighted}
                onClick={() => onSelectOption({ kind: "tool", item: tool })}
                className={`flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  isHighlighted
                    ? "bg-emerald-500/20 text-emerald-100"
                    : "text-zinc-200 hover:bg-zinc-900"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs font-semibold text-zinc-100">
                    {tool.name}
                    {tool.fullName && tool.fullName !== tool.name && (
                      <span className="ml-1.5 font-normal text-zinc-400">
                        ({tool.fullName})
                      </span>
                    )}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums text-amber-300">
                    <Star className="h-3 w-3 text-amber-400" />
                    <span>{formatStars(tool.stars)}</span>
                  </span>
                </div>
                <p className="line-clamp-1 text-[11px] text-zinc-400">
                  {tool.summaryVi}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
