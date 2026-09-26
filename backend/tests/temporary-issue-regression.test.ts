import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "http";
import type { ResolverResult } from "@/lib/types.js";

// Mock the provider factory: controllable errors/results per test. Real
// resolveUrl (cache + in-flight dedup), real routes and real media proxy
// stay under test.
vi.mock("@/lib/providers/index.js", () => ({
  createProvider: vi.fn(),
}));

import { createProvider } from "@/lib/providers/index.js";
import { resetResolver } from "@/lib/resolvers/index.js";
import resolveRouter from "@/routes/resolve.js";
import app from "@/app";
import {
  createError,
  toAppError,
  toMediaAppError,
  isConnectionLostError,
} from "@/lib/errors.js";

const mockCreateProvider = () => vi.mocked(createProvider);

const GENERIC = "A temporary issue occurred. Please try again shortly.";

const MEDIA = "https://scontent-iad3-2.xx.fbcdn.net/v/root.mp4?sig=1";
const SOURCE = "https://www.instagram.com/reel/RootCause1/";

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

/** Puppeteer's real failure shape: Error with name + a `code` property. */
function staleBrowserError(): Error {
  const err = new Error("Connection closed.") as Error & { code?: number };
  err.name = "ConnectionClosedError";
  err.code = -32000;
  return err;
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

function stubUpstreamFetch(
  impl: (input: string, init?: RequestInit) => Promise<Response>
): ReturnType<typeof vi.fn> {
  const realFetch = globalThis.fetch.bind(globalThis);
  const handler = vi.fn(async (input: unknown, init?: unknown) => {
    const url = String(input);
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) {
      return realFetch(input as string, init as RequestInit);
    }
    return impl(url, init as RequestInit);
  });
  vi.stubGlobal("fetch", handler as never);
  return handler;
}

async function readSseUntilError(url: string): Promise<string> {
  const res = await fetch(url);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    acc += decoder.decode(value, { stream: true });
    if (acc.includes("event: error")) break;
  }
  await reader.cancel().catch(() => {});
  return acc;
}

const ALL_ROUTE_ENV = [
  "RATE_LIMIT_MAX_REQUESTS",
  "RATE_LIMIT_DOWNLOAD_MAX_REQUESTS",
  "RATE_LIMIT_STREAM_MAX_REQUESTS",
  "RATE_LIMIT_AUDIO_MAX_REQUESTS",
];

