import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createProvider } from "@/lib/providers/index";

describe("createProvider factory", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns not-configured provider by default", () => {
    delete process.env.RESOLVER_PROVIDER;
    const provider = createProvider();
    expect(provider.name).toBe("not-configured");
  });

  it("returns not-configured for placeholder", () => {
    process.env.RESOLVER_PROVIDER = "placeholder";
    const provider = createProvider();
    expect(provider.name).toBe("not-configured");
  });

  it("returns mock provider", () => {
    process.env.RESOLVER_PROVIDER = "mock";
    const provider = createProvider();
    expect(provider.name).toBe("mock");
  });

  it("returns not-configured when external missing credentials", () => {
    process.env.RESOLVER_PROVIDER = "external";
    delete process.env.PROVIDER_API_URL;
    delete process.env.PROVIDER_API_KEY;
    const provider = createProvider();
    expect(provider.name).toBe("not-configured");
  });

  it("returns not-configured when external missing API URL", () => {
    process.env.RESOLVER_PROVIDER = "external";
    process.env.PROVIDER_API_KEY = "test-key";
    delete process.env.PROVIDER_API_URL;
    const provider = createProvider();
    expect(provider.name).toBe("not-configured");
  });

  it("returns not-configured when external missing API key", () => {
    process.env.RESOLVER_PROVIDER = "external";
    process.env.PROVIDER_API_URL = "https://api.example.com";
    delete process.env.PROVIDER_API_KEY;
    const provider = createProvider();
    expect(provider.name).toBe("not-configured");
  });

  it("returns external provider with valid credentials", () => {
    process.env.RESOLVER_PROVIDER = "external";
    process.env.PROVIDER_API_URL = "https://api.example.com";
    process.env.PROVIDER_API_KEY = "test-key";
    const provider = createProvider();
    expect(provider.name).toBe("external");
  });

  it("not-configured provider throws PROVIDER_NOT_CONFIGURED", async () => {
    delete process.env.RESOLVER_PROVIDER;
    const provider = createProvider();
    await expect(
      provider.resolve("https://www.instagram.com/p/test/")
    ).rejects.toThrow();
  });
});
