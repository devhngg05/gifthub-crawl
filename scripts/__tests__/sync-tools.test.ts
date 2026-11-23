import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "@/db";
import { syncLogs, tools } from "@/db/schema";
import type { AiClassification } from "@/lib/validator";
import {
  AllProvidersExhaustedError,
  classifyRepo,
  classifyRepoBatch,
  DAILY_QUOTA_COOLDOWN_MS,
  type ClassifyRepoInput,
} from "../lib/classifier";
import type { CleanReadmeResult, GitHubRepoItem } from "../lib/github";
import {
  AI_RATE_LIMIT_DELAY_MS,
  buildReclassifyUpdateSet,
  DEFAULT_SYNC_BATCH_SIZE,
  DEFAULT_SYNC_LIMIT,
  EXISTING_QUERY_CHUNK_SIZE,
  formatClassificationTable,
  isDirectExecution,
  parseSyncBatchSize,
  parseSyncDelayMs,
  parseSyncLimit,
  parseSyncPruneOnly,
  parseSyncReclassifyMode,
  RECLASSIFY_FETCH_CONCURRENCY,
  runSync,
  sanitizeErrorMessage,
  type PruneDatabaseSummary,
  type SyncLogger,
  type UpsertToolConflictSet,
  type UpsertToolValues,
} from "../sync-tools";

interface ExistingToolRow {
  githubId: number;
  readmeSha: string | null;
}

interface CapturedUpdateCall {
  table: unknown;
  setPayload: Record<string, unknown>;
  whereClause: unknown;
}

interface CapturedInsertToolCall {
  table: unknown;
  valuesPayload: UpsertToolValues;
  conflictTarget: unknown;
  conflictSet: UpsertToolConflictSet;
}

interface CapturedInsertSyncLogCall {
  table: unknown;
  valuesPayload: {
    fetchedCount: number;
    aiProcessedCount: number;
    updatedStarsOnly: number;
    failedCount: number;
    errorSummary: string | null;
  };
}

interface ReclassifyMockRow {
  id: number;
  githubId: number;
  name: string;
  fullName: string;
  language: string | null;
  summaryVi: string;
}

function createMockDb(
  existingTools: readonly ExistingToolRow[] = [],
  reclassifyRows: readonly ReclassifyMockRow[] = [],
) {
  const updateCalls: CapturedUpdateCall[] = [];
  const insertToolCalls: CapturedInsertToolCall[] = [];
  const insertSyncLogCalls: CapturedInsertSyncLogCall[] = [];
  let selectCalls = 0;

  const makeThenableQuery = (rows: unknown[]) => ({
    orderBy: vi.fn(() => ({
      limit: vi.fn(async (n: number) => rows.slice(0, n)),
    })),
    then: (
      resolve: (val: unknown[]) => void,
      reject?: (err: unknown) => void,
    ) => Promise.resolve(rows).then(resolve, reject),
  });

  const mockClient = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          selectCalls += 1;
          if (reclassifyRows.length > 0) {
            return makeThenableQuery([...reclassifyRows]);
          }
          return makeThenableQuery(selectCalls === 1 ? [...existingTools] : []);
        }),
        orderBy: vi.fn(() => ({
          limit: vi.fn(async (n: number) => [...reclassifyRows].slice(0, n)),
        })),
      })),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((setPayload: Record<string, unknown>) => ({
        where: vi.fn(async (whereClause: unknown) => {
          updateCalls.push({ table, setPayload, whereClause });
        }),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((valuesPayload: unknown) => {
        if (table === syncLogs) {
          const logPayload =
            valuesPayload as CapturedInsertSyncLogCall["valuesPayload"];
          insertSyncLogCalls.push({ table, valuesPayload: logPayload });
          return Promise.resolve();
        }

        const toolValues = valuesPayload as UpsertToolValues;
        return {
          onConflictDoUpdate: vi.fn(
            async (config: {
              target: unknown;
              set: UpsertToolConflictSet;
            }) => {
              insertToolCalls.push({
                table,
                valuesPayload: toolValues,
                conflictTarget: config.target,
                conflictSet: config.set,
              });
            },
          ),
        };
      }),
    })),
  };

  return {
    db: mockClient as unknown as DatabaseClient,
    getSelectCount: () => selectCalls,
    updateCalls,
    insertToolCalls,
    insertSyncLogCalls,
  };
}

function makeRepo(overrides: Partial<GitHubRepoItem> = {}): GitHubRepoItem {
  const id = overrides.id ?? 1001;
  const name = overrides.name ?? `tool-${id}`;
  return {
    id,
    name,
    full_name: `acme/${name}`,
    html_url: `https://github.com/acme/${name}`,
    description: "Open-source developer productivity tool",
    stargazers_count: 3200,
    language: "TypeScript",
    pushed_at: "2026-11-20T08:30:00Z",
    archived: false,
    topics: ["cli", "devtools"],
    ...overrides,
  };
}

function makeClassification(
  overrides: Partial<AiClassification> = {},
): AiClassification {
  return {
    summary_vi:
      "Công cụ dòng lệnh giúp tự động hóa kiểm thử API và tối ưu quy trình phát triển.",
    category: "api-integration",
    sub_category: "api-client-testing",
    secondary_sub_categories: ["api-mock-docs"],
    use_cases: ["Kiểm thử REST API", "Tự động hóa pipeline CI"],
    replaces: ["Postman"],
    usability: "cli-tool",
    ...overrides,
  };
}

