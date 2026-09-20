const ALLOWED_HOSTS = ["www.instagram.com", "instagram.com", "m.instagram.com"];

const UNSUPPORTED_PATHS = ["/accounts/login", "/accounts/signup"];

const TRACKING_PARAMS = new Set([
  "igshid",
  "ig_cache_key",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
  "feature",
]);

export interface ParsedInstagramUrl {
  normalized: string;
  hostname: string;
  pathname: string;
  contentType: string | null;
  shortcode: string | null;
  storyUsername: string | null;
  highlightId: string | null;
}

export function validateInstagramUrl(raw: string): {
  valid: boolean;
  error?: string;
  parsed?: ParsedInstagramUrl;
} {
  if (!raw || typeof raw !== "string") {
    return { valid: false, error: "No URL provided." };
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: "URL is empty." };
  }

  if (trimmed.length > 2048) {
    return { valid: false, error: "URL is too long." };
  }

  if (/^(javascript|data|blob|vbscript):/i.test(trimmed)) {
    return { valid: false, error: "Invalid URL scheme." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: "Malformed URL." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, error: "Only HTTP and HTTPS URLs are supported." };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, error: "Invalid URL format." };
  }

  if (!ALLOWED_HOSTS.includes(parsed.hostname.toLowerCase())) {
    return { valid: false, error: "This is not an Instagram URL." };
  }

  const pathLower = parsed.pathname.toLowerCase();

  for (const unsupported of UNSUPPORTED_PATHS) {
    if (pathLower.startsWith(unsupported)) {
      return {
        valid: false,
        error: "This URL type is not supported for download.",
      };
    }
  }

  const contentType = detectContentTypeFromPath(parsed.pathname);
  if (contentType === null) {
    return {
      valid: false,
      error:
        "This Instagram URL pattern is not supported. Try a link to a post, reel, story, or video.",
    };
  }

  const cleaned = cleanUrl(parsed);

  return {
    valid: true,
    parsed: {
      normalized: cleaned.href,
      hostname: parsed.hostname.toLowerCase(),
      pathname: parsed.pathname,
      contentType,
      shortcode: extractShortcode(parsed.pathname),
      storyUsername: extractStoryUsername(parsed.pathname),
      highlightId: extractHighlightId(parsed.pathname),
    },
  };
}

function detectContentTypeFromPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] === "reel" || segments[0] === "reels") return "REEL";
  if (segments[0] === "p") {
    if (segments.includes("carousel")) return "CAROUSEL";
    return "POST";
  }
  if (segments[0] === "tv") return "VIDEO";
  if (segments[0] === "stories") {
    if (segments.includes("highlights")) return "HIGHLIGHT";
    return "STORY";
  }
  if (segments[0] === "explore") return null;

  return null;
}

function extractShortcode(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (
    (segments[0] === "p" || segments[0] === "reel" || segments[0] === "reels" || segments[0] === "tv") &&
    segments[1]
  ) {
    return segments[1].split("/")[0];
  }
  return null;
}

function extractStoryUsername(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "stories" && segments[1]) {
    return segments[1];
  }
  return null;
}

function extractHighlightId(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "stories" && segments.includes("highlights")) {
    const highlightIdx = segments.indexOf("highlights");
    return segments[highlightIdx + 1] || null;
  }
  return null;
}

function cleanUrl(url: URL): URL {
  const cleaned = new URL(url.origin + url.pathname);

  url.searchParams.forEach((value, key) => {
    if (!TRACKING_PARAMS.has(key.toLowerCase())) {
      cleaned.searchParams.set(key, value);
    }
  });

  return cleaned;
}
