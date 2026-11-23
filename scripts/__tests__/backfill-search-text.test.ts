import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "@/db";
import { tools } from "@/db/schema";
import {
  backfillSearchText,
  resolveNormalizedCategoryForRow,
} from "../backfill-search-text";

interface MockToolRow {
  id: number;
  name: string;
  fullName: string;
  language: string | null;
  summaryVi: string;
  category: string;
  subCategory: string;
  secondarySubCategories: string[];
  useCases: string[];
  replaces: string[];
  userNotes: string | null;
}

interface CapturedUpdate {
  table: unknown;
  setPayload: Record<string, unknown>;
}

function createBackfillMockDb(rows: readonly MockToolRow[]) {
  const executedSql: unknown[] = [];
  const updates: CapturedUpdate[] = [];

  const mockClient = {
    execute: vi.fn(async (query: unknown) => {
      executedSql.push(query);
      return { rows: [] };
    }),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        orderBy: vi.fn(async () => [...rows]),
      })),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((setPayload: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          updates.push({ table, setPayload });
        }),
      })),
    })),
  };

  return {
    db: mockClient as unknown as DatabaseClient,
    executedSql,
    updates,
  };
}

describe("scripts/backfill-search-text — category normalization & search_text backfill", () => {
  it("normalizes mismatched category from SUB_CATEGORY_MAP and leaves valid/uncategorized rows unchanged", () => {
    expect(
      resolveNormalizedCategoryForRow({
        category: "dev-engineering",
        subCategory: "bi-analytics-dashboard",
      }),
    ).toEqual({
      nextCategory: "data-analytics",
      categorySynced: true,
    });

    expect(
      resolveNormalizedCategoryForRow({
        category: "data-analytics",
        subCategory: "bi-analytics-dashboard",
      }),
    ).toEqual({
      nextCategory: "data-analytics",
      categorySynced: false,
    });

    expect(
      resolveNormalizedCategoryForRow({
        category: "other",
        subCategory: "uncategorized",
      }),
    ).toEqual({
      nextCategory: "other",
      categorySynced: false,
    });
  });

  it("auto-corrects drifted category column during backfillSearchText and rebuilds searchText", async () => {
    const rows: MockToolRow[] = [
      {
        id: 1,
        name: "metabase",
        fullName: "metabase/metabase",
        language: "Clojure",
        summaryVi: "Nền tảng BI phân tích dữ liệu trực quan.",
        category: "dev-engineering", // cố tình bị lệch so với bi-analytics-dashboard
        subCategory: "bi-analytics-dashboard",
        secondarySubCategories: ["data-pipeline-etl"],
        useCases: ["Tạo dashboard BI"],
        replaces: ["Tableau"],
        userNotes: null,
      },
      {
        id: 2,
        name: "umami",
        fullName: "umami-software/umami",
        language: "TypeScript",
        summaryVi: "Phân tích web gọn nhẹ thay thế Google Analytics.",
        category: "data-analytics",
        subCategory: "bi-analytics-dashboard",
        secondarySubCategories: [],
        useCases: ["Theo dõi lượt truy cập"],
        replaces: ["Google Analytics"],
        userNotes: "Dùng cho blog",
      },
      {
        id: 3,
        name: "mystery-tool",
        fullName: "acme/mystery-tool",
        language: "Go",
        summaryVi: "Công cụ chưa phân loại.",
        category: "other",
        subCategory: "uncategorized",
        secondarySubCategories: [],
        useCases: [],
        replaces: [],
        userNotes: null,
      },
    ];

    const mockDb = createBackfillMockDb(rows);
    const logs: string[] = [];

    const result = await backfillSearchText({
      db: mockDb.db,
      batchSize: 2,
      logger: { info: (msg) => logs.push(msg) },
    });

    expect(result).toEqual({
      totalRows: 3,
      updatedRows: 3,
      syncedCategoryRows: 1,
    });

    expect(mockDb.executedSql).toHaveLength(2);
    expect(mockDb.updates).toHaveLength(3);

    // Hàng 1 bị lệch category -> vừa cập nhật searchText vừa chuẩn hóa category thành "data-analytics"
    expect(mockDb.updates[0]?.table).toBe(tools);
    expect(mockDb.updates[0]?.setPayload.category).toBe("data-analytics");
    expect(mockDb.updates[0]?.setPayload.searchText).toContain("bi dashboard");

    // Hàng 2 và hàng 3 không bị lệch -> chỉ cập nhật searchText
    expect(mockDb.updates[1]?.setPayload).not.toHaveProperty("category");
    expect(mockDb.updates[1]?.setPayload.searchText).toContain("dung cho blog");
    expect(mockDb.updates[2]?.setPayload).not.toHaveProperty("category");

    expect(logs.join("\n")).toContain(
      "Đã chuẩn hóa cột category cho 1 bản ghi lệch danh mục.",
    );
  });
});
