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
  "stkn",
]);

export interface ParsedInstagramUrl {
  normalized: string;
  hostname: string;
  pathname: string;
  contentType: string | null;
  shortcode: string | null;
  storyUsername: string | null;
  storyId: string | null;
  highlightId: string | null;
  /**
   * 0-based carousel start slide from `?img_index=N` (Instagram numbers
   * slides from 1). Null when absent/invalid. View-state only: stripped from
   * the normalized URL so identical posts share one cache entry.
   */
  slideIndex: number | null;
  /** Instagram audio ID from `/reels/audio/<id>/` (null otherwise). */
  audioId: string | null;
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
      storyId: extractStoryId(parsed.pathname),
      highlightId: extractHighlightId(parsed.pathname),
      slideIndex: extractSlideIndex(parsed.searchParams),
      audioId: extractAudioId(parsed.pathname),
    },
  };
}

function detectContentTypeFromPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean).map((segment) => segment.toLowerCase());

  // Public sound/audio pages (e.g. /reels/audio/<id>/) resolve to AUDIO so
  // the result UI switches to audio mode instead of treating them as Reels.
  if (segments[0] === "reels" && segments[1] === "audio") return "AUDIO";
  if (segments[0] === "reel" || segments[0] === "reels") return "REEL";
  if (segments[0] === "p") {
    if (segments.includes("carousel")) return "CAROUSEL";
    return "POST";
  }
  if (segments[0] === "tv") return "VIDEO";
  if (segments[0] === "stories" || segments[0] === "story") {
    if (segments.includes("highlights")) return "HIGHLIGHT";
    return segments.length >= 3 ? "STORY" : null;
  }
  // Short share links like /s/<code> that sometimes wrap story shares
  if (segments[0] === "s" && segments.length >= 2) return "STORY";
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
  const first = segments[0]?.toLowerCase();
  if ((first === "stories" || first === "story") && segments.length >= 3 && segments[1]) {
    return segments[1];
  }
  if (first === "s" && segments.length >= 2) {
    // Short links don't encode username; return null and let resolver handle via redirect
    return null;
  }
  return null;
}

function extractStoryId(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0]?.toLowerCase();
  if ((first === "stories" || first === "story") && segments.length >= 3 && segments[1].toLowerCase() !== "highlights") {
    return segments[2] || null;
  }
  if (first === "s" && segments.length >= 2) {
    return segments[1] || null;
  }
  return null;
}

function extractHighlightId(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0]?.toLowerCase();
  if ((first === "stories" || first === "story") && segments.some((segment) => segment.toLowerCase() === "highlights")) {
    const highlightIdx = segments.findIndex((segment) => segment.toLowerCase() === "highlights");
    return segments[highlightIdx + 1] || null;
  }
  return null;
}

export function extractAudioId(pathOrUrl: string): string | null {
  let pathname = pathOrUrl;
  try {
    pathname = new URL(pathOrUrl).pathname;
  } catch {
    // Not a full URL — treat the input as a bare pathname.
  }
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "reels" && segments[1] === "audio" && segments[2]) {
    return segments[2].split("?")[0].slice(0, 64) || null;
  }
  return null;
}

function extractSlideIndex(params: URLSearchParams): number | null {
  const raw = params.get("img_index");
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 100) return null;
  return n - 1;
}

function cleanUrl(url: URL): URL {
  const cleaned = new URL(url.origin + url.pathname);

  url.searchParams.forEach((value, key) => {
    const lower = key.toLowerCase();
    // img_index is viewer state (which slide was open), not post identity —
    // strip it so cache keys coalesce; the parsed slideIndex carries it.
    if (lower === "img_index") return;
    if (!TRACKING_PARAMS.has(lower)) {
      cleaned.searchParams.set(key, value);
    }
  });

  return cleaned;
}