function createTestLogger(): { logger: SyncLogger; infos: string[]; warns: string[]; errors: string[] } {
  const infos: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];
  return {
    logger: {
      info: (msg) => infos.push(msg),
      warn: (msg) => warns.push(msg),
      error: (msg) => errors.push(msg),
    },
    infos,
    warns,
    errors,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("scripts/sync-tools — conventions & helpers", () => {
  it('places `import "./load-env";` on the very first line before `@/db`', () => {
    const filePath = path.resolve(process.cwd(), "scripts/sync-tools.ts");
    const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);

    expect(lines[0]).toBe('import "./load-env";');
    const dbImportIndex = lines.findIndex((line) => line.includes("@/db"));
    expect(dbImportIndex).toBeGreaterThan(0);
  });

  it("parses SYNC_LIMIT with default 20 and validates positive integers", () => {
    expect(parseSyncLimit(undefined)).toBe(DEFAULT_SYNC_LIMIT);
    expect(parseSyncLimit("")).toBe(DEFAULT_SYNC_LIMIT);
    expect(parseSyncLimit("   ")).toBe(DEFAULT_SYNC_LIMIT);
    expect(parseSyncLimit("25")).toBe(25);
    expect(parseSyncLimit(" 10 ")).toBe(10);

    expect(() => parseSyncLimit("0")).toThrow(/Invalid SYNC_LIMIT/);
    expect(() => parseSyncLimit("-3")).toThrow(/Invalid SYNC_LIMIT/);
    expect(() => parseSyncLimit("2.5")).toThrow(/Invalid SYNC_LIMIT/);
    expect(() => parseSyncLimit("abc")).toThrow(/Invalid SYNC_LIMIT/);
  });

  it("parses SYNC_DELAY_MS with default 4000 and validates non-negative integers", () => {
    expect(AI_RATE_LIMIT_DELAY_MS).toBe(4000);
    expect(EXISTING_QUERY_CHUNK_SIZE).toBe(500);
    expect(parseSyncDelayMs(undefined)).toBe(4000);
    expect(parseSyncDelayMs("")).toBe(4000);
    expect(parseSyncDelayMs("   ")).toBe(4000);
    expect(parseSyncDelayMs("0")).toBe(0);
    expect(parseSyncDelayMs(" 5000 ")).toBe(5000);

    expect(() => parseSyncDelayMs("-10")).toThrow(/Invalid SYNC_DELAY_MS/);
    expect(() => parseSyncDelayMs("1.5")).toThrow(/Invalid SYNC_DELAY_MS/);
    expect(() => parseSyncDelayMs("fast")).toThrow(/Invalid SYNC_DELAY_MS/);
  });

  it("parses SYNC_BATCH_SIZE and SYNC_RECLASSIFY with safe defaults and strict validation", () => {
    expect(DEFAULT_SYNC_BATCH_SIZE).toBe(5);
    expect(RECLASSIFY_FETCH_CONCURRENCY).toBe(5);
    expect(parseSyncBatchSize(undefined)).toBe(5);
    expect(parseSyncBatchSize("")).toBe(5);
    expect(parseSyncBatchSize(" 10 ")).toBe(10);
    expect(() => parseSyncBatchSize("0")).toThrow(/Invalid SYNC_BATCH_SIZE/);
    expect(() => parseSyncBatchSize("21")).toThrow(/Invalid SYNC_BATCH_SIZE/);
    expect(() => parseSyncBatchSize("abc")).toThrow(/Invalid SYNC_BATCH_SIZE/);

    expect(parseSyncReclassifyMode(undefined)).toBe("none");
    expect(parseSyncReclassifyMode("  ")).toBe("none");
    expect(parseSyncReclassifyMode("UNCATEGORIZED")).toBe("uncategorized");
    expect(parseSyncReclassifyMode(" all ")).toBe("all");
    expect(() => parseSyncReclassifyMode("partial")).toThrow(
      /Invalid SYNC_RECLASSIFY/,
    );
  });

  it("buildReclassifyUpdateSet includes the AI fields + searchText and excludes isPinned/userNotes", () => {
    const fixedNow = new Date("2026-11-23T10:00:00Z");
    const updateSet = buildReclassifyUpdateSet(
      "sha-reclass",
      makeClassification(),
      fixedNow,
      {
        name: "bruno",
        fullName: "usebruno/bruno",
        language: "TypeScript",
        userNotes: "Ghi chú cá nhân không bị xóa",
        topics: ["api-client"],
      },
    );

    expect(Object.keys(updateSet).sort()).toEqual(
      [
        "category",
        "readmeSha",
        "replaces",
        "searchText",
        "secondarySubCategories",
        "subCategory",
        "summaryVi",
        "updatedAt",
        "usability",
        "useCases",
      ].sort(),
    );
    expect(updateSet.searchText).toContain("usebruno bruno");
    expect(updateSet.searchText).toContain("ghi chu ca nhan khong bi xoa");
    expect(updateSet).not.toHaveProperty("isPinned");
    expect(updateSet).not.toHaveProperty("userNotes");
    expect(updateSet).not.toHaveProperty("id");
    expect(updateSet).not.toHaveProperty("githubId");
    expect(updateSet).not.toHaveProperty("createdAt");
  });

  it("handles Windows drive-letter casing safely in isDirectExecution", () => {
    const resolvedScript = path.resolve("scripts/sync-tools.ts");
    const moduleUrl = pathToFileURL(resolvedScript).href;
    const altCasePath = resolvedScript.replace(/^[A-Za-z]:/, (drive) =>
      drive === drive.toUpperCase() ? drive.toLowerCase() : drive.toUpperCase(),
    );

    expect(isDirectExecution(altCasePath, moduleUrl, "win32")).toBe(true);
    expect(
      isDirectExecution(
        path.resolve("scripts/other.ts"),
        moduleUrl,
        "win32",
      ),
    ).toBe(false);
    expect(isDirectExecution(undefined, moduleUrl, "win32")).toBe(false);

    const diffSegmentCase = resolvedScript.replace("sync-tools.ts", "Sync-Tools.ts");
    expect(isDirectExecution(resolvedScript, moduleUrl, "linux")).toBe(true);
    expect(isDirectExecution(diffSegmentCase, moduleUrl, "linux")).toBe(false);
  });

  it("redacts database URLs, Bearer tokens, and provider API keys from error messages", () => {
    const rawError = new Error(
      "Failed with postgresql://neondb_owner:super_secret_pw@ep-cool.neon.tech/neondb?sslmode=require and Bearer ghp_abc123SECRET, gsk_live_key_999, github_pat_11ABC_XYZ, sk-or-v1-secretkey",
    );

    const sanitized = sanitizeErrorMessage(rawError);
    expect(sanitized).not.toContain("super_secret_pw");
    expect(sanitized).not.toContain("ep-cool.neon.tech");
    expect(sanitized).not.toContain("ghp_abc123SECRET");
    expect(sanitized).not.toContain("gsk_live_key_999");
    expect(sanitized).not.toContain("github_pat_11ABC_XYZ");
    expect(sanitized).not.toContain("sk-or-v1-secretkey");
    expect(sanitized).toContain("[REDACTED_DATABASE_URL]");
    expect(sanitized).toContain("Bearer [REDACTED]");
    expect(sanitized).toContain("[REDACTED_TOKEN]");
  });
});

