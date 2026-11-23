"use client";

import { useRouter } from "next/navigation";
import { RotateCcw, Star } from "lucide-react";
import { TAXONOMY, isValidCategory, type CategorySlug } from "@/config/taxonomy";
import {
  buildNewsfeedUrl,
  NEWSFEED_TABS,
  NEWSFEED_WINDOWS,
  type NewsfeedParams,
  type NewsfeedTab,
  type NewsfeedWindow,
} from "@/lib/newsfeed";

export interface NewsfeedControlsProps {
  params: NewsfeedParams;
  tabCounts: Record<NewsfeedTab, number>;
}

/**
 * Thanh chuyển 5 tab gạch chân tối giản và 1 hàng bộ lọc tinh gọn cho trang `/newsfeed`.
 */
export function NewsfeedControls({ params, tabCounts }: NewsfeedControlsProps) {
  const router = useRouter();

  const isQualityActive =
    params.quality === "high" || params.quality === "top";

  const hasNonDefaultFilters =
    params.tab !== "spotlight" ||
    params.window !== "30d" ||
    Boolean(params.category) ||
    Boolean(params.usability) ||
    Boolean(params.quality);

  function navigate(updates: Partial<NewsfeedParams>) {
    const nextUrl = buildNewsfeedUrl(params, updates);
    router.push(nextUrl, { scroll: false });
  }

  return (
    <section aria-label="Bộ lọc Newsfeed" className="space-y-3">
      {/* Hàng 1: 5 tab gạch chân tối giản */}
      <div
        role="tablist"
        aria-label="Luồng tuyển chọn Newsfeed"
        className="flex items-center gap-5 overflow-x-auto border-b border-zinc-800/80"
      >
        {NEWSFEED_TABS.map((tab) => {
          const isActive = params.tab === tab.id;
          const count = tabCounts[tab.id] ?? 0;

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => navigate({ tab: tab.id })}
              className={`-mb-px inline-flex shrink-0 cursor-pointer items-center border-b-2 pb-2.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                isActive
                  ? "border-emerald-400 text-zinc-100"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <span>{tab.label}</span>
              <span className="ml-1.5 font-mono text-[11px] tabular-nums text-zinc-500">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Hàng 2: 1 dòng lọc tinh gọn */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={isQualityActive}
            onClick={() =>
              navigate({ quality: isQualityActive ? undefined : "high" })
            }
            className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 ${
              isQualityActive
                ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100"
            }`}
          >
            <Star
              className="h-3.5 w-3.5 fill-amber-400 text-amber-400"
              aria-hidden="true"
            />
            <span>
              {params.quality === "top"
                ? "Chỉ repo xuất sắc (★★★)"
                : "Chỉ repo chất lượng (★★+)"}
            </span>
          </button>

          <select
            aria-label="Lọc theo khoảng thời gian"
            value={params.window}
            onChange={(event) => {
              const value = event.target.value as NewsfeedWindow;
              navigate({ window: value });
            }}
            className="h-8 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-200 transition-colors [color-scheme:dark] hover:border-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            {NEWSFEED_WINDOWS.map((win) => (
              <option
                key={win.id}
                value={win.id}
                className="bg-zinc-950 text-zinc-200"
              >
                {win.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Lọc theo danh mục"
            value={params.category ?? ""}
            onChange={(event) => {
              const raw = event.target.value;
              const nextCategory: CategorySlug | undefined =
                raw && isValidCategory(raw) ? raw : undefined;
              navigate({ category: nextCategory });
            }}
            className="h-8 max-w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-200 transition-colors [color-scheme:dark] hover:border-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            <option value="" className="bg-zinc-950 text-zinc-200">
              Tất cả danh mục
            </option>
            {TAXONOMY.map((cat) => (
              <option
                key={cat.slug}
                value={cat.slug}
                className="bg-zinc-950 text-zinc-200"
              >
                {cat.label}
              </option>
            ))}
          </select>
        </div>

        {hasNonDefaultFilters && (
          <button
            type="button"
            onClick={() => router.push("/newsfeed", { scroll: false })}
            className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            <span>Đặt lại</span>
          </button>
        )}
      </div>
    </section>
  );
}
