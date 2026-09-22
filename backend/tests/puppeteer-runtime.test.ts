import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isServerlessRuntime } from "@/lib/providers/puppeteer";

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.VERCEL;
  delete process.env.PUPPETEER_RUNTIME;
});

afterEach(() => {
  process.env = originalEnv;
});

describe("isServerlessRuntime", () => {
  it("is false locally with no indicators", () => {
    expect(isServerlessRuntime()).toBe(false);
  });

  it("is true when Vercel sets VERCEL=1", () => {
    process.env.VERCEL = "1";
    expect(isServerlessRuntime()).toBe(true);
  });

  it("explicit override forces serverless without Vercel", () => {
    process.env.PUPPETEER_RUNTIME = "serverless";
    expect(isServerlessRuntime()).toBe(true);
  });

  it("explicit override forces local Chrome even on Vercel", () => {
    process.env.VERCEL = "1";
    process.env.PUPPETEER_RUNTIME = "local";
    expect(isServerlessRuntime()).toBe(false);
  });
});
