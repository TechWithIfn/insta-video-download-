import type { MediaItem, TempStoreEntry, InstagramContentType } from "./types.js";

const store = new Map<string, TempStoreEntry>();

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 1000;

export function storeMedia(
  id: string,
  media: MediaItem[],
  type?: InstagramContentType
): void {
  if (store.size >= MAX_ENTRIES) {
    evictOldest();
  }

  store.set(id, {
    id,
    media,
    type,
    createdAt: Date.now(),
  });
}

export function getMedia(id: string): MediaItem[] | null {
  const entry = store.get(id);
  if (!entry) return null;

  if (Date.now() - entry.createdAt > TTL_MS) {
    store.delete(id);
    return null;
  }

  return entry.media;
}

export function getMediaEntry(id: string): TempStoreEntry | null {
  const entry = store.get(id);
  if (!entry) return null;

  if (Date.now() - entry.createdAt > TTL_MS) {
    store.delete(id);
    return null;
  }

  return entry;
}

export function deleteMedia(id: string): boolean {
  return store.delete(id);
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
