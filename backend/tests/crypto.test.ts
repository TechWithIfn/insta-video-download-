import { describe, it, expect } from "vitest";
import { generateToken, hashUrl } from "@/lib/crypto";

describe("generateToken", () => {
  it("returns a 32-character hex string", () => {
    const token = generateToken();
    expect(token).toMatch(/^[a-f0-9]{32}$/);
  });

  it("generates unique tokens", () => {
    const token1 = generateToken();
    const token2 = generateToken();
    expect(token1).not.toBe(token2);
  });
});

describe("hashUrl", () => {
  it("returns a 16-character hex string", () => {
    const hash = hashUrl("https://example.com");
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });

  it("produces consistent hashes", () => {
    const url = "https://www.instagram.com/p/ABC123/";
    expect(hashUrl(url)).toBe(hashUrl(url));
  });

  it("produces different hashes for different URLs", () => {
    expect(hashUrl("https://a.com")).not.toBe(hashUrl("https://b.com"));
  });
});
