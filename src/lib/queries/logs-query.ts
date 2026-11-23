import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { syncLogs, tools } from "@/db/schema";

/** Truy vấn song song lịch sử `sync_logs` gần nhất và thống kê tổng hợp bảng `tools` cho trang `/logs`. */
export async function fetchLogsPageData(limit = 30) {
  const [logs, [stats]] = await Promise.all([
    db.select().from(syncLogs).orderBy(desc(syncLogs.ranAt)).limit(limit),
    db
      .select({
        totalCount: sql<number>`COUNT(*)::int`,
        pinnedCount: sql<number>`COUNT(*) FILTER (WHERE ${tools.isPinned} = true)::int`,
        uncategorizedCount: sql<number>`COUNT(*) FILTER (WHERE ${tools.subCategory} = 'uncategorized')::int`,
      })
      .from(tools),
  ]);

  const counts = {
    totalCount: stats?.totalCount ?? 0,
    pinnedCount: stats?.pinnedCount ?? 0,
    uncategorizedCount: stats?.uncategorizedCount ?? 0,
  };

  return {
    logs,
    counts,
    latestLog: logs[0],
  };
}
