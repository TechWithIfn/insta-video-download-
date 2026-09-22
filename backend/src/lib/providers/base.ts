import type { ResolverResult, ResolveProgressCallback } from "../types.js";

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

export { isPrivateOrReservedHost };

const CDN_HOST_MATCHERS: Array<(hostname: string) => boolean> = [
  (h) => h === "cdninstagram.com" || h.endsWith(".cdninstagram.com"),
  (h) => h === "fbcdn.net" || h.endsWith(".fbcdn.net"),
  (h) => h.startsWith("scontent."),
];

/** Strict allowlist for Instagram/Facebook media CDN hosts (no open proxy). */
export function isCdnMediaHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return CDN_HOST_MATCHERS.some((match) => match(h));
}

export abstract class BaseProvider {
  abstract readonly name: string;
  abstract resolve(url: string, onProgress?: ResolveProgressCallback): Promise<ResolverResult>;

  protected validateMediaUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false;
      }
      const h = parsed.hostname.toLowerCase();
      if (isPrivateOrReservedHost(h)) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}
