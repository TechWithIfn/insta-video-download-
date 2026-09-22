import type { Request, Response as ExpressResponse } from "express";
import { isPrivateOrReservedHost, isCdnMediaHost } from "./providers/base.js";
import { resolveUrl } from "./resolvers/index.js";
import { validateInstagramUrl } from "./validators/instagram-url.js";
import { logger } from "./logger.js";

function isInstagramHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "instagram.com" || h.endsWith(".instagram.com");
}

function isAllowedRedirectHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (isPrivateOrReservedHost(h)) return false;
  return isCdnMediaHost(h) || isInstagramHost(h);
}

export function isAllowedMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return isCdnMediaHost(parsed.hostname);
  } catch {
    return false;
  }
}

export type UrlValidationError = "MISSING" | "MALFORMED" | "NOT_HTTPS" | "DISALLOWED_HOST" | "PRIVATE_HOST";

export interface ValidatedUrl {
  url: string;
  hostname: string;
}

export function validateProxyUrl(raw: unknown): { ok: true; value: ValidatedUrl } | { ok: false; error: UrlValidationError } {
  if (!raw || typeof raw !== "string") {
    return { ok: false, error: "MISSING" };
  }
  // Defense-in-depth: resolver output cached before the &amp; fix (or any
  // provider returning HTML-escaped URLs) must be decoded back to the real
  // query string before signature validation, or the CDN rejects it.
  const decoded = raw.includes("&amp;") ? raw.split("&amp;").join("&") : raw;
  let parsed: URL;
  try {
    parsed = new URL(decoded);
  } catch {
    return { ok: false, error: "MALFORMED" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "NOT_HTTPS" };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!isAllowedMediaUrl(decoded)) {
    return { ok: false, error: "DISALLOWED_HOST" };
  }
  if (isPrivateOrReservedHost(hostname)) {
    return { ok: false, error: "PRIVATE_HOST" };
  }
  return { ok: true, value: { url: decoded, hostname } };
}

export function getClientIp(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    (req.headers["x-real-ip"] as string) ||
    req.ip ||
    "anonymous"
  );
}

export const UPSTREAM_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  Accept: "video/mp4,video/*;q=0.9,image/*;q=0.8,*/*;q=0.5",
  Referer: "https://www.instagram.com/",
  "Accept-Language": "en-US,en;q=0.9",
};

const MAX_REDIRECTS = 5;

export type UpstreamStatus =
  | { kind: "ok"; response: Response; finalUrl: string }
  | { kind: "timeout" }
  | { kind: "bad-redirect"; location: string }
  | { kind: "network-error"; message: string };

export async function fetchUpstreamMedia(
  initialUrl: string,
  options: { timeoutMs: number; rangeHeader?: string; tag: string; requestId: string }
): Promise<UpstreamStatus> {
  const { timeoutMs, rangeHeader, tag, requestId } = options;
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      const headers: Record<string, string> = { ...UPSTREAM_HEADERS };
      if (rangeHeader) {
        headers.Range = rangeHeader;
      }
      response = await fetch(currentUrl, {
        signal: controller.signal,
        headers,
        redirect: "manual",
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === "AbortError") {
        logger.warn(`[${tag}] upstream timeout`, { requestId, url: currentUrl.slice(0, 120) });
        return { kind: "timeout" };
      }
      const message = err instanceof Error ? err.message : "unknown";
      logger.warn(`[${tag}] upstream network error`, { requestId, message });
      return { kind: "network-error", message };
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location) {
        logger.warn(`[${tag}] redirect without location`, { requestId, status: response.status });
        return { kind: "bad-redirect", location: "" };
      }
      let nextUrl: string;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        return { kind: "bad-redirect", location: location.slice(0, 120) };
      }
      let nextParsed: URL;
      try {
        nextParsed = new URL(nextUrl);
      } catch {
        return { kind: "bad-redirect", location: nextUrl.slice(0, 120) };
      }
      const nextHost = nextParsed.hostname.toLowerCase();
      if (nextParsed.protocol !== "https:" || isPrivateOrReservedHost(nextHost)) {
        logger.warn(`[${tag}] blocked redirect to unsafe destination`, {
          requestId,
          hostname: nextHost,
          location: nextUrl.slice(0, 120),
        });
        return { kind: "bad-redirect", location: nextUrl.slice(0, 120) };
      }
      if (!isAllowedRedirectHost(nextHost)) {
        logger.warn(`[${tag}] blocked redirect to non-allowed host`, {
          requestId,
          hostname: nextHost,
          location: nextUrl.slice(0, 120),
        });
        return { kind: "bad-redirect", location: nextUrl.slice(0, 120) };
      }
      logger.info(`[${tag}] following redirect`, {
        requestId,
        hop: hop + 1,
        to: nextHost,
      });
      currentUrl = nextUrl;
      continue;
    }

    return { kind: "ok", response, finalUrl: currentUrl };
  }

  logger.warn(`[${tag}] too many redirects`, { requestId });
  return { kind: "bad-redirect", location: "too many redirects" };
}

