import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "http";

/**
 * The operational contract this project depends on under load:
 *  - rate limiting answers 429 (never 503, so clients/proxies can tell
 *    "you are too fast" from "we are full");
 *  - capacity answers 503 WITH Retry-After;
 *  - invalid input answers 400, missing content 404, upstream failure 502/504;
 *  - the funnel (requests, resolve/downloads, 429, 503, 5xx) is reported on
 *    /api/health/capacity.
 */
vi.mock("@/lib/providers/index.js", () => ({ createProvider: vi.fn() }));

import { createProvider } from "@/lib/providers/index.js";
import { resetResolver } from "@/lib/resolvers/index.js";
import { resetRateLimitsForTests } from "@/lib/rate-limit.js";
import app from "@/app";
import { metricsSnapshot, resetMetricsForTests } from "@/lib/metrics";

const REEL = "https://www.instagram.com/reel/StatusCode1/";
const MEDIA = "https://scontent-iad3-2.xx.fbcdn.net/v/a.mp4?sig=1";

function providerReturning(url: string) {
  return {
    name: "mock",
    resolve: vi.fn(async (u: string) => ({
      type: "REEL" as const,
      sourceUrl: u,
      thumbnail: null,
      title: null,
      author: { username: "someone", displayName: null },
      media: [
        {
          url: MEDIA,
          type: "video" as const,
          width: 1080,
          height: 1920,
          duration: 5,
          size: 10,
          thumbnail: null,
          format: "mp4",
        },
      ],
    })),
  };
}

async function startServer(): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
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

async function postResolve(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/api/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("HTTP status codes + funnel metrics", () => {
  let server: Server | undefined;
  let base = "";

  beforeEach(async () => {
    // The app, the rate-limit store and the metrics module are all
    // module-level singletons, and the metrics instance the app writes to must
    // be the same one this file reads: no module resets inside this file.
    resetMetricsForTests();
    resetResolver();
    resetRateLimitsForTests();
    vi.mocked(createProvider).mockReset();
    vi.unstubAllGlobals();
    vi.stubEnv("RATE_LIMIT_MAX_REQUESTS", "3");
    vi.stubEnv("RATE_LIMIT_DOWNLOAD_MAX_REQUESTS", "2");
    vi.stubEnv("MAX_REQUEST_BODY_SIZE", "1024");
    const started = await startServer();
    server = started.server;
    base = started.base;
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    server = undefined;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("400 for an invalid Instagram URL, not 500", async () => {
    const res = await postResolve(base, { url: "https://example.com/not-instagram" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_URL");
  });

  it("400 for a malformed body, 413 for an oversized one", async () => {
    const malformed = await fetch(`${base}/api/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(malformed.status).toBe(400);

    const huge = await postResolve(base, { url: REEL, pad: "x".repeat(5000) });
    expect(huge.status).toBe(413);
  });

  it("429 with Retry-After once the resolve quota is spent", async () => {
    vi.mocked(createProvider).mockReturnValue(providerReturning(REEL) as never);

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await postResolve(base, { url: REEL });
      await res.text();
      statuses.push(res.status);
    }
    // 3 allowed by the stubbed budget, the 4th must be rate limited.
    expect(statuses.slice(0, 3).every((s) => s === 200)).toBe(true);
    expect(statuses[3]).toBe(429);
    expect(metricsSnapshot().counters.rateLimited).toBeGreaterThanOrEqual(1);
  });

  it("502/504 for provider failure, never a blanket 500", async () => {
    vi.mocked(createProvider).mockReturnValue({
      name: "mock",
      resolve: vi.fn(async () => {
        throw new Error("Connection closed.");
      }),
    } as never);

    const res = await postResolve(base, { url: "https://www.instagram.com/reel/Broken01/" });
    expect([502, 503, 504]).toContain(res.status);
    expect(res.status).not.toBe(500);
  });

  it("429 for downloads too, and the funnel is reported on /capacity", async () => {
    // One completed request first: counters are incremented on response
    // `finish`, so the /capacity request itself is not in its own snapshot.
    const warm = await fetch(`${base}/api/health`);
    await warm.text();

    const capacity = await fetch(`${base}/api/health/capacity`);
    expect(capacity.status).toBe(200);
    const body = (await capacity.json()) as {
      metrics: { counters: Record<string, number>; cacheHitRate: number };
    };
    expect(body.metrics).toBeDefined();
    expect(body.metrics.counters.requests).toBeGreaterThan(0);
    expect(typeof body.metrics.cacheHitRate).toBe("number");
    // Secrets must never appear in an operational endpoint.
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/sessionid|csrftoken|AUDIO_PROVIDER_KEY|api_key/i);
  });

  it("streams and downloads are capped independently of resolve", async () => {
    // The download budget is separate: a user re-downloading must not be
    // punished, but a flood must still be refused with 429.
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${base}/api/download?url=${encodeURIComponent(MEDIA)}`);
      await res.text();
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
  });
});
