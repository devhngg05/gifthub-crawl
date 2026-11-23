import { desc, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { syncLogs, tools } from "@/db/schema";

/** Truy vấn song song lịch sử `sync_logs` gần nhất (loại trừ lease lock row `id = -1`) và thống kê tổng hợp bảng `tools` cho trang `/logs`. */
export async function fetchLogsPageData(limit = 30) {
  const [logs, [stats]] = await Promise.all([
    db
      .select()
      .from(syncLogs)
      .where(gt(syncLogs.id, 0))
      .orderBy(desc(syncLogs.ranAt))
      .limit(limit),
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
