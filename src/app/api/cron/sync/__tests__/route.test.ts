import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCronSyncOptions,
  CRON_AI_TIMEOUT_MS,
  CRON_GITHUB_PAGES_PER_QUERY,
  CRON_GITHUB_PER_PAGE,
  CRON_LOCK_TTL_SECONDS,
  CRON_MAX_COOLDOWN_WAIT_MS,
  CRON_MAX_SYNC_LIMIT,
  CRON_SYNC_BATCH_SIZE,
  CRON_SYNC_DELAY_MS,
  resolveCronSyncLimit,
  selectCronStreams,
} from "../../../../../../scripts/lib/sync/cron-config";
import type { SyncRunSummary } from "../../../../../../scripts/lib/sync/upsert";

const { runSyncMock } = vi.hoisted(() => ({
  runSyncMock: vi.fn(),
}));

vi.mock("../../../../../../scripts/lib/sync/runner", () => ({
  runSync: runSyncMock,
}));

import { dynamic, GET, maxDuration, POST } from "../route";

function makeCronRequest(
  method: "GET" | "POST",
  authorization?: string,
): NextRequest {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) {
    headers.authorization = authorization;
  }
  return new NextRequest("https://example.vercel.app/api/cron/sync", {
    method,
    headers,
  });
}

function makeSummary(overrides: Partial<SyncRunSummary> = {}): SyncRunSummary {
  return {
    fetchedCount: 10,
    aiProcessedCount: 3,
    updatedStarsOnly: 4,
    failedCount: 0,
    errorSummary: null,
    classified: [],
    skippedDueToLock: false,
    ...overrides,
  };
}

