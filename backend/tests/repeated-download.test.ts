import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "http";
import type { ResolverResult } from "@/lib/types.js";

// Mock the provider factory: counted, controllable promises. Real
// resolveUrl (cache + in-flight dedup) and real routes stay under test.
vi.mock("@/lib/providers/index.js", () => ({
  createProvider: vi.fn(),
}));

import { createProvider } from "@/lib/providers/index.js";
import { resetResolver } from "@/lib/resolvers/index.js";
import resolveRouter from "@/routes/resolve.js";
import app from "@/app";

const mockCreateProvider = () => vi.mocked(createProvider);

const REEL_URL = "https://www.instagram.com/reel/RepeatMe123/";
const SOURCE = REEL_URL;

function videoItem(url: string) {
  return {
    url,
    type: "video" as const,
    width: 1080,
    height: 1920,
    duration: 12,
    size: 42000,
    thumbnail: null,
    format: "mp4",
  };
}

function reelResult(url: string): ResolverResult {
  return {
    type: "REEL",
    sourceUrl: SOURCE,
    thumbnail: null,
    title: null,
    author: { username: "someone", displayName: null },
    media: [videoItem(url)],
  };
}

function carouselResult(urls: string[]): ResolverResult {
  return {
    type: "CAROUSEL",
    sourceUrl: SOURCE,
    thumbnail: null,
    title: null,
    author: null,
    media: urls.map((u) => ({ ...videoItem(u) })),
  };
}

function startServer(handler: express.Express): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = handler.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
}

/**
 * Stub upstream CDN fetches while letting the test client's own HTTP calls
 * to the local test server pass through. (A blanket fetch stub would
 * intercept the test's own requests and the route would never execute.)
 */
function stubUpstreamFetch(
  upstreamImpl: (input: string) => Promise<Response>
): ReturnType<typeof vi.fn> {
  const realFetch = globalThis.fetch.bind(globalThis);
  const handler = vi.fn(async (input: unknown, init?: unknown) => {
    const url = String(input);
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) {
      return realFetch(input as string, init as RequestInit);
    }
    return upstreamImpl(url);
  });
  vi.stubGlobal("fetch", handler as never);
  return handler;
}

