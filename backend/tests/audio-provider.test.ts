import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveAudioViaProvider,
  isAudioProviderConfigured,
  isTrustedProviderMediaUrl,
} from "@/lib/audio-provider";
import { AppError } from "@/lib/errors";

const ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...ENV };
  delete process.env.AUDIO_PROVIDER_URL;
  delete process.env.AUDIO_PROVIDER_KEY;
});

afterEach(() => {
  process.env = ENV;
  vi.unstubAllGlobals();
});

function configure(): void {
  process.env.AUDIO_PROVIDER_URL = "https://audio-api.example.com/resolve";
  process.env.AUDIO_PROVIDER_KEY = "secret-key";
}

describe("isAudioProviderConfigured", () => {
  it("is false without credentials and never exposes them", () => {
    expect(isAudioProviderConfigured()).toBe(false);
    configure();
    expect(isAudioProviderConfigured()).toBe(true);
  });
});

describe("isTrustedProviderMediaUrl", () => {
  it("allows public https hosts and blocks the rest", () => {
    expect(isTrustedProviderMediaUrl("https://cdn.example.com/a.mp3")).toBe(true);
    expect(isTrustedProviderMediaUrl("http://cdn.example.com/a.mp3")).toBe(false);
    expect(isTrustedProviderMediaUrl("https://127.0.0.1/a.mp3")).toBe(false);
    expect(isTrustedProviderMediaUrl("https://user:pass@cdn.example.com/a.mp3")).toBe(false);
    expect(isTrustedProviderMediaUrl("not a url")).toBe(false);
  });
});

describe("resolveAudioViaProvider", () => {
  it("returns null when unconfigured (falls back to page lookup)", async () => {
    const out = await resolveAudioViaProvider("123", "https://www.instagram.com/reels/audio/123/");
    expect(out).toBeNull();
  });

  it("returns AUDIO with a direct audio file", async () => {
    configure();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          success: true,
          data: {
            title: "Cool Song",
            duration: 29.5,
            audioUrl: "https://cdn.example.com/tracks/song.mp3",
          },
        })
      )
    );
    const out = await resolveAudioViaProvider("123", "https://www.instagram.com/reels/audio/123/");
    expect(out?.type).toBe("AUDIO");
    expect(out?.media).toHaveLength(1);
    expect(out?.media[0].type).toBe("audio");
    expect(out?.media[0].url).toContain("song.mp3");
    expect(out?.title).toBe("Cool Song");
  });

  it("normalizes a media[] payload and drops untrusted URLs", async () => {
    configure();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          success: true,
          data: {
            media: [
              { url: "https://cdn.example.com/a.mp3", type: "audio" },
              { url: "http://127.0.0.1/evil.mp3", type: "audio" },
            ],
          },
        })
      )
    );
    const out = await resolveAudioViaProvider("123", "https://www.instagram.com/reels/audio/123/");
    expect(out?.media).toHaveLength(1);
    expect(out?.media[0].url).toContain("cdn.example.com");
  });

  it("throws precise errors instead of generic ones", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    const err = await resolveAudioViaProvider("1", "https://x/").catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("PROVIDER_NOT_CONFIGURED");
  });

  it("throws AUDIO_NO_SOURCE when the provider has nothing usable", async () => {
    configure();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: true, data: { media: [] } }))
    );
    const err = await resolveAudioViaProvider("1", "https://x/").catch((e) => e);
    expect((err as AppError).code).toBe("AUDIO_NO_SOURCE");
  });
});
