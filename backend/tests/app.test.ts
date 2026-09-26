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
    // Readiness reports whether the instance should receive new work, so it
    // reports "ready" (and 503 + "draining" while shutting down) rather than
    // the liveness string "ok".
    expect(body.status).toBe("ready");
    expect(body.draining).toBe(false);
    expect(typeof body.provider).toBe("string");
    expect(typeof body.ffmpegAvailable).toBe("boolean");
    // Honest saturation visibility, with no secrets in the payload.
    expect(body.capacity).toBeDefined();
    const raw = JSON.stringify(body).toLowerCase();
    expect(raw).not.toContain("api_key");
    expect(raw).not.toContain("apikey");
  });

  it("serves GET /api/health/capacity with per-workload limits", async () => {
    const res = await fetch(`${base}/api/health/capacity`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      capacity: { workloads: Array<{ name: string; limit: number; inFlight: number }> };
    };
    const names = body.capacity.workloads.map((w) => w.name);
    for (const expected of ["request", "resolve", "provider", "puppeteer", "audio", "ffmpeg", "stream", "download", "probe"]) {
      expect(names).toContain(expected);
    }
    for (const w of body.capacity.workloads) {
      // Every workload is bounded — nothing is unlimited.
      expect(w.limit).toBeGreaterThan(0);
      expect(Number.isFinite(w.limit)).toBe(true);
      expect(w.inFlight).toBeGreaterThanOrEqual(0);
    }
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
