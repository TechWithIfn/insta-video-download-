import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkRateLimit, cleanupExpiredEntries } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows first request", () => {
    const result = checkRateLimit("test-key");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(29);
  });

  it("tracks request count", () => {
    const key = "test-count";
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key);
    }
    const result = checkRateLimit(key);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(24);
  });

  it("blocks after max requests", () => {
    const key = "test-block";
    for (let i = 0; i < 30; i++) {
      checkRateLimit(key);
    }
    const result = checkRateLimit(key);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after window expires", () => {
    const key = "test-reset";
    for (let i = 0; i < 30; i++) {
      checkRateLimit(key);
    }
    vi.advanceTimersByTime(61_000);
    const result = checkRateLimit(key);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(29);
  });

  it("allows different keys independently", () => {
    for (let i = 0; i < 30; i++) {
      checkRateLimit("key-a");
    }
    const resultB = checkRateLimit("key-b");
    expect(resultB.allowed).toBe(true);
  });

  it("respects custom config", () => {
    const config = { windowMs: 10_000, maxRequests: 3 };
    checkRateLimit("custom", config);
    checkRateLimit("custom", config);
    checkRateLimit("custom", config);
    const result = checkRateLimit("custom", config);
    expect(result.allowed).toBe(false);
  });
});

describe("cleanupExpiredEntries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes expired entries", () => {
    checkRateLimit("cleanup-test");
    vi.advanceTimersByTime(120_000);
    cleanupExpiredEntries();
    const result = checkRateLimit("cleanup-test");
    expect(result.remaining).toBe(29);
  });
});
