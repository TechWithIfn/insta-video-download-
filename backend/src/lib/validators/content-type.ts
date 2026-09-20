import type { InstagramContentType } from "../types.js";

export function detectContentType(pathname: string): InstagramContentType {
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] === "reel" || segments[0] === "reels") return "REEL";
  if (segments[0] === "p") return "POST";
  if (segments[0] === "tv") return "VIDEO";
  if (segments[0] === "stories") {
    if (segments.includes("highlights")) return "HIGHLIGHT";
    return "STORY";
  }

  return "UNKNOWN";
}

export function isSupportedContent(type: InstagramContentType): boolean {
  const supported: InstagramContentType[] = [
    "REEL",
    "POST",
    "VIDEO",
    "STORY",
    "HIGHLIGHT",
  ];
  return supported.includes(type);
}