describe("scripts/sync-tools — runSync pipeline", () => {
  it("updates only stars/lastPushedAt/updatedAt when readmeSha is unchanged and skips AI", async () => {
    const repo = makeRepo({
      id: 42,
      name: "bruno",
      full_name: "usebruno/bruno",
      stargazers_count: 29500,
      pushed_at: "2026-11-22T01:00:00Z",
    });

    const mockDb = createMockDb([{ githubId: 42, readmeSha: "sha-same-123" }]);
    const classifyMock = vi.fn();
    const sleepMock = vi.fn(async () => undefined);
    const fixedNow = new Date("2026-11-22T12:00:00Z");
    const { logger } = createTestLogger();

    const summary = await runSync({
      db: mockDb.db,
      fetchCandidateRepos: async () => [repo],
      fetchCleanReadme: async (): Promise<CleanReadmeResult> => ({
        sha: "sha-same-123",
        text: "Bruno README",
      }),
      classifyRepo: classifyMock,
      sleep: sleepMock,
      now: () => fixedNow,
      env: {},
      logger,
    });

    expect(classifyMock).not.toHaveBeenCalled();
    expect(sleepMock).not.toHaveBeenCalled();
    expect(mockDb.insertToolCalls).toHaveLength(0);
    expect(mockDb.updateCalls).toHaveLength(1);
    expect(mockDb.updateCalls[0]?.table).toBe(tools);
    expect(mockDb.updateCalls[0]?.setPayload).toEqual({
      stars: 29500,
      lastPushedAt: new Date("2026-11-22T01:00:00Z"),
      updatedAt: fixedNow,
    });

    expect(summary).toMatchObject({
      fetchedCount: 1,
      aiProcessedCount: 0,
      updatedStarsOnly: 1,
      failedCount: 0,
      errorSummary: null,
      classified: [],
    });

    expect(mockDb.insertSyncLogCalls).toHaveLength(1);
    expect(mockDb.insertSyncLogCalls[0]?.valuesPayload).toEqual({
      fetchedCount: 1,
      aiProcessedCount: 0,
      updatedStarsOnly: 1,
      failedCount: 0,
      errorSummary: null,
    });
  });

  it("preserves isPinned and userNotes during UPSERT and sleeps SYNC_DELAY_MS (default 4000ms) after AI classification", async () => {
    const newRepo = makeRepo({ id: 101, name: "new-cli", full_name: "acme/new-cli" });
    const changedRepo = makeRepo({
      id: 102,
      name: "changed-app",
      full_name: "acme/changed-app",
    });

    const mockDb = createMockDb([{ githubId: 102, readmeSha: "sha-old" }]);
    const classifyMock = vi
      .fn()
      .mockResolvedValueOnce({
        classification: makeClassification({
          sub_category: "cli-dev-env",
          usability: "cli-tool",
        }),
        provider: "Groq-70B",
      })
      .mockResolvedValueOnce({
        classification: makeClassification({
          sub_category: "ai-coding-agent",
          usability: "app-ready",
        }),
        provider: "GitHub-Models-4o-mini",
      });
    const sleepMock = vi.fn(async () => undefined);
    const fixedNow = new Date("2026-11-22T15:00:00Z");
    const { logger, infos } = createTestLogger();

    const summary = await runSync({
      db: mockDb.db,
      fetchCandidateRepos: async () => [newRepo, changedRepo],
      fetchCleanReadme: async (fullName) => ({
        sha: fullName === "acme/new-cli" ? "sha-new" : "sha-updated",
        text: "Cleaned README content",
      }),
      classifyRepo: classifyMock,
      sleep: sleepMock,
      now: () => fixedNow,
      env: { SYNC_LIMIT: "20" },
      logger,
    });

    expect(classifyMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenNthCalledWith(1, AI_RATE_LIMIT_DELAY_MS);
    expect(sleepMock).toHaveBeenNthCalledWith(2, AI_RATE_LIMIT_DELAY_MS);

    expect(mockDb.insertToolCalls).toHaveLength(2);
    for (const call of mockDb.insertToolCalls) {
      expect(call.table).toBe(tools);
      expect(call.conflictTarget).toBe(tools.githubId);

      // Bảo toàn tuyệt đối dữ liệu cá nhân hóa của người dùng
      expect(call.conflictSet).not.toHaveProperty("isPinned");
      expect(call.conflictSet).not.toHaveProperty("userNotes");
      expect(call.conflictSet).not.toHaveProperty("createdAt");
      expect(call.conflictSet).not.toHaveProperty("id");
      expect(call.conflictSet).not.toHaveProperty("githubId");

      expect(call.valuesPayload).not.toHaveProperty("isPinned");
      expect(call.valuesPayload).not.toHaveProperty("userNotes");
    }

    expect(summary).toMatchObject({
      fetchedCount: 2,
      aiProcessedCount: 2,
      updatedStarsOnly: 0,
      failedCount: 0,
      errorSummary: null,
    });

    const combinedInfoLogs = infos.join("\n");
    expect(combinedInfoLogs).toContain(
      "[sync-tools] Đã tìm thấy 2 ứng viên, đang đối chiếu DB...",
    );
    expect(combinedInfoLogs).toContain(
      "[sync-tools] Đang tải README & phân loại lô 1 (5 repo)...",
    );
    expect(combinedInfoLogs).toContain("Tên repo");
    expect(combinedInfoLogs).toContain("Provider đã dùng");
    expect(combinedInfoLogs).toContain("subCategory");
    expect(combinedInfoLogs).toContain("usability");
    expect(combinedInfoLogs).toContain("acme/new-cli");
    expect(combinedInfoLogs).toContain("Groq-70B");
    expect(combinedInfoLogs).toContain("acme/changed-app");
    expect(combinedInfoLogs).toContain("GitHub-Models-4o-mini");
  });

  it("skips upsert and records errorSummary when all 4 AI providers fail, while isolating per-repo errors", async () => {
    const failingRepo = makeRepo({
      id: 201,
      name: "broken-ai-repo",
      full_name: "acme/broken-ai-repo",
    });
    const healthyRepo = makeRepo({
      id: 202,
      name: "healthy-repo",
      full_name: "acme/healthy-repo",
    });

    const mockDb = createMockDb([]);
    const classifyMock = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "All AI providers failed for acme/broken-ai-repo: Groq-70B: HTTP 429; OpenRouter-Free: HTTP 503",
        ),
      )
      .mockResolvedValueOnce({
        classification: makeClassification(),
        provider: "Groq-8B-Fallback",
      });
    const sleepMock = vi.fn(async () => undefined);
    const { logger, warns } = createTestLogger();

    const summary = await runSync({
      db: mockDb.db,
      fetchCandidateRepos: async () => [failingRepo, healthyRepo],
      fetchCleanReadme: async () => ({
        sha: "sha-1",
        text: "README text",
      }),
      classifyRepo: classifyMock,
      sleep: sleepMock,
      env: {},
      logger,
    });

    expect(mockDb.insertToolCalls).toHaveLength(1);
    expect(mockDb.insertToolCalls[0]?.valuesPayload.githubId).toBe(202);
    expect(sleepMock).toHaveBeenCalledTimes(1);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("acme/broken-ai-repo");

    expect(summary.fetchedCount).toBe(2);
    expect(summary.aiProcessedCount).toBe(1);
    expect(summary.updatedStarsOnly).toBe(0);
    expect(summary.failedCount).toBe(1);
    expect(summary.errorSummary).toContain("acme/broken-ai-repo");
    expect(summary.errorSummary).toContain("All AI providers failed");

    expect(mockDb.insertSyncLogCalls).toHaveLength(1);
    expect(mockDb.insertSyncLogCalls[0]?.valuesPayload).toEqual({
      fetchedCount: 2,
      aiProcessedCount: 1,
      updatedStarsOnly: 0,
      failedCount: 1,
      errorSummary: summary.errorSummary,
    });
  });

  it("counts SYNC_LIMIT strictly on AI calls, updates stars for prior changed repos past limit, and breaks early on new repo past limit", async () => {
    const repo1Unchanged = makeRepo({ id: 1, full_name: "acme/unchanged-1", stargazers_count: 5100 });
    const repo2New = makeRepo({ id: 2, full_name: "acme/new-2" });
    const repo3Unchanged = makeRepo({ id: 3, full_name: "acme/unchanged-3", stargazers_count: 6200 });
    const repo4ChangedWithinLimit = makeRepo({ id: 4, full_name: "acme/changed-4" });
    const repo6ChangedPastLimit = makeRepo({
      id: 6,
      full_name: "acme/changed-past-limit-6",
      stargazers_count: 9999,
      pushed_at: "2026-11-22T10:00:00Z",
    });
    const repo5NewPastLimit = makeRepo({ id: 5, full_name: "acme/new-past-limit-5" });
    const repo7AfterBreak = makeRepo({ id: 7, full_name: "acme/after-break-7" });

    const mockDb = createMockDb([
      { githubId: 1, readmeSha: "sha-1" },
      { githubId: 3, readmeSha: "sha-3" },
      { githubId: 4, readmeSha: "sha-4-old" },
      { githubId: 6, readmeSha: "sha-6-old" },
      { githubId: 7, readmeSha: "sha-7" },
    ]);

    const fetchReadmeMock = vi.fn(async (fullName: string): Promise<CleanReadmeResult> => {
      switch (fullName) {
        case "acme/unchanged-1":
          return { sha: "sha-1", text: "r1" };
        case "acme/new-2":
          return { sha: "sha-2", text: "r2" };
        case "acme/unchanged-3":
          return { sha: "sha-3", text: "r3" };
        case "acme/changed-4":
          return { sha: "sha-4-new", text: "r4" };
        default:
          throw new Error(`Unexpected README fetch for ${fullName}`);
      }
    });

    const classifyMock = vi.fn(async (input: ClassifyRepoInput) => {
      void input;
      return {
        classification: makeClassification(),
        provider: "Groq-70B",
      };
    });
    const sleepMock = vi.fn(async () => undefined);
    const fixedNow = new Date("2026-11-22T18:00:00Z");
    const { logger, infos } = createTestLogger();

    const summary = await runSync({
      db: mockDb.db,
      fetchCandidateRepos: async () => [
        repo1Unchanged,
        repo2New,
        repo3Unchanged,
        repo4ChangedWithinLimit,
        repo6ChangedPastLimit,
        repo5NewPastLimit,
        repo7AfterBreak,
      ],
      fetchCleanReadme: fetchReadmeMock,
      classifyRepo: classifyMock,
      sleep: sleepMock,
      now: () => fixedNow,
      env: { SYNC_LIMIT: "2", SYNC_DELAY_MS: "4500" },
      logger,
    });

    // Chỉ gọi AI đúng 2 lần (repo2 và repo4), sleep đúng SYNC_DELAY_MS từ env
    expect(classifyMock).toHaveBeenCalledTimes(2);
    expect(classifyMock.mock.calls.map((c) => c[0].fullName)).toEqual([
      "acme/new-2",
      "acme/changed-4",
    ]);
    expect(sleepMock).toHaveBeenNthCalledWith(1, 4500);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 4500);

    // Repo sau SYNC_LIMIT đều không tốn request README, và vòng lặp dừng sớm ở repo5 nên không đụng repo7
    expect(fetchReadmeMock).not.toHaveBeenCalledWith("acme/changed-past-limit-6");
    expect(fetchReadmeMock).not.toHaveBeenCalledWith("acme/new-past-limit-5");
    expect(fetchReadmeMock).not.toHaveBeenCalledWith("acme/after-break-7");
    expect(infos.join("\n")).toContain("stopping loop early");

    // 3 repo chỉ cập nhật stars (repo1, repo3, và repo6 đổi SHA trước điểm break; repo7 không bị đụng)
    expect(mockDb.updateCalls).toHaveLength(3);
    const repo6Update = mockDb.updateCalls[2];
    expect(repo6Update?.setPayload).toEqual({
      stars: 9999,
      lastPushedAt: new Date("2026-11-22T10:00:00Z"),
      updatedAt: fixedNow,
    });
    // Quan trọng: giữ nguyên readmeSha cũ trong DB để lượt chạy sau tự động phân loại lại
    expect(repo6Update?.setPayload).not.toHaveProperty("readmeSha");

    expect(summary).toMatchObject({
      fetchedCount: 7,
      aiProcessedCount: 2,
      updatedStarsOnly: 3,
      failedCount: 0,
      errorSummary: null,
    });
  });

  it("queries existing tools in chunks of 500 when candidates exceed 500 repos", async () => {
    const candidates = Array.from({ length: 1200 }, (_, idx) =>
      makeRepo({
        id: 8000 + idx,
        name: `repo-${idx + 1}`,
        full_name: `acme/repo-${idx + 1}`,
      }),
    );

    const mockDb = createMockDb([{ githubId: 8000, readmeSha: "sha-8000" }]);
    const { logger } = createTestLogger();

    const summary = await runSync({
      db: mockDb.db,
      fetchCandidateRepos: async () => candidates,
      fetchCleanReadme: async () => ({ sha: "sha-8000", text: "README" }),
      classifyRepo: vi.fn(async () => ({
        classification: makeClassification(),
        provider: "Groq-120B",
      })),
      sleep: vi.fn(async () => undefined),
      env: { SYNC_LIMIT: "1", SYNC_DELAY_MS: "0" },
      logger,
    });

    // 1200 candidate IDs -> 3 chunks (500 + 500 + 200)
    expect(mockDb.getSelectCount()).toBe(3);
    expect(summary.fetchedCount).toBe(1200);
    expect(summary.updatedStarsOnly).toBe(1);
    expect(summary.aiProcessedCount).toBe(1);
  });

  it("formats empty and non-empty classification summary tables cleanly", () => {
    expect(formatClassificationTable([])).toContain("Không có repository");

    const table = formatClassificationTable([
      {
        fullName: "usebruno/bruno",
        provider: "Groq-70B",
        subCategory: "api-client-testing",
        usability: "app-ready",
      },
    ]);
    expect(table).toContain(
      "Tên repo       | Provider đã dùng | subCategory        | usability",
    );
    expect(table).toContain(
      "usebruno/bruno | Groq-70B         | api-client-testing | app-ready",
    );
  });

  it("handles large SYNC_LIMIT (35) smoothly across 429 TPM rate limits via all 5 fallback tiers including OpenRouter-Free-Backup", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const totalCandidates = 40;
    const repos = Array.from({ length: totalCandidates }, (_, idx) =>
      makeRepo({
        id: 5000 + idx,
        name: `repo-${idx + 1}`,
        full_name: `acme/repo-${idx + 1}`,
      }),
    );

    const mockDb = createMockDb([]);
    const fetchReadmeMock = vi.fn(
      async (fullName: string): Promise<CleanReadmeResult> => ({
        sha: `sha-${fullName}`,
        text: `README for ${fullName}`,
      }),
    );

    let fakeNowMs = 10_000_000;
    const sleepMock = vi.fn(async (ms: number) => {
      fakeNowMs += ms;
    });

    const providerCounts: Record<string, number> = {
      "openai/gpt-oss-120b": 0,
      "qwen/qwen3.8-27b": 0,
      "openai/gpt-oss-20b": 0,
      "google/gemma-4-31b-it:free": 0,
      "google/gemma-4-26b-a4b-it:free": 0,
    };

    const aiFetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      providerCounts[body.model] = (providerCounts[body.model] ?? 0) + 1;

      if (
        body.model === "openai/gpt-oss-120b" &&
        providerCounts[body.model] > 3
      ) {
        return new Response(
          '{"error":{"message":"TPM limit 8000 reached. Please try again in 80s."}}',
          { status: 429 },
        );
      }
      if (
        body.model === "qwen/qwen3.8-27b" &&
        providerCounts[body.model] > 12
      ) {
        return new Response("TPM limit reached", {
          status: 429,
          headers: { "retry-after": "80" },
        });
      }
      if (
        body.model === "openai/gpt-oss-20b" &&
        providerCounts[body.model] > 10
      ) {
        return new Response("TPM limit reached", {
          status: 429,
          headers: { "retry-after": "80" },
        });
      }
      if (
        body.model === "google/gemma-4-31b-it:free" &&
        providerCounts[body.model] > 5
      ) {
        return new Response("OpenRouter 31B limit reached", {
          status: 429,
          headers: { "retry-after": "80" },
        });
      }

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(makeClassification()),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const { logger } = createTestLogger();

    const summary = await runSync({
      db: mockDb.db,
      fetchCandidateRepos: async () => repos,
      fetchCleanReadme: fetchReadmeMock,
      classifyRepo: (input, opts) =>
        classifyRepo(input, {
          ...opts,
          env: {
            GROQ_API_KEY: "gsk_mock_key",
            OPENROUTER_API_KEY: "sk-or-mock_key",
          },
          fetchImpl: aiFetchMock,
        }),
      sleep: sleepMock,
      delayMs: 500,
      now: () => new Date(fakeNowMs),
      env: { SYNC_LIMIT: "35" },
      logger,
    });

    expect(summary.fetchedCount).toBe(40);
    expect(summary.aiProcessedCount).toBe(35);
    expect(summary.failedCount).toBe(0);
    expect(summary.errorSummary).toBeNull();
    expect(mockDb.insertToolCalls).toHaveLength(35);
    expect(fetchReadmeMock).toHaveBeenCalledTimes(35);

    const usedProviders = new Set(summary.classified.map((c) => c.provider));
    expect(usedProviders).toEqual(
      new Set([
        "Groq-120B",
        "Groq-Qwen-27B",
        "Groq-20B-Fast",
        "OpenRouter-Free",
        "OpenRouter-Free-Backup",
      ]),
    );

    // Cooldown prevented hammering saturated providers after their single 429 response
    expect(providerCounts["openai/gpt-oss-120b"]).toBe(4);
    expect(providerCounts["qwen/qwen3.8-27b"]).toBe(13);
    expect(providerCounts["openai/gpt-oss-20b"]).toBe(11);
    expect(providerCounts["google/gemma-4-31b-it:free"]).toBe(6);
    expect(providerCounts["google/gemma-4-26b-a4b-it:free"]).toBe(5);
  });

  it("reclassifies uncategorized and all tools in batches via classifyRepoBatch without touching isPinned or userNotes", async () => {
    const dbRows: ReclassifyMockRow[] = [
      {
        id: 11,
        githubId: 9011,
        name: "open-webui",
        fullName: "open-webui/open-webui",
        language: "Python",
        summaryVi: "Tóm tắt cũ",
      },
      {
        id: 12,
        githubId: 9012,
        name: "missing-meta-tool",
        fullName: "acme/missing-meta-tool",
        language: "Go",
        summaryVi: "Mô tả dự phòng từ DB khi GitHub trả 404 metadata",
      },
      {
        id: 13,
        githubId: 9013,
        name: "broken-readme-tool",
        fullName: "acme/broken-readme-tool",
        language: "Rust",
        summaryVi: "Tóm tắt khác",
      },
    ];

    const mockDb = createMockDb([], dbRows);
    const fetchCandidateMock = vi.fn();
    const fetchMetaMock = vi.fn(async (fullName: string) => {
      if (fullName === "open-webui/open-webui") {
        return makeRepo({
          id: 9011,
          name: "open-webui",
          full_name: "open-webui/open-webui",
          homepage: "https://openwebui.com",
          description: "Extensible self-hosted AI interface",
          language: "Python",
          topics: ["llm", "webui"],
        });
      }
      return null;
    });
    const fetchReadmeMock = vi.fn(async (fullName: string): Promise<CleanReadmeResult> => {
      if (fullName === "acme/broken-readme-tool") {
        throw new Error("README network timeout");
      }
      return { sha: `sha-${fullName}`, text: `README for ${fullName}` };
    });

    const batchMock = vi.fn(async (inputs: readonly ClassifyRepoInput[]) =>
      inputs.map((input) => ({
        fullName: input.fullName,
        ok: true as const,
        result: {
          provider: "Gemini-3.5-Flash-Lite",
          classification: makeClassification({
            category: "ai-llm",
            sub_category:
              input.fullName === "open-webui/open-webui"
                ? "ai-chat-ui"
                : "cli-dev-env",
            usability:
              input.fullName === "open-webui/open-webui"
                ? "app-ready"
                : "cli-tool",
          }),
        },
      })),
    );
    const sleepMock = vi.fn(async () => undefined);
    const fixedNow = new Date("2026-11-23T12:00:00Z");
    const { logger, infos } = createTestLogger();

    const summary = await runSync({
      db: mockDb.db,
      fetchCandidateRepos: fetchCandidateMock,
      fetchRepoMetadata: fetchMetaMock,
      fetchCleanReadme: fetchReadmeMock,
      classifyRepoBatch: batchMock,
      sleep: sleepMock,
      now: () => fixedNow,
      env: {
        SYNC_RECLASSIFY: "uncategorized",
        SYNC_LIMIT: "10",
        SYNC_BATCH_SIZE: "2",
        SYNC_DELAY_MS: "100",
      },
      logger,
    });

    // Does not crawl search API in reclassify mode
    expect(fetchCandidateMock).not.toHaveBeenCalled();
    expect(fetchMetaMock).toHaveBeenCalledTimes(3);
    expect(fetchReadmeMock).toHaveBeenCalledTimes(3);
    expect(batchMock).toHaveBeenCalledTimes(1);
    expect(batchMock.mock.calls[0]?.[0]).toEqual([
      {
        name: "open-webui",
        fullName: "open-webui/open-webui",
        description: "Extensible self-hosted AI interface",
        homepage: "https://openwebui.com",
        language: "Python",
        topics: ["llm", "webui"],
        readmeText: "README for open-webui/open-webui",
      },
      {
        name: "missing-meta-tool",
        fullName: "acme/missing-meta-tool",
        description: "Mô tả dự phòng từ DB khi GitHub trả 404 metadata",
        homepage: null,
        language: "Go",
        topics: [],
        readmeText: "README for acme/missing-meta-tool",
      },
    ]);

    expect(mockDb.updateCalls).toHaveLength(2);
    for (const update of mockDb.updateCalls) {
      expect(update.table).toBe(tools);
      expect(update.setPayload).not.toHaveProperty("isPinned");
      expect(update.setPayload).not.toHaveProperty("userNotes");
      expect(update.setPayload).toHaveProperty("updatedAt", fixedNow);
    }

    expect(summary).toMatchObject({
      fetchedCount: 3,
      aiProcessedCount: 2,
      updatedStarsOnly: 0,
      failedCount: 1,
    });
    expect(summary.errorSummary).toContain("acme/broken-readme-tool");
    expect(infos.join("\n")).toContain("Chế độ phân loại lại (uncategorized)");
    expect(sleepMock).toHaveBeenCalledWith(100);

    // Also verify SYNC_RECLASSIFY=all path executes cleanly
    const mockDbAll = createMockDb([], [dbRows[0]]);
    const summaryAll = await runSync({
      db: mockDbAll.db,
      fetchCandidateRepos: fetchCandidateMock,
      fetchRepoMetadata: fetchMetaMock,
      fetchCleanReadme: fetchReadmeMock,
      classifyRepoBatch: batchMock,
      sleep: sleepMock,
      now: () => fixedNow,
      env: {
        SYNC_RECLASSIFY: "all",
        SYNC_LIMIT: "1",
        SYNC_BATCH_SIZE: "5",
        SYNC_DELAY_MS: "0",
      },
      logger,
    });
    expect(summaryAll.aiProcessedCount).toBe(1);
  });

  it("uses real batching in runSync (groups repos by SYNC_BATCH_SIZE and forwards env) when classifyRepoBatch is used", async () => {
    const candidates = [
      makeRepo({ id: 701, name: "unchanged", full_name: "acme/unchanged" }),
      makeRepo({ id: 702, name: "repo-1", full_name: "acme/repo-1" }),
      makeRepo({ id: 703, name: "repo-2", full_name: "acme/repo-2" }),
      makeRepo({ id: 704, name: "repo-3", full_name: "acme/repo-3" }),
      makeRepo({ id: 705, name: "repo-4", full_name: "acme/repo-4" }),
      makeRepo({ id: 706, name: "repo-5", full_name: "acme/repo-5" }),
      makeRepo({ id: 707, name: "over-limit", full_name: "acme/over-limit" }),
    ];

    const mockDb = createMockDb([{ githubId: 701, readmeSha: "sha-unchanged" }]);
    const fetchReadmeMock = vi.fn(
      async (fullName: string): Promise<CleanReadmeResult> => ({
        sha: fullName === "acme/unchanged" ? "sha-unchanged" : `sha-${fullName}`,
        text: `README for ${fullName}`,
      }),
    );

    const batchMock = vi.fn<typeof classifyRepoBatch>(async (inputs) =>
      inputs.map((input) => ({
        fullName: input.fullName,
        ok: true as const,
        result: {
          provider: "Groq-120B",
          classification: makeClassification(),
        },
      })),
    );
    const sleepMock = vi.fn(async () => undefined);
    const { logger } = createTestLogger();

    const env = {
      SYNC_LIMIT: "5",
      SYNC_BATCH_SIZE: "3",
      SYNC_DELAY_MS: "250",
      GROQ_API_KEY: "gsk_batch_env_test",
    };

    const summary = await runSync({
      db: mockDb.db,
      fetchCandidateRepos: async () => candidates,
      fetchCleanReadme: fetchReadmeMock,
      classifyRepoBatch: batchMock,
      sleep: sleepMock,
      env,
      logger,
    });

    // 5 AI-attempted repos grouped into 2 real batches: [3, 2]
    expect(batchMock).toHaveBeenCalledTimes(2);
    expect(batchMock.mock.calls[0]?.[0].map((i) => i.fullName)).toEqual([
      "acme/repo-1",
      "acme/repo-2",
      "acme/repo-3",
    ]);
    expect(batchMock.mock.calls[1]?.[0].map((i) => i.fullName)).toEqual([
      "acme/repo-4",
      "acme/repo-5",
    ]);
    expect(batchMock.mock.calls[0]?.[1]?.env).toBe(env);

    // Sleeps only between batches (not after hitting SYNC_LIMIT on final batch)
    expect(sleepMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).toHaveBeenCalledWith(250);

    // Stops before fetching README for acme/over-limit
    expect(fetchReadmeMock).not.toHaveBeenCalledWith("acme/over-limit");
    expect(summary).toMatchObject({
      fetchedCount: 7,
      aiProcessedCount: 5,
      updatedStarsOnly: 1,
      failedCount: 0,
      errorSummary: null,
    });

    // Also verify default runSync (neither classifyRepo nor classifyRepoBatch injected) calls real batch endpoint once for 3 repos
    const mockDbDefault = createMockDb([]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  results: [
                    { full_name: "acme/repo-1", ...makeClassification() },
                    { full_name: "acme/repo-2", ...makeClassification() },
                    { full_name: "acme/repo-3", ...makeClassification() },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const defaultSummary = await runSync({
      db: mockDbDefault.db,
      fetchCandidateRepos: async () => candidates.slice(1, 4),
      fetchCleanReadme: fetchReadmeMock,
      sleep: sleepMock,
      env: {
        GROQ_API_KEY: "gsk_default_batch_test",
        SYNC_BATCH_SIZE: "5",
        SYNC_DELAY_MS: "0",
      },
      logger,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(defaultSummary.aiProcessedCount).toBe(3);
  });

  it("triggers circuit breaker immediately in runSync when all providers hit daily quota, halting README fetches and AI calls while still updating existing stars", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const candidates = [
      ...Array.from({ length: 19 }, (_, idx) =>
        makeRepo({
          id: 9500 + idx,
          name: `new-repo-${idx + 1}`,
          full_name: `acme/new-repo-${idx + 1}`,
        }),
      ),
      makeRepo({
        id: 9600,
        name: "existing-after-break",
        full_name: "acme/existing-after-break",
        stargazers_count: 8888,
      }),
    ];

    const mockDb = createMockDb([
      { githubId: 9600, readmeSha: "sha-existing-old" },
    ]);
    const fetchReadmeMock = vi.fn(
      async (fullName: string): Promise<CleanReadmeResult> => ({
        sha: `sha-${fullName}`,
        text: `README for ${fullName}`,
      }),
    );

    const aiFetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        '{"error":{"message":"Rate limit reached for model on tokens per day (TPD): Limit 200000, Used 200000. Please try again in 45m."}}',
        { status: 429 },
      );
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(aiFetchMock);

    const sleepMock = vi.fn(async () => undefined);
    const { logger, warns } = createTestLogger();

    const summary = await runSync({
      db: mockDb.db,
      fetchCandidateRepos: async () => candidates,
      fetchCleanReadme: fetchReadmeMock,
      sleep: sleepMock,
      env: {
        GROQ_API_KEY: "gsk_tpd_exhausted",
        SYNC_BATCH_SIZE: "5",
        SYNC_LIMIT: "20",
        SYNC_DELAY_MS: "1000",
      },
      logger,
    });

    // Only batch 1 (first 5 repos) fetched README and called the 3 Groq tiers (3 HTTP calls total)
    expect(fetchReadmeMock).toHaveBeenCalledTimes(5);
    expect(aiFetchMock).toHaveBeenCalledTimes(3);
    expect(sleepMock).not.toHaveBeenCalled();

    // Remaining 14 new repos skipped without README/AI; existing-after-break still updated stars without README fetch!
    expect(mockDb.updateCalls).toHaveLength(1);
    expect(mockDb.updateCalls[0]?.setPayload).toMatchObject({ stars: 8888 });
    expect(summary).toMatchObject({
      fetchedCount: 20,
      aiProcessedCount: 0,
      updatedStarsOnly: 1,
      failedCount: 5,
    });
    expect(
      warns.filter((w) => w.includes("Circuit breaker kích hoạt")),
    ).toHaveLength(1);
    expect(warns.some((w) => w.includes("~45m"))).toBe(true);
    expect(mockDb.insertSyncLogCalls).toHaveLength(1);

    // Also verify single-repo mode (SYNC_BATCH_SIZE=1 / classifyRepo mock) trips circuit breaker immediately on AllProvidersExhaustedError
    const singleMockDb = createMockDb([]);
    const singleFetchReadme = vi.fn(async () => ({
      sha: "sha-1",
      text: "README",
    }));
    const singleClassify = vi
      .fn()
      .mockRejectedValue(
        new AllProvidersExhaustedError(
          "All AI providers failed [all cooling down; earliest recovery ~30m]",
          true,
          DAILY_QUOTA_COOLDOWN_MS,
        ),
      );
    const singleSummary = await runSync({
      db: singleMockDb.db,
      fetchCandidateRepos: async () => candidates.slice(0, 10),
      fetchCleanReadme: singleFetchReadme,
      classifyRepo: singleClassify,
      sleep: sleepMock,
      env: { SYNC_BATCH_SIZE: "1", SYNC_LIMIT: "10" },
      logger,
    });
    expect(singleFetchReadme).toHaveBeenCalledTimes(1);
    expect(singleClassify).toHaveBeenCalledTimes(1);
    expect(singleSummary.failedCount).toBe(1);
  });

  it("triggers circuit breaker in runReclassifySync when first batch exhausts all providers long-term", async () => {
    const dbRows: ReclassifyMockRow[] = Array.from({ length: 12 }, (_, idx) => ({
      id: 200 + idx,
      githubId: 7200 + idx,
      name: `tool-${idx + 1}`,
      fullName: `acme/tool-${idx + 1}`,
      language: "TypeScript",
      summaryVi: "Tóm tắt cũ",
    }));

    const mockDb = createMockDb([], dbRows);
    const fetchMetaMock = vi.fn(async (fullName: string) =>
      makeRepo({ name: fullName, full_name: fullName }),
    );
    const fetchReadmeMock = vi.fn(async (fullName: string) => ({
      sha: `sha-${fullName}`,
      text: "README",
    }));
    const batchMock = vi.fn(async (inputs: readonly ClassifyRepoInput[]) =>
      inputs.map((input) => ({
        fullName: input.fullName,
        ok: false as const,
        error: "All AI providers cooling down beyond 65s limit",
        allProvidersLongTermCooldown: true,
      })),
    );
    const sleepMock = vi.fn(async () => undefined);
    const { logger, warns } = createTestLogger();

    const summary = await runSync({
      db: mockDb.db,
      fetchRepoMetadata: fetchMetaMock,
      fetchCleanReadme: fetchReadmeMock,
      classifyRepoBatch: batchMock,
      sleep: sleepMock,
      env: {
        SYNC_RECLASSIFY: "uncategorized",
        SYNC_LIMIT: "12",
        SYNC_BATCH_SIZE: "4",
        SYNC_DELAY_MS: "500",
      },
      logger,
    });

    // Only batch 1 (4 repos) fetched metadata + README and ran AI; batches 2 and 3 never touched
    expect(fetchMetaMock).toHaveBeenCalledTimes(4);
    expect(fetchReadmeMock).toHaveBeenCalledTimes(4);
    expect(batchMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      fetchedCount: 12,
      aiProcessedCount: 0,
      failedCount: 4,
    });
    expect(
      warns.some((w) => w.includes("Circuit breaker kích hoạt (reclassify)")),
    ).toBe(true);
    expect(mockDb.insertSyncLogCalls).toHaveLength(1);
  });
});

