import type { InstagramResolver, ResolverResult, ResolveProgressCallback } from "../types.js";
import { createProvider } from "../providers/index.js";
import { getCachedResult, setCachedResult, deleteCachedResult } from "../provider-cache.js";
import { hashUrl } from "../crypto.js";
import { logger } from "../logger.js";

let resolverInstance: InstagramResolver | null = null;
let lastProviderName: string | null = null;

const inflight = new Map<string, Promise<ResolverResult>>();

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

export interface ResolveOptions {
  /**
   * Skip the resolve cache read (used for expiry recovery: the cached CDN
   * URL is known-bad, so fresh provider data is required). The fresh result
   * is still stored, keeping the cache warm for subsequent requests.
   */
  bypassCache?: boolean;
}

export async function resolveUrl(
  url: string,
  onProgress?: ResolveProgressCallback,
  opts?: ResolveOptions
): Promise<ResolverResult> {
  if (!opts?.bypassCache) {
    const cached = getCachedResult(url);
    if (cached) {
      logger.info("Cache hit", { url: url.slice(0, 80) });
      onProgress?.(90, "Cached result found");
      return cached;
    }
  } else {
    deleteCachedResult(url);
  }

  const key = hashUrl(url);
  const existing = inflight.get(key);
  if (existing) {
    logger.info("Request coalesced", { url: url.slice(0, 80) });
    onProgress?.(30, "Joining active resolution");
    const result = await existing;
    onProgress?.(95, "Preparing result");
    return result;
  }

  const promise = (async () => {
    const resolver = getResolver();
    logger.info("Resolving via provider", {
      provider: resolver.name,
      url: url.slice(0, 80),
    });
    onProgress?.(25, "Starting resolution");
    const raw = await resolver.resolve(url, onProgress);
    const result = normalizeResultType(raw);
    setCachedResult(url, result);
    return result;
  })();

  inflight.set(key, promise);
  try {
    const result = await promise;
    onProgress?.(95, "Preparing result");
    return result;
  } finally {
    inflight.delete(key);
  }
}
