import { describe, it, expect, afterEach } from "vitest";
import { readPositiveInt } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";

describe("readPositiveInt", () => {
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function setEnv(key: string, value: string | undefined): void {
    if (!(key in saved)) saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  it("falls back when missing", () => {
    setEnv("DOWNLOADIT_TEST_INT", undefined);
    expect(readPositiveInt("DOWNLOADIT_TEST_INT", 42)).toBe(42);
  });

  it("falls back on non-numeric, zero, or negative values", () => {
    setEnv("DOWNLOADIT_TEST_INT", "abc");
    expect(readPositiveInt("DOWNLOADIT_TEST_INT", 42)).toBe(42);
    setEnv("DOWNLOADIT_TEST_INT", "0");
    expect(readPositiveInt("DOWNLOADIT_TEST_INT", 42)).toBe(42);
    setEnv("DOWNLOADIT_TEST_INT", "-5");
    expect(readPositiveInt("DOWNLOADIT_TEST_INT", 42)).toBe(42);
  });

  it("reads valid values", () => {
    setEnv("DOWNLOADIT_TEST_INT", "7");
    expect(readPositiveInt("DOWNLOADIT_TEST_INT", 42)).toBe(7);
  });

  it("rate limiting honors RATE_LIMIT_MAX_REQUESTS", () => {
    setEnv("RATE_LIMIT_MAX_REQUESTS", "2");
    const key = "env-override-" + Date.now();
    expect(checkRateLimit(key).allowed).toBe(true);
    expect(checkRateLimit(key).allowed).toBe(true);
    const blocked = checkRateLimit(key);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });
});
