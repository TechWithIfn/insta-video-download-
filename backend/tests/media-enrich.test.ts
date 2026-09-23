import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseImageDimensions,
  formatFromContentType,
  enrichMediaItems,
} from "@/lib/media-enrich";
import type { MediaItem } from "@/lib/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    url: "https://scontent.cdninstagram.com/v/img.jpg",
    type: "image",
    width: null,
    height: null,
    duration: null,
    size: null,
    thumbnail: null,
    format: null,
    ...overrides,
  };
}

describe("parseImageDimensions", () => {
  it("parses PNG IHDR dimensions", () => {
    const buf = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x04, 0x38,
      0x00, 0x00, 0x05, 0x46,
      0x08, 0x02, 0x00, 0x00, 0x00,
    ]);
    expect(parseImageDimensions(buf)).toEqual({ width: 1080, height: 1350 });
  });

  it("parses JPEG SOF dimensions", () => {
    const buf = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x0b, 0x08, 0x04, 0x38, 0x05, 0x50,
      0x01, 0x02, 0x03, 0x04,
    ]);
    expect(parseImageDimensions(buf)).toEqual({ width: 1360, height: 1080 });
  });

  it("parses GIF dimensions", () => {
    const buf = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
      0x38, 0x04, 0x46, 0x05,
      0x00, 0x00, 0x00,
    ]);
    expect(parseImageDimensions(buf)).toEqual({ width: 1080, height: 1350 });
  });

  it("parses WebP VP8X canvas size", () => {
    const buf = new Uint8Array([
      0x52, 0x49, 0x46, 0x46,
      0x00, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x58,
      0x0a, 0x00, 0x00, 0x00,
      0x00,
      0x37, 0x04, 0x00,
      0x45, 0x05, 0x00,
    ]);
    expect(parseImageDimensions(buf)).toEqual({ width: 1080, height: 1350 });
  });

  it("returns null for garbage bytes", () => {
    expect(parseImageDimensions(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))).toBeNull();
    expect(parseImageDimensions(new Uint8Array(0))).toBeNull();
  });
});

describe("formatFromContentType", () => {
  it("maps common media content types", () => {
    expect(formatFromContentType("image/jpeg")).toBe("jpg");
    expect(formatFromContentType("image/png")).toBe("png");
    expect(formatFromContentType("image/webp")).toBe("webp");
    expect(formatFromContentType("video/mp4")).toBe("mp4");
    expect(formatFromContentType("text/html")).toBeNull();
    expect(formatFromContentType(null)).toBeNull();
  });
});

describe("enrichMediaItems", () => {
  it("leaves complete items untouched without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const item = baseItem({ width: 1080, height: 1350, size: 12345, format: "jpg" });
    const out = await enrichMediaItems([item]);
    expect(out[0]).toEqual(item);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fills size and format from a HEAD probe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, {
        status: 200,
        headers: { "content-length": "54321", "content-type": "video/mp4" },
      }))
    );
    const item = baseItem({
      url: "https://scontent.cdninstagram.com/v/clip.mp4",
      type: "video",
      width: 1080,
      height: 1920,
    });
    const out = await enrichMediaItems([item]);
    expect(out[0].size).toBe(54321);
    expect(out[0].format).toBe("mp4");
    expect(out).toHaveLength(1);
  });

  it("parses real dimensions from a ranged GET", async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x04, 0x38,
      0x00, 0x00, 0x05, 0x46,
      0x08, 0x02, 0x00, 0x00, 0x00,
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if ((init?.method || "GET") === "HEAD") {
          return new Response(null, { status: 405 });
        }
        return new Response(png, {
          status: 206,
          headers: { "content-length": "999", "content-type": "image/png" },
        });
      })
    );
    const out = await enrichMediaItems([baseItem()]);
    expect(out[0].width).toBe(1080);
    expect(out[0].height).toBe(1350);
    expect(out[0].format).toBe("png");
    expect(out[0].size).toBe(999);
  });

  it("never throws and preserves item count/order on probe failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    const items = [baseItem(), baseItem({ url: "https://scontent.cdninstagram.com/v/2.jpg" })];
    const out = await enrichMediaItems(items);
    expect(out).toEqual(items);
  });
});
