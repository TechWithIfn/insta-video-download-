import { describe, it, expect } from "vitest";
import { getCachedResult, setCachedResult } from "@/lib/provider-cache";
import type { ResolverResult } from "@/lib/types";

function makeResult(type: string = "POST"): ResolverResult {
  return {
    type: type as ResolverResult["type"],
    sourceUrl: `https://www.instagram.com/p/${Date.now()}/`,
    thumbnail: null,
    title: `Test ${type}`,
    author: null,
    media: [
      {
        url: "https://example.com/media.jpg",
        type: "image",
        width: 1080,
        height: 1080,
        duration: null,
        thumbnail: null,
        format: "jpg",
      },
    ],
  };
}

describe("provider-cache", () => {
  it("returns null for cache miss", () => {
    const result = getCachedResult("https://www.instagram.com/p/miss123/");
    expect(result).toBeNull();
  });

  it("stores and retrieves cached result", () => {
    const url = "https://www.instagram.com/p/cache123/";
    const result = makeResult();
    setCachedResult(url, result);
    const cached = getCachedResult(url);
    expect(cached).toEqual(result);
  });

  it("returns same reference for cached URL", () => {
    const url = "https://www.instagram.com/p/ref123/";
    const result = makeResult();
    setCachedResult(url, result);
    const cached = getCachedResult(url);
    expect(cached).toBe(result);
  });

  it("different URLs have separate caches", () => {
    const url1 = "https://www.instagram.com/p/url1/";
    const url2 = "https://www.instagram.com/p/url2/";
    const result1 = makeResult("REEL");
    const result2 = makeResult("VIDEO");

    setCachedResult(url1, result1);
    setCachedResult(url2, result2);

    expect(getCachedResult(url1)?.type).toBe("REEL");
    expect(getCachedResult(url2)?.type).toBe("VIDEO");
  });
});
