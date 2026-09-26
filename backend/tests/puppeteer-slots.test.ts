import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { PuppeteerProvider } from "@/lib/providers/puppeteer";
import { getGate, resetGatesForTests } from "@/lib/capacity";

// Access the private slot acquisition (which is now a thin wrapper around the
// central `puppeteer` workload gate) for unit testing (compile-time only).
function slotsOf(provider: PuppeteerProvider): any {
  return provider as any;
}

async function newProvider(): Promise<any> {
  const { PuppeteerProvider: Impl } = await import("@/lib/providers/puppeteer");
  return slotsOf(new Impl());
}

/**
 * Browser concurrency is owned by the central `puppeteer` gate, so these tests
 * assert the provider really uses that gate (and therefore that
 * /api/health/capacity reports real in-flight browser work) rather than a
 * private counter that capacity cannot see.
 */
describe("Puppeteer page slots (central puppeteer gate)", () => {
  beforeEach(() => {
    resetGatesForTests();
  });

  afterEach(() => {
    resetGatesForTests();
    vi.unstubAllEnvs();
  });

  it("grants up to the configured bound and tracks it in the gate", async () => {
    const provider = await newProvider();
    const gate = getGate("puppeteer");
    const limit = gate.limit;
    expect(limit).toBeGreaterThan(0);
    for (let i = 0; i < limit; i++) {
      expect(await provider.acquirePageSlot()).not.toBeNull();
    }
    expect(gate.inFlight).toBe(limit);
    expect(gate.isSaturated()).toBe(true);
  });

  it("releases the slot for the next resolve (no permanent leak)", async () => {
    const provider = await newProvider();
    const gate = getGate("puppeteer");
    for (let i = 0; i < gate.limit; i++) await provider.acquirePageSlot();
    provider.pageSlotLeases[0].release();
    expect(gate.inFlight).toBe(gate.limit - 1);
    // Previously the slot was never released: every later resolve returned
    // SERVER_OVERLOADED until restart.
    expect(await provider.acquirePageSlot()).not.toBeNull();
    expect(gate.inFlight).toBe(gate.limit);
  });

  it("reclaims slots leaked by killed/frozen runtimes", async () => {
    const provider = await newProvider();
    const gate = getGate("puppeteer");
    // Simulate holders that never released (killed request / frozen instance).
    const leaked = [];
    for (let i = 0; i < gate.limit; i++) leaked.push(await gate.acquire({ waitMs: 0 }));
    expect(gate.inFlight).toBe(gate.limit);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + gate.staleMs + 1_000);
      expect(await provider.acquirePageSlot()).not.toBeNull();
      expect(gate.snapshot().reclaimed).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a queued acquire when the caller disconnects", async () => {
    const provider = await newProvider();
    const gate = getGate("puppeteer");
    for (let i = 0; i < gate.limit; i++) await provider.acquirePageSlot();
    const controller = new AbortController();
    const pending = provider.acquirePageSlot(controller.signal);
    controller.abort();
    expect(await pending).toBeNull();
    // The abandoned waiter must not stay queued: a later release would hand
    // the slot to an already-settled promise and silently lose capacity.
    expect(gate.queued).toBe(0);
  });

  it("refuses rather than queueing forever when the queue window is zero", async () => {
    const provider = await newProvider();
    const gate = getGate("puppeteer");
    for (let i = 0; i < gate.limit; i++) await provider.acquirePageSlot({ waitMs: 0 });
    // Bounded queue: a full page budget with no wait time fails fast instead
    // of piling up promises.
    expect(await provider.acquirePageSlot({ waitMs: 0 })).toBeNull();
    expect(gate.queued).toBe(0);
  });
});
