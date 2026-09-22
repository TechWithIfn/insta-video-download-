import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "http";
import resolveRouter from "@/routes/resolve";

describe("GET /api/resolve/stream (SSE)", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: "1kb" }));
    app.use("/api/resolve", resolveRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  });

  async function readFirstChunk(url: string): Promise<{
    status: number;
    contentType: string | null;
    chunk: string;
  }> {
    const res = await fetch(url);
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    await reader.cancel().catch(() => {});
    return {
      status: res.status,
      contentType: res.headers.get("content-type"),
      chunk: new TextDecoder().decode(value),
    };
  }

  it("sends SSE headers and a progress event followed by INVALID_URL for a non-Instagram URL", async () => {
    const r = await readFirstChunk(
      `${base}/api/resolve/stream?url=${encodeURIComponent("https://example.com/video")}`
    );
    expect(r.status).toBe(200);
    expect(r.contentType).toContain("text/event-stream");
    expect(r.chunk).toContain("event: progress");
    expect(r.chunk).toContain("event: error");
    expect(r.chunk).toContain("INVALID_URL");
  });

  it("sends a VALIDATION_ERROR event when url is missing", async () => {
    const r = await readFirstChunk(`${base}/api/resolve/stream`);
    expect(r.status).toBe(200);
    expect(r.contentType).toContain("text/event-stream");
    expect(r.chunk).toContain("event: error");
    expect(r.chunk).toContain("VALIDATION_ERROR");
  });

  it("does not start resolution work for unsupported URL patterns", async () => {
    const r = await readFirstChunk(
      `${base}/api/resolve/stream?url=${encodeURIComponent("https://www.instagram.com/explore/")}`
    );
    expect(r.chunk).toContain("event: error");
    expect(r.chunk).toContain("INVALID_URL");
  });
});