describe("/api/cron/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "cron-top-secret-token");
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("exports dynamic='force-dynamic' and maxDuration=60", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(60);
  });

  it("fails closed with 503 when CRON_SECRET is missing or blank", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const resGet = await GET(
      makeCronRequest("GET", "Bearer cron-top-secret-token"),
    );
    expect(resGet.status).toBe(503);
    expect(resGet.headers.get("cache-control")).toBe("no-store");
    expect(await resGet.json()).toEqual({
      ok: false,
      error: "CRON_SECRET is not configured",
    });

    vi.stubEnv("CRON_SECRET", "   ");
    const resPost = await POST(
      makeCronRequest("POST", "Bearer cron-top-secret-token"),
    );
    expect(resPost.status).toBe(503);
    expect(runSyncMock).not.toHaveBeenCalled();
  });

  it("rejects missing, malformed, or wrong Bearer tokens with 401", async () => {
    const missingRes = await GET(makeCronRequest("GET"));
    expect(missingRes.status).toBe(401);
    expect(missingRes.headers.get("cache-control")).toBe("no-store");

    const basicRes = await GET(makeCronRequest("GET", "Basic abc123"));
    expect(basicRes.status).toBe(401);

    const emptyBearerRes = await POST(makeCronRequest("POST", "Bearer   "));
    expect(emptyBearerRes.status).toBe(401);

    const wrongTokenRes = await POST(
      makeCronRequest("POST", "Bearer wrong-cron-secret"),
    );
    expect(wrongTokenRes.status).toBe(401);

    expect(runSyncMock).not.toHaveBeenCalled();
  });

  it("runs a bounded micro-batch sync on authorized GET and POST requests", async () => {
    const summary = makeSummary({ aiProcessedCount: 5 });
    runSyncMock.mockResolvedValueOnce(summary).mockResolvedValueOnce(summary);

    vi.stubEnv("SYNC_LIMIT", "40");
    const getRes = await GET(
      makeCronRequest("GET", "Bearer cron-top-secret-token"),
    );
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("cache-control")).toBe("no-store");
    expect(await getRes.json()).toEqual({
      ok: true,
      skipped: false,
      summary,
    });

    const firstCallOpts = runSyncMock.mock.calls[0]?.[0];
    expect(firstCallOpts?.env?.SYNC_LIMIT).toBe(String(CRON_MAX_SYNC_LIMIT));
    expect(firstCallOpts?.env?.SYNC_BATCH_SIZE).toBe(
      String(CRON_SYNC_BATCH_SIZE),
    );
    expect(firstCallOpts?.env?.SYNC_DELAY_MS).toBe(String(CRON_SYNC_DELAY_MS));
    expect(firstCallOpts?.env?.SYNC_RECLASSIFY).toBe("none");
    expect(firstCallOpts?.delayMs).toBe(CRON_SYNC_DELAY_MS);
    expect(firstCallOpts?.maxCooldownWaitMs).toBe(CRON_MAX_COOLDOWN_WAIT_MS);
    expect(firstCallOpts?.aiTimeoutMs).toBe(CRON_AI_TIMEOUT_MS);
    expect(firstCallOpts?.lockTtlSeconds).toBe(CRON_LOCK_TTL_SECONDS);
    expect(firstCallOpts?.lockOwner).toBe("vercel-cron");
    expect(firstCallOpts?.useLock).toBe(true);
    expect(firstCallOpts?.enablePrune).toBe(true);
    expect(firstCallOpts?.fetchCandidateOptions?.pagesPerQuery).toBe(
      CRON_GITHUB_PAGES_PER_QUERY,
    );
    expect(firstCallOpts?.fetchCandidateOptions?.perPage).toBe(
      CRON_GITHUB_PER_PAGE,
    );
    expect(firstCallOpts?.fetchCandidateOptions?.streams).toHaveLength(2);

    const postRes = await POST(
      makeCronRequest("POST", "Bearer cron-top-secret-token"),
    );
    expect(postRes.status).toBe(200);
    expect(runSyncMock).toHaveBeenCalledTimes(2);
  });

  it("returns 200 skipped=true when another worker already holds the distributed lock", async () => {
    const lockedSummary = makeSummary({
      fetchedCount: 0,
      aiProcessedCount: 0,
      updatedStarsOnly: 0,
      skippedDueToLock: true,
    });
    runSyncMock.mockResolvedValueOnce(lockedSummary);

    const res = await GET(
      makeCronRequest("GET", "Bearer cron-top-secret-token"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      ok: true,
      skipped: true,
      reason: "lock_held",
      summary: lockedSummary,
    });
  });

  it("returns sanitized 500 error without leaking secrets when runSync fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    runSyncMock.mockRejectedValueOnce(
      new Error(
        "postgresql://user:super_secret_pw@ep-demo.neon.tech/neondb connection error",
      ),
    );

    const res = await POST(
      makeCronRequest("POST", "Bearer cron-top-secret-token"),
    );
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({
      ok: false,
      error: "Sync execution failed",
    });
    expect(JSON.stringify(body)).not.toContain("super_secret_pw");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[1]).toContain("[REDACTED_DATABASE_URL]");
  });

  it("clamps cron sync limit safely and rotates lightweight GitHub streams", () => {
    expect(resolveCronSyncLimit({})).toBe(5);
    expect(resolveCronSyncLimit({ CRON_SYNC_LIMIT: "2" })).toBe(2);
    expect(resolveCronSyncLimit({ CRON_SYNC_LIMIT: "25" })).toBe(5);
    expect(resolveCronSyncLimit({ SYNC_LIMIT: "3" })).toBe(3);
    expect(resolveCronSyncLimit({ CRON_SYNC_LIMIT: "invalid" })).toBe(5);

    const hour1Streams = selectCronStreams(new Date("2026-11-23T01:00:00Z"));
    const hour2Streams = selectCronStreams(new Date("2026-11-23T02:00:00Z"));
    expect(hour1Streams[0]).toBe("rising");
    expect(hour2Streams[0]).toBe("rising");
    expect(hour1Streams[1]).not.toBe("rising");
    expect(hour1Streams[1]).not.toBe(hour2Streams[1]);

    const opts = buildCronSyncOptions(
      { CRON_SYNC_LIMIT: "4" },
      new Date("2026-11-23T05:00:00Z"),
    );
    expect(opts.env?.SYNC_LIMIT).toBe("4");
  });
});
