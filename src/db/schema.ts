import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const tools = pgTable(
  "tools",
  {
    id: serial("id").primaryKey(),
    githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    fullName: varchar("full_name", { length: 255 }).notNull(),
    htmlUrl: text("html_url").notNull(),
    stars: integer("stars").notNull().default(0),
    language: varchar("language", { length: 100 }),
    lastPushedAt: timestamp("last_pushed_at", { withTimezone: true }).notNull(),
    readmeSha: varchar("readme_sha", { length: 64 }),
    summaryVi: text("summary_vi").notNull(),
    category: varchar("category", { length: 100 }).notNull(),
    subCategory: varchar("sub_category", { length: 100 }).notNull(),
    secondarySubCategories: text("secondary_sub_categories")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    useCases: text("use_cases")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    replaces: text("replaces")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    usability: varchar("usability", { length: 50 }).notNull(),
    isPinned: boolean("is_pinned").notNull().default(false),
    userNotes: text("user_notes"),
    searchText: text("search_text").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("tools_category_idx").on(table.category),
    index("tools_sub_category_idx").on(table.subCategory),
    index("tools_stars_idx").on(table.stars),
    index("tools_secondary_sub_categories_gin_idx").using(
      "gin",
      table.secondarySubCategories,
    ),
    index("tools_use_cases_gin_idx").using("gin", table.useCases),
    index("tools_replaces_gin_idx").using("gin", table.replaces),
    index("tools_search_text_trgm_idx").using(
      "gin",
      table.searchText.op("gin_trgm_ops"),
    ),
    index("tools_pinned_stars_pushed_idx").on(
      table.isPinned.desc(),
      table.stars.desc(),
      table.lastPushedAt.desc().nullsLast(),
      table.id.desc(),
    ),
    index("tools_last_pushed_at_idx").on(
      table.lastPushedAt.desc().nullsLast(),
      table.stars.desc(),
      table.id.desc(),
    ),
    index("tools_created_at_idx").on(table.createdAt.desc()),
  ],
);

export const syncLogs = pgTable(
  "sync_logs",
  {
    id: serial("id").primaryKey(),
    ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
    fetchedCount: integer("fetched_count").notNull().default(0),
    aiProcessedCount: integer("ai_processed_count").notNull().default(0),
    updatedStarsOnly: integer("updated_stars_only").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    errorSummary: text("error_summary"),
  },
  (table) => [index("sync_logs_ran_at_idx").on(table.ranAt.desc())],
);

export type ToolRow = typeof tools.$inferSelect;
export type NewToolRow = typeof tools.$inferInsert;
export type SyncLogRow = typeof syncLogs.$inferSelect;
export type NewSyncLogRow = typeof syncLogs.$inferInsert;
