import type { InstagramResolver, ResolverResult, ResolveProgressCallback } from "../types.js";
import { createProvider } from "../providers/index.js";
import { getCachedResult, setCachedResult } from "../provider-cache.js";
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

export async function resolveUrl(url: string, onProgress?: ResolveProgressCallback): Promise<ResolverResult> {
  const cached = getCachedResult(url);
  if (cached) {
    logger.info("Cache hit", { url: url.slice(0, 80) });
    onProgress?.(90, "Cached result found");
    return cached;
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
    const result = await resolver.resolve(url, onProgress);
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
