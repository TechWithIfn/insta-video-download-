import type { ResolverResult, MediaItem, InstagramContentType } from "../types.js";
import { BaseProvider } from "./base.js";

export class MockProvider extends BaseProvider {
  readonly name = "mock";

  private determineType(pathname: string): InstagramContentType {
    const segments = pathname.split("/").filter(Boolean);
    if (segments[0] === "reels" && segments[1] === "audio") return "AUDIO";
    if (segments[0] === "reel" || segments[0] === "reels") return "REEL";
    if (segments[0] === "p") return "POST";
    if (segments[0] === "tv") return "VIDEO";
    if (segments[0] === "stories") {
      if (segments.includes("highlights")) return "HIGHLIGHT";
      return "STORY";
    }
    return "UNKNOWN";
  }

  async resolve(url: string): Promise<ResolverResult> {
    const parsed = new URL(url);
    const type = this.determineType(parsed.pathname);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const shortcode = segments[1] || "MOCK123";

    // AUDIO pages resolve to a playable source video whose track is extracted.
    const isVideo = type === "REEL" || type === "VIDEO" || type === "AUDIO";

    let media: MediaItem[] = [];

    if (type === "STORY") {
      // Deterministic: derive media kind from the shortcode so repeated
      // resolves of the same URL always return the same result.
      // Explicit dev/test provider only — never used as a production fallback.
      let hash = 0;
      for (let i = 0; i < shortcode.length; i++) {
        hash = (hash * 31 + shortcode.charCodeAt(i)) >>> 0;
      }
      const isStoryVideo = hash % 2 === 0;
      media = [
        {
          url: `https://mock-cdn.example.com/story/${shortcode}/1.${isStoryVideo ? "mp4" : "jpg"}`,
          type: isStoryVideo ? "video" : "image",
          width: 1080,
          height: 1920,
          duration: isStoryVideo ? 15 : null,
          thumbnail: `https://mock-cdn.example.com/story/${shortcode}/thumb.jpg`,
          format: isStoryVideo ? "mp4" : "jpg",
        },
      ];
    } else if (type === "HIGHLIGHT") {
      const highlightId = segments.includes("highlights")
        ? segments[segments.indexOf("highlights") + 1] || "HIGHLIGHT123"
        : "HIGHLIGHT123";
      media = [
        {
          url: `https://mock-cdn.example.com/highlight/${highlightId}/1.jpg`,
          type: "image",
          width: 1080,
          height: 1920,
          duration: null,
          thumbnail: `https://mock-cdn.example.com/highlight/${highlightId}/thumb1.jpg`,
          format: "jpg",
        },
        {
          url: `https://mock-cdn.example.com/highlight/${highlightId}/2.mp4`,
          type: "video",
          width: 1080,
          height: 1920,
          duration: 12,
          thumbnail: `https://mock-cdn.example.com/highlight/${highlightId}/thumb2.jpg`,
          format: "mp4",
        },
        {
          url: `https://mock-cdn.example.com/highlight/${highlightId}/3.jpg`,
          type: "image",
          width: 1080,
          height: 1920,
          duration: null,
          thumbnail: `https://mock-cdn.example.com/highlight/${highlightId}/thumb3.jpg`,
          format: "jpg",
        },
      ];
    } else {
      media = [
        {
          url: `https://mock-cdn.example.com/media/${shortcode}/1.mp4`,
          type: isVideo ? "video" : "image",
          width: isVideo ? 1080 : 1080,
          height: isVideo ? 1920 : 1080,
          duration: isVideo ? 15 : null,
          thumbnail: `https://mock-cdn.example.com/thumb/${shortcode}.jpg`,
          format: isVideo ? "mp4" : "jpg",
        },
      ];

      if (type === "POST" && parsed.pathname.includes("/p/")) {
        media.push({
          url: `https://mock-cdn.example.com/media/${shortcode}/2.jpg`,
          type: "image",
          width: 1080,
          height: 1350,
          duration: null,
          thumbnail: null,
          format: "jpg",
        });
        media.push({
          url: `https://mock-cdn.example.com/media/${shortcode}/3.jpg`,
          type: "image",
          width: 1080,
          height: 1080,
          duration: null,
          thumbnail: null,
          format: "jpg",
        });
      }
    }

    const authorUsername =
      type === "STORY"
        ? segments[1] || "mock_user"
        : type === "HIGHLIGHT"
          ? "mock_user"
          : "mock_user";

    return {
      type,
      sourceUrl: url,
      thumbnail: media[0]?.thumbnail || `https://mock-cdn.example.com/thumb/${shortcode}.jpg`,
      title: `Mock ${type.toLowerCase()} — ${shortcode}`,
      author: {
        username: authorUsername,
        displayName: "Mock User",
      },
      media,
    };
  }
}
