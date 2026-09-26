import type { RateLimitConfig } from "./types.js";
import { readBoundedInt, readPositiveInt } from "./env.js";
import { scheduleBackgroundTask } from "./background.js";
import { logger } from "./logger.js";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

/**
 * Hard cap on tracked clients. An unbounded per-IP map is a memory-growth
 * vector: an attacker rotating source IPs (or a proxy misconfiguration)
 * otherwise leaves one entry behind forever, because sweeps only removed
 * entries whose *window* had expired, never entries for IPs seen once.
 */
const MAX_TRACKED_KEYS = readBoundedInt("RATE_LIMIT_MAX_TRACKED_KEYS", 20_000, 100, 1_000_000);

function defaultRateLimitConfig(): RateLimitConfig {
  return {
    windowMs: readPositiveInt("RATE_LIMIT_WINDOW_MS", 60_000),
    maxRequests: readPositiveInt("RATE_LIMIT_MAX_REQUESTS", 30),
  };
}

/**
 * Per-route budgets (each route already uses its own key namespace, so the
 * buckets never bleed into each other).
 *
 * Correctness rules encoded here:
 *  - RESOLVE is the expensive, abuse-sensitive operation and keeps the tight
 *    default budget (RATE_LIMIT_MAX_REQUESTS, 30/min).
 *  - DOWNLOAD/STREAM are cheap transfers of already-resolved media. A user
 *    legitimately re-downloads the same file and a video preview issues many
 *    small range requests while seeking — those must not be treated as
 *    abuse, and they must never consume the resolve quota.
 *  - Every bucket stays finite and returns HTTP 429 when genuinely exceeded;
 *    security rate limiting is configured, not removed.
 */
const ROUTE_MAX_DEFAULTS = {
  download: 60,
  stream: 180,
  audio: 20,
} as const;

export function routeRateLimitConfig(
  kind: keyof typeof ROUTE_MAX_DEFAULTS
): RateLimitConfig {
  const envKey =
    kind === "download"
      ? "RATE_LIMIT_DOWNLOAD_MAX_REQUESTS"
      : kind === "stream"
        ? "RATE_LIMIT_STREAM_MAX_REQUESTS"
        : "RATE_LIMIT_AUDIO_MAX_REQUESTS";
  return {
    windowMs: readPositiveInt("RATE_LIMIT_WINDOW_MS", 60_000),
    maxRequests: readPositiveInt(envKey, ROUTE_MAX_DEFAULTS[kind]),
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
    // Re-inspect after insert so a brand-new key cannot push an already-full
    // map further past the cap.
    enforceKeyCap();
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

/** Drop the oldest-expiring buckets until the map is back under its cap. */
function enforceKeyCap(): void {
  if (store.size <= MAX_TRACKED_KEYS) return;
  const sorted = [...store.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
  const toRemove = store.size - MAX_TRACKED_KEYS;
  for (let i = 0; i < toRemove; i++) {
    store.delete(sorted[i][0]);
  }
  logger.warn("Rate-limit store over capacity — evicted oldest buckets", {
    cap: MAX_TRACKED_KEYS,
    evicted: toRemove,
  });
}

/** Test-only: drop every bucket so quota assertions are independent. */
export function resetRateLimitsForTests(): void {
  store.clear();
}

export function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
  enforceKeyCap();
}

// Named + unref'd so this can never hold the process open, and is cleared
// deterministically on shutdown instead of racing the exit.
scheduleBackgroundTask("rate-limit-sweep", 60_000, cleanupExpiredEntries);
