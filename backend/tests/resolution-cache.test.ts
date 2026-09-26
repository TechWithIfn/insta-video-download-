import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ResolverResult } from "@/lib/types";

/**
 * The resolution cache + in-flight dedup are the two things that keep 100
 * simultaneous requests for one URL from becoming 100 browser launches. These
 * tests pin the contract that makes that safe:
 *
 *  - a cache hit costs zero provider work;
 *  - an expired entry is a miss (never a stale signed CDN URL handed out);
 *  - concurrent requests for the same URL produce ONE provider call;
 *  - a FAILED resolution is neither cached nor left in the in-flight map, so
 *    every waiter gets the same controlled error and it cannot poison later
 *    requests;
 *  - an explicit refresh (expired CDN signature) replaces the entry.
 *
 * The cache is module-level, so each test uses its OWN URL: sharing one URL
 * would let a previous test's entry satisfy the next test's lookup.
 */
vi.mock("@/lib/providers/index.js", () => ({
  createProvider: vi.fn(),
}));

import { createProvider } from "@/lib/providers/index.js";
import { resetMetricsForTests, metricsSnapshot } from "@/lib/metrics";
import { isMediaBearingApiUrl, isUnnecessaryResource } from "@/lib/providers/puppeteer";

function result(url: string, sig = 1): ResolverResult {
  return {
    type: "REEL",
    sourceUrl: url,
    thumbnail: null,
    title: null,
    author: { username: "someone", displayName: null },
    media: [
      {
        url: `https://scontent-iad3-2.xx.fbcdn.net/v/x.mp4?sig=${sig}`,
        type: "video",
        width: 1080,
        height: 1920,
        duration: 10,
        size: 1000,
        thumbnail: null,
        format: "mp4",
      },
    ],
  };
}

function mockProvider(impl: (url: string) => Promise<ResolverResult>) {
  const provider = { name: "mock", resolve: vi.fn(impl) };
  vi.mocked(createProvider).mockReturnValue(provider as never);
  return provider;
}

