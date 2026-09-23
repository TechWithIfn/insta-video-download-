import { describe, it, expect, vi, afterEach } from "vitest";
import {
  extractMediaFromJson,
  extractSidecarFromJson,
  extractSidecarFromEmbedHtml,
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

describe("extractSidecarFromJson", () => {
  function edge(i: number, video: boolean): object {
    return {
      node: {
        __typename: video ? "GraphVideo" : "GraphImage",
        id: `media-${i}`,
        is_video: video,
        ...(video
          ? { video_url: `https://scontent.cdninstagram.com/v/clip${i}.mp4?x=${i}` }
          : {}),
        display_url: `https://scontent.cdninstagram.com/v/slide${i}.jpg?x=${i}`,
        dimensions: { width: 1080, height: 1350 },
      },
    };
  }

  it("returns all 11 children in order with real dimensions", () => {
    const edges = Array.from({ length: 11 }, (_, i) => edge(i + 1, i === 5));
    const payload = JSON.stringify({
      data: {
        shortcode_media: {
          edge_sidecar_to_children: {
            edges,
            page_info: { has_next_page: false, end_cursor: null },
          },
        },
      },
    });
    const page = extractSidecarFromJson(payload);
    // 10 images + 1 video + its poster = 12 entries, images in slide order.
    expect(page.items).toHaveLength(12);
    expect(page.items[0].url).toContain("slide1.jpg");
    expect(page.items[0].width).toBe(1080);
    expect(page.items[0].height).toBe(1350);
    const videos = page.items.filter((m) => m.type === "video");
    expect(videos).toHaveLength(1);
    expect(videos[0].url).toContain("clip6.mp4");
    expect(page.hasMore).toBe(false);
  });

  it("parses pagination state for cursor following", () => {
    const payload = JSON.stringify({
      edge_sidecar_to_children: {
        edges: [edge(1, false), edge(2, false)],
        page_info: { has_next_page: true, end_cursor: "CURSOR123" },
      },
    });
    const page = extractSidecarFromJson(payload);
    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.endCursor).toBe("CURSOR123");
  });

  it("parses carousel_media children with best candidates", () => {
    const payload = JSON.stringify({
      items: [
        {
          carousel_media: [
            {
              image_versions2: {
                candidates: [
                  { width: 640, height: 640, url: "https://scontent.cdninstagram.com/v/a-small.jpg" },
                  { width: 1440, height: 1440, url: "https://scontent.cdninstagram.com/v/a-big.jpg" },
                ],
              },
            },
            {
              video_versions: [
                { width: 720, height: 1280, url: "https://scontent.cdninstagram.com/v/b.mp4" },
              ],
              display_url: "https://scontent.cdninstagram.com/v/b-poster.jpg",
            },
          ],
        },
      ],
    });
    const page = extractSidecarFromJson(payload);
    const urls = page.items.map((m) => m.url);
    expect(urls).toContain("https://scontent.cdninstagram.com/v/a-big.jpg");
    expect(urls).not.toContain("https://scontent.cdninstagram.com/v/a-small.jpg");
    expect(urls).toContain("https://scontent.cdninstagram.com/v/b.mp4");
    const big = page.items.find((m) => m.url.includes("a-big"));
    expect(big?.width).toBe(1440);
    expect(big?.height).toBe(1440);
  });

  it("never invents video URLs for video nodes without one", () => {
    const payload = JSON.stringify({
      edge_sidecar_to_children: {
        edges: [{ node: { is_video: true, display_url: "https://scontent.cdninstagram.com/v/p.jpg" } }],
        page_info: { has_next_page: false },
      },
    });
    const page = extractSidecarFromJson(payload);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].type).toBe("image");
  });

  it("returns an empty page for invalid JSON", () => {
    expect(extractSidecarFromJson("not json{{")).toEqual({ items: [], hasMore: false, endCursor: null });
  });
});

describe("extractSidecarFromEmbedHtml", () => {
  function embedHtml(childCount: number): string {
    const edges = Array.from({ length: childCount }, (_, i) => ({
      node: {
        id: `id-${i + 1}`,
        shortcode: `CHILD${i + 1}`,
        is_video: false,
        display_url: `https://scontent.cdninstagram.com/v/slide${i + 1}.jpg`,
        dimensions: { width: 1080, height: 1350 },
      },
    }));
    // Embed nests the sidecar one JSON-string level deep with \" escapes.
    const inner = JSON.stringify({
      edge_sidecar_to_children: {
        edges,
        page_info: { has_next_page: false, end_cursor: null },
      },
    }).replace(/"/g, '\\"');
    return (
      `<html><body><script>window.__emb=` +
      JSON.stringify({ gql_data: { shortcode_media: { data: inner } } }) +
      `;</script></body></html>`
    );
  }

  it("returns all 11 children in order from embed HTML", () => {
    const page = extractSidecarFromEmbedHtml(embedHtml(11));
    expect(page.items).toHaveLength(11);
    expect(page.items[0].url).toContain("slide1.jpg");
    expect(page.items[10].url).toContain("slide11.jpg");
    expect(page.items[0].width).toBe(1080);
    expect(page.items[0].height).toBe(1350);
  });

  it("returns an empty page when no sidecar exists", () => {
    expect(extractSidecarFromEmbedHtml("<html><body>hello</body></html>")).toEqual({
      items: [],
      hasMore: false,
      endCursor: null,
    });
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
