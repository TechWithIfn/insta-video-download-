import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { launchMock } = vi.hoisted(() => ({ launchMock: vi.fn() }));

vi.mock("puppeteer", () => ({
  default: { launch: launchMock },
}));

import { PuppeteerProvider } from "@/lib/providers/puppeteer";

function connectionClosedError(): Error {
  const err = new Error("Connection closed.") as Error & { code?: number };
  err.name = "ConnectionClosedError";
  err.code = -32000;
  return err;
}

function makePage() {
  return {
    evaluateOnNewDocument: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    setViewport: vi.fn(async () => undefined),
    setUserAgent: vi.fn(async () => undefined),
    setExtraHTTPHeaders: vi.fn(async () => undefined),
    setRequestInterception: vi.fn(async () => undefined),
    on: vi.fn(),
  };
}

function makeBrowser() {
  const page = makePage();
  const browser = {
    isConnected: vi.fn(() => true),
    pages: vi.fn(async () => []),
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  };
  return { browser, page };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function internals(provider: PuppeteerProvider): any {
  return provider as unknown as {
    openPageWithRecovery(): Promise<unknown>;
    browser: unknown;
    ensureBrowser(): Promise<void>;
  };
}

describe("PuppeteerProvider stale-browser recovery (root cause of the generic temporary error)", () => {
  beforeEach(() => {
    launchMock.mockReset();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    launchMock.mockReset();
  });

  it("opens a page from a healthy browser with a single launch", async () => {
    const { browser, page } = makeBrowser();
    launchMock.mockResolvedValue(browser);

    const provider = new PuppeteerProvider();
    const opened = await internals(provider).openPageWithRecovery();

    expect(opened).toBe(page);
    expect(launchMock).toHaveBeenCalledTimes(1);
  });

  it("detects a dead browser handle, resets it and relaunches instead of failing", async () => {
    const first = makeBrowser();
    const second = makeBrowser();
    launchMock.mockResolvedValueOnce(first.browser).mockResolvedValueOnce(second.browser);

    const provider = new PuppeteerProvider();
    await internals(provider).openPageWithRecovery();
    expect(launchMock).toHaveBeenCalledTimes(1);

    // Chromium died but the handle survived: isConnected() now reports false.
    first.browser.isConnected.mockReturnValue(false);

    const opened = await internals(provider).openPageWithRecovery();

    expect(launchMock).toHaveBeenCalledTimes(2);
    expect(opened).toBe(second.page);
  });

  it("recovers from Connection closed. with exactly one relaunch", async () => {
    const first = makeBrowser();
    const second = makeBrowser();
    first.browser.newPage.mockRejectedValueOnce(connectionClosedError());
    launchMock.mockResolvedValueOnce(first.browser).mockResolvedValueOnce(second.browser);

    const provider = new PuppeteerProvider();
    const opened = await internals(provider).openPageWithRecovery();

    expect(opened).toBe(second.page);
    expect(launchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed launch: the next attempt launches again", async () => {
    launchMock.mockRejectedValueOnce(new Error("chrome crashed during launch"));
    launchMock.mockResolvedValueOnce(makeBrowser().browser);

    const provider = new PuppeteerProvider();
    await expect(internals(provider).openPageWithRecovery()).rejects.toThrow(
      "chrome crashed during launch"
    );

    const opened = await internals(provider).openPageWithRecovery();
    expect(opened).toBeTruthy();
    expect(launchMock).toHaveBeenCalledTimes(2);
  });

  it("resolve() maps a dead-connection failure to PROVIDER_UNAVAILABLE and drops the handle", async () => {
    const { browser } = makeBrowser();
    browser.newPage.mockRejectedValue(connectionClosedError());
    launchMock.mockResolvedValue(browser);

    const html =
      '<html><head><meta property="og:image" content="https://scontent-iad3-2.xx.fbcdn.net/v/t.jpg"></head><body></body></html>';
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }))
    );

    const provider = new PuppeteerProvider();
    await expect(provider.resolve("https://www.instagram.com/reel/DeadBrowser1/")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });

    // The stale handle must be gone so the NEXT request relaunches cleanly.
    expect(internals(provider).browser).toBeNull();
    expect(launchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
