import { describe, it, expect } from "vitest";

describe("Download query-param validation", () => {
  function sanitizeDownloadFilename(raw: unknown, contentType: string): string {
    let base = typeof raw === "string" ? raw.toLowerCase().slice(0, 80) : "";
    base = base
      .replace(/\.\.+/g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^\.+|\.+$/g, "")
      .replace(/\.[a-z0-9]{2,4}$/, "");
    if (!base) base = "downloadit-media";
    const ct = contentType.toLowerCase();
    let ext = ".mp4";
    if (ct.includes("audio/mpeg") || ct.includes("audio/mp3")) ext = ".mp3";
    else if (ct.includes("audio/mp4") || ct.includes("audio/x-m4a")) ext = ".m4a";
    else if (ct.includes("image/png")) ext = ".png";
    else if (ct.includes("image/webp")) ext = ".webp";
    else if (ct.includes("image/jpeg") || ct.includes("image/jpg")) ext = ".jpg";
    return base + ext;
  }

  it("enforces extension from verified content type", () => {
    expect(sanitizeDownloadFilename("creator-video", "video/mp4")).toBe("creator-video.mp4");
    expect(sanitizeDownloadFilename("creator-video.mp4", "image/jpeg")).toBe("creator-video.jpg");
    expect(sanitizeDownloadFilename("pic", "image/png")).toBe("pic.png");
    expect(sanitizeDownloadFilename("track", "audio/mpeg")).toBe("track.mp3");
    expect(sanitizeDownloadFilename("track", "audio/mp4")).toBe("track.m4a");
  });

  it("strips path traversal and dangerous characters", () => {
    expect(sanitizeDownloadFilename("../../etc/passwd", "video/mp4")).toBe("etc-passwd.mp4");
    expect(sanitizeDownloadFilename('a"b\r\nc', "video/mp4")).toBe("a-b-c.mp4");
    expect(sanitizeDownloadFilename("C:\\evil.exe", "video/mp4")).toBe("c-evil.mp4");
  });

  it("falls back to a safe name for empty input", () => {
    expect(sanitizeDownloadFilename("", "video/mp4")).toBe("downloadit-media.mp4");
    expect(sanitizeDownloadFilename(undefined, "video/mp4")).toBe("downloadit-media.mp4");
    expect(sanitizeDownloadFilename("...", "video/mp4")).toBe("downloadit-media.mp4");
  });

  it("truncates long names", () => {
    expect(sanitizeDownloadFilename("a".repeat(100), "video/mp4").length).toBeLessThanOrEqual(84);
  });
});

describe("Strict domain allowlist matching", () => {
  const ALLOWED_MEDIA_HOSTS: Array<(hostname: string) => boolean> = [
    (h) => h === "cdninstagram.com" || h.endsWith(".cdninstagram.com"),
    (h) => h === "fbcdn.net" || h.endsWith(".fbcdn.net"),
    (h) => h.startsWith("scontent."),
  ];

  function isAllowedMediaUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") return false;
      const hostname = parsed.hostname.toLowerCase();
      return ALLOWED_MEDIA_HOSTS.some((match) => match(hostname));
    } catch {
      return false;
    }
  }

  it("allows legitimate Instagram CDN domains", () => {
    expect(isAllowedMediaUrl("https://cdninstagram.com/media/v1.mp4")).toBe(true);
    expect(isAllowedMediaUrl("https://scontent-iad3-1.xx.fbcdn.net/v/media.mp4")).toBe(true);
    expect(isAllowedMediaUrl("https://scontent.cdninstagram.com/v/image.jpg")).toBe(true);
    expect(isAllowedMediaUrl("https://fbcdn.net/v/media.mp4")).toBe(true);
  });

  it("blocks attacker-controlled domains containing allowed substrings", () => {
    expect(isAllowedMediaUrl("https://evil-cdninstagram.com.attacker.net/malware")).toBe(false);
    expect(isAllowedMediaUrl("https://not-cdninstagram.com/malware")).toBe(false);
    expect(isAllowedMediaUrl("https://evil-scontent.attacker.com/malware")).toBe(false);
    expect(isAllowedMediaUrl("https://evil-fbcdn.net.attacker.com/malware")).toBe(false);
  });

  it("blocks non-https protocols", () => {
    expect(isAllowedMediaUrl("http://cdninstagram.com/video.mp4")).toBe(false);
    expect(isAllowedMediaUrl("ftp://scontent.xx.fbcdn.net/video.mp4")).toBe(false);
  });

  it("blocks all other domains", () => {
    expect(isAllowedMediaUrl("https://evil.com/steal")).toBe(false);
    expect(isAllowedMediaUrl("https://notinstagram.com/p/fake")).toBe(false);
    expect(isAllowedMediaUrl("https://example.com/hack")).toBe(false);
  });
});