export function isHtmlContent(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return ct.includes("text/html") || ct.includes("application/xhtml");
}

// Upstream statuses that indicate the signed CDN URL is expired or invalid
// (as opposed to a transport problem). Only these trigger a single guarded
// re-resolution. 429 is deliberately excluded: re-resolving while rate
// limited would amplify load instead of recovering.
const REFRESHABLE_STATUSES = new Set([401, 403, 404, 410, 500, 502, 503, 504]);

export interface ResilientUpstreamResult {
  status: UpstreamStatus;
  refreshed: boolean;
}

/**
 * Fetch upstream media, with ONE guarded recovery attempt: if the CDN
 * reports the URL expired/invalid AND the caller supplied the original
 * Instagram `sourceUrl`, re-run the resolver (bypassing the stale cache
 * entry) and retry exactly once against the fresh media URL.
 *
 * Security is preserved end-to-end: the source must be a valid Instagram
 * URL and the refreshed URL must pass the same CDN/SSRF validation.
 * Maximum 2 upstream attempts per call — never an open retry loop.
 */
export async function fetchUpstreamMediaResilient(
  initialUrl: string,
  options: {
    timeoutMs: number;
    rangeHeader?: string;
    tag: string;
    requestId: string;
    sourceUrl?: unknown;
  }
): Promise<ResilientUpstreamResult> {
  const { sourceUrl, ...fetchOpts } = options;
  const first = await fetchUpstreamMedia(initialUrl, { ...fetchOpts });

  if (first.kind !== "ok" || !REFRESHABLE_STATUSES.has(first.response.status)) {
    return { status: first, refreshed: false };
  }

  if (typeof sourceUrl !== "string" || sourceUrl.length === 0) {
    await first.response.body?.cancel().catch(() => {});
    return { status: first, refreshed: false };
  }

  const validation = validateInstagramUrl(sourceUrl);
  if (!validation.valid || !validation.parsed) {
    await first.response.body?.cancel().catch(() => {});
    return { status: first, refreshed: false };
  }

  logger.info(`[${options.tag}] upstream reports expired media, re-resolving once`, {
    requestId: options.requestId,
    status: first.response.status,
  });

  let freshUrl: string | null = null;
  try {
    const result = await resolveUrl(validation.parsed.normalized, undefined, { bypassCache: true });
    const candidate = result.media[0]?.url;
    if (typeof candidate === "string" && candidate.length > 0) {
      const mediaValidation = validateProxyUrl(candidate);
      if (mediaValidation.ok && mediaValidation.value.url !== initialUrl) {
        freshUrl = mediaValidation.value.url;
      }
    }
  } catch (err) {
    logger.warn(`[${options.tag}] refresh re-resolve failed`, {
      requestId: options.requestId,
      error: err instanceof Error ? err.message : "unknown",
    });
  }

  await first.response.body?.cancel().catch(() => {});
  if (!freshUrl) {
    return { status: first, refreshed: false };
  }

  const retry = await fetchUpstreamMedia(freshUrl, { ...fetchOpts });
  return { status: retry, refreshed: true };
}

export async function pipeUpstreamToClient(
  req: Request,
  res: ExpressResponse,
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  tag: string,
  requestId: string
): Promise<{ completed: boolean; bytes: number }> {
  const reader = body.getReader();
  let totalBytes = 0;
  let finished = false;
  let clientGone = false;

  const onClientClose = () => {
    if (!finished) {
      clientGone = true;
      reader.cancel().catch(() => {});
      logger.warn(`[${tag}] client disconnected mid-stream`, { requestId, bytes: totalBytes });
    }
  };
  req.on("close", onClientClose);

  try {
    while (true) {
      if (clientGone) {
        return { completed: false, bytes: totalBytes };
      }
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        res.end();
        return { completed: true, bytes: totalBytes };
      }
      totalBytes += value.length;
      if (totalBytes > maxBytes) {
        finished = true;
        await reader.cancel().catch(() => {});
        res.destroy();
        logger.warn(`[${tag}] exceeded size limit mid-stream`, { requestId, bytes: totalBytes });
        return { completed: false, bytes: totalBytes };
      }
      try {
        const canContinue = res.write(value);
        if (!canContinue) {
          await new Promise<void>((resolve) => res.once("drain", () => resolve()));
        }
      } catch {
        finished = true;
        await reader.cancel().catch(() => {});
        return { completed: false, bytes: totalBytes };
      }
    }
  } finally {
    req.off("close", onClientClose);
  }
}
