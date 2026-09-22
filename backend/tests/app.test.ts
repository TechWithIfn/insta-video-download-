import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import app from "@/app";

describe("App wiring (shared by local server and Vercel function)", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
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

  it("serves service info at GET /", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { service?: string; status?: string };
    expect(body.service).toBe("Downloadit API");
    expect(body.status).toBe("ok");
  });

  it("serves GET /api/health", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("ok");
  });

  it("serves GET /api/health/ready without secrets", async () => {
    const res = await fetch(`${base}/api/health/ready`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(typeof body.provider).toBe("string");
    expect(typeof body.ffmpegAvailable).toBe("boolean");
    const raw = JSON.stringify(body).toLowerCase();
    expect(raw).not.toContain("api_key");
    expect(raw).not.toContain("apikey");
  });

  it("rejects invalid resolve payloads without touching the resolver", async () => {
    const res = await fetch(`${base}/api/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/not-instagram" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success?: boolean };
    expect(body.success).toBe(false);
  });
});
