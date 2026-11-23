import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Flame,
  Info,
  Layers,
  RotateCcw,
} from "lucide-react";
import { NewsfeedControls } from "@/components/NewsfeedControls";
import { NewsfeedItem } from "@/components/NewsfeedItem";
import { RelativeTime } from "@/components/RelativeTime";
import { ToolkitShowcase } from "@/components/ToolkitShowcase";
import {
  buildNewsfeedData,
  buildNewsfeedUrl,
  parseNewsfeedParams,
} from "@/lib/newsfeed";
import { fetchNewsfeedPageData } from "@/lib/queries/tools-page-query";
import type { RawSearchParams } from "@/lib/ui-helpers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    absolute: "Newsfeed — Gifthub Crawl",
  },
  description:
    "Bảng tin tối giản tuyển chọn các công cụ mã nguồn mở đáng chú ý từ GitHub kèm hệ thống Ngôi sao chất lượng.",
};

export default async function NewsfeedPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const resolvedParams = await searchParams;
  const params = parseNewsfeedParams(resolvedParams);
  const { allTools, latestRanAtIso } = await fetchNewsfeedPageData();

  const feed = buildNewsfeedData(allTools, params, new Date());
  const isTopQualityFilter = feed.params.quality === "top";
  const topQualityHref = buildNewsfeedUrl(feed.params, {
    quality: isTopQualityFilter ? undefined : "top",
  });

  return (
    <div className="min-h-dvh overflow-x-clip bg-zinc-950 text-zinc-100">
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        {/* 1. Header 1 dòng tối giản */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
          <div className="min-w-0 space-y-1">
            <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-100">
              Newsfeed
            </h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
              <span>
                Cập nhật{" "}
                {latestRanAtIso ? (
                  <RelativeTime isoDate={latestRanAtIso} />
                ) : (
                  "chưa chạy"
                )}
              </span>
              <span aria-hidden="true">·</span>
              <Link
                href={topQualityHref}
                aria-pressed={isTopQualityFilter}
                className={`rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 ${
                  isTopQualityFilter
                    ? "font-medium text-amber-300 underline underline-offset-4"
                    : "text-zinc-300 hover:text-amber-300"
                }`}
              >
                {feed.pulse.topRatedCount} repo xuất sắc (★★★)
              </Link>
              <span aria-hidden="true">·</span>
              <span>{feed.pulse.newLast7Days} mới tuần này</span>
            </p>
          </div>

          <nav
            aria-label="Điều hướng nhanh"
            className="flex shrink-0 items-center gap-2"
          >
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-emerald-500/40 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              <Layers className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              <span>Kho công cụ</span>
            </Link>
            <Link
              href="/logs"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-emerald-500/40 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              <Activity className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
              <span>Nhật ký</span>
            </Link>
          </nav>
        </header>

        {/* 2. Bộ công cụ tuyển chọn dạng 1 thanh chọn gọn */}
        <ToolkitShowcase toolkits={feed.toolkits} />

        {/* 3. Thanh lọc 1 hàng tinh gọn */}
        <NewsfeedControls params={feed.params} tabCounts={feed.tabCounts} />

        {feed.didRelaxWindow && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
          >
            <span className="flex items-center gap-2">
              <Info className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
              <span>
                Chưa có kết quả trong khung{" "}
                <strong className="font-semibold text-amber-100">
                  {feed.params.window === "7d" ? "7 ngày" : "30 ngày"}
                </strong>{" "}
                — đã tự động mở rộng sang toàn thời gian.
              </span>
            </span>
            <Link
              href="/newsfeed"
              className="font-medium text-amber-300 underline-offset-2 hover:underline"
            >
              Về mặc định
            </Link>
          </div>
        )}

        {/* 4. Dòng tin 1 cột siêu sạch */}
        <section aria-labelledby="newsfeed-stream-heading" className="space-y-3">
          <h2 id="newsfeed-stream-heading" className="sr-only">
            Danh sách công cụ nổi bật trên Newsfeed
          </h2>

          {feed.items.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                <span>
                  ★★★ Xuất sắc · ★★ Chất lượng cao · ★ Đáng chú ý
                </span>
                <span className="font-mono tabular-nums">
                  Hiển thị {feed.items.length} / {feed.totalMatchedInTab}
                </span>
              </div>

              <div className="divide-y divide-zinc-800/70 border-y border-zinc-800/70">
                {feed.items.map((item) => (
                  <NewsfeedItem key={item.tool.id} item={item} />
                ))}
              </div>

              <div className="flex justify-end pt-1">
                <Link
                  href="/"
                  className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 transition-colors hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                >
                  <span>Khám phá toàn bộ kho công cụ</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-12 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-400">
                <Flame className="h-5 w-5" aria-hidden="true" />
              </div>
              <h3 className="text-sm font-semibold text-zinc-200">
                {feed.pulse.totalTools === 0
                  ? "Chưa có công cụ nào trong cơ sở dữ liệu"
                  : "Không có công cụ nào khớp tổ hợp lọc hiện tại"}
              </h3>
              <p className="mt-1 max-w-md text-xs text-zinc-400">
                {feed.pulse.totalTools === 0
                  ? "Hãy chạy worker đồng bộ (npm run sync) để thu thập và phân loại công cụ từ GitHub."
                  : "Thử chuyển tab khác, tắt bộ lọc chất lượng hoặc đặt lại bộ lọc để xem thêm kết quả."}
              </p>

              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Link
                  href="/newsfeed"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Đặt lại Newsfeed</span>
                </Link>
                <Link
                  href="/"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
                >
                  <span>Về kho công cụ</span>
                </Link>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
