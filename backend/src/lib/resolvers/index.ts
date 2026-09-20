import type { InstagramResolver, ResolverResult } from "../types.js";
import { createProvider } from "../providers/index.js";
import { getCachedResult, setCachedResult } from "../provider-cache.js";
import { logger } from "../logger.js";

let resolverInstance: InstagramResolver | null = null;
let lastProviderName: string | null = null;

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

export async function resolveUrl(url: string): Promise<ResolverResult> {
  const cached = getCachedResult(url);
  if (cached) {
    logger.info("Cache hit", { url: url.slice(0, 80) });
    return cached;
  }

  const resolver = getResolver();
  logger.info("Resolving via provider", {
    provider: resolver.name,
    url: url.slice(0, 80),
  });

  const result = await resolver.resolve(url);
  setCachedResult(url, result);

  return result;
}
