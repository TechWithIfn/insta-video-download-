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

    it("accepts an audio page URL as AUDIO, not a reel", () => {
      const result = validateInstagramUrl("https://www.instagram.com/reels/audio/409293986509384/");
      expect(result.valid).toBe(true);
      expect(result.parsed?.contentType).toBe("AUDIO");
    });

    it("accepts a story URL", () => {
      const result = validateInstagramUrl("https://www.instagram.com/stories/username/12345/");
      expect(result.valid).toBe(true);
      expect(result.parsed?.contentType).toBe("STORY");
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
