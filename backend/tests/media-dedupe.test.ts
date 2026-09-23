import { describe, it, expect } from "vitest";
import { dedupeExactUrls, dedupeMediaItems } from "@/lib/resolvers/index";
import type { MediaItem } from "@/lib/types";

function item(url: string, overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    url,
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

describe("dedupeExactUrls", () => {
  it("drops byte-identical URL duplicates", () => {
    const a = item("https://scontent.cdninstagram.com/v/1.jpg?x=1");
    const b = item("https://scontent.cdninstagram.com/v/2.jpg?x=2");
    expect(dedupeExactUrls([a, a, b])).toEqual([a, b]);
  });
});

describe("dedupeMediaItems", () => {
  it("collapses same-image renditions keeping the largest copy", () => {
    const small =
      "https://scontent.cdninstagram.com/v/t51.82787-15/782252598_17914872441436842_1994145216778006982_n.heic?stp=c288.0.864.864a_dst-jpg_e35_s640x640";
    const large =
      "https://instagram.fdel11-3.fna.fbcdn.net/v/t51.82787-15/782252598_17914872441436842_1994145216778006982_n.heic?stp=dst-jpg_e35";
    const other =
      "https://instagram.fdel11-2.fna.fbcdn.net/v/t51.82787-15/784197389_17914872456436842_1794084067509869878_n.heic?stp=dst-jpg_e35";
    const items = [
      item(small, { width: 640, height: 640, size: 45594, format: "jpg" }),
      item(large, { width: 1440, height: 1440, size: 180764, format: "jpg" }),
      item(other, { width: 1440, height: 1440, size: 142515, format: "jpg" }),
      item(small, { width: 640, height: 640, size: 45594, format: "jpg" }),
    ];
    const out = dedupeMediaItems(items);
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe(large);
    expect(out[1].url).toBe(other);
  });

  it("preserves order of unique images and never reorders", () => {
    const a = item("https://scontent.cdninstagram.com/a.jpg");
    const b = item("https://scontent.cdninstagram.com/b.jpg");
    const c = item("https://scontent.cdninstagram.com/c.jpg");
    expect(dedupeMediaItems([a, b, c]).map((m) => m.url)).toEqual([a.url, b.url, c.url]);
  });

  it("keeps unparseable URLs instead of dropping them", () => {
    const bad = item("not a url");
    const good = item("https://scontent.cdninstagram.com/a.jpg");
    expect(dedupeMediaItems([bad, good])).toHaveLength(2);
  });
});