describe("scripts/sync-tools — lock, prune & low-star filtering integration", () => {
  it("parses SYNC_PRUNE_ONLY safely", () => {
    expect(parseSyncPruneOnly(undefined)).toBe(false);
    expect(parseSyncPruneOnly("  ")).toBe(false);
    expect(parseSyncPruneOnly("true")).toBe(true);
    expect(parseSyncPruneOnly("1")).toBe(true);
    expect(parseSyncPruneOnly("FALSE")).toBe(false);
    expect(parseSyncPruneOnly("0")).toBe(false);
    expect(() => parseSyncPruneOnly("maybe")).toThrow(/Invalid SYNC_PRUNE_ONLY/);
  });

  it("exits cleanly with skippedDueToLock=true when another worker holds the lease lock", async () => {
    const mockDb = createMockDb([]);
    const fetchCandidateMock = vi.fn();
    const pruneMock = vi.fn();
    const { logger, infos } = createTestLogger();

    const summary = await runSync({
      db: mockDb.db,
      useLock: true,
      acquireSyncLock: vi.fn(async () => ({
        acquired: false as const,
        activeHolder: {
          ranAt: "2026-11-23T10:00:00.000Z",
          marker: "__SYNC_LOCK__:other:2026-11-23T10:25:00.000Z",
        },
      })),
      fetchCandidateRepos: fetchCandidateMock,
      pruneDatabase: pruneMock,
      logger,
    });

    expect(summary).toEqual({
      fetchedCount: 0,
      aiProcessedCount: 0,
      updatedStarsOnly: 0,
      failedCount: 0,
      errorSummary: null,
      classified: [],
      skippedDueToLock: true,
    });
    expect(fetchCandidateMock).not.toHaveBeenCalled();
    expect(pruneMock).not.toHaveBeenCalled();
    expect(mockDb.insertSyncLogCalls).toHaveLength(0);
    expect(infos.join("\n")).toContain("exiting cleanly with status 0");
  });

  it("releases the distributed lock in finally even when candidate fetch throws", async () => {
    const mockDb = createMockDb([]);
    const releaseMock = vi.fn(async () => undefined);
    const { logger } = createTestLogger();

    await expect(
      runSync({
        db: mockDb.db,
        useLock: true,
        acquireSyncLock: vi.fn(async () => ({
          acquired: true as const,
          handle: {
            marker: "__SYNC_LOCK__:test",
            acquiredAt: new Date(),
            expiresAt: new Date(),
            release: releaseMock,
          },
        })),
        fetchCandidateRepos: async () => {
          throw new Error("GitHub network failure");
        },
        logger,
      }),
    ).rejects.toThrow("GitHub network failure");

    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(mockDb.insertSyncLogCalls).toHaveLength(1);
  });

  it("skips low-star new candidates when DB is near capacity while still updating existing tools and running post-sync prune", async () => {
    const lowStarNew = makeRepo({
      id: 3001,
      name: "low-star-new",
      full_name: "acme/low-star-new",
      stargazers_count: 600,
    });
    const highStarNew = makeRepo({
      id: 3002,
      name: "high-star-new",
      full_name: "acme/high-star-new",
      stargazers_count: 4500,
    });
    const existingLowStar = makeRepo({
      id: 3003,
      name: "existing-low-star",
      full_name: "acme/existing-low-star",
      stargazers_count: 700,
    });

    const mockDb = createMockDb([
      { githubId: 3003, readmeSha: "sha-existing-3003" },
    ]);
    const fetchReadmeMock = vi.fn(
      async (fullName: string): Promise<CleanReadmeResult> => ({
        sha:
          fullName === "acme/existing-low-star"
            ? "sha-existing-3003"
            : `sha-${fullName}`,
        text: "README",
      }),
    );
    const batchMock = vi.fn(async (inputs: readonly ClassifyRepoInput[]) =>
      inputs.map((input) => ({
        fullName: input.fullName,
        ok: true as const,
        result: {
          provider: "Groq-120B",
          classification: makeClassification(),
        },
      })),
    );
    const fakePruneSummary: PruneDatabaseSummary = {
      dbSizeBytes: 390 * 1024 * 1024,
      dbSizeMb: 390,
      totalToolsBefore: 4001,
      totalToolsAfter: 3995,
      prunedToolsCount: 6,
      prunedMaxStars: 800,
      prunedSyncLogsCount: 2,
      vacuumRan: true,
      config: {
        maxTools: 4000,
        pruneThresholdMb: 380,
        pruneBatchSize: 100,
        minToolsKeep: 500,
        syncLogsMaxRows: 300,
      },
    };
    const releaseMock = vi.fn(async () => undefined);
    const pruneMock = vi.fn(async () => fakePruneSummary);
    const { logger, infos } = createTestLogger();

    const summary = await runSync({
      db: mockDb.db,
      useLock: true,
      enablePrune: true,
      acquireSyncLock: vi.fn(async () => ({
        acquired: true as const,
        handle: {
          marker: "__SYNC_LOCK__:test",
          acquiredAt: new Date(),
          expiresAt: new Date(),
          release: releaseMock,
        },
      })),
      getStarFloorThreshold: vi.fn(async () => ({
        dbSizeBytes: 390 * 1024 * 1024,
        dbSizeMb: 390,
        totalTools: 4000,
        isNearCapacity: true,
        minEligibleStars: 800,
      })),
      pruneDatabase: pruneMock,
      fetchCandidateRepos: async () => [
        lowStarNew,
        highStarNew,
        existingLowStar,
      ],
      fetchCleanReadme: fetchReadmeMock,
      classifyRepoBatch: batchMock,
      sleep: vi.fn(async () => undefined),
      env: { SYNC_LIMIT: "10", SYNC_BATCH_SIZE: "5", SYNC_DELAY_MS: "0" },
      logger,
    });

    // low-star-new (600 <= 800) never fetched README or called AI
    expect(fetchReadmeMock).not.toHaveBeenCalledWith("acme/low-star-new");
    expect(batchMock).toHaveBeenCalledTimes(1);
    expect(batchMock.mock.calls[0]?.[0].map((i) => i.fullName)).toEqual([
      "acme/high-star-new",
    ]);

    expect(summary).toMatchObject({
      fetchedCount: 3,
      aiProcessedCount: 1,
      updatedStarsOnly: 1,
      failedCount: 0,
      skippedDueToLock: false,
      skippedLowStarCount: 1,
      minEligibleStars: 800,
      pruneSummary: fakePruneSummary,
    });
    expect(pruneMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(infos.join("\n")).toContain("Đã bỏ qua 1 repo mới có <= 800 sao");
  });

  it("supports SYNC_PRUNE_ONLY=true without crawling GitHub or calling AI", async () => {
    const mockDb = createMockDb([]);
    const fetchCandidateMock = vi.fn();
    const fakePruneSummary: PruneDatabaseSummary = {
      dbSizeBytes: 250 * 1024 * 1024,
      dbSizeMb: 250,
      totalToolsBefore: 4050,
      totalToolsAfter: 4000,
      prunedToolsCount: 50,
      prunedMaxStars: 620,
      prunedSyncLogsCount: 10,
      vacuumRan: true,
      config: {
        maxTools: 4000,
        pruneThresholdMb: 380,
        pruneBatchSize: 100,
        minToolsKeep: 500,
        syncLogsMaxRows: 300,
      },
    };
    const pruneMock = vi.fn(async () => fakePruneSummary);
    const { logger } = createTestLogger();

    const summary = await runSync({
      db: mockDb.db,
      useLock: false,
      enablePrune: true,
      pruneDatabase: pruneMock,
      fetchCandidateRepos: fetchCandidateMock,
      env: { SYNC_PRUNE_ONLY: "true" },
      logger,
    });

    expect(fetchCandidateMock).not.toHaveBeenCalled();
    expect(pruneMock).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({
      fetchedCount: 0,
      aiProcessedCount: 0,
      updatedStarsOnly: 0,
      failedCount: 0,
      pruneSummary: fakePruneSummary,
    });
  });
});
