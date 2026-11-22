import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "@/db";
import { syncLogs, tools } from "@/db/schema";
import type { AiClassification } from "@/lib/validator";
import type { ClassifyRepoInput } from "../lib/classifier";
import type { CleanReadmeResult, GitHubRepoItem } from "../lib/github";
import {
  AI_RATE_LIMIT_DELAY_MS,
  DEFAULT_SYNC_LIMIT,
  formatClassificationTable,
  isDirectExecution,
  parseSyncLimit,
  runSync,
  sanitizeErrorMessage,
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

function createMockDb(existingTools: readonly ExistingToolRow[] = []) {
  const updateCalls: CapturedUpdateCall[] = [];
  const insertToolCalls: CapturedInsertToolCall[] = [];
  const insertSyncLogCalls: CapturedInsertSyncLogCall[] = [];

  const mockClient = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [...existingTools]),
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

  it("preserves isPinned and userNotes during UPSERT and sleeps 1500ms after AI classification", async () => {
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

  it("counts SYNC_LIMIT strictly on AI calls and updates only stars/lastPushedAt for changed existing repos past limit", async () => {
    const repo1Unchanged = makeRepo({ id: 1, full_name: "acme/unchanged-1", stargazers_count: 5100 });
    const repo2New = makeRepo({ id: 2, full_name: "acme/new-2" });
    const repo3Unchanged = makeRepo({ id: 3, full_name: "acme/unchanged-3", stargazers_count: 6200 });
    const repo4ChangedWithinLimit = makeRepo({ id: 4, full_name: "acme/changed-4" });
    const repo5NewPastLimit = makeRepo({ id: 5, full_name: "acme/new-past-limit-5" });
    const repo6ChangedPastLimit = makeRepo({
      id: 6,
      full_name: "acme/changed-past-limit-6",
      stargazers_count: 9999,
      pushed_at: "2026-11-22T10:00:00Z",
    });

    const mockDb = createMockDb([
      { githubId: 1, readmeSha: "sha-1" },
      { githubId: 3, readmeSha: "sha-3" },
      { githubId: 4, readmeSha: "sha-4-old" },
      { githubId: 6, readmeSha: "sha-6-old" },
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
        case "acme/changed-past-limit-6":
          return { sha: "sha-6-new", text: "r6" };
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
    const { logger } = createTestLogger();

    const summary = await runSync({
      db: mockDb.db,
      fetchCandidateRepos: async () => [
        repo1Unchanged,
        repo2New,
        repo3Unchanged,
        repo4ChangedWithinLimit,
        repo5NewPastLimit,
        repo6ChangedPastLimit,
      ],
      fetchCleanReadme: fetchReadmeMock,
      classifyRepo: classifyMock,
      sleep: sleepMock,
      now: () => fixedNow,
      env: { SYNC_LIMIT: "2" },
      logger,
    });

    // Chỉ gọi AI đúng 2 lần (repo2 và repo4), bỏ qua repo5 (mới, sau limit) và không gọi AI cho repo6
    expect(classifyMock).toHaveBeenCalledTimes(2);
    expect(classifyMock.mock.calls.map((c) => c[0].fullName)).toEqual([
      "acme/new-2",
      "acme/changed-4",
    ]);

    // Repo mới sau SYNC_LIMIT không tốn request README
    expect(fetchReadmeMock).not.toHaveBeenCalledWith("acme/new-past-limit-5");

    // 3 repo chỉ cập nhật stars (repo1, repo3, và repo6 đổi SHA nhưng đã chạm SYNC_LIMIT)
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
      fetchedCount: 6,
      aiProcessedCount: 2,
      updatedStarsOnly: 3,
      failedCount: 0,
      errorSummary: null,
    });
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
});
