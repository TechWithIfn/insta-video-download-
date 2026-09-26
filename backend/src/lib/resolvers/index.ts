import type { InstagramResolver, ResolverResult, ResolveProgressCallback, MediaItem } from "../types.js";
import { createProvider } from "../providers/index.js";
import { getCachedResult, setCachedResult, deleteCachedResult } from "../provider-cache.js";
import { enrichMediaItems } from "../media-enrich.js";
import { resolveAudioPage, isAudioPageUrl } from "../audio-resolve.js";
import { resolveStoryUrl, isStoryOrHighlightUrl } from "../story-resolve.js";
import { hashUrl } from "../crypto.js";
import { logger } from "../logger.js";
import { getGate } from "../capacity.js";
import { readBoundedInt } from "../env.js";
import { inc, observe } from "../metrics.js";

let resolverInstance: InstagramResolver | null = null;
let lastProviderName: string | null = null;

const inflight = new Map<string, Promise<ResolverResult>>();

/**
 * Hard bound on distinct in-flight resolutions. Coalescing already collapses
 * identical URLs; this caps the total so a flood of distinct URLs cannot build
 * an unbounded promise map (each entry pins a provider/browser slot).
 */
const MAX_INFLIGHT_RESOLUTIONS = readBoundedInt("MAX_INFLIGHT_RESOLUTIONS", 64, 1, 512);

function getResolver(): InstagramResolver {
  const currentProvider = process.env.RESOLVER_PROVIDER || "placeholder";
  if (!resolverInstance || currentProvider !== lastProviderName) {
    resolverInstance = createProvider();
    lastProviderName = currentProvider;
  }
  return resolverInstance;
}

export function resetResolver(): void {
  resolverInstance = null;
  lastProviderName = null;
}

/** Name of the currently active provider (for structured logging). */
export function getActiveProviderName(): string {
  return getResolver().name;
}

/**
 * Single normalized-type rule shared by all providers: a POST that resolved
 * to multiple media items is a carousel. Provider responses (and URL hints)
 * are unreliable here — /p/SHORTCODE/ covers both single photos and
 * carousels — so the real media count is the source of truth.
 */
export function normalizeResultType(result: ResolverResult): ResolverResult {
  if (result.type === "POST" && result.media.length > 1) {
    return { ...result, type: "CAROUSEL" };
  }
  return result;
}

/** Drop byte-identical URL duplicates (exact string match). */
export function dedupeExactUrls(items: MediaItem[]): MediaItem[] {
  const seen = new Set<string>();
  return items.filter((m) => {
    if (seen.has(m.url)) return false;
    seen.add(m.url);
    return true;
  });
}

function mediaScore(m: MediaItem): [number, number] {
  const w = typeof m.width === "number" ? m.width : 0;
  const h = typeof m.height === "number" ? m.height : 0;
  const size = typeof m.size === "number" ? m.size : 0;
  return [w * h, size];
}

/**
 * Collapse same-image renditions: Instagram serves every carousel image at
 * several resolutions (e.g. s640x640 + full 1440) under the same CDN path —
 * often even from different CDN hosts — with different query strings, and
 * page scrapes collect each rendition as a separate "slide". Grouping by
 * pathname (which embeds the unique media ID) keeps every unique image once,
 * preferring the largest rendition. Order of first appearance is preserved.
 * Never reorders unique images.
 */
export function dedupeMediaItems(items: MediaItem[]): MediaItem[] {
  const byKey = new Map<string, MediaItem>();
  const order: string[] = [];
  let unkeyed = 0;
  for (const item of items) {
    let key: string;
    try {
      key = new URL(item.url).pathname;
    } catch {
      key = `\0unkeyed-${unkeyed++}`;
    }
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      order.push(key);
      continue;
    }
    const [ea, es] = mediaScore(existing);
    const [ia, is] = mediaScore(item);
    if (ia > ea || (ia === ea && is > es)) {
      byKey.set(key, item);
    }
  }
  return order.map((k) => byKey.get(k) as MediaItem);
}

export interface ResolveOptions {
  /**
   * Skip the resolve cache read (used for expiry recovery: the cached CDN
   * URL is known-bad, so fresh provider data is required). The fresh result
   * is still stored, keeping the cache warm for subsequent requests.
   */
  bypassCache?: boolean;
  /**
   * Cancellation for provider work (client disconnect / shutdown). A queued
   * admission wait and a running browser operation both observe it.
   */
  signal?: AbortSignal;
}

/**
 * True when this exact URL is already being resolved, so a new caller will
 * join the existing in-flight work instead of starting a second provider
 * call. Used by per-client admission: joining an in-flight resolution costs
 * no extra browser page or provider slot, so it must not be throttled as if it
 * were new work.
 */
export function isResolutionInFlight(url: string): boolean {
  return inflight.has(hashUrl(url));
}

