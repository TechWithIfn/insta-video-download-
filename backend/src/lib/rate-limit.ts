import type { RateLimitConfig } from "./types.js";
import { readPositiveInt } from "./env.js";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

function defaultRateLimitConfig(): RateLimitConfig {
  return {
    windowMs: readPositiveInt("RATE_LIMIT_WINDOW_MS", 60_000),
    maxRequests: readPositiveInt("RATE_LIMIT_MAX_REQUESTS", 30),
  };
}

export function checkRateLimit(
  key: string,
  config: RateLimitConfig = defaultRateLimitConfig()
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, {
      count: 1,
      resetAt: now + config.windowMs,
    });
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      retryAfterMs: 0,
    };
  }

  if (entry.count >= config.maxRequests) {
    const retryAfterMs = entry.resetAt - now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(retryAfterMs, 0),
    };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    retryAfterMs: 0,
  };
}

export function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}

setInterval(cleanupExpiredEntries, 60_000);
