import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SUGGEST_MAX_ENTRIES,
  SUGGEST_MAX_REQUESTS,
  SUGGEST_RATE_LIMIT_WINDOW_MS,
  consumeSuggestRateLimit,
  getSuggestRateLimitEntryCountForTests,
  resetSuggestRateLimitForTests,
} from "@/lib/suggest-rate-limit";

describe("suggest-rate-limit", () => {
  beforeEach(() => {
    resetSuggestRateLimitForTests();
  });

  afterEach(() => {
    resetSuggestRateLimitForTests();
  });

  it("allows up to SUGGEST_MAX_REQUESTS within window, blocks the next with Retry-After, and resets after window expires", () => {
    const ip = "203.0.113.10";
    const startMs = 1_000_000;

    for (let i = 0; i < SUGGEST_MAX_REQUESTS; i += 1) {
      expect(consumeSuggestRateLimit(ip, startMs + i * 100)).toEqual({
        blocked: false,
        retryAfterSeconds: 0,
      });
    }

    const blockedAtMs = startMs + 6000;
    const blocked = consumeSuggestRateLimit(ip, blockedAtMs);
    expect(blocked.blocked).toBe(true);
    expect(blocked.retryAfterSeconds).toBe(
      Math.ceil((SUGGEST_RATE_LIMIT_WINDOW_MS - 6000) / 1000),
    );

    const expiredAtMs = startMs + SUGGEST_RATE_LIMIT_WINDOW_MS;
    expect(consumeSuggestRateLimit(ip, expiredAtMs)).toEqual({
      blocked: false,
      retryAfterSeconds: 0,
    });
    expect(getSuggestRateLimitEntryCountForTests()).toBe(1);
  });

  it("tracks rate limits independently per IP", () => {
    const nowMs = 2_000_000;
    for (let i = 0; i < SUGGEST_MAX_REQUESTS; i += 1) {
      expect(consumeSuggestRateLimit("198.51.100.1", nowMs).blocked).toBe(
        false,
      );
    }

    expect(consumeSuggestRateLimit("198.51.100.1", nowMs).blocked).toBe(true);
    expect(consumeSuggestRateLimit("198.51.100.2", nowMs).blocked).toBe(false);
  });

  it("purges expired entries first before evicting active entries at SUGGEST_MAX_ENTRIES", () => {
    const expiredAtMs = 1_000_000;
    const activeAtMs = expiredAtMs + SUGGEST_RATE_LIMIT_WINDOW_MS - 10_000;
    const insertNowMs = expiredAtMs + SUGGEST_RATE_LIMIT_WINDOW_MS;

    const halfCap = Math.floor(SUGGEST_MAX_ENTRIES / 2);
    for (let i = 0; i < halfCap; i += 1) {
      consumeSuggestRateLimit(`10.0.0.${i}`, expiredAtMs);
    }
    for (let i = halfCap; i < SUGGEST_MAX_ENTRIES; i += 1) {
      for (let req = 0; req < SUGGEST_MAX_REQUESTS; req += 1) {
        consumeSuggestRateLimit(`10.0.1.${i}`, activeAtMs);
      }
    }
    expect(getSuggestRateLimitEntryCountForTests()).toBe(SUGGEST_MAX_ENTRIES);

    consumeSuggestRateLimit("10.0.2.1", insertNowMs);

    expect(getSuggestRateLimitEntryCountForTests()).toBe(
      SUGGEST_MAX_ENTRIES - halfCap + 1,
    );
    expect(
      consumeSuggestRateLimit(`10.0.1.${halfCap}`, insertNowMs).blocked,
    ).toBe(true);
  });

  it("evicts oldest keys (FIFO) when all entries are active so Map size never exceeds SUGGEST_MAX_ENTRIES", () => {
    const startMs = 5_000_000;

    for (let i = 0; i < SUGGEST_MAX_ENTRIES; i += 1) {
      for (let req = 0; req < SUGGEST_MAX_REQUESTS; req += 1) {
        consumeSuggestRateLimit(`192.0.2.${i}`, startMs + i);
      }
    }
    expect(getSuggestRateLimitEntryCountForTests()).toBe(SUGGEST_MAX_ENTRIES);

    for (let extra = 0; extra < 10; extra += 1) {
      for (let req = 0; req < SUGGEST_MAX_REQUESTS; req += 1) {
        consumeSuggestRateLimit(`198.51.100.${extra}`, startMs + 2000 + extra);
      }
      expect(getSuggestRateLimitEntryCountForTests()).toBeLessThanOrEqual(
        SUGGEST_MAX_ENTRIES,
      );
    }

    expect(getSuggestRateLimitEntryCountForTests()).toBe(SUGGEST_MAX_ENTRIES);

    // 10 IP cũ nhất đã bị xóa nên bộ đếm được reset
    for (let i = 0; i < 10; i += 1) {
      expect(
        consumeSuggestRateLimit(`192.0.2.${i}`, startMs + 3000).blocked,
      ).toBe(false);
    }
  });
});