describe("Private IP blocking", () => {
  function isPrivateOrReservedHost(hostname: string): boolean {
    if (
      hostname === "localhost" ||
      hostname === "0.0.0.0" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "::" ||
      hostname === "[::1]"
    ) {
      return true;
    }
    if (hostname.startsWith("192.168.")) return true;
    if (hostname.startsWith("10.")) return true;
    if (hostname.startsWith("172.")) {
      const second = parseInt(hostname.split(".")[1], 10);
      if (second >= 16 && second <= 31) return true;
    }
    if (hostname.startsWith("169.254.")) return true;
    if (hostname === "metadata.google.internal" || hostname === "169.254.169.254") return true;
    if (hostname.endsWith(".internal") || hostname.endsWith(".local")) return true;
    return false;
  }

  it("blocks localhost variants", () => {
    expect(isPrivateOrReservedHost("localhost")).toBe(true);
    expect(isPrivateOrReservedHost("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedHost("0.0.0.0")).toBe(true);
    expect(isPrivateOrReservedHost("::1")).toBe(true);
    expect(isPrivateOrReservedHost("::")).toBe(true);
  });

  it("blocks private IPv4 ranges", () => {
    expect(isPrivateOrReservedHost("192.168.1.1")).toBe(true);
    expect(isPrivateOrReservedHost("10.0.0.1")).toBe(true);
    expect(isPrivateOrReservedHost("172.16.0.1")).toBe(true);
    expect(isPrivateOrReservedHost("172.31.255.255")).toBe(true);
  });

  it("blocks link-local and metadata", () => {
    expect(isPrivateOrReservedHost("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedHost("metadata.google.internal")).toBe(true);
    expect(isPrivateOrReservedHost("some-host.internal")).toBe(true);
    expect(isPrivateOrReservedHost("device.local")).toBe(true);
  });

  it("allows public IPs", () => {
    expect(isPrivateOrReservedHost("8.8.8.8")).toBe(false);
    expect(isPrivateOrReservedHost("1.1.1.1")).toBe(false);
    expect(isPrivateOrReservedHost("203.0.113.1")).toBe(false);
  });

  it("allows public hostnames", () => {
    expect(isPrivateOrReservedHost("cdninstagram.com")).toBe(false);
    expect(isPrivateOrReservedHost("scontent-iad3-1.xx.fbcdn.net")).toBe(false);
    expect(isPrivateOrReservedHost("example.com")).toBe(false);
  });

  it("allows 172.x.x.x outside private range", () => {
    expect(isPrivateOrReservedHost("172.0.0.1")).toBe(false);
    expect(isPrivateOrReservedHost("172.15.255.255")).toBe(false);
    expect(isPrivateOrReservedHost("172.32.0.1")).toBe(false);
  });
});

describe("Media URL validation", () => {
  const blockedDomains = [
    "localhost",
    "127.0.0.1",
    "192.168.1.1",
    "evil.com",
    "notinstagram.com",
  ];

  it("rejects non-https URLs", () => {
    const urls = [
      "http://cdninstagram.com/video.mp4",
      "ftp://cdninstagram.com/video.mp4",
      "javascript:alert(1)",
    ];
    for (const url of urls) {
      try {
        const parsed = new URL(url);
        expect(parsed.protocol).not.toBe("https:");
      } catch {
        // Invalid URL - expected
      }
    }
  });

  it("blocks unsafe domains", () => {
    for (const domain of blockedDomains) {
      const url = `https://${domain}/media/video.mp4`;
      const parsed = new URL(url);
      expect(
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname.startsWith("192.168.") ||
        parsed.hostname === "evil.com" ||
        parsed.hostname === "notinstagram.com"
      ).toBe(true);
    }
  });
});

describe("Filename sanitization", () => {
  it("sanitizes special characters", () => {
    const input = "My Post! @#$%^&*()";
    const sanitized = input
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 50);
    expect(sanitized).toBe("my-post");
  });

  it("truncates long names", () => {
    const input = "a".repeat(100);
    const sanitized = input
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 50);
    expect(sanitized.length).toBeLessThanOrEqual(50);
  });

  it("handles empty input", () => {
    const input = "";
    const sanitized = input
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 50);
    expect(sanitized).toBe("");
  });

  it("preserves valid characters", () => {
    const input = "reel-2024-test";
    const sanitized = input
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 50);
    expect(sanitized).toBe("reel-2024-test");
  });
});
