import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_FAILED_ATTEMPTS,
  MAX_RATE_LIMIT_ENTRIES,
  RATE_LIMIT_WINDOW_MS,
  checkRateLimit,
  clearFailedAttempts,
  getRateLimitEntryCountForTests,
  recordFailedAttempt,
  resetSessionRateLimitForTests,
} from "@/lib/admin-rate-limit";

describe("admin-rate-limit", () => {
  beforeEach(() => {
    resetSessionRateLimitForTests();
  });

  afterEach(() => {
    resetSessionRateLimitForTests();
  });

  it("blocks after MAX_FAILED_ATTEMPTS and unblocks after RATE_LIMIT_WINDOW_MS", () => {
    const ip = "203.0.113.1";
    const startMs = 1_000_000;

    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i += 1) {
      recordFailedAttempt(ip, startMs + i * 1000);
      expect(checkRateLimit(ip, startMs + i * 1000)).toEqual({
        blocked: false,
        retryAfterSeconds: 0,
      });
    }

    recordFailedAttempt(ip, startMs + 4000);
    const blocked = checkRateLimit(ip, startMs + 4000);
    expect(blocked.blocked).toBe(true);
    expect(blocked.retryAfterSeconds).toBe(
      Math.ceil((RATE_LIMIT_WINDOW_MS - 4000) / 1000),
    );

    const expiredAt = startMs + RATE_LIMIT_WINDOW_MS;
    expect(checkRateLimit(ip, expiredAt)).toEqual({
      blocked: false,
      retryAfterSeconds: 0,
    });
    expect(getRateLimitEntryCountForTests()).toBe(0);
  });

  it("clearFailedAttempts resets only the specified IP", () => {
    const nowMs = 2_000_000;
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
      recordFailedAttempt("198.51.100.1", nowMs);
      recordFailedAttempt("198.51.100.2", nowMs);
    }

    clearFailedAttempts("198.51.100.1");

    expect(checkRateLimit("198.51.100.1", nowMs).blocked).toBe(false);
    expect(checkRateLimit("198.51.100.2", nowMs).blocked).toBe(true);
  });

  it("purges expired entries first before touching active entries at MAX_RATE_LIMIT_ENTRIES", () => {
    const expiredAtMs = 1_000_000;
    const activeAtMs = expiredAtMs + RATE_LIMIT_WINDOW_MS - 10_000;
    const insertNowMs = expiredAtMs + RATE_LIMIT_WINDOW_MS;

    // Seed 250 expired entries and 250 active entries to reach MAX_RATE_LIMIT_ENTRIES (500)
    const halfCap = Math.floor(MAX_RATE_LIMIT_ENTRIES / 2);
    for (let i = 0; i < halfCap; i += 1) {
      recordFailedAttempt(`10.0.0.${i}`, expiredAtMs);
    }
    for (let i = halfCap; i < MAX_RATE_LIMIT_ENTRIES; i += 1) {
      for (let f = 0; f < MAX_FAILED_ATTEMPTS; f += 1) {
        recordFailedAttempt(`10.0.1.${i}`, activeAtMs);
      }
    }
    expect(getRateLimitEntryCountForTests()).toBe(MAX_RATE_LIMIT_ENTRIES);

    // Adding one new IP at insertNowMs should purge all 250 expired entries and preserve all 250 active ones
    recordFailedAttempt("10.0.2.1", insertNowMs);

    expect(getRateLimitEntryCountForTests()).toBe(
      MAX_RATE_LIMIT_ENTRIES - halfCap + 1,
    );
    expect(checkRateLimit(`10.0.1.${halfCap}`, insertNowMs).blocked).toBe(true);
  });

  it("evicts oldest keys (FIFO) when all entries are active so Map size never exceeds MAX_RATE_LIMIT_ENTRIES", () => {
    const startMs = 5_000_000;

    for (let i = 0; i < MAX_RATE_LIMIT_ENTRIES; i += 1) {
      for (let f = 0; f < MAX_FAILED_ATTEMPTS; f += 1) {
        recordFailedAttempt(`192.0.2.${i}`, startMs + i);
      }
    }
    expect(getRateLimitEntryCountForTests()).toBe(MAX_RATE_LIMIT_ENTRIES);

    // Add 10 more active IPs beyond the cap
    for (let extra = 0; extra < 10; extra += 1) {
      for (let f = 0; f < MAX_FAILED_ATTEMPTS; f += 1) {
        recordFailedAttempt(`198.51.100.${extra}`, startMs + 1000 + extra);
      }
      expect(getRateLimitEntryCountForTests()).toBeLessThanOrEqual(
        MAX_RATE_LIMIT_ENTRIES,
      );
    }

    expect(getRateLimitEntryCountForTests()).toBe(MAX_RATE_LIMIT_ENTRIES);

    // Oldest 10 entries (192.0.2.0 .. 192.0.2.9) must have been evicted
    for (let i = 0; i < 10; i += 1) {
      expect(checkRateLimit(`192.0.2.${i}`, startMs + 2000).blocked).toBe(
        false,
      );
    }

    // Subsequent active entries and newly inserted entries remain blocked
    expect(checkRateLimit("192.0.2.10", startMs + 2000).blocked).toBe(true);
    expect(checkRateLimit("198.51.100.9", startMs + 2000).blocked).toBe(true);
  });

  it("increments failures for the oldest active IP at full capacity without evicting it", () => {
    const startMs = 8_000_000;

    for (let i = 0; i < MAX_RATE_LIMIT_ENTRIES; i += 1) {
      recordFailedAttempt(`172.16.0.${i}`, startMs);
    }
    expect(getRateLimitEntryCountForTests()).toBe(MAX_RATE_LIMIT_ENTRIES);

    for (let f = 1; f < MAX_FAILED_ATTEMPTS; f += 1) {
      recordFailedAttempt("172.16.0.0", startMs + f * 100);
    }

    expect(getRateLimitEntryCountForTests()).toBe(MAX_RATE_LIMIT_ENTRIES);
    expect(checkRateLimit("172.16.0.0", startMs + 1000).blocked).toBe(true);
  });
});
