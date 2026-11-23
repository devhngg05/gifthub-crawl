import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  buildFilterUrl,
  getPaginationRange,
  type ToolFilters,
} from "@/lib/ui-helpers";

export interface PaginationProps {
  filters: ToolFilters;
  currentPage: number;
  totalPages: number;
  totalItems: number;
  startItem: number;
  endItem: number;
}

/**
 * Thanh phân trang gọn gàng ở cuối danh sách công cụ, bảo toàn toàn bộ bộ lọc/sắp xếp trên URL.
 */
export function Pagination({
  filters,
  currentPage,
  totalPages,
  totalItems,
  startItem,
  endItem,
}: PaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  const items = getPaginationRange(currentPage, totalPages);
  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  return (
    <div className="flex flex-col items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 sm:flex-row">
      <p className="text-xs text-zinc-400">
        Hiển thị{" "}
        <strong className="font-mono tabular-nums text-zinc-200">
          {startItem}–{endItem}
        </strong>{" "}
        trong{" "}
        <strong className="font-mono tabular-nums text-zinc-200">
          {totalItems}
        </strong>{" "}
        công cụ{" "}
        <span className="font-mono tabular-nums text-zinc-400">
          (Trang {currentPage} / {totalPages})
        </span>
      </p>

      <nav
        aria-label="Phân trang danh sách công cụ"
        className="flex flex-wrap items-center justify-center gap-1"
      >
        {hasPrev ? (
          <Link
            href={buildFilterUrl(filters, { page: currentPage - 1 })}
            prefetch={false}
            aria-label={`Trang trước (Trang ${currentPage - 1})`}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>Trước</span>
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="inline-flex cursor-not-allowed items-center gap-1 rounded-lg border border-zinc-800/60 bg-zinc-950/40 px-2.5 py-1.5 text-xs font-medium text-zinc-600"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>Trước</span>
          </span>
        )}

        {items.map((item, idx) => {
          if (item === "ellipsis") {
            return (
              <span
                key={`ellipsis-${idx}`}
                aria-hidden="true"
                className="px-1.5 py-1 text-xs font-mono text-zinc-500"
              >
                …
              </span>
            );
          }

          const isCurrent = item === currentPage;
          return (
            <Link
              key={item}
              href={buildFilterUrl(filters, { page: item })}
              prefetch={false}
              aria-current={isCurrent ? "page" : undefined}
              aria-label={`Trang ${item}`}
              className={`min-w-8 rounded-lg border px-2.5 py-1.5 text-center font-mono text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                isCurrent
                  ? "border-emerald-500/40 bg-emerald-500/15 font-semibold text-emerald-300"
                  : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
              }`}
            >
              {item}
            </Link>
          );
        })}

        {hasNext ? (
          <Link
            href={buildFilterUrl(filters, { page: currentPage + 1 })}
            prefetch={false}
            aria-label={`Trang sau (Trang ${currentPage + 1})`}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            <span>Sau</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="inline-flex cursor-not-allowed items-center gap-1 rounded-lg border border-zinc-800/60 bg-zinc-950/40 px-2.5 py-1.5 text-xs font-medium text-zinc-600"
          >
            <span>Sau</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
        )}
      </nav>
    </div>
  );
}