export async function resolveUrl(
  url: string,
  onProgress?: ResolveProgressCallback,
  opts?: ResolveOptions
): Promise<ResolverResult> {
  const signal = opts?.signal;
  const startedAt = Date.now();

  if (!opts?.bypassCache) {
    const lookupStart = Date.now();
    const cached = getCachedResult(url);
    if (cached) {
      logger.info("Cache hit", {
        url: url.slice(0, 80),
        cacheHit: true,
        lookupMs: Date.now() - lookupStart,
      });
      onProgress?.(90, "Cached result found");
      observe("resolve", Date.now() - startedAt);
      return cached;
    }
  } else {
    // A known-bad signed CDN URL: the cached copy is dropped so the fresh
    // provider result below replaces it instead of leaving a dead entry.
    deleteCachedResult(url);
    inc("cacheRefreshes");
  }

  const key = hashUrl(url);
  const existing = inflight.get(key);
  if (existing) {
    logger.info("Request coalesced", { url: url.slice(0, 80) });
    inc("coalescedResolutions");
    onProgress?.(30, "Joining active resolution");
    const result = await existing;
    onProgress?.(95, "Preparing result");
    observe("resolve", Date.now() - startedAt);
    return result;
  }

  if (inflight.size >= MAX_INFLIGHT_RESOLUTIONS) {
    // Refuse before creating another promise: a controlled 503 beats an
    // unbounded map of pending resolutions.
    logger.warn("Too many distinct in-flight resolutions", {
      inflight: inflight.size,
      limit: MAX_INFLIGHT_RESOLUTIONS,
    });
    const { createError } = await import("../errors.js");
    throw createError("CAPACITY_EXHAUSTED");
  }

  const providerGate = getGate("provider");

  const promise = (async () => {
    // Phase timings below feed the dev observability logs: provider network
    // latency vs local enrichment vs cache lookup, so a slow resolve can be
    // attributed instead of guessed.
    const resolveStart = Date.now();
    // Direct audio pages NEVER go through the post/reel resolver: they carry
    // no playable media of their own and need the dedicated audio lookup.
    if (isAudioPageUrl(url)) {
      logger.info("Resolving via dedicated audio lookup", { url: url.slice(0, 80) });
      const audio = await providerGate.run(() => resolveAudioPage(url, onProgress), { signal });
      const media = await enrichMediaItems(audio.media, { signal });
      const result: ResolverResult = { ...audio, media };
      logger.info("Audio resolve normalized", {
        type: result.type,
        finalCount: result.media.length,
        resolveMs: Date.now() - resolveStart,
        url: url.slice(0, 80),
      });
      setCachedResult(url, result);
      return result;
    }

    // Stories and Highlights use a dedicated API-based resolver that is
    // Vercel-compatible (pure fetch, no browser) and correctly handles
    // story-specific endpoints (reels_media) with optional session cookie.
    // This must run BEFORE the generic provider, which treats stories as
    // generic post pages and hits Instagram's login wall.
    // When the mock provider is active (tests/dev), let it handle stories
    // so deterministic mock data is preserved.
    const providerName = process.env.RESOLVER_PROVIDER || "placeholder";
    if (isStoryOrHighlightUrl(url) && providerName !== "mock") {
      logger.info("Resolving via dedicated story resolver", { url: url.slice(0, 80) });
      const storyResult = await providerGate.run(
        () => resolveStoryUrl(url, onProgress),
        { signal }
      );
      const normalized = normalizeResultType(storyResult);
      const unique = dedupeExactUrls(normalized.media);
      const enriched = await enrichMediaItems(unique, { signal });
      const media = dedupeMediaItems(enriched);
      const result: ResolverResult = { ...normalized, media };
      logger.info("Story resolve normalized", {
        type: result.type,
        discovered: normalized.media.length,
        exactDupesRemoved: normalized.media.length - unique.length,
        renditionsRemoved: unique.length - media.length,
        finalCount: media.length,
        resolveMs: Date.now() - resolveStart,
        url: url.slice(0, 80),
      });
      setCachedResult(url, result);
      return result;
    }

    const resolver = getResolver();
    logger.info("Resolving via provider", {
      provider: resolver.name,
      url: url.slice(0, 80),
    });
    onProgress?.(25, "Starting resolution");
    // The provider gate is the single choke point for expensive resolution
    // work (browser pages, upstream API calls). It bounds concurrency and
    // returns a controlled 503 when the queue window elapses.
    const raw = await providerGate.run(() => {
      const providerStart = Date.now();
      inc("providerResolutions");
      return resolver.resolve(url, onProgress).finally(() => {
        observe("provider", Date.now() - providerStart);
      });
    }, { signal });
    const normalized = normalizeResultType(raw);
    // Collapse exact duplicates before probing so the same bytes are never
    // fetched twice, then fill gaps the provider left (size/format/dims)
    // from the real media bytes, then collapse same-image renditions keeping
    // the largest copy. The final list is what gets cached.
    const unique = dedupeExactUrls(normalized.media);
    const enriched = await enrichMediaItems(unique, { signal });
    const media = dedupeMediaItems(enriched);
    const result: ResolverResult = { ...normalized, media };
    logger.info("Resolve normalized", {
      type: result.type,
      provider: resolver.name,
      discovered: normalized.media.length,
      exactDupesRemoved: normalized.media.length - unique.length,
      renditionsRemoved: unique.length - media.length,
      finalCount: media.length,
      resolveMs: Date.now() - resolveStart,
      url: url.slice(0, 80),
    });
    setCachedResult(url, result);
    return result;
  })();

  inflight.set(key, promise);
  try {
    const result = await promise;
    onProgress?.(95, "Preparing result");
    observe("resolve", Date.now() - startedAt);
    return result;
  } catch (err) {
    // A failure is never cached and the in-flight entry is removed below, so
    // one bad resolve cannot poison later requests for the same URL. Count it
    // so a rising provider failure rate is visible before users report it.
    inc("providerFailures");
    throw err;
  } finally {
    inflight.delete(key);
  }
}