describe("resolution cache + in-flight dedup", () => {
  beforeEach(() => {
    resetMetricsForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("serves a second identical request from cache with no provider work", async () => {
    const url = "https://www.instagram.com/reel/CacheHit01/";
    const provider = mockProvider(async (u) => result(u));
    const { resolveUrl } = await import("@/lib/resolvers/index.js");

    const first = await resolveUrl(url);
    const second = await resolveUrl(url);

    expect(provider.resolve).toHaveBeenCalledTimes(1);
    expect(second.sourceUrl).toBe(first.sourceUrl);
    const m = metricsSnapshot();
    expect(m.counters.cacheHits).toBeGreaterThanOrEqual(1);
    expect(m.counters.providerResolutions).toBe(1);
  });

  it("treats an expired entry as a miss and re-resolves", async () => {
    const url = "https://www.instagram.com/reel/CacheTtl01/";
    vi.stubEnv("RESOLVE_CACHE_TTL_MS", "1000");
    // Fresh module graph so the 1s TTL is actually the one under test.
    vi.resetModules();
    const { resolveUrl } = await import("@/lib/resolvers/index.js");
    const { getCachedResult } = await import("@/lib/provider-cache.js");
    const provider = mockProvider(async (u) => result(u));

    await resolveUrl(url);
    expect(provider.resolve).toHaveBeenCalledTimes(1);
    expect(getCachedResult(url)).not.toBeNull();

    await new Promise((r) => setTimeout(r, 1100));

    // Expired: a miss, never a stale signed CDN URL handed back to a client.
    expect(getCachedResult(url)).toBeNull();
    await resolveUrl(url);
    expect(provider.resolve).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent identical resolutions into one provider call", async () => {
    const url = "https://www.instagram.com/reel/Coalesce01/";
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = mockProvider(async (u) => {
      await gate;
      return result(u);
    });
    const { resolveUrl } = await import("@/lib/resolvers/index.js");

    const many = Array.from({ length: 25 }, () => resolveUrl(url));
    // Let all 25 callers register before the work is allowed to finish.
    await new Promise((r) => setTimeout(r, 25));
    release?.();
    const settled = await Promise.all(many);

    // 25 users, 1 provider call: this is the "no 100 Puppeteer launches" rule.
    expect(provider.resolve).toHaveBeenCalledTimes(1);
    for (const r of settled) expect(r.sourceUrl).toBe(url);
  });

  it("does not cache a failure and does not poison the next request", async () => {
    const url = "https://www.instagram.com/reel/Poison01/";
    let attempt = 0;
    const provider = mockProvider(async (u) => {
      attempt += 1;
      if (attempt === 1) throw new Error("provider exploded");
      return result(u);
    });
    const { resolveUrl } = await import("@/lib/resolvers/index.js");
    const { getCachedResult } = await import("@/lib/provider-cache.js");

    // Every concurrent waiter receives the same controlled failure: no hang,
    // no partial result, no cached error.
    const waiters = [resolveUrl(url), resolveUrl(url), resolveUrl(url)];
    const settled = await Promise.allSettled(waiters);
    for (const s of settled) expect(s.status).toBe("rejected");

    // Nothing was cached, and the in-flight entry was cleared, so a retry
    // really does reach the provider again.
    expect(getCachedResult(url)).toBeNull();
    const recovered = await resolveUrl(url);
    expect(recovered.sourceUrl).toBe(url);
    expect(provider.resolve).toHaveBeenCalledTimes(2);
  });

  it("refresh replaces the cached entry instead of leaving the stale one", async () => {
    const url = "https://www.instagram.com/reel/Refresh01/";
    let generation = 0;
    const provider = mockProvider(async (u) => {
      generation += 1;
      return result(u, generation);
    });
    const { resolveUrl } = await import("@/lib/resolvers/index.js");

    const first = await resolveUrl(url);
    expect(first.media[0].url).toContain("sig=1");

    const refreshed = await resolveUrl(url, undefined, { bypassCache: true });
    expect(refreshed.media[0].url).toContain("sig=2");

    // The fresh result is what the cache now serves.
    const after = await resolveUrl(url);
    expect(after.media[0].url).toContain("sig=2");
    expect(provider.resolve).toHaveBeenCalledTimes(2);
  });

  it("a deleted entry forces the next resolve to call the provider", async () => {
    const url = "https://www.instagram.com/reel/Deleted01/";
    const provider = mockProvider(async (u) => result(u));
    const { resolveUrl } = await import("@/lib/resolvers/index.js");
    const { getCachedResult, deleteCachedResult } = await import("@/lib/provider-cache.js");

    await resolveUrl(url);
    expect(getCachedResult(url)).not.toBeNull();
    deleteCachedResult(url);
    expect(getCachedResult(url)).toBeNull();
    await resolveUrl(url);
    expect(provider.resolve).toHaveBeenCalledTimes(2);
  });

  it("evicts instead of growing without bound", async () => {
    vi.stubEnv("RESOLVE_CACHE_MAX_ENTRIES", "10");
    vi.resetModules();
    const { setCachedResult, getCachedResult } = await import("@/lib/provider-cache.js");
    for (let i = 0; i < 50; i++) {
      setCachedResult(`https://www.instagram.com/reel/Bulk${i}/`, result("x"));
    }
    // Eviction, not unbounded growth: the newest entry survives, the oldest is
    // gone.
    expect(getCachedResult("https://www.instagram.com/reel/Bulk49/")).not.toBeNull();
    expect(getCachedResult("https://www.instagram.com/reel/Bulk0/")).toBeNull();
  });
});

describe("browser request filtering (blocks noise, never media)", () => {
  it("blocks third-party analytics, tracking, fonts and stylesheets", () => {
    for (const url of [
      "https://www.googletagmanager.com/gtm.js?id=GTM-ABC",
      "https://www.google-analytics.com/analytics.js",
      "https://connect.facebook.net/en_US/fbevents.js",
      "https://doubleclick.net/ads.js",
    ]) {
      expect(isUnnecessaryResource(url, "script")).toBe(true);
    }
    expect(isUnnecessaryResource("https://fonts.gstatic.com/s/inter.woff2", "font")).toBe(true);
    expect(isUnnecessaryResource("https://x.test/a.css", "stylesheet")).toBe(true);
  });

  it("never blocks a media or media-metadata host, whatever the path", () => {
    // Blocking any of these would break extraction: the CDN bytes and the
    // <video> element response are primary signals. This is the guard rail on
    // the blocking filter itself.
    for (const url of [
      "https://scontent.cdninstagram.com/v/abc.mp4?sig=1",
      "https://scontent-iad3-2.xx.fbcdn.net/v/abc.jpg?stp=dst-jpg",
      "https://www.instagram.com/api/graphql",
      "https://i.instagram.com/graphql",
      "https://www.instagram.com/static_resources/fonts/Inter.woff2",
    ]) {
      expect(isUnnecessaryResource(url, "xhr")).toBe(false);
    }
  });

  it("only inspects JSON from Instagram's own API surfaces", () => {
    expect(isMediaBearingApiUrl("https://www.instagram.com/api/v1/media/1/")).toBe(true);
    expect(isMediaBearingApiUrl("https://www.instagram.com/graphql/query/")).toBe(true);
    expect(isMediaBearingApiUrl("https://i.instagram.com/api/graphql")).toBe(true);
    // Not media-bearing: buffering these was pure overhead on every resolve.
    expect(isMediaBearingApiUrl("https://www.instagram.com/manifest.json")).toBe(false);
    expect(isMediaBearingApiUrl("https://static.instagram.com/assets/feature.json")).toBe(false);
    // Non-Instagram and non-HTTPS sources are never inspected.
    expect(isMediaBearingApiUrl("https://evil.example.com/api/v1/media")).toBe(false);
    expect(isMediaBearingApiUrl("http://www.instagram.com/api/v1/media/1/")).toBe(false);
    expect(isMediaBearingApiUrl("not-a-url")).toBe(false);
  });
});
