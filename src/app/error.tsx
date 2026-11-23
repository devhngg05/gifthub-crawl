"use client";

import Link from "next/link";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-950 px-4 py-12 text-zinc-100">
      <main className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10 text-red-400">
          <AlertTriangle className="h-6 w-6" />
        </div>

        <h1 className="font-display text-lg font-bold tracking-tight text-zinc-100">
          Không thể tải dữ liệu lúc này
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Hệ thống gặp sự cố tạm thời khi kết nối cơ sở dữ liệu. Vui lòng thử
          tải lại trang hoặc quay về trang chủ.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Thử lại</span>
          </button>

          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            <Home className="h-3.5 w-3.5" />
            <span>Quay lại trang chủ</span>
          </Link>
        </div>
      </main>
    </div>
  );
}
