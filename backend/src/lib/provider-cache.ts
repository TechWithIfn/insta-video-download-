import type { ResolverResult } from "./types.js";
import { hashUrl } from "./crypto.js";
import { readBoundedInt } from "./env.js";
import { scheduleBackgroundTask } from "./background.js";
import { logger } from "./logger.js";
import { inc } from "./metrics.js";

interface CacheEntry {
  result: ResolverResult;
  createdAt: number;
}

const store = new Map<string, CacheEntry>();

/**
 * `parseInt(process.env.X || "120000")` silently produced NaN for a present-but
 * invalid value (e.g. `RESOLVE_CACHE_TTL_MS=abc`), which made every comparison
 * false and turned the cache into an unbounded-growth map of stale results.
 * Bounded parsing keeps both the TTL and the entry count valid.
 */
const TTL_MS = readBoundedInt("RESOLVE_CACHE_TTL_MS", 120_000, 1_000, 3_600_000);
const MAX_ENTRIES = readBoundedInt("RESOLVE_CACHE_MAX_ENTRIES", 200, 10, 10_000);

/** Drop expired entries so TTL misses do not accumulate between writes. */
function sweepExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.createdAt > TTL_MS) {
      store.delete(key);
    }
  }
}

scheduleBackgroundTask("provider-cache-sweep", 60_000, () => {
  sweepExpired();
  if (store.size > MAX_ENTRIES) {
    logger.warn("Provider cache over capacity", { size: store.size, max: MAX_ENTRIES });
  }
}, { runImmediately: false });

export function getCachedResult(url: string): ResolverResult | null {
  const key = hashUrl(url);
  const entry = store.get(key);
  if (!entry) {
    inc("cacheMisses");
    return null;
  }

  if (Date.now() - entry.createdAt > TTL_MS) {
    store.delete(key);
    inc("cacheMisses");
    return null;
  }

  inc("cacheHits");
  return entry.result;
}

export function setCachedResult(url: string, result: ResolverResult): void {
  if (store.size >= MAX_ENTRIES) {
    evictOldest();
  }

  store.set(hashUrl(url), {
    result,
    createdAt: Date.now(),
  });
}

/**
 * Drop a cached entry so the next resolve fetches fresh data (expiry recovery).
 * Counted as a refresh, not a miss: this is the signed-CDN-URL self-heal path
 * (an upstream 403/expired signature forces a fresh provider resolve), and it
 * is the number that shows whether refreshes are happening at a sane rate.
 */
export function deleteCachedResult(url: string): void {
  if (store.delete(hashUrl(url))) inc("cacheRefreshes");
}

function evictOldest(): void {
  let oldestKey: string | null = null;
  let oldestTime = Infinity;

  for (const [key, entry] of store.entries()) {
    if (entry.createdAt < oldestTime) {
      oldestTime = entry.createdAt;
      oldestKey = key;
    }
  }

  if (oldestKey) {
    store.delete(oldestKey);
    inc("cacheEvictions");
  }
}
