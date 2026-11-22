import { pgTable, serial } from "drizzle-orm/pg-core";

export const tools = pgTable("tools", {
  id: serial("id").primaryKey(),
});

export const syncLogs = pgTable("sync_logs", {
  id: serial("id").primaryKey(),
});

export type ToolRow = typeof tools.$inferSelect;
export type NewToolRow = typeof tools.$inferInsert;
export type SyncLogRow = typeof syncLogs.$inferSelect;
export type NewSyncLogRow = typeof syncLogs.$inferInsert;
