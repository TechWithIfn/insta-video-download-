import { describe, it, expect } from "vitest";
import { MockProvider } from "@/lib/providers/mock";

describe("MockProvider", () => {
  const provider = new MockProvider();

  it("has correct name", () => {
    expect(provider.name).toBe("mock");
  });

  it("resolves a reel URL", async () => {
    const result = await provider.resolve(
      "https://www.instagram.com/reel/Cxyz123/"
    );
    expect(result.type).toBe("REEL");
    expect(result.media.length).toBeGreaterThanOrEqual(1);
    expect(result.media[0].type).toBe("video");
    expect(result.author).toEqual({
      username: "mock_user",
      displayName: "Mock User",
    });
    expect(result.thumbnail).toBeTruthy();
    expect(result.title).toContain("reel");
  });

  it("resolves a post URL with carousel items", async () => {
    const result = await provider.resolve(
      "https://www.instagram.com/p/Cxyz123/"
    );
    expect(result.type).toBe("POST");
    expect(result.media.length).toBe(3);
    expect(result.media[0].type).toBe("image");
    expect(result.media[1].type).toBe("image");
    expect(result.media[2].type).toBe("image");
  });

  it("resolves a TV/video URL", async () => {
    const result = await provider.resolve(
      "https://www.instagram.com/tv/Cxyz123/"
    );
    expect(result.type).toBe("VIDEO");
    expect(result.media[0].type).toBe("video");
  });

  it("resolves a story URL with single item", async () => {
    const result = await provider.resolve(
      "https://www.instagram.com/stories/johndoe/12345/"
    );
    expect(result.type).toBe("STORY");
    expect(result.media.length).toBe(1);
    expect(result.media[0].width).toBe(1080);
    expect(result.media[0].height).toBe(1920);
    expect(result.author?.username).toBe("johndoe");
    expect(result.sourceUrl).toBe(
      "https://www.instagram.com/stories/johndoe/12345/"
    );
  });

  it("resolves a story URL with video media", async () => {
    const result = await provider.resolve(
      "https://www.instagram.com/stories/videouser/99999/"
    );
    expect(result.type).toBe("STORY");
    expect(result.media.length).toBe(1);
    const item = result.media[0];
    expect(["video", "image"]).toContain(item.type);
    if (item.type === "video") {
      expect(item.duration).toBe(15);
      expect(item.format).toBe("mp4");
    } else {
      expect(item.format).toBe("jpg");
    }
  });

  it("resolves a highlight URL with multiple items", async () => {
    const result = await provider.resolve(
      "https://www.instagram.com/stories/highlights/123456789/"
    );
    expect(result.type).toBe("HIGHLIGHT");
    expect(result.media.length).toBe(3);
    expect(result.author?.username).toBe("mock_user");
    expect(result.thumbnail).toBeTruthy();
    expect(result.sourceUrl).toBe(
      "https://www.instagram.com/stories/highlights/123456789/"
    );
  });

  it("highlight contains mixed image and video items", async () => {
    const result = await provider.resolve(
      "https://www.instagram.com/stories/highlights/123456789/"
    );
    expect(result.type).toBe("HIGHLIGHT");
    const types = result.media.map((m) => m.type);
    expect(types).toContain("image");
    expect(types).toContain("video");
  });

  it("highlight items have 9:16 aspect ratio", async () => {
    const result = await provider.resolve(
      "https://www.instagram.com/stories/highlights/123456789/"
    );
    for (const item of result.media) {
      expect(item.width).toBe(1080);
      expect(item.height).toBe(1920);
    }
  });

  it("resolves an audio page URL as AUDIO with a source video", async () => {
    const result = await provider.resolve(
      "https://www.instagram.com/reels/audio/409293986509384/"
    );
    expect(result.type).toBe("AUDIO");
    expect(result.media.length).toBe(1);
    expect(result.media[0].type).toBe("video");
  });

  it("returns author information", async () => {
    const result = await provider.resolve(
      "https://www.instagram.com/p/Cxyz123/"
    );
    expect(result.author).not.toBeNull();
    expect(result.author?.username).toBeTruthy();
    expect(result.author?.displayName).toBeTruthy();
  });

  it("returns valid media URLs", async () => {
    const result = await provider.resolve(
      "https://www.instagram.com/p/Cxyz123/"
    );
    for (const item of result.media) {
      expect(item.url).toMatch(/^https?:\/\//);
      expect(item.width).toBeGreaterThan(0);
      expect(item.height).toBeGreaterThan(0);
    }
  });
});
