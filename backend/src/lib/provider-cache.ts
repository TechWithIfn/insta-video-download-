import type { ResolverResult } from "./types.js";
import { hashUrl } from "./crypto.js";

interface CacheEntry {
  result: ResolverResult;
  createdAt: number;
}

const store = new Map<string, CacheEntry>();

const TTL_MS = parseInt(process.env.RESOLVE_CACHE_TTL_MS || "120000", 10);
const MAX_ENTRIES = 200;

export function getCachedResult(url: string): ResolverResult | null {
  const key = hashUrl(url);
  const entry = store.get(key);
  if (!entry) return null;

  if (Date.now() - entry.createdAt > TTL_MS) {
    store.delete(key);
    return null;
  }

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
  }
}
