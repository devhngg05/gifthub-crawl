export default function LogsLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Đang tải nhật ký đồng bộ"
      className="min-h-dvh bg-zinc-950 text-zinc-100"
    >
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
          <div className="space-y-2">
            <div className="h-4 w-32 animate-pulse rounded bg-zinc-900" />
            <div className="h-8 w-56 animate-pulse rounded-lg bg-zinc-900" />
            <div className="h-4 w-80 max-w-full animate-pulse rounded bg-zinc-900/80" />
          </div>
          <div className="h-9 w-36 animate-pulse rounded-lg bg-zinc-900" />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-24 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/60"
            />
          ))}
        </div>

        <div className="h-96 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />
      </main>
    </div>
  );
}
