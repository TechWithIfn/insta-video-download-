import { describe, it, expect, vi, afterEach } from "vitest";
import {
  extractMediaFromJson,
  sortVideoFirst,
  fetchMetadata,
} from "@/lib/providers/puppeteer";
import type { MediaItem } from "@/lib/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

function item(url: string, type: "video" | "image"): MediaItem {
  return {
    url,
    type,
    width: null,
    height: null,
    duration: null,
    thumbnail: null,
    format: type === "video" ? "mp4" : null,
  };
}

describe("extractMediaFromJson", () => {
  it("finds video_url and playback_url as video", () => {
    const html =
      `{"video_url":"https://scontent-a.xx.fbcdn.net/v/1.mp4?x=1",` +
      `"playback_url":"https://scontent-b.xx.fbcdn.net/v/2.mp4?y=2",` +
      `"display_url":"https://scontent-c.xx.fbcdn.net/v/3.jpg?z=3"}`;
    const found = extractMediaFromJson(html);
    const videos = found.filter((m) => m.type === "video").map((m) => m.url);
    expect(videos).toHaveLength(2);
    expect(videos[0]).toContain("1.mp4");
    expect(videos[1]).toContain("2.mp4");
  });
});

describe("fetchMetadata embedded video scan", () => {
  function stubHtml(html: string): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(html, {
          status: 200,
          headers: { "content-type": "text/html" },
        })
      )
    );
  }

  it("uses embedded video_url JSON as the video source when og:video is absent", async () => {
    stubHtml(
      `<html><head>` +
        `<meta property="og:image" content="https://scontent.cdninstagram.com/img.jpg?a=1" />` +
        `</head><body>` +
        `<script>{"video_url":"https://scontent-a.xx.fbcdn.net/v/reel.mp4?sig=abc"}</script>` +
        `</body></html>`
    );
    const meta = await fetchMetadata("https://www.instagram.com/reel/Test123/");
    expect(meta.loginWall).toBe(false);
    expect(meta.ogVideo).toContain("reel.mp4");
    expect(meta.ogImage).toContain("img.jpg");
  });

  it("does not trust embedded video URLs from non-CDN hosts", async () => {
    stubHtml(
      `<html><head></head><body>` +
        `<script>{"video_url":"https://evil.example.com/v/x.mp4"}</script>` +
        `</body></html>`
    );
    const meta = await fetchMetadata("https://www.instagram.com/reel/Test123/");
    expect(meta.ogVideo).toBeNull();
  });

  it("returns image-only metadata when no video signal exists", async () => {
    stubHtml(
      `<html><head>` +
        `<meta property="og:image" content="https://scontent.cdninstagram.com/img.jpg?a=1" />` +
        `</head><body><p>hello</p></body></html>`
    );
    const meta = await fetchMetadata("https://www.instagram.com/reel/Test123/");
    expect(meta.ogVideo).toBeNull();
    expect(meta.ogImage).toContain("img.jpg");
  });
});

describe("sortVideoFirst", () => {
  const img1 = item("https://scontent.cdninstagram.com/a.jpg", "image");
  const vid = item("https://scontent-a.xx.fbcdn.net/v/b.mp4", "video");
  const img2 = item("https://scontent.cdninstagram.com/c.jpg", "image");

  it("moves video first for REEL without disturbing relative order", () => {
    expect(sortVideoFirst([img1, vid, img2], "REEL").map((m) => m.url)).toEqual([
      vid.url,
      img1.url,
      img2.url,
    ]);
  });

  it("leaves POST/carousel order untouched", () => {
    expect(sortVideoFirst([img1, vid, img2], "POST")).toEqual([img1, vid, img2]);
  });

  it("leaves image-only reels untouched", () => {
    expect(sortVideoFirst([img1, img2], "REEL")).toEqual([img1, img2]);
  });
});
