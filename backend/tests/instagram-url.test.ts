import { describe, it, expect } from "vitest";
import { validateInstagramUrl } from "@/lib/validators/instagram-url";

describe("validateInstagramUrl", () => {
  describe("valid URLs", () => {
    it("accepts a standard post URL", () => {
      const result = validateInstagramUrl("https://www.instagram.com/p/Cxyz123/");
      expect(result.valid).toBe(true);
      expect(result.parsed?.contentType).toBe("POST");
    });

    it("accepts a reel URL", () => {
      const result = validateInstagramUrl("https://www.instagram.com/reel/Cxyz123/");
      expect(result.valid).toBe(true);
      expect(result.parsed?.contentType).toBe("REEL");
    });

    it("accepts a reels URL", () => {
      const result = validateInstagramUrl("https://www.instagram.com/reels/Cxyz123/");
      expect(result.valid).toBe(true);
      expect(result.parsed?.contentType).toBe("REEL");
    });

    it("parses img_index as a 0-based slide index and strips it from the URL", () => {
      const result = validateInstagramUrl("https://www.instagram.com/p/DcWV7JVE10j/?img_index=9");
      expect(result.valid).toBe(true);
      expect(result.parsed?.contentType).toBe("POST");
      expect(result.parsed?.slideIndex).toBe(8);
      expect(result.parsed?.normalized).not.toContain("img_index");
    });

    it("returns null slide index without img_index", () => {
      const result = validateInstagramUrl("https://www.instagram.com/p/DcWV7JVE10j/");
      expect(result.valid).toBe(true);
      expect(result.parsed?.slideIndex).toBeNull();
    });

    it("resolves the same collection identity with and without img_index", () => {
      const base = validateInstagramUrl("https://www.instagram.com/p/DdPBl2PE1J7/");
      const indexed = validateInstagramUrl("https://www.instagram.com/p/DdPBl2PE1J7/?img_index=2");
      expect(base.valid).toBe(true);
      expect(indexed.valid).toBe(true);
      // Same canonical collection (shared cache), different start slide.
      expect(indexed.parsed?.normalized).toBe(base.parsed?.normalized);
      expect(indexed.parsed?.slideIndex).toBe(1);
      expect(base.parsed?.slideIndex).toBeNull();
    });

    it("accepts an audio page URL as AUDIO, not a reel", () => {
      const result = validateInstagramUrl("https://www.instagram.com/reels/audio/409293986509384/");
      expect(result.valid).toBe(true);
      expect(result.parsed?.contentType).toBe("AUDIO");
      expect(result.parsed?.audioId).toBe("409293986509384");
    });

    it("accepts a story URL", () => {
      const result = validateInstagramUrl("https://www.instagram.com/stories/username/12345/");
      expect(result.valid).toBe(true);
      expect(result.parsed?.contentType).toBe("STORY");
      expect(result.parsed?.storyUsername).toBe("username");
      expect(result.parsed?.storyId).toBe("12345");
    });

    it("keeps story identity while stripping tracking parameters", () => {
      const withTracking = validateInstagramUrl(
        "https://www.instagram.com/stories/akhyanx/3992641005173656578?utm_source=ig_story_item_share&stkn=abc"
      );
      const withoutTracking = validateInstagramUrl(
        "https://www.instagram.com/stories/akhyanx/3992641005173656578"
      );
      expect(withTracking.valid).toBe(true);
      expect(withTracking.parsed?.normalized).toBe(
        "https://www.instagram.com/stories/akhyanx/3992641005173656578"
      );
      expect(withTracking.parsed?.normalized).not.toContain("utm_source");
      expect(withTracking.parsed?.normalized).toBe(withoutTracking.parsed?.normalized);
      expect(withTracking.parsed?.storyId).toBe("3992641005173656578");
    });

    it("accepts a highlight URL", () => {
      const result = validateInstagramUrl("https://www.instagram.com/stories/highlights/123456789/");
      expect(result.valid).toBe(true);
      expect(result.parsed?.contentType).toBe("HIGHLIGHT");
    });

    it("accepts a TV/video URL", () => {
      const result = validateInstagramUrl("https://www.instagram.com/tv/Cxyz123/");
      expect(result.valid).toBe(true);
      expect(result.parsed?.contentType).toBe("VIDEO");
    });

    it("accepts URL without www", () => {
      const result = validateInstagramUrl("https://instagram.com/p/Cxyz123/");
      expect(result.valid).toBe(true);
      expect(result.parsed?.hostname).toBe("instagram.com");
    });

    it("strips tracking parameters", () => {
      const result = validateInstagramUrl(
        "https://www.instagram.com/p/Cxyz123/?utm_source=ig&igshid=abc123"
      );
      expect(result.valid).toBe(true);
      expect(result.parsed?.normalized).not.toContain("utm_source");
      expect(result.parsed?.normalized).not.toContain("igshid");
    });

    it("extracts shortcode from post URL", () => {
      const result = validateInstagramUrl("https://www.instagram.com/p/ABC123def/");
      expect(result.valid).toBe(true);
      expect(result.parsed?.shortcode).toBe("ABC123def");
    });

    it("extracts username from story URL", () => {
      const result = validateInstagramUrl(
        "https://www.instagram.com/stories/johndoe/12345/"
      );
      expect(result.valid).toBe(true);
      expect(result.parsed?.storyUsername).toBe("johndoe");
    });

    it("extracts highlight ID from highlight URL", () => {
      const result = validateInstagramUrl(
        "https://www.instagram.com/stories/highlights/17892345678/"
      );
      expect(result.valid).toBe(true);
      expect(result.parsed?.highlightId).toBe("17892345678");
    });
  });

  describe("invalid URLs", () => {
    it("rejects empty string", () => {
      const result = validateInstagramUrl("");
      expect(result.valid).toBe(false);
    });

    it("rejects whitespace-only string", () => {
      const result = validateInstagramUrl("   ");
      expect(result.valid).toBe(false);
    });

    it("rejects non-Instagram domain", () => {
      const result = validateInstagramUrl("https://www.google.com/p/ABC/");
      expect(result.valid).toBe(false);
    });

    it("rejects malformed URL", () => {
      const result = validateInstagramUrl("not-a-url");
      expect(result.valid).toBe(false);
    });

    it("rejects javascript: URL", () => {
      const result = validateInstagramUrl("javascript:alert(1)");
      expect(result.valid).toBe(false);
    });

    it("rejects data: URL", () => {
      const result = validateInstagramUrl("data:text/html,<h1>test</h1>");
      expect(result.valid).toBe(false);
    });

    it("rejects unsupported Instagram path", () => {
      const result = validateInstagramUrl("https://www.instagram.com/direct/inbox/");
      expect(result.valid).toBe(false);
    });

    it("rejects login page URL", () => {
      const result = validateInstagramUrl("https://www.instagram.com/accounts/login/");
      expect(result.valid).toBe(false);
    });

    it("rejects signup page URL", () => {
      const result = validateInstagramUrl("https://www.instagram.com/accounts/signup/");
      expect(result.valid).toBe(false);
    });

    it("rejects URL longer than 2048 characters", () => {
      const longUrl = "https://www.instagram.com/p/" + "a".repeat(2100) + "/";
      const result = validateInstagramUrl(longUrl);
      expect(result.valid).toBe(false);
    });
  });

  describe("SSRF prevention", () => {
    it("rejects non-http protocols", () => {
      const result = validateInstagramUrl("ftp://instagram.com/p/ABC/");
      expect(result.valid).toBe(false);
    });

    it("rejects IP-based URLs", () => {
      const result = validateInstagramUrl("http://127.0.0.1/p/ABC/");
      expect(result.valid).toBe(false);
    });

    it("rejects URLs with host header injection", () => {
      const result = validateInstagramUrl("https://evil.com@instagram.com/p/ABC/");
      expect(result.valid).toBe(false);
    });
  });
});
