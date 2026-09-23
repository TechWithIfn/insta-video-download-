import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveAudioPage, isAudioPageUrl } from "@/lib/audio-resolve";
import { AppError } from "@/lib/errors";

afterEach(() => {
  vi.unstubAllGlobals();
});

const AUDIO_URL = "https://www.instagram.com/reels/audio/409293986509384/";

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

describe("isAudioPageUrl", () => {
  it("matches dedicated audio page URLs only", () => {
    expect(isAudioPageUrl(AUDIO_URL)).toBe(true);
    expect(isAudioPageUrl("https://www.instagram.com/reel/Cxyz123/")).toBe(false);
    expect(isAudioPageUrl("https://www.instagram.com/p/Cxyz123/")).toBe(false);
  });
});

describe("resolveAudioPage", () => {
  it("uses a directly exposed page video without further requests", async () => {
    const fetchMock = vi.fn(async () =>
      htmlResponse(
        `<html><head>` +
          `<meta property="og:video" content="https://scontent.cdninstagram.com/v/direct.mp4?a=1" />` +
          `<meta property="og:image" content="https://scontent.cdninstagram.com/v/cover.jpg" />` +
          `<meta property="og:title" content="Cool Song" />` +
          `</head><body></body></html>`
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await resolveAudioPage(AUDIO_URL);
    expect(result.type).toBe("AUDIO");
    expect(result.media).toHaveLength(1);
    expect(result.media[0].type).toBe("video");
    expect(result.media[0].url).toContain("direct.mp4");
    expect(result.title).toContain("Cool Song");
  });

  it("resolves via a linked clip when the page has no direct source", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (typeof url === "string" && url.includes("/reels/audio/")) {
          return htmlResponse(
            `<html><head>` +
              `<meta property="og:image" content="https://scontent.cdninstagram.com/v/cover.jpg" />` +
              `</head><body><a href="/reel/CLIP99/">use sound</a></body></html>`
          );
        }
        return htmlResponse(
          `<html><head>` +
            `<meta property="og:video" content="https://scontent.cdninstagram.com/v/clip.mp4?a=1" />` +
            `</head><body></body></html>`
        );
      })
    );
    const result = await resolveAudioPage(AUDIO_URL);
    expect(result.type).toBe("AUDIO");
    expect(result.media).toHaveLength(1);
    expect(result.media[0].url).toContain("clip.mp4");
  });

  it("throws a login-specific error on login-walled audio pages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        htmlResponse(`<html><body><input name="username" /><p>Log in to Instagram</p></body></html>`)
      )
    );
    const err = await resolveAudioPage(AUDIO_URL).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("AUDIO_NO_SOURCE");
    expect((err as AppError).message).toContain("login");
  });

  it("throws a precise no-clips error when nothing is exposed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        htmlResponse(`<html><head></head><body><p>audio page, nothing usable</p></body></html>`)
      )
    );
    const err = await resolveAudioPage(AUDIO_URL).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("AUDIO_NO_SOURCE");
    expect((err as AppError).message).toContain("no accessible clips");
  });

  it("never mentions generic extraction failure for audio pages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => htmlResponse(`<html><body>empty</body></html>`))
    );
    const err = await resolveAudioPage(AUDIO_URL).catch((e) => e);
    expect((err as AppError).message).not.toBe(
      "Audio extraction is currently unavailable. Please try again."
    );
  });
});
