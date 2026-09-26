import type { MediaItem, TempStoreEntry, InstagramContentType } from "./types.js";
import { readPositiveInt } from "./env.js";

/**
 * Temporary resolution storage.
 *
 * Lifecycle contract (regression-critical):
 *   resolve -> storeMedia -> entry valid for its TTL -> getMedia() any number
 *   of times -> entry expires naturally after TTL.
 *
 * A DOWNLOAD NEVER DELETES AN ENTRY. Nothing in the request paths calls
 * `deleteMedia`: repeated downloads of the same resolution must keep working,
 * and a successful download must not invalidate a still-valid resolution.
 */
const store = new Map<string, TempStoreEntry>();

const TTL_MS = readPositiveInt("TEMP_STORE_TTL_MS", 10 * 60 * 1000);
const MAX_ENTRIES = 1000;
/**
 * Entries touched inside this window are protected from capacity eviction —
 * cleanup/eviction must never pull a resolution out from under a download
 * that is reading it right now. TTL expiry still applies regardless.
 */
const ACTIVE_GUARD_MS = readPositiveInt("TEMP_STORE_ACTIVE_GUARD_MS", 60_000);

function nowMs(): number {
  return Date.now();
}

function isExpired(entry: TempStoreEntry, now: number): boolean {
  return now - entry.createdAt > TTL_MS;
}

export function storeMedia(
  id: string,
  media: MediaItem[],
  type?: InstagramContentType
): void {
  // Drop genuinely expired entries first so capacity eviction never has to
  // choose between two live resolutions.
  pruneExpired();

  if (store.size >= MAX_ENTRIES) {
    evictLeastRecentlyUsed();
  }

  const now = nowMs();
  store.set(id, {
    id,
    media,
    type,
    createdAt: now,
    lastAccessAt: now,
  });
}

export function getMedia(id: string): MediaItem[] | null {
  const entry = getMediaEntry(id);
  return entry ? entry.media : null;
}

export function getMediaEntry(id: string): TempStoreEntry | null {
  const entry = store.get(id);
  if (!entry) return null;

  const now = nowMs();
  if (isExpired(entry, now)) {
    store.delete(id);
    return null;
  }

  // Reading = active use (a download is streaming this resolution now), so
  // capacity eviction treats it as the most recent entry.
  entry.lastAccessAt = now;
  return entry;
}

/**
 * Explicit deletion hook (tests / admin tooling only). Request handlers must
 * never call this: resolutions expire by TTL, not by consumption.
 */
export function deleteMedia(id: string): boolean {
  return store.delete(id);
}

/** Remove ONLY entries whose TTL genuinely elapsed. Returns count removed. */
export function pruneExpired(): number {
  const now = nowMs();
  let removed = 0;
  for (const [key, entry] of store.entries()) {
    if (isExpired(entry, now)) {
      store.delete(key);
      removed++;
    }
  }
  return removed;
}

/** Number of live (non-expired) entries — used by tests/diagnostics. */
export function liveEntryCount(): number {
  pruneExpired();
  return store.size;
}

function evictLeastRecentlyUsed(): void {
  // Prefer an idle entry; never touch one accessed inside the active guard
  // window (it may be mid-download). If every entry is active, evict the
  // least-recently used anyway — the store is hard-capped.
  const now = nowMs();
  let victimKey: string | null = null;
  let victimAccess = Infinity;

  for (const [key, entry] of store.entries()) {
    const access = entry.lastAccessAt ?? entry.createdAt;
    const active = now - access < ACTIVE_GUARD_MS;
    if (!active && access < victimAccess) {
      victimAccess = access;
      victimKey = key;
    }
  }

  if (victimKey) {
    store.delete(victimKey);
    return;
  }

  // All entries are active: evict the least-recently used as a last resort.
  let oldestKey: string | null = null;
  let oldestTime = Infinity;
  for (const [key, entry] of store.entries()) {
    const access = entry.lastAccessAt ?? entry.createdAt;
    if (access < oldestTime) {
      oldestTime = access;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    store.delete(oldestKey);
  }
}
