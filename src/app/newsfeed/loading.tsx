export default function NewsfeedLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Đang tải Newsfeed Gifthub Crawl"
      className="min-h-dvh overflow-x-clip bg-zinc-950 text-zinc-100"
    >
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        {/* 1. Header 1 dòng */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
          <div className="space-y-2">
            <div className="h-7 w-32 animate-pulse rounded-md bg-zinc-900" />
            <div className="h-4 w-72 max-w-full animate-pulse rounded bg-zinc-900/80" />
          </div>
          <div className="flex gap-2">
            <div className="h-8 w-28 animate-pulse rounded-lg bg-zinc-900" />
            <div className="h-8 w-24 animate-pulse rounded-lg bg-zinc-900" />
          </div>
        </div>

        {/* 2. Bộ công cụ tuyển chọn: thanh 6 pill + 1 khối 4 ô */}
        <div className="space-y-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="h-4 w-36 animate-pulse rounded bg-zinc-900" />
            <div className="flex flex-wrap items-center gap-1.5">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-6 w-20 animate-pulse rounded-md bg-zinc-900"
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div
                key={idx}
                className="h-14 animate-pulse rounded-lg border border-zinc-800/70 bg-zinc-950/60"
              />
            ))}
          </div>
        </div>

        {/* 3. Thanh tab gạch chân + 1 hàng lọc */}
        <div className="space-y-3">
          <div className="flex items-center gap-5 border-b border-zinc-800/80 pb-2.5">
            {Array.from({ length: 5 }).map((_, idx) => (
              <div
                key={idx}
                className="h-5 w-20 animate-pulse rounded bg-zinc-900"
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="h-8 w-44 animate-pulse rounded-lg bg-zinc-900" />
            <div className="h-8 w-24 animate-pulse rounded-lg bg-zinc-900" />
            <div className="h-8 w-36 animate-pulse rounded-lg bg-zinc-900" />
          </div>
        </div>

        {/* 4. Danh sách 8 dòng tin mảnh */}
        <div className="divide-y divide-zinc-800/70 border-y border-zinc-800/70">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div key={idx} className="space-y-2 px-3 py-4 sm:px-4">
              <div className="flex items-center justify-between gap-3">
                <div className="h-5 w-52 animate-pulse rounded bg-zinc-900" />
                <div className="h-6 w-32 animate-pulse rounded bg-zinc-900" />
              </div>
              <div className="h-4 w-full animate-pulse rounded bg-zinc-900/80" />
              <div className="h-3.5 w-56 animate-pulse rounded bg-zinc-900/70" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