describe("root cause: generic TEMPORARY_ERROR must not mask known failures", () => {
  beforeEach(() => {
    resetResolver();
    mockCreateProvider().mockReset();
    vi.unstubAllGlobals();
    delete process.env.RESOLVER_TIMEOUT_MS;
    // Keep quota out of the way for these cases; rate-limit tests set their
    // own budgets explicitly below.
    process.env.RATE_LIMIT_MAX_REQUESTS = "500";
    process.env.RATE_LIMIT_DOWNLOAD_MAX_REQUESTS = "500";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESOLVER_TIMEOUT_MS;
    for (const key of ALL_ROUTE_ENV) delete process.env[key];
  });

  describe("error normalization (toAppError / toMediaAppError)", () => {
    it("maps a stale-browser connection error to PROVIDER_UNAVAILABLE", () => {
      const mapped = toAppError(staleBrowserError());
      expect(mapped.code).toBe("PROVIDER_UNAVAILABLE");
      expect(mapped.message).not.toBe(GENERIC);
      expect(isConnectionLostError(staleBrowserError())).toBe(true);
    });

    it("maps a ProtocolError-shaped error (with a `code` property) to a real code", () => {
      const mapped = toAppError(new Error("Protocol error (Target.createTarget): Target closed."));
      expect(mapped.code).toBe("PROVIDER_UNAVAILABLE");
      expect(mapped.message).not.toBe(GENERIC);
    });

    it("maps AbortError/timeout to PROVIDER_TIMEOUT", () => {
      const abort = new DOMException("The operation was aborted", "AbortError");
      expect(toAppError(abort).code).toBe("PROVIDER_TIMEOUT");
      expect(toAppError(new Error("page-body-timeout")).code).toBe("PROVIDER_TIMEOUT");
    });

    it("maps transport failures to PROVIDER_UNAVAILABLE", () => {
      expect(toAppError(new TypeError("fetch failed")).code).toBe("PROVIDER_UNAVAILABLE");
      const dns = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
      expect(toAppError(dns).code).toBe("PROVIDER_UNAVAILABLE");
    });

    it("keeps AppError codes untouched (honest passthrough)", () => {
      const original = createError("CONTENT_NOT_FOUND");
      expect(toAppError(original)).toBe(original);
      expect(toMediaAppError(original).code).toBe("CONTENT_NOT_FOUND");
    });

    it("reserves the generic message for genuinely unknown failures only", () => {
      expect(toAppError(new Error("some totally unknown bug")).code).toBe("TEMPORARY_ERROR");
    });

    it("media context maps transport failures to MEDIA_DOWNLOAD_FAILED", () => {
      expect(toMediaAppError(new TypeError("fetch failed")).code).toBe("MEDIA_DOWNLOAD_FAILED");
      expect(toMediaAppError(new DOMException("x", "AbortError")).code).toBe("PROVIDER_TIMEOUT");
    });
  });

  describe("POST /api/resolve never answers a known failure with the generic message", () => {
    async function postResolve(url: string): Promise<Response> {
      const mini = express();
      mini.use(express.json({ limit: "1kb" }));
      mini.use("/api/resolve", resolveRouter);
      const { server, base } = await startServer(mini);
      try {
        return await fetch(`${base}/api/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
      } finally {
        await closeServer(server);
      }
    }

    it("stale browser connection -> 503 PROVIDER_UNAVAILABLE, not TEMPORARY_ERROR", async () => {
      mockCreateProvider().mockReturnValue({
        name: "test-mock",
        resolve: async () => {
          throw staleBrowserError();
        },
      } as never);

      const res = await postResolve("https://www.instagram.com/reel/StaleBrowser1/");
      expect(res.status).toBe(503);
      const body = (await res.json()) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("PROVIDER_UNAVAILABLE");
      expect(body.error.message).not.toBe(GENERIC);
      expect(body.error.message).not.toContain("temporary issue");
    });

    it("provider timeout error keeps its own code and 504", async () => {
      mockCreateProvider().mockReturnValue({
        name: "test-mock",
        resolve: async () => {
          throw createError("PROVIDER_TIMEOUT");
        },
      } as never);

      const res = await postResolve("https://www.instagram.com/reel/ProviderTimeout1/");
      expect(res.status).toBe(504);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("PROVIDER_TIMEOUT");
      expect(body.error.message).not.toBe(GENERIC);
    });

    it("unavailable content keeps 404 CONTENT_NOT_FOUND", async () => {
      mockCreateProvider().mockReturnValue({
        name: "test-mock",
        resolve: async () => {
          throw createError("CONTENT_NOT_FOUND");
        },
      } as never);

      const res = await postResolve("https://www.instagram.com/reel/GonePost404/");
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("CONTENT_NOT_FOUND");
    });

    it("a genuinely unknown bug still yields TEMPORARY_ERROR (the only allowed case)", async () => {
      mockCreateProvider().mockReturnValue({
        name: "test-mock",
        resolve: async () => {
          throw new Error("quantum flux in the widget factory");
        },
      } as never);

      const res = await postResolve("https://www.instagram.com/reel/UnknownBug777/");
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("TEMPORARY_ERROR");
    });

    it("valid URL still resolves successfully after a failed attempt (retry works)", async () => {
      mockCreateProvider().mockReturnValue({
        name: "test-mock",
        resolve: vi
          .fn<(...args: unknown[]) => Promise<ResolverResult>>()
          .mockRejectedValueOnce(staleBrowserError())
          .mockResolvedValue(reelResult(MEDIA)),
      } as never);

      const first = await postResolve("https://www.instagram.com/reel/RetryAfterStale1/");
      expect(first.status).toBe(503);

      const second = await postResolve("https://www.instagram.com/reel/RetryAfterStale1/");
      expect(second.status).toBe(200);
      const body = (await second.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });
  });

  describe("GET /api/resolve/stream (SSE) error payload honesty", () => {
    it("sends the specific provider code instead of the generic message", async () => {
      mockCreateProvider().mockReturnValue({
        name: "test-mock",
        resolve: async () => {
          throw staleBrowserError();
        },
      } as never);

      const mini = express();
      mini.use("/api/resolve", resolveRouter);
      const { server, base } = await startServer(mini);
      try {
        const chunk = await readSseUntilError(
          `${base}/api/resolve/stream?url=${encodeURIComponent("https://www.instagram.com/reel/SseStale2/")}`
        );
        expect(chunk).toContain("event: error");
        expect(chunk).toContain("PROVIDER_UNAVAILABLE");
        expect(chunk).not.toContain("TEMPORARY_ERROR");
        expect(chunk).not.toContain(GENERIC);
      } finally {
        await closeServer(server);
      }
    });
  });

  describe("temporary storage lifecycle", () => {
    it("a successful download never destroys a still-valid resolution", async () => {
      mockCreateProvider().mockReturnValue({
        name: "test-mock",
        resolve: async () => reelResult(MEDIA),
      } as never);
      stubUpstreamFetch(
        async () =>
          new Response("bytes", { status: 200, headers: { "content-type": "video/mp4" } })
      );

      const { server, base } = await startServer(app);
      try {
        const resolved = await fetch(`${base}/api/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: SOURCE }),
        });
        const resolvedBody = (await resolved.json()) as {
          success: boolean;
          data: { mediaId: string; media: Array<{ url: string }> };
        };
        expect(resolvedBody.success).toBe(true);
        const { mediaId } = resolvedBody.data;

        const { getMediaEntry } = await import("@/lib/temp-store.js");
        expect(getMediaEntry(mediaId)).not.toBeNull();

        for (let i = 0; i < 5; i++) {
          const dl = await fetch(
            `${base}/api/download?url=${encodeURIComponent(MEDIA)}&filename=clip.mp4&source=${encodeURIComponent(SOURCE)}`
          );
          expect(dl.status).toBe(200);
        }

        // Still valid after downloads: TTL governs lifetime, not consumption.
        expect(getMediaEntry(mediaId)).not.toBeNull();
      } finally {
        await closeServer(server);
      }
    });

    it("expired entries are the only thing cleanup removes", async () => {
      vi.useFakeTimers();
      try {
        const { storeMedia, getMedia, pruneExpired, liveEntryCount } = await import(
          "@/lib/temp-store.js"
        );
        const now = Date.now();
        storeMedia("ttl-fresh", [videoItem("https://scontent-iad3-2.xx.fbcdn.net/v/a.mp4")]);
        vi.setSystemTime(now + 9 * 60 * 1000); // inside the 10 minute TTL
        expect(getMedia("ttl-fresh")).not.toBeNull();
        expect(pruneExpired()).toBe(0);

        vi.setSystemTime(now + 11 * 60 * 1000); // past TTL
        expect(getMedia("ttl-fresh")).toBeNull();
        expect(liveEntryCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("capacity eviction never removes a recently used (actively downloading) entry", async () => {
      vi.useFakeTimers();
      try {
        const { storeMedia, getMediaEntry, liveEntryCount } = await import(
          "@/lib/temp-store.js"
        );
        const now = Date.now();
        // Fill the store, then let them all become idle (guard window is 60s).
        for (let i = 0; i < 1000; i++) {
          storeMedia(`bulk-${i}`, [videoItem(`https://scontent-iad3-2.xx.fbcdn.net/v/${i}.mp4`)]);
        }
        vi.setSystemTime(now + 61 * 1000);
        storeMedia("in-use-resolution", [videoItem("https://scontent-iad3-2.xx.fbcdn.net/v/live.mp4")]);
        expect(getMediaEntry("in-use-resolution")).not.toBeNull();

        // Force capacity eviction with one more insert.
        storeMedia("one-more", [videoItem("https://scontent-iad3-2.xx.fbcdn.net/v/more.mp4")]);

        expect(getMediaEntry("in-use-resolution")).not.toBeNull();
        expect(liveEntryCount()).toBeLessThanOrEqual(1000);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("rate limiting: repeated downloads are legitimate, buckets are separate", () => {
    /**
     * The rate-limit buckets are per-process state shared with the other
     * tests in this file. Shift the clock past any previously created window
     * (the offset accumulates, so each call lands beyond the last resetAt)
     * without touching timers.
     */
    let clockOffset = 0;
    function freshRateLimitWindow(): () => void {
      const originalNow = Date.now.bind(Date);
      clockOffset += 600_000;
      const offset = clockOffset;
      const spy = vi.spyOn(Date, "now").mockImplementation(() => originalNow() + offset);
      return () => spy.mockRestore();
    }

    it("downloads never consume the resolve quota, and a real resolve limit still answers 429", async () => {
      mockCreateProvider().mockReturnValue({
        name: "test-mock",
        resolve: async (url: string) => reelResult(MEDIA),
      } as never);
      stubUpstreamFetch(
        async () =>
          new Response("bytes", { status: 200, headers: { "content-type": "video/mp4" } })
      );
      process.env.RATE_LIMIT_MAX_REQUESTS = "3";
      process.env.RATE_LIMIT_DOWNLOAD_MAX_REQUESTS = "500";
      const restoreClock = freshRateLimitWindow();

      const { server, base } = await startServer(app);
      try {
        // 5 downloads first: must not burn the resolve budget.
        for (let i = 0; i < 5; i++) {
          const dl = await fetch(
            `${base}/api/download?url=${encodeURIComponent(MEDIA)}&filename=clip.mp4&source=${encodeURIComponent(SOURCE)}`
          );
          expect(dl.status).toBe(200);
        }

        const resolveOnce = (tag: string) =>
          fetch(`${base}/api/resolve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: `https://www.instagram.com/reel/Budget-${tag}/` }),
          });

        // Budget is 3/min for resolve: the first three are allowed even after
        // five downloads (separate bucket), the fourth is a clean 429.
        expect((await resolveOnce("a")).status).toBe(200);
        expect((await resolveOnce("b")).status).toBe(200);
        expect((await resolveOnce("c")).status).toBe(200);
        const limited = await resolveOnce("d");
        expect(limited.status).toBe(429);
        expect(limited.headers.get("retry-after")).toBeTruthy();
        const body = (await limited.json()) as { error: { code: string; message: string } };
        expect(body.error.code).toBe("RATE_LIMITED");
        expect(body.error.message).not.toBe(GENERIC);
      } finally {
        restoreClock();
        await closeServer(server);
      }
    });

    it("an exceeded download budget answers 429 RATE_LIMITED with a clear message", async () => {
      stubUpstreamFetch(
        async () =>
          new Response("bytes", { status: 200, headers: { "content-type": "video/mp4" } })
      );
      process.env.RATE_LIMIT_DOWNLOAD_MAX_REQUESTS = "1";
      const restoreClock = freshRateLimitWindow();

      const { server, base } = await startServer(app);
      try {
        const first = await fetch(
          `${base}/api/download?url=${encodeURIComponent(MEDIA)}&filename=clip.mp4&source=${encodeURIComponent(SOURCE)}`
        );
        expect(first.status).toBe(200);

        const second = await fetch(
          `${base}/api/download?url=${encodeURIComponent(MEDIA)}&filename=clip.mp4&source=${encodeURIComponent(SOURCE)}`
        );
        expect(second.status).toBe(429);
        const body = (await second.json()) as { error: { code: string; message: string } };
        expect(body.error.code).toBe("RATE_LIMITED");
        expect(body.error.message).not.toBe(GENERIC);
        expect(body.error.message).toContain("Too many requests");
        expect(second.headers.get("retry-after")).toBeTruthy();
      } finally {
        restoreClock();
        await closeServer(server);
      }
    });
  });

  describe("repeated and concurrent downloads", () => {
    it("10 consecutive downloads of the same media all succeed", async () => {
      stubUpstreamFetch(
        async () =>
          new Response("bytes", { status: 200, headers: { "content-type": "video/mp4" } })
      );
      const { server, base } = await startServer(app);
      try {
        for (let i = 1; i <= 10; i++) {
          const res = await fetch(
            `${base}/api/download?url=${encodeURIComponent(MEDIA)}&filename=clip.mp4&source=${encodeURIComponent(SOURCE)}`
          );
          expect(res.status).toBe(200);
          expect(await res.text()).toBe("bytes");
        }
      } finally {
        await closeServer(server);
      }
    });

    it("5 simultaneous downloads all succeed without corrupting each other", async () => {
      stubUpstreamFetch(
        async () =>
          new Response("bytes", { status: 200, headers: { "content-type": "video/mp4" } })
      );
      const { server, base } = await startServer(app);
      try {
        const responses = await Promise.all(
          Array.from({ length: 5 }, () =>
            fetch(
              `${base}/api/download?url=${encodeURIComponent(MEDIA)}&filename=clip.mp4&source=${encodeURIComponent(SOURCE)}`
            )
          )
        );
        for (const res of responses) expect(res.status).toBe(200);
        const bodies = await Promise.all(responses.map((r) => r.text()));
        for (const body of bodies) expect(body).toBe("bytes");
      } finally {
        await closeServer(server);
      }
    });

    it("every media index stays downloadable (multi-media post)", async () => {
      const slides = [
        "https://scontent-iad3-2.xx.fbcdn.net/v/slide1.mp4?sig=1",
        "https://scontent-iad3-2.xx.fbcdn.net/v/slide2.mp4?sig=1",
        "https://scontent-iad3-2.xx.fbcdn.net/v/slide3.mp4?sig=1",
      ];
      stubUpstreamFetch(
        async () =>
          new Response("bytes", { status: 200, headers: { "content-type": "video/mp4" } })
      );
      const { server, base } = await startServer(app);
      try {
        for (const slide of slides) {
          const res = await fetch(
            `${base}/api/download?url=${encodeURIComponent(slide)}&filename=clip.mp4&source=${encodeURIComponent(SOURCE)}`
          );
          expect(res.status).toBe(200);
        }
        // Re-download a middle item: nothing was mutated or consumed.
        const again = await fetch(
          `${base}/api/download?url=${encodeURIComponent(slides[1])}&filename=clip.mp4&source=${encodeURIComponent(SOURCE)}`
        );
        expect(again.status).toBe(200);
      } finally {
        await closeServer(server);
      }
    });

    it("failed download followed by a retry succeeds once upstream recovers", async () => {
      let calls = 0;
      stubUpstreamFetch(async () => {
        calls++;
        if (calls === 1) return new Response("bad gateway", { status: 500 });
        return new Response("bytes", { status: 200, headers: { "content-type": "video/mp4" } });
      });
      const { server, base } = await startServer(app);
      try {
        const first = await fetch(
          `${base}/api/download?url=${encodeURIComponent(MEDIA)}&filename=clip.mp4&source=${encodeURIComponent(SOURCE)}`
        );
        expect(first.status).toBe(502);
        const firstBody = (await first.json()) as { error: { code: string; message: string } };
        expect(firstBody.error.code).toBe("MEDIA_DOWNLOAD_FAILED");
        expect(firstBody.error.message).not.toBe(GENERIC);

        const retry = await fetch(
          `${base}/api/download?url=${encodeURIComponent(MEDIA)}&filename=clip.mp4&source=${encodeURIComponent(SOURCE)}`
        );
        expect(retry.status).toBe(200);
        expect(await retry.text()).toBe("bytes");
      } finally {
        await closeServer(server);
      }
    });

    it("upstream 429 answers RATE codes, never the generic message", async () => {
      stubUpstreamFetch(async () => new Response("slow down", { status: 429 }));
      const { server, base } = await startServer(app);
      try {
        const res = await fetch(
          `${base}/api/download?url=${encodeURIComponent(MEDIA)}&filename=clip.mp4&source=${encodeURIComponent(SOURCE)}`
        );
        expect(res.status).toBe(429);
        const body = (await res.json()) as { error: { code: string; message: string } };
        expect(body.error.code).toBe("PROVIDER_RATE_LIMITED");
        expect(body.error.message).not.toBe(GENERIC);
      } finally {
        await closeServer(server);
      }
    });

    it("upstream timeout answers 504 PROVIDER_TIMEOUT, never the generic message", async () => {
      stubUpstreamFetch(async () => {
        throw new DOMException("The operation was aborted", "AbortError");
      });
      const { server, base } = await startServer(app);
      try {
        const res = await fetch(
          `${base}/api/download?url=${encodeURIComponent(MEDIA)}&filename=clip.mp4&source=${encodeURIComponent(SOURCE)}`
        );
        expect(res.status).toBe(504);
        const body = (await res.json()) as { error: { code: string; message: string } };
        expect(body.error.code).toBe("PROVIDER_TIMEOUT");
        expect(body.error.message).not.toBe(GENERIC);
      } finally {
        await closeServer(server);
      }
    });
  });
});
