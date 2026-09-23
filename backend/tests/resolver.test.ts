import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveUrl, resetResolver, normalizeResultType } from "@/lib/resolvers";
import type { ResolverResult, MediaItem } from "@/lib/types";

const originalEnv = process.env;

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  resetResolver();
});

afterEach(() => {
  process.env = originalEnv;
  resetResolver();
});

describe("resolveUrl", () => {
  it("resolves via mock provider", async () => {
    process.env.RESOLVER_PROVIDER = "mock";
    const result = await resolveUrl(
      "https://www.instagram.com/reel/Cxyz123/"
    );
    expect(result.type).toBe("REEL");
    expect(result.media.length).toBeGreaterThanOrEqual(1);
  });

  it("throws for not-configured provider", async () => {
    delete process.env.RESOLVER_PROVIDER;
    await expect(
      resolveUrl("https://www.instagram.com/p/NOTCONFIGURED123/")
    ).rejects.toThrow();
  });

  it("keeps a complete 11-item carousel intact (never truncated)", () => {
    const media: MediaItem[] = Array.from({ length: 11 }, (_, i) => ({
      url: `https://scontent.cdninstagram.com/v/slide${i + 1}.jpg?x=${i}`,
      type: "image" as const,
      width: 1080,
      height: 1350,
      duration: null,
      thumbnail: null,
      format: "jpg",
    }));
    const base: ResolverResult = {
      type: "POST",
      sourceUrl: "https://www.instagram.com/p/CAROUSEL11/",
      thumbnail: null,
      title: null,
      author: null,
      media,
    };
    const out = normalizeResultType(base);
    expect(out.type).toBe("CAROUSEL");
    expect(out.media).toHaveLength(11);
    expect(out.media[0].url).toContain("slide1.jpg");
    expect(out.media[10].url).toContain("slide11.jpg");
  });

  it("keeps a single-item post as POST (no carousel UI)", () => {
    const base: ResolverResult = {
      type: "POST",
      sourceUrl: "https://www.instagram.com/p/SINGLE1/",
      thumbnail: null,
      title: null,
      author: null,
      media: [
        {
          url: "https://scontent.cdninstagram.com/v/only.jpg",
          type: "image",
          width: 1080,
          height: 1080,
          duration: null,
          thumbnail: null,
          format: "jpg",
        },
      ],
    };
    const out = normalizeResultType(base);
    expect(out.type).toBe("POST");
    expect(out.media).toHaveLength(1);
  });

  it("caches identical URLs", async () => {
    process.env.RESOLVER_PROVIDER = "mock";
    const url = "https://www.instagram.com/p/CACHE123/";
    const result1 = await resolveUrl(url);
    const result2 = await resolveUrl(url);
    expect(result1).toBe(result2);
  });
});
