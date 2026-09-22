import { describe, it, expect } from "vitest";
import { PuppeteerProvider } from "@/lib/providers/puppeteer";

// Access private slot machinery for unit testing (compile-time only).
function slotsOf(provider: PuppeteerProvider): any {
  return provider as any;
}

describe("Puppeteer page slots", () => {
  it("grants up to the concurrency bound", async () => {
    const provider = slotsOf(new PuppeteerProvider());
    expect(await provider.acquirePageSlot()).toBe(true);
    expect(await provider.acquirePageSlot()).toBe(true);
    expect(await provider.acquirePageSlot()).toBe(true);
    expect(provider.pageSlots.length).toBe(3);
  });

  it("release frees the slot for the next resolve (no permanent leak)", async () => {
    const provider = slotsOf(new PuppeteerProvider());
    await provider.acquirePageSlot();
    await provider.acquirePageSlot();
    await provider.acquirePageSlot();
    provider.releasePageSlot();
    expect(provider.pageSlots.length).toBe(2);
    // Previously the slot was never released: the 4th acquire would hang
    // until timeout and every later resolve returned SERVER_OVERLOADED.
    expect(await provider.acquirePageSlot()).toBe(true);
    expect(provider.pageSlots.length).toBe(3);
  });

  it("reclaims slots leaked by killed/frozen runtimes", async () => {
    const provider = slotsOf(new PuppeteerProvider());
    const ancient = Date.now() - 200_000;
    provider.pageSlots = [ancient, ancient, ancient];
    expect(await provider.acquirePageSlot()).toBe(true);
    expect(provider.pageSlots.length).toBe(1);
  });

  it("keeps recently held slots", async () => {
    const provider = slotsOf(new PuppeteerProvider());
    const now = Date.now();
    provider.pageSlots = [now, now, now];
    provider.reclaimStalePageSlots();
    expect(provider.pageSlots.length).toBe(3);
  });
});
