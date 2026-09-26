import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "http";

/**
 * Capacity/backpressure contract:
 *  - every workload is bounded,
 *  - a saturated workload returns a controlled 503 (never hangs, never grows),
 *  - leases are released exactly once, including on throw and on abort,
 *  - draining makes the instance report itself unready and refuse new work.
 */
describe("workload capacity", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("caps concurrency and releases the slot when the work throws", async () => {
    const { WorkloadGate } = await import("@/lib/capacity.js");
    const gate = new WorkloadGate("unit-test", { limit: 2, maxQueueMs: 0, staleMs: 60_000 });

    const leases = await Promise.all([gate.acquire(), gate.acquire()]);
    expect(gate.inFlight).toBe(2);
    expect(gate.isSaturated()).toBe(true);

    // Bounded: a third request is refused with a controlled capacity error
    // instead of queueing forever.
    await expect(gate.acquire()).rejects.toMatchObject({ code: "CAPACITY_EXHAUSTED", statusCode: 503 });

    leases[0].release();
    expect(gate.inFlight).toBe(1);
    // Idempotent: a double release must not free someone else's slot.
    leases[0].release();
    expect(gate.inFlight).toBe(1);
    leases[1].release();
    expect(gate.inFlight).toBe(0);

    await expect(
      gate.run(() => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(gate.inFlight).toBe(0);
  });

  it("hands a freed slot to the next waiter instead of polling", async () => {
    const { WorkloadGate } = await import("@/lib/capacity.js");
    const gate = new WorkloadGate("unit-fifo", { limit: 1, maxQueueMs: 2_000, staleMs: 60_000 });
    const first = await gate.acquire();

    let granted = false;
    const queued = gate.acquire().then((lease) => {
      granted = true;
      return lease;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(granted).toBe(false);
    expect(gate.queued).toBe(1);

    first.release();
    const lease = await queued;
    expect(granted).toBe(true);
    expect(gate.inFlight).toBe(1);
    lease.release();
    expect(gate.inFlight).toBe(0);
    expect(gate.queued).toBe(0);
  });

  it("drops a queued waiter when the client disconnects", async () => {
    const { WorkloadGate } = await import("@/lib/capacity.js");
    const gate = new WorkloadGate("unit-abort", { limit: 1, maxQueueMs: 5_000, staleMs: 60_000 });
    const held = await gate.acquire();

    const controller = new AbortController();
    const queued = gate.acquire({ signal: controller.signal });
    await new Promise((r) => setTimeout(r, 10));
    expect(gate.queued).toBe(1);

    controller.abort();
    await expect(queued).rejects.toMatchObject({ code: "CAPACITY_EXHAUSTED" });
    // The abandoned waiter is removed, so a later release is not swallowed.
    expect(gate.queued).toBe(0);
    held.release();
    expect(gate.inFlight).toBe(0);
    // Capacity is still usable afterwards.
    const next = await gate.acquire();
    expect(next).toBeTruthy();
    next.release();
  });

  it("clamps an absurd limit instead of trusting configuration", async () => {
    vi.stubEnv("MAX_CONCURRENT_PAGES", "1000000");
    vi.resetModules();
    const { getGate } = await import("@/lib/capacity.js");
    const gate = getGate("puppeteer");
    // Never unlimited, never a million pages.
    expect(gate.limit).toBeGreaterThan(0);
    expect(gate.limit).toBeLessThanOrEqual(4096);
  });

  it("bounds concurrency per client key", async () => {
    const { KeyedConcurrency } = await import("@/lib/capacity.js");
    const limiter = new KeyedConcurrency(2, 10, 60_000);
    expect(limiter.tryAcquire("1.2.3.4")).toBe(true);
    expect(limiter.tryAcquire("1.2.3.4")).toBe(true);
    expect(limiter.tryAcquire("1.2.3.4")).toBe(false);
    // A different client is unaffected by the first client's saturation.
    expect(limiter.tryAcquire("5.6.7.8")).toBe(true);

    limiter.release("1.2.3.4");
    expect(limiter.tryAcquire("1.2.3.4")).toBe(true);
  });

  it("reports every workload with a finite limit", async () => {
    const { capacitySnapshot, WORKLOAD_NAMES } = await import("@/lib/capacity.js");
    const snapshot = capacitySnapshot();
    expect(snapshot.workloads).toHaveLength(WORKLOAD_NAMES.length);
    for (const workload of snapshot.workloads) {
      expect(workload.limit).toBeGreaterThan(0);
      expect(Number.isFinite(workload.limit)).toBe(true);
      expect(workload.inFlight).toBeLessThanOrEqual(workload.limit);
    }
    expect(snapshot.memory.rssMb).toBeGreaterThan(0);
  });
});

describe("capacity refusal over HTTP", () => {
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {
      RESOLVE_QUEUE_WAIT_MS: process.env.RESOLVE_QUEUE_WAIT_MS,
      RESOLVER_PROVIDER: process.env.RESOLVER_PROVIDER,
    };
    // Fail fast rather than queueing, so the refusal is immediate.
    vi.stubEnv("RESOLVE_QUEUE_WAIT_MS", "0");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("answers a saturated resolve workload with 503 + Retry-After", async () => {
    const { getGate } = await import("@/lib/capacity.js");
    const { default: resolveRouter } = await import("@/routes/resolve.js");
    const { cleanupExpiredEntries } = await import("@/lib/rate-limit.js");
    cleanupExpiredEntries();

    const gate = getGate("resolve");
    const held: Array<{ release: () => void }> = [];
    for (let i = 0; i < gate.limit; i++) {
      held.push(await gate.acquire());
    }

    const mini = express();
    mini.use(express.json({ limit: "1kb" }));
    mini.use("/api/resolve", resolveRouter);

    const server: Server = await new Promise((resolve) => {
      const s = mini.listen(0, () => resolve(s));
    });
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    try {
      const res = await fetch(`${base}/api/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://www.instagram.com/reel/Saturated123/" }),
      });
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBeTruthy();
      const body = (await res.json()) as { error: { code: string } };
      // Honest, specific code — not a generic "temporary issue".
      expect(body.error.code).toBe("CAPACITY_EXHAUSTED");
    } finally {
      for (const lease of held) lease.release();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("draining", () => {
  afterEach(async () => {
    const { resetShutdownStateForTests } = await import("@/lib/shutdown.js");
    resetShutdownStateForTests();
    const { resetGatesForTests } = await import("@/lib/capacity.js");
    resetGatesForTests();
  });

  it("reports 503 readiness and refuses new work once draining", async () => {
    const app = (await import("@/app.js")).default;
    const { startDraining, drainMetrics } = await import("@/lib/shutdown.js");

    const server: Server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    try {
      const before = await fetch(`${base}/api/health/ready`);
      expect(before.status).toBe(200);

      startDraining("test");

      const ready = await fetch(`${base}/api/health/ready`);
      expect(ready.status).toBe(503);
      const readyBody = (await ready.json()) as { status: string; draining: boolean; drainReason: string };
      expect(readyBody.status).toBe("draining");
      expect(readyBody.draining).toBe(true);
      expect(readyBody.drainReason).toBe("test");

      // Liveness stays green so an orchestrator does not kill a draining
      // instance that is still finishing real work.
      const live = await fetch(`${base}/api/health`);
      expect(live.status).toBe(200);

      // Readiness reports the drain reason so the operator knows why.
      const cap = await fetch(`${base}/api/health/capacity`);
      expect(cap.status).toBe(200);
      const capBody = (await cap.json()) as { draining: boolean; drainReason: string };
      expect(capBody.draining).toBe(true);
      expect(capBody.drainReason).toBe("test");
      expect(drainMetrics().draining).toBe(true);

      // Health endpoints stay reachable during the drain, but real work is
      // refused with the shutdown-specific code rather than a generic 500.
      const refused = await fetch(`${base}/api/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://www.instagram.com/reel/Draining123/" }),
      });
      expect(refused.status).toBe(503);
      const refusedBody = (await refused.json()) as { error: { code: string } };
      expect(refusedBody.error.code).toBe("SERVER_SHUTTING_DOWN");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("resolve cache expiry", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("still expires entries when the TTL env var is invalid", async () => {
    // Regression: `parseInt("abc")` used to yield NaN, every expiry comparison
    // became false, and the cache grew without ever dropping stale results.
    vi.stubEnv("RESOLVE_CACHE_TTL_MS", "abc");
    vi.resetModules();
    const { getCachedResult, setCachedResult } = await import("@/lib/provider-cache.js");

    const url = "https://www.instagram.com/reel/CacheTtl123/";
    const result = {
      type: "REEL" as const,
      sourceUrl: url,
      thumbnail: null,
      title: null,
      author: null,
      media: [],
    };
    setCachedResult(url, result);
    expect(getCachedResult(url)).not.toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 10 * 60 * 1000));
    try {
      expect(getCachedResult(url)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
