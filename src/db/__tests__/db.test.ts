import { getTableConfig } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { neonMock } = vi.hoisted(() => ({
  neonMock: vi.fn(() => vi.fn()),
}));

vi.mock("@neondatabase/serverless", () => ({
  neon: neonMock,
}));

import {
  createDb,
  db,
  getDb,
  resolveAppDatabaseUrl,
  resolveMigrationDatabaseUrl,
  sanitizeDatabaseUrl,
} from "@/db";
import { syncLogs, tools } from "@/db/schema";

describe("sanitizeDatabaseUrl", () => {
  it("removes channel_binding while keeping sslmode=require and other params", () => {
    const atEnd = sanitizeDatabaseUrl(
      "postgresql://user:pass@ep-demo.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    );
    expect(atEnd).toBe(
      "postgresql://user:pass@ep-demo.us-east-2.aws.neon.tech/neondb?sslmode=require",
    );

    const atStart = sanitizeDatabaseUrl(
      "postgresql://user:pass@ep-demo.us-east-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require",
    );
    expect(atStart).toBe(
      "postgresql://user:pass@ep-demo.us-east-2.aws.neon.tech/neondb?sslmode=require",
    );

    const inMiddle = sanitizeDatabaseUrl(
      "postgresql://user:pass@ep-demo.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require&connect_timeout=10",
    );
    expect(inMiddle).toBe(
      "postgresql://user:pass@ep-demo.us-east-2.aws.neon.tech/neondb?sslmode=require&connect_timeout=10",
    );
  });

  it("removes channel_binding case-insensitively across values and duplicates", () => {
    const prefer = sanitizeDatabaseUrl(
      "postgres://user:pass@db.neon.tech/app?sslmode=require&channel_binding=prefer",
    );
    expect(prefer).toBe("postgres://user:pass@db.neon.tech/app?sslmode=require");

    const disableAndDupes = sanitizeDatabaseUrl(
      "postgresql://user:pass@db.neon.tech/app?CHANNEL_BINDING=disable&sslmode=require&channel_binding=require",
    );
    expect(disableAndDupes).toBe(
      "postgresql://user:pass@db.neon.tech/app?sslmode=require",
    );
  });

  it("removes trailing question mark when channel_binding is the only query parameter", () => {
    const result = sanitizeDatabaseUrl(
      "postgresql://user:pass@db.neon.tech/neondb?channel_binding=require",
    );
    expect(result).toBe("postgresql://user:pass@db.neon.tech/neondb");
  });

  it("preserves valid URLs without channel_binding and trims surrounding whitespace", () => {
    const withSslMode =
      "postgresql://user:p%40ss%231@db.neon.tech:5432/neondb?sslmode=require";
    expect(sanitizeDatabaseUrl(`  ${withSslMode}  `)).toBe(withSslMode);

    const withoutQuery = "postgres://user:pass@localhost:5432/radar";
    expect(sanitizeDatabaseUrl(withoutQuery)).toBe(withoutQuery);
  });

  it("rejects empty or invalid URLs without leaking credentials or raw input", () => {
    const invalidInputs = [
      "",
      "   ",
      "not-a-url-secret_token_123",
      "https://user:top_secret_pw@example.com/db",
      "mysql://user:top_secret_pw@host/db",
      "postgresql:///neondb",
    ];

    for (const badInput of invalidInputs) {
      let caughtError: unknown;
      try {
        sanitizeDatabaseUrl(badInput);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(Error);
      const message = (caughtError as Error).message;
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain("top_secret_pw");
      expect(message).not.toContain("secret_token_123");
      if (badInput.trim().length > 0) {
        expect(message).not.toContain(badInput.trim());
      }
    }
  });
});

describe("Database URL resolvers", () => {
  it("resolveMigrationDatabaseUrl prefers DATABASE_URL_UNPOOLED and sanitizes channel_binding", () => {
    const resolved = resolveMigrationDatabaseUrl({
      DATABASE_URL_UNPOOLED:
        "postgresql://user:pw@ep-direct.neon.tech/neondb?sslmode=require&channel_binding=require",
      DATABASE_URL:
        "postgresql://user:pw@ep-direct-pooler.neon.tech/neondb?sslmode=require&channel_binding=require",
    });

    expect(resolved).toBe(
      "postgresql://user:pw@ep-direct.neon.tech/neondb?sslmode=require",
    );
  });

  it("resolveMigrationDatabaseUrl falls back to DATABASE_URL when unpooled is empty or missing", () => {
    for (const unpooled of [undefined, "", "   "]) {
      const resolved = resolveMigrationDatabaseUrl({
        DATABASE_URL_UNPOOLED: unpooled,
        DATABASE_URL:
          "postgresql://user:pw@ep-pooler.neon.tech/neondb?sslmode=require&channel_binding=require",
      });
      expect(resolved).toBe(
        "postgresql://user:pw@ep-pooler.neon.tech/neondb?sslmode=require",
      );
    }
  });

  it("throws clear errors when required env vars are missing or blank", () => {
    expect(() => resolveMigrationDatabaseUrl({})).toThrow(
      /DATABASE_URL_UNPOOLED.*DATABASE_URL/,
    );
    expect(() =>
      resolveMigrationDatabaseUrl({
        DATABASE_URL_UNPOOLED: "  ",
        DATABASE_URL: "",
      }),
    ).toThrow(/DATABASE_URL_UNPOOLED.*DATABASE_URL/);

    expect(() => resolveAppDatabaseUrl({})).toThrow(/DATABASE_URL/);
    expect(() => resolveAppDatabaseUrl({ DATABASE_URL: "   " })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("resolveAppDatabaseUrl returns sanitized DATABASE_URL", () => {
    expect(
      resolveAppDatabaseUrl({
        DATABASE_URL:
          "postgresql://user:pw@ep-pooler.neon.tech/neondb?sslmode=require&channel_binding=require",
      }),
    ).toBe("postgresql://user:pw@ep-pooler.neon.tech/neondb?sslmode=require");
  });
});

describe("Neon HTTP client initialization & lazy db proxy", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("passes sanitized URL to neon() when creating a client", () => {
    const client = createDb(
      "postgresql://user:pw@ep-app.neon.tech/neondb?sslmode=require&channel_binding=require",
    );

    expect(neonMock).toHaveBeenCalledTimes(1);
    expect(neonMock).toHaveBeenCalledWith(
      "postgresql://user:pw@ep-app.neon.tech/neondb?sslmode=require",
    );
    expect(typeof client.select).toBe("function");
  });

  it("caches getDb() per sanitized URL and refreshes when DATABASE_URL changes", () => {
    process.env.DATABASE_URL =
      "postgresql://user:pw@ep-one.neon.tech/db1?sslmode=require&channel_binding=require";
    const first = getDb();
    const second = getDb();
    expect(first).toBe(second);
    expect(neonMock).toHaveBeenCalledTimes(1);
    expect(neonMock).toHaveBeenLastCalledWith(
      "postgresql://user:pw@ep-one.neon.tech/db1?sslmode=require",
    );

    process.env.DATABASE_URL =
      "postgresql://user:pw@ep-two.neon.tech/db2?sslmode=require&channel_binding=require";
    const third = getDb();
    expect(third).not.toBe(first);
    expect(neonMock).toHaveBeenCalledTimes(2);
    expect(neonMock).toHaveBeenLastCalledWith(
      "postgresql://user:pw@ep-two.neon.tech/db2?sslmode=require",
    );
  });

  it("delegates operations through lazy db proxy", () => {
    process.env.DATABASE_URL =
      "postgresql://user:pw@ep-proxy.neon.tech/neondb?sslmode=require";
    expect(typeof db.select).toBe("function");
    expect(typeof db.insert).toBe("function");
    expect(typeof db.update).toBe("function");
    expect(typeof db.query).toBe("object");
  });
});

describe("Drizzle PostgreSQL schema metadata", () => {
  it("defines tools table with exact 20 columns, constraints, and defaults", () => {
    const config = getTableConfig(tools);
    expect(config.name).toBe("tools");
    expect(config.columns).toHaveLength(20);

    const byName = Object.fromEntries(
      config.columns.map((column) => [column.name, column]),
    );

    expect(Object.keys(byName)).toEqual([
      "id",
      "github_id",
      "name",
      "full_name",
      "html_url",
      "stars",
      "language",
      "last_pushed_at",
      "readme_sha",
      "summary_vi",
      "category",
      "sub_category",
      "secondary_sub_categories",
      "use_cases",
      "replaces",
      "usability",
      "is_pinned",
      "user_notes",
      "created_at",
      "updated_at",
    ]);

    expect(byName.id.primary).toBe(true);
    expect(byName.github_id.notNull).toBe(true);
    expect(byName.github_id.isUnique).toBe(true);
    expect(byName.stars.notNull).toBe(true);
    expect(byName.stars.default).toBe(0);
    expect(byName.is_pinned.notNull).toBe(true);
    expect(byName.is_pinned.default).toBe(false);

    for (const nullableCol of ["language", "readme_sha", "user_notes"]) {
      expect(byName[nullableCol].notNull).toBe(false);
    }

    for (const requiredCol of [
      "name",
      "full_name",
      "html_url",
      "last_pushed_at",
      "summary_vi",
      "category",
      "sub_category",
      "usability",
      "created_at",
      "updated_at",
    ]) {
      expect(byName[requiredCol].notNull).toBe(true);
    }

    expect(byName.created_at.hasDefault).toBe(true);
    expect(byName.updated_at.hasDefault).toBe(true);

    for (const arrayCol of [
      "secondary_sub_categories",
      "use_cases",
      "replaces",
    ]) {
      expect(byName[arrayCol].dataType).toBe("array");
      expect(byName[arrayCol].notNull).toBe(true);
      expect(byName[arrayCol].hasDefault).toBe(true);
    }
  });

  it("defines 3 B-Tree indexes and 3 GIN indexes on tools", () => {
    const config = getTableConfig(tools);
    expect(config.indexes).toHaveLength(6);

    const summarized = config.indexes.map((idx) => ({
      name: idx.config.name,
      method: idx.config.method ?? "btree",
      unique: idx.config.unique,
      columns: idx.config.columns.map((col) =>
        "name" in col ? col.name : undefined,
      ),
    }));

    expect(summarized).toEqual([
      {
        name: "tools_category_idx",
        method: "btree",
        unique: false,
        columns: ["category"],
      },
      {
        name: "tools_sub_category_idx",
        method: "btree",
        unique: false,
        columns: ["sub_category"],
      },
      {
        name: "tools_stars_idx",
        method: "btree",
        unique: false,
        columns: ["stars"],
      },
      {
        name: "tools_secondary_sub_categories_gin_idx",
        method: "gin",
        unique: false,
        columns: ["secondary_sub_categories"],
      },
      {
        name: "tools_use_cases_gin_idx",
        method: "gin",
        unique: false,
        columns: ["use_cases"],
      },
      {
        name: "tools_replaces_gin_idx",
        method: "gin",
        unique: false,
        columns: ["replaces"],
      },
    ]);
  });

  it("defines sync_logs table with exact 7 columns, constraints, and defaults", () => {
    const config = getTableConfig(syncLogs);
    expect(config.name).toBe("sync_logs");
    expect(config.columns).toHaveLength(7);

    const byName = Object.fromEntries(
      config.columns.map((column) => [column.name, column]),
    );

    expect(Object.keys(byName)).toEqual([
      "id",
      "ran_at",
      "fetched_count",
      "ai_processed_count",
      "updated_stars_only",
      "failed_count",
      "error_summary",
    ]);

    expect(byName.id.primary).toBe(true);
    expect(byName.ran_at.notNull).toBe(true);
    expect(byName.ran_at.hasDefault).toBe(true);
    expect(byName.error_summary.notNull).toBe(false);

    for (const counterCol of [
      "fetched_count",
      "ai_processed_count",
      "updated_stars_only",
      "failed_count",
    ]) {
      expect(byName[counterCol].notNull).toBe(true);
      expect(byName[counterCol].default).toBe(0);
    }
  });
});
