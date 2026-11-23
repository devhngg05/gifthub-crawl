export default function HomeLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Đang tải danh sách công cụ"
      className="flex min-h-dvh flex-col overflow-x-clip bg-zinc-950 text-zinc-100 lg:flex-row"
    >
      {/* Mobile top bar skeleton */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 lg:hidden">
        <div className="h-7 w-40 animate-pulse rounded-md bg-zinc-900" />
        <div className="h-8 w-20 animate-pulse rounded-md bg-zinc-900" />
      </div>

      {/* Desktop sidebar skeleton */}
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-72 lg:shrink-0 lg:self-start lg:flex-col lg:overflow-y-auto lg:border-r lg:border-zinc-800 lg:p-4">
        <div className="mb-6 h-10 w-48 animate-pulse rounded-lg bg-zinc-900" />
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="h-8 animate-pulse rounded-lg bg-zinc-900/80"
            />
          ))}
        </div>
      </aside>

      {/* Main content skeleton */}
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="space-y-2">
            <div className="h-8 w-64 animate-pulse rounded-lg bg-zinc-900" />
            <div className="h-4 w-96 max-w-full animate-pulse rounded bg-zinc-900/80" />
          </div>

          <div className="h-24 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-64 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/60 p-5"
              />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
