import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "http";
import type { ResolverResult } from "@/lib/types";

// Mock the provider factory so the resolver stays in flight for as long as the
// test needs. Real resolveUrl (cache + in-flight dedup), real routes, real
// capacity gates and the real per-client limiter stay under test.
vi.mock("@/lib/providers/index.js", () => ({
  createProvider: vi.fn(),
}));

import { createProvider } from "@/lib/providers/index.js";

const REEL_A = "https://www.instagram.com/reel/CoalesceAAA/";
const REEL_B = "https://www.instagram.com/reel/CoalesceBBB/";

function reelResult(url: string): ResolverResult {
  return {
    type: "REEL",
    sourceUrl: url,
    thumbnail: null,
    title: null,
    author: { username: "someone", displayName: null },
    media: [
      {
        url: "https://scontent-iad3-2.xx.fbcdn.net/v/a.mp4?sig=1",
        type: "video",
        width: 1080,
        height: 1920,
        duration: 12,
        size: 42000,
        thumbnail: null,
        format: "mp4",
      },
    ],
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

/** Read a few SSE bytes so we know the stream got past admission. */
async function readSseHead(url: string): Promise<string> {
  const controller = new AbortController();
  const res = await fetch(url, { signal: controller.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !acc.includes("Link validated")) {
    const { value, done } = await reader.read();
    if (done) break;
    acc += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  controller.abort();
  return acc;
}

describe("per-client resolve capacity vs in-flight coalescing", () => {
  let server: Server | undefined;
  let base = "";
  let releaseWork: (() => void) | undefined;

  beforeEach(() => {
    releaseWork = undefined;
  });

  afterEach(async () => {
    releaseWork?.();
    if (server) {
      await closeServer(server);
      server = undefined;
    }
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("lets a duplicate URL join without spending another per-client slot, while a different URL is still capped", async () => {
    vi.stubEnv("MAX_CONCURRENT_RESOLVES_PER_IP", "1");
    vi.stubEnv("RATE_LIMIT_MAX_REQUESTS", "500");
    vi.resetModules();

    // The first URL stays in flight for the whole test (held open by the
    // test); any other URL resolves immediately so the tail of the test is
    // fast and deterministic.
    let firstHeld: Promise<ResolverResult> | null = null;
    const provider = {
      name: "mock",
      resolve: vi.fn((url: string) => {
        if (url !== REEL_A) return Promise.resolve(reelResult(url));
        if (!firstHeld) {
          firstHeld = new Promise<ResolverResult>((resolve) => {
            releaseWork = () => resolve(reelResult(url));
          });
        }
        return firstHeld as Promise<ResolverResult>;
      }),
    };
    vi.mocked(createProvider).mockReturnValue(provider as never);

    const { default: app } = await import("@/app");
    const started = await startServer(app);
    server = started.server;
    base = started.base;

    // 1) The single per-client slot is taken by a fresh resolution.
    const first = fetch(`${base}/api/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: REEL_A }),
    });

    // Wait until the provider is actually working, so the slot is held.
    const deadline = Date.now() + 5000;
    while (provider.resolve.mock.calls.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(provider.resolve).toHaveBeenCalledTimes(1);

    // 2) A second request for the SAME url must be admitted (it joins the
    //    in-flight work and costs no extra provider/browser capacity).
    const duplicate = await readSseHead(`${base}/api/resolve/stream?url=${encodeURIComponent(REEL_A)}`);
    expect(duplicate).toContain("Link validated");
    expect(duplicate).not.toContain("CAPACITY_EXHAUSTED");

    // 3) A DIFFERENT url from the same client must still be refused: the one
    //    slot is in use.
    const other = await fetch(`${base}/api/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: REEL_B }),
    });
    expect(other.status).toBe(503);
    expect(other.headers.get("retry-after")).toBeTruthy();
    const body = (await other.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("CAPACITY_EXHAUSTED");
    // ...and it never reached the provider.
    expect(provider.resolve).toHaveBeenCalledTimes(1);

    // 4) Once the shared work settles, the slot is free again.
    releaseWork?.();
    const settled = await first;
    expect(settled.status).toBe(200);
    const followUp = await fetch(`${base}/api/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: REEL_B }),
    });
    await followUp.text();
    expect(followUp.status).toBe(200);
  }, 20_000);
});
