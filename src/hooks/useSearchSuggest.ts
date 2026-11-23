"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  buildFilterUrl,
  buildSuggestedToolUrl,
  type ToolFilters,
} from "@/lib/ui-helpers";

export interface SuggestToolItem {
  id: number;
  name: string;
  fullName: string;
  summaryVi: string;
  subCategory: string;
  stars: number;
  usability: string;
}

export interface SuggestCategoryItem {
  slug: string;
  label: string;
  categoryLabel: string;
}

export type SuggestOption =
  | { kind: "category"; item: SuggestCategoryItem }
  | { kind: "tool"; item: SuggestToolItem };

/**
 * Custom hook quản lý toàn bộ vòng đời gợi ý tức thì cho thanh tìm kiếm:
 * debounce 200ms, `AbortController`, fetch `/api/tools/suggest`,
 * điều hướng bàn phím `↑`/`↓`/`Enter`/`Escape`, phím tắt toàn cục `Ctrl + K` / `/` và đóng khi click ngoài.
 */
export function useSearchSuggest(liveFilters: ToolFilters) {
  const router = useRouter();

  const searchWrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestTimerRef = useRef<number | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);
  const latestQueryRef = useRef("");

  const cancelPendingSuggest = useCallback(() => {
    if (suggestTimerRef.current !== null) {
      window.clearTimeout(suggestTimerRef.current);
      suggestTimerRef.current = null;
    }
    if (suggestAbortRef.current !== null) {
      suggestAbortRef.current.abort();
      suggestAbortRef.current = null;
    }
  }, []);

  useEffect(() => cancelPendingSuggest, [cancelPendingSuggest]);

  useEffect(() => {
    latestQueryRef.current = liveFilters.q;
  }, [liveFilters.q]);

  const [searchInput, setSearchInput] = useState(liveFilters.q);
  const [prevFilterQ, setPrevFilterQ] = useState(liveFilters.q);

  if (liveFilters.q !== prevFilterQ) {
    setPrevFilterQ(liveFilters.q);
    setSearchInput(liveFilters.q);
  }

  const [isSuggestOpen, setIsSuggestOpen] = useState(false);
  const [isSuggestLoading, setIsSuggestLoading] = useState(false);
  const [suggestTools, setSuggestTools] = useState<SuggestToolItem[]>([]);
  const [suggestCategories, setSuggestCategories] = useState<
    SuggestCategoryItem[]
  >([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const suggestOptions = useMemo<SuggestOption[]>(() => {
    const items: SuggestOption[] = [];
    for (const cat of suggestCategories) {
      items.push({ kind: "category", item: cat });
    }
    for (const tool of suggestTools) {
      items.push({ kind: "tool", item: tool });
    }
    return items;
  }, [suggestCategories, suggestTools]);

  // Global keyboard shortcuts: Ctrl+K / Cmd+K or "/"
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

  // Close suggest dropdown on outside click
  useEffect(() => {
    if (!isSuggestOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        searchWrapperRef.current &&
        !searchWrapperRef.current.contains(target)
      ) {
        setIsSuggestOpen(false);
        setHighlightedIndex(-1);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isSuggestOpen]);

  const closeSuggest = useCallback(() => {
    setIsSuggestOpen(false);
  }, []);

  const resetSuggest = useCallback(() => {
    cancelPendingSuggest();
    latestQueryRef.current = "";
    setIsSuggestOpen(false);
    setSuggestTools([]);
    setSuggestCategories([]);
    setSearchInput("");
  }, [cancelPendingSuggest]);

  const commitSearch = useCallback(
    (rawValue: string) => {
      cancelPendingSuggest();
      setIsSuggestOpen(false);
      setIsSuggestLoading(false);
      setHighlightedIndex(-1);

      const trimmed = rawValue.trim();
      latestQueryRef.current = trimmed;
      const nextUrl = buildFilterUrl(liveFilters, { q: trimmed });
      const currentUrl = buildFilterUrl(liveFilters, {});

      if (nextUrl === currentUrl) {
        return;
      }

      router.push(nextUrl, { scroll: false });
    },
    [cancelPendingSuggest, liveFilters, router],
  );

  const fetchSuggestions = async (query: string, controller: AbortController) => {
    try {
      const response = await fetch(
        `/api/tools/suggest?q=${encodeURIComponent(query)}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as {
        tools?: SuggestToolItem[];
        categories?: SuggestCategoryItem[];
      };
      if (controller.signal.aborted || latestQueryRef.current !== query) {
        return;
      }
      const nextTools = Array.isArray(data.tools) ? data.tools : [];
      const nextCats = Array.isArray(data.categories) ? data.categories : [];
      setSuggestTools(nextTools);
      setSuggestCategories(nextCats);
      setHighlightedIndex(-1);
      setIsSuggestOpen(nextTools.length > 0 || nextCats.length > 0);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setIsSuggestOpen(false);
    } finally {
      if (!controller.signal.aborted && latestQueryRef.current === query) {
        setIsSuggestLoading(false);
      }
    }
  };

  const handleInputChange = (nextValue: string) => {
    setSearchInput(nextValue);
    cancelPendingSuggest();
    setHighlightedIndex(-1);

    const trimmed = nextValue.trim();
    latestQueryRef.current = trimmed;
    setSuggestTools([]);
    setSuggestCategories([]);
    setIsSuggestOpen(false);

    if (trimmed.length < 2) {
      setIsSuggestLoading(false);
      return;
    }

    setIsSuggestLoading(true);
    suggestTimerRef.current = window.setTimeout(() => {
      suggestTimerRef.current = null;
      const controller = new AbortController();
      suggestAbortRef.current = controller;
      void fetchSuggestions(trimmed, controller);
    }, 200);
  };

  const handleInputFocus = () => {
    if (suggestOptions.length > 0 && searchInput.trim().length >= 2) {
      setIsSuggestOpen(true);
    }
  };

  const handleSelectOption = (option: SuggestOption) => {
    cancelPendingSuggest();
    setIsSuggestOpen(false);
    setIsSuggestLoading(false);
    setSuggestTools([]);
    setSuggestCategories([]);
    setHighlightedIndex(-1);

    if (option.kind === "category") {
      latestQueryRef.current = "";
      setSearchInput("");
      router.push(
        buildFilterUrl(liveFilters, {
          subCategory: option.item.slug as ToolFilters["subCategory"],
          category: undefined,
          pinned: false,
          q: "",
        }),
        { scroll: false },
      );
      return;
    }

    const nextQuery = option.item.fullName.trim() || option.item.name.trim();
    latestQueryRef.current = nextQuery;
    setSearchInput(nextQuery);
    router.push(buildSuggestedToolUrl(nextQuery), { scroll: false });
  };

  const handleInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (suggestOptions.length > 0) {
        e.preventDefault();
        setIsSuggestOpen(true);
        setHighlightedIndex((prev) =>
          prev < suggestOptions.length - 1 ? prev + 1 : 0,
        );
      }
      return;
    }
    if (e.key === "ArrowUp") {
      if (isSuggestOpen && suggestOptions.length > 0) {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : suggestOptions.length - 1,
        );
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (
        isSuggestOpen &&
        highlightedIndex >= 0 &&
        suggestOptions[highlightedIndex]
      ) {
        handleSelectOption(suggestOptions[highlightedIndex]);
      } else {
        commitSearch(searchInput);
      }
      return;
    }
    if (e.key === "Escape") {
      if (isSuggestOpen) {
        e.preventDefault();
        setIsSuggestOpen(false);
        setHighlightedIndex(-1);
      } else {
        inputRef.current?.blur();
      }
    }
  };

  const handleClearSearch = () => {
    cancelPendingSuggest();
    latestQueryRef.current = "";
    setSearchInput("");
    setSuggestTools([]);
    setSuggestCategories([]);
    setIsSuggestOpen(false);
    setIsSuggestLoading(false);
    setHighlightedIndex(-1);

    const nextUrl = buildFilterUrl(liveFilters, { q: "" });
    const currentUrl = buildFilterUrl(liveFilters, {});
    if (nextUrl !== currentUrl) {
      router.replace(nextUrl, { scroll: false });
    }
    inputRef.current?.focus();
  };

  return {
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
  };
}
