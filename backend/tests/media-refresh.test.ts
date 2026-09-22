import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ResolverResult } from "@/lib/types.js";

vi.mock("@/lib/resolvers/index", () => ({
  resolveUrl: vi.fn(),
}));

import { fetchUpstreamMediaResilient } from "@/lib/media-proxy.js";
import { resolveUrl } from "@/lib/resolvers/index.js";

const mockResolve = () => vi.mocked(resolveUrl);

function freshVideoResult(url: string): ResolverResult {
  return {
    type: "REEL",
    sourceUrl: "https://www.instagram.com/reel/AbC123xYz/",
    thumbnail: null,
    title: null,
    author: null,
    media: [
      {
        url,
        type: "video",
        width: null,
        height: null,
        duration: null,
        thumbnail: null,
        format: "mp4",
      },
    ],
  };
}

const STALE_URL =
  "https://scontent-iad3-2.xx.fbcdn.net/v/stale.mp4?sig=old";
const FRESH_URL =
  "https://scontent-iad3-2.xx.fbcdn.net/v/fresh.mp4?sig=new";
const SOURCE_URL = "https://www.instagram.com/reel/AbC123xYz/";

describe("fetchUpstreamMediaResilient", () => {
  beforeEach(() => {
    mockResolve().mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes healthy responses through without resolving", async () => {
    const mockFetch = vi.fn(async () =>
      new Response("video-bytes", {
        status: 200,
        headers: { "content-type": "video/mp4" },
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUpstreamMediaResilient(STALE_URL, {
      timeoutMs: 5000,
      tag: "TEST",
      requestId: "test-1",
      sourceUrl: SOURCE_URL,
    });

    expect(result.refreshed).toBe(false);
    expect(result.status.kind).toBe("ok");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockResolve()).not.toHaveBeenCalled();
  });

  it("re-resolves once and retries on 403 with a valid source", async () => {
    const mockFetch = vi
      .fn<(...args: unknown[]) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("expired", { status: 403 }))
      .mockResolvedValueOnce(
        new Response("fresh-video-bytes", {
          status: 200,
          headers: { "content-type": "video/mp4" },
        })
      );
    vi.stubGlobal("fetch", mockFetch);
    mockResolve().mockResolvedValue(freshVideoResult(FRESH_URL));

    const result = await fetchUpstreamMediaResilient(STALE_URL, {
      timeoutMs: 5000,
      tag: "TEST",
      requestId: "test-2",
      sourceUrl: SOURCE_URL,
    });

    expect(result.refreshed).toBe(true);
    expect(result.status.kind).toBe("ok");
    if (result.status.kind === "ok") {
      expect(result.status.response.status).toBe(200);
    }
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockResolve()).toHaveBeenCalledTimes(1);
    expect(mockResolve()).toHaveBeenCalledWith(
      "https://www.instagram.com/reel/AbC123xYz/",
      undefined,
      { bypassCache: true }
    );
  });

  it("returns the original failure when no source is supplied", async () => {
    const mockFetch = vi.fn(async () => new Response("expired", { status: 403 }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUpstreamMediaResilient(STALE_URL, {
      timeoutMs: 5000,
      tag: "TEST",
      requestId: "test-3",
    });

    expect(result.refreshed).toBe(false);
    expect(result.status.kind).toBe("ok");
    if (result.status.kind === "ok") {
      expect(result.status.response.status).toBe(403);
    }
    expect(mockResolve()).not.toHaveBeenCalled();
  });

  it("returns the original failure when re-resolve throws", async () => {
    const mockFetch = vi.fn(async () => new Response("gone", { status: 404 }));
    vi.stubGlobal("fetch", mockFetch);
    mockResolve().mockRejectedValue(new Error("provider down"));

    const result = await fetchUpstreamMediaResilient(STALE_URL, {
      timeoutMs: 5000,
      tag: "TEST",
      requestId: "test-4",
      sourceUrl: SOURCE_URL,
    });

    expect(result.refreshed).toBe(false);
    expect(result.status.kind).toBe("ok");
    if (result.status.kind === "ok") {
      expect(result.status.response.status).toBe(404);
    }
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns the original failure when the refreshed URL is not an allowed CDN host", async () => {
    const mockFetch = vi.fn(async () => new Response("forbidden", { status: 403 }));
    vi.stubGlobal("fetch", mockFetch);
    mockResolve().mockResolvedValue(freshVideoResult("https://evil.example.com/video.mp4"));

    const result = await fetchUpstreamMediaResilient(STALE_URL, {
      timeoutMs: 5000,
      tag: "TEST",
      requestId: "test-5",
      sourceUrl: SOURCE_URL,
    });

    expect(result.refreshed).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not attempt refresh for rate-limited responses", async () => {
    const mockFetch = vi.fn(async () => new Response("slow down", { status: 429 }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUpstreamMediaResilient(STALE_URL, {
      timeoutMs: 5000,
      tag: "TEST",
      requestId: "test-6",
      sourceUrl: SOURCE_URL,
    });

    expect(result.refreshed).toBe(false);
    expect(mockResolve()).not.toHaveBeenCalled();
  });
});