describe("repeated download + resolve (bug matrix)", () => {
  beforeEach(() => {
    // Drop the resolver singleton so each test's mocked provider takes
    // effect (production keeps the singleton; this is test isolation only).
    resetResolver();
    mockCreateProvider().mockReset();
    vi.unstubAllGlobals();
    delete process.env.RESOLVER_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESOLVER_TIMEOUT_MS;
  });

  it("Test D: 5 rapid downloads of the same resolved URL all succeed (non-consuming)", async () => {
    const MEDIA = "https://scontent-iad3-2.xx.fbcdn.net/v/repeat.mp4?sig=abc";
    const mockFetch = stubUpstreamFetch(
      async () =>
        new Response("media-bytes", {
          status: 200,
          headers: { "content-type": "video/mp4", "content-length": "11" },
        })
    );
    let upstreamCalls = 0;
    const { server, base } = await startServer(app);
    try {
      for (let i = 1; i <= 5; i++) {
        const res = await fetch(
          `${base}/api/download?url=${encodeURIComponent(MEDIA)}&filename=test.mp4&source=${encodeURIComponent(SOURCE)}`
        );
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("video/mp4");
        expect(res.headers.get("content-disposition")).toContain('filename="test.mp4"');
        expect(await res.text()).toBe("media-bytes");
      }
      upstreamCalls = mockFetch.mock.calls.filter(
        ([input]) => !String(input).startsWith(`http://127.0.0.1:`)
      ).length;
      // Exactly one upstream fetch per download: no consumption, no extra
      // re-resolution while the URL is healthy.
      expect(upstreamCalls).toBe(5);
    } finally {
      await closeServer(server);
    }
  });

  it("Test C: 3 simultaneous resolves for the same URL trigger ONE provider call", async () => {
    let providerCalls = 0;
    let release!: (r: ResolverResult) => void;
    const gate = new Promise<ResolverResult>((resolve) => {
      release = resolve;
    });
    mockCreateProvider().mockReturnValue({
      name: "test-mock",
      resolve: async () => {
        providerCalls++;
        return gate;
      },
    } as never);

    const mini = express();
    mini.use(express.json({ limit: "1kb" }));
    mini.use("/api/resolve", resolveRouter);
    const { server, base } = await startServer(mini);
    try {
      const payload = { url: REEL_URL };
      const pending = [1, 2, 3].map(() =>
        fetch(`${base}/api/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      );
      // Let all three requests arrive while the provider is still working.
      await new Promise((r) => setTimeout(r, 150));
      release(reelResult("https://scontent-iad3-2.xx.fbcdn.net/v/one.mp4?sig=1"));
      const responses = await Promise.all(pending);
      for (const res of responses) expect(res.status).toBe(200);
      const bodies = (await Promise.all(responses.map((r) => r.json()))) as Array<{
        success: boolean;
        data: { media: Array<{ url: string }> };
      }>;
      for (const b of bodies) {
        expect(b.success).toBe(true);
        expect(b.data.media[0].url).toBe("https://scontent-iad3-2.xx.fbcdn.net/v/one.mp4?sig=1");
      }
      expect(providerCalls).toBe(1);
    } finally {
      await closeServer(server);
    }
  });

  it("Test B: same URL re-resolves from cache without a second provider call", async () => {
    mockCreateProvider().mockReturnValue({
      name: "test-mock",
      resolve: async (url: string) => reelResult("https://scontent-iad3-2.xx.fbcdn.net/v/cached.mp4?sig=1"),
    } as never);

    const mini = express();
    mini.use(express.json({ limit: "1kb" }));
    mini.use("/api/resolve", resolveRouter);
    const { server, base } = await startServer(mini);
    try {
      const post = () =>
        fetch(`${base}/api/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: REEL_URL }),
        });
      const first = await post();
      expect(first.status).toBe(200);
      const second = await post();
      expect(second.status).toBe(200);
      expect(mockCreateProvider()).toHaveBeenCalledTimes(1);
      const body = (await second.json()) as { success: boolean };
      expect(body.success).toBe(true);
    } finally {
      await closeServer(server);
    }
  });

  it("Test F: expired slide-N URL refreshes to slide N, not slide 1", async () => {
    const { fetchUpstreamMediaResilient } = await import("@/lib/media-proxy.js");

    const STALE_SLIDE_2 = "https://scontent-iad3-2.xx.fbcdn.net/v/slide2.mp4?sig=old";
    const FRESH = [
      "https://scontent-iad3-2.xx.fbcdn.net/v/slide1.mp4?sig=new",
      "https://scontent-iad3-2.xx.fbcdn.net/v/slide2.mp4?sig=new",
      "https://scontent-iad3-2.xx.fbcdn.net/v/slide3.mp4?sig=new",
    ];
    // Full-metadata items skip enrichment probes; the mocked provider
    // supplies the fresh carousel through the real resolveUrl path.
    mockCreateProvider().mockReturnValue({
      name: "test-mock",
      resolve: async () => carouselResult(FRESH),
    } as never);

    const fetchedUrls: string[] = [];
    const mockFetch = vi.fn(async (input: unknown) => {
      fetchedUrls.push(String(input));
      if (fetchedUrls.length === 1) return new Response("expired", { status: 403 });
      return new Response("slide2-bytes", { status: 200, headers: { "content-type": "video/mp4" } });
    });
    vi.stubGlobal("fetch", mockFetch as never);

    const result = await fetchUpstreamMediaResilient(STALE_SLIDE_2, {
      timeoutMs: 5000,
      tag: "TEST",
      requestId: "test-slide-refresh",
      sourceUrl: SOURCE,
    });

    expect(result.refreshed).toBe(true);
    expect(result.status.kind).toBe("ok");
    // The retry must target the SAME slide (slide 2), never slide 1.
    expect(fetchedUrls[1]).toBe(FRESH[1]);
  });

  it("failed resolution is never cached: reject once, then succeed on retry", async () => {
    const { resolveUrl } = await import("@/lib/resolvers/index.js");
    const url = "https://www.instagram.com/reel/FailThenRetry1/";
    mockCreateProvider().mockReturnValue({
      name: "test-mock",
      resolve: vi
        .fn<(...args: unknown[]) => Promise<ResolverResult>>()
        .mockRejectedValueOnce(new Error("transient provider blowup"))
        .mockResolvedValue(reelResult("https://scontent-iad3-2.xx.fbcdn.net/v/retry.mp4?sig=1")),
    } as never);

    await expect(resolveUrl(url)).rejects.toThrow("transient provider blowup");
    const result = await resolveUrl(url);
    expect(result.media[0].url).toBe("https://scontent-iad3-2.xx.fbcdn.net/v/retry.mp4?sig=1");
    // And the success is now cached: no further provider calls.
    const again = await resolveUrl(url);
    expect(again.media[0].url).toBe("https://scontent-iad3-2.xx.fbcdn.net/v/retry.mp4?sig=1");
  });

  it("transient network error is retried once, then succeeds", async () => {
    const { fetchUpstreamMedia } = await import("@/lib/media-proxy.js");
    const mockFetch = vi
      .fn<(...args: unknown[]) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("bytes", { status: 200, headers: { "content-type": "video/mp4" } }));
    vi.stubGlobal("fetch", mockFetch as never);

    const status = await fetchUpstreamMedia("https://scontent-iad3-2.xx.fbcdn.net/v/x.mp4?sig=1", {
      timeoutMs: 5000,
      tag: "TEST",
      requestId: "retry-once",
    });
    expect(status.kind).toBe("ok");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("persistent network error stops after exactly 2 attempts", async () => {
    const { fetchUpstreamMedia } = await import("@/lib/media-proxy.js");
    const mockFetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", mockFetch as never);

    const status = await fetchUpstreamMedia("https://scontent-iad3-2.xx.fbcdn.net/v/y.mp4?sig=1", {
      timeoutMs: 5000,
      tag: "TEST",
      requestId: "retry-twice",
    });
    expect(status.kind).toBe("network-error");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("timeout is never retried (budget already spent)", async () => {
    const { fetchUpstreamMedia } = await import("@/lib/media-proxy.js");
    const mockFetch = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    vi.stubGlobal("fetch", mockFetch as never);

    const status = await fetchUpstreamMedia("https://scontent-iad3-2.xx.fbcdn.net/v/z.mp4?sig=1", {
      timeoutMs: 5000,
      tag: "TEST",
      requestId: "no-retry-timeout",
    });
    expect(status.kind).toBe("timeout");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("persistent provider 503 on download maps to retryable 502, never a masked 500", async () => {
    const MEDIA = "https://scontent-iad3-2.xx.fbcdn.net/v/sick.mp4?sig=1";
    const mockFetch = stubUpstreamFetch(async () => new Response("bad gateway", { status: 503 }));
    // Refresh path re-resolves but gets the same sick URL back.
    mockCreateProvider().mockReturnValue({
      name: "test-mock",
      resolve: async () => reelResult(MEDIA),
    } as never);
    const { server, base } = await startServer(app);
    try {
      const res = await fetch(
        `${base}/api/download?url=${encodeURIComponent(MEDIA)}&filename=test.mp4&source=${encodeURIComponent(SOURCE)}`
      );
      expect(res.status).toBe(502);
      const body = (await res.json()) as { success: boolean; error: { code: string; retryable: boolean } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("MEDIA_DOWNLOAD_FAILED");
      expect(body.error.retryable).toBe(true);
    } finally {
      await closeServer(server);
    }
  });

  it("Test I: hung provider yields 504 fast and the URL is retryable immediately after settle", async () => {
    process.env.RESOLVER_TIMEOUT_MS = "300";
    let release!: (r: ResolverResult) => void;
    const gate = new Promise<ResolverResult>((resolve) => {
      release = resolve;
    });
    mockCreateProvider().mockReturnValue({
      name: "test-mock",
      resolve: () => gate,
    } as never);

    const mini = express();
    mini.use(express.json({ limit: "1kb" }));
    mini.use("/api/resolve", resolveRouter);
    const { server, base } = await startServer(mini);
    try {
      const post = () =>
        fetch(`${base}/api/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: "https://www.instagram.com/reel/SlowHang999/" }),
        });
      const t0 = Date.now();
      const timedOut = await post();
      const elapsed = Date.now() - t0;
      expect(timedOut.status).toBe(504);
      expect(elapsed).toBeLessThan(5000);
      const errBody = (await timedOut.json()) as { success: boolean; error: { code: string } };
      expect(errBody.success).toBe(false);
      expect(errBody.error.code).toBe("RESOLVER_TIMEOUT");

      // Provider finishes late: cache warms, immediate retry succeeds fast.
      release(reelResult("https://scontent-iad3-2.xx.fbcdn.net/v/late.mp4?sig=1"));
      await new Promise((r) => setTimeout(r, 100));
      const retry = await post();
      expect(retry.status).toBe(200);
      const okBody = (await retry.json()) as { success: boolean };
      expect(okBody.success).toBe(true);
    } finally {
      await closeServer(server);
    }
  }, 15000);
});
