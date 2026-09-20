import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveUrl, resetResolver } from "@/lib/resolvers";

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

  it("caches identical URLs", async () => {
    process.env.RESOLVER_PROVIDER = "mock";
    const url = "https://www.instagram.com/p/CACHE123/";
    const result1 = await resolveUrl(url);
    const result2 = await resolveUrl(url);
    expect(result1).toBe(result2);
  });
});
