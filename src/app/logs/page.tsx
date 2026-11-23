import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Database,
  Flame,
  HelpCircle,
  Pin,
} from "lucide-react";
import { RelativeTime } from "@/components/RelativeTime";
import { fetchLogsPageData } from "@/lib/queries/logs-query";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Nhật ký đồng bộ",
  description:
    "Theo dõi trạng thái, số lượng đồng bộ và chi tiết lỗi của worker Gifthub Crawl trên Neon PostgreSQL.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function LogsPage() {
  const { logs, counts, latestLog } = await fetchLogsPageData(30);

  return (
    <div className="min-h-dvh overflow-x-clip bg-zinc-950 text-zinc-100">
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        {/* Top bar */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-emerald-400">
              <Activity className="h-5 w-5 shrink-0" />
              <span className="text-xs font-semibold uppercase tracking-wider">
                Giám sát Worker
              </span>
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-100">
              Nhật ký đồng bộ
            </h1>
            <p className="text-sm text-zinc-400">
              Theo dõi 30 phiên chạy gần nhất của{" "}
              <code className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-xs text-zinc-300">
                scripts/sync-tools.ts
              </code>{" "}
              trên Neon PostgreSQL.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/newsfeed"
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-sm font-medium text-emerald-300 transition-colors hover:border-emerald-500/50 hover:bg-emerald-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              <Flame className="h-4 w-4 text-emerald-400" />
              <span>Newsfeed</span>
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-emerald-500/40 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Quay lại Gifthub Crawl</span>
            </Link>
          </div>
        </header>

        {/* Summary stat cards */}
        <section
          aria-label="Thống kê tổng quan"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>Tổng số công cụ</span>
              <Database className="h-4 w-4 text-emerald-400" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-zinc-100">
              {counts.totalCount}
            </p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>Công cụ đã ghim</span>
              <Pin className="h-4 w-4 text-emerald-400" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-zinc-100">
              {counts.pinnedCount}
            </p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>Chưa phân loại</span>
              <HelpCircle className="h-4 w-4 text-amber-400" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-zinc-100">
              {counts.uncategorizedCount}
            </p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>Đồng bộ gần nhất</span>
              <Clock className="h-4 w-4 text-sky-400" />
            </div>
            <div className="mt-2 text-lg font-semibold text-zinc-100">
              {latestLog ? (
                <RelativeTime
                  isoDate={
                    latestLog.ranAt instanceof Date
                      ? latestLog.ranAt.toISOString()
                      : String(latestLog.ranAt)
                  }
                />
              ) : (
                <span className="text-sm text-zinc-400">Chưa chạy</span>
              )}
            </div>
          </div>
        </section>

        {/* Sync logs table */}
        <section
          aria-label="Danh sách lịch sử đồng bộ"
          className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40"
        >
          {logs.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-sm font-medium text-zinc-300">
                Chưa có bản ghi nào trong bảng{" "}
                <code className="font-mono text-zinc-200">sync_logs</code>.
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                Chạy{" "}
                <code className="font-mono text-zinc-300">npm run sync</code>{" "}
                hoặc kích hoạt GitHub Actions để ghi nhận lịch sử đồng bộ đầu
                tiên.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/80 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    <th scope="col" className="px-4 py-3">
                      Thời gian chạy
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Đã thu thập
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Phân loại AI
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Chỉ cập nhật sao
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Lỗi
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Chi tiết lỗi
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80">
                  {logs.map((log) => {
                    const ranAtIso =
                      log.ranAt instanceof Date
                        ? log.ranAt.toISOString()
                        : String(log.ranAt);
                    const hasFailure = log.failedCount > 0;

                    return (
                      <tr
                        key={log.id}
                        className="transition-colors hover:bg-zinc-900/60"
                      >
                        <td className="whitespace-nowrap px-4 py-3.5">
                          <div className="flex flex-col">
                            <span className="font-medium text-zinc-200">
                              <RelativeTime isoDate={ranAtIso} />
                            </span>
                            <span className="font-mono text-[11px] tabular-nums text-zinc-400">
                              {ranAtIso.replace("T", " ").slice(0, 19)} UTC
                            </span>
                          </div>
                        </td>

                        <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono tabular-nums text-zinc-200">
                          {log.fetchedCount}
                        </td>

                        <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono tabular-nums text-emerald-300">
                          {log.aiProcessedCount}
                        </td>

                        <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono tabular-nums text-sky-300">
                          {log.updatedStarsOnly}
                        </td>

                        <td className="whitespace-nowrap px-4 py-3.5 text-right">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs font-medium tabular-nums ${
                              hasFailure
                                ? "border-red-500/40 bg-red-500/15 text-red-300"
                                : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                            }`}
                          >
                            {hasFailure ? (
                              <AlertTriangle className="h-3 w-3" />
                            ) : (
                              <CheckCircle2 className="h-3 w-3" />
                            )}
                            <span>{log.failedCount}</span>
                          </span>
                        </td>

                        <td className="max-w-md px-4 py-3.5">
                          {log.errorSummary ? (
                            <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-red-500/20 bg-red-950/20 p-2 font-mono text-xs text-red-200 [overflow-wrap:anywhere]">
                              {log.errorSummary}
                            </pre>
                          ) : (
                            <span className="text-xs text-zinc-400">
                              Không có lỗi
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
