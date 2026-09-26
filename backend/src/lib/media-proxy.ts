import type { Request, Response as ExpressResponse } from "express";
import { isPrivateOrReservedHost, isCdnMediaHost } from "./providers/base.js";
import { resolveUrl } from "./resolvers/index.js";
import { validateInstagramUrl } from "./validators/instagram-url.js";
import { logger } from "./logger.js";
import { withRetry } from "./retry.js";

function isInstagramHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "instagram.com" || h.endsWith(".instagram.com");
}

function isAllowedRedirectHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (isPrivateOrReservedHost(h)) return false;
  if (isMockCdnHost(h)) return true;
  return isCdnMediaHost(h) || isInstagramHost(h);
}

function isMockCdnHost(hostname: string): boolean {
  if (hostname.toLowerCase() !== "mock-cdn.example.com") return false;
  // Dev/test provider only — never a production fallback.
  return (
    process.env.RESOLVER_PROVIDER === "mock" ||
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    process.env.ALLOW_MOCK_CDN === "true"
  );
}

export function isAllowedMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (isMockCdnHost(parsed.hostname)) return true;
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

/**
 * CDN identity of a media URL: rotating signatures live in the query
 * string, while host + pathname identify the underlying media bytes.
 */
function sameCdnIdentity(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.hostname === ub.hostname && ua.pathname === ub.pathname;
  } catch {
    return false;
  }
}

/**
 * Client IP for rate limiting and per-client concurrency.
 *
 * `X-Forwarded-For` / `X-Real-IP` are attacker-controlled unless a trusted
 * proxy actually rewrites them, so they are read ONLY when this process is
 * explicitly configured to sit behind one (`TRUST_PROXY=true`, which makes
 * Express resolve `req.ip` through the proxy chain via `app.set("trust
 * proxy")`). With no proxy configured — the default — the socket address is
 * the only trustworthy value, and forwarding headers are ignored entirely.
 *
 * Without this, one client could rotate the header to mint unlimited rate
 * limit buckets and unlimited per-IP concurrency slots, which is both an
 * abuse hole and a way to defeat the backpressure.
 */
export function getClientIp(req: Request): string {
  if (process.env.TRUST_PROXY === "true" || process.env.TRUST_PROXY === "1") {
    const forwarded = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
    const realIp = (req.headers["x-real-ip"] as string | undefined)?.trim();
    if (realIp) return realIp;
  }
  return req.ip || req.socket?.remoteAddress || "anonymous";
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
  | { kind: "client-gone" }
  | { kind: "bad-redirect"; location: string }
  | { kind: "network-error"; message: string };

/**
 * Single bounded retry for transient transport failures (connection reset /
 * refused / DNS): one retry after a short backoff, same URL, then give up.
 * Never retries timeouts (the full budget was already spent), HTTP statuses
 * (expiry recovery owns those), or redirect errors (deterministic). Keeps
 * the worst case to 2 attempts — never a retry loop.
 */
const RETRY_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // A backoff sleep must never be the reason the process stays alive.
    timer.unref?.();
  });
}

export async function fetchUpstreamMedia(
  initialUrl: string,
  options: {
    timeoutMs: number;
    rangeHeader?: string;
    tag: string;
    requestId: string;
    /** Caller-owned cancellation (client disconnect / shutdown). */
    signal?: AbortSignal;
  }
): Promise<UpstreamStatus> {
  const { timeoutMs, rangeHeader, tag, requestId, signal } = options;
  let currentUrl = initialUrl;

  if (signal?.aborted) {
    return { kind: "client-gone" };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: Response | null = null;
    let hopFailure: UpstreamStatus | null = null;

    for (let attempt = 0; attempt <= 1; attempt++) {
      // Timeout and caller cancellation are merged: a dead client must abort
      // the upstream socket immediately instead of holding a connection (and
      // its bandwidth) until the timeout expires.
      const controller = new AbortController();
      const onExternalAbort = (): void => controller.abort();
      signal?.addEventListener("abort", onExternalAbort, { once: true });
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      timeout.unref?.();
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
        clearTimeout(timeout);
        break;
      } catch (err) {
        clearTimeout(timeout);
        if (signal?.aborted) {
          logger.info(`[${tag}] client gone, upstream aborted`, { requestId });
          hopFailure = { kind: "client-gone" };
          break;
        }
        if (err instanceof Error && err.name === "AbortError") {
          logger.warn(`[${tag}] upstream timeout`, { requestId, url: currentUrl.slice(0, 120) });
          hopFailure = { kind: "timeout" };
          break;
        }
        const message = err instanceof Error ? err.message : "unknown";
        if (attempt === 0) {
          logger.warn(`[${tag}] upstream network error, retrying once`, { requestId, message });
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        logger.warn(`[${tag}] upstream network error`, { requestId, message });
        hopFailure = { kind: "network-error", message };
        break;
      } finally {
        signal?.removeEventListener("abort", onExternalAbort);
      }
    }

    if (hopFailure || !response) {
      return hopFailure ?? { kind: "network-error", message: "unknown" };
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
    signal?: AbortSignal;
  }
): Promise<ResilientUpstreamResult> {
  const { sourceUrl, ...fetchOpts } = options;
  const first = await fetchUpstreamMedia(initialUrl, { ...fetchOpts });

  if (first.kind !== "ok" || !REFRESHABLE_STATUSES.has(first.response.status)) {
    return { status: first, refreshed: false };
  }

  // A client that is already gone must not trigger an expensive re-resolve.
  if (fetchOpts.signal?.aborted) {
    await first.response.body?.cancel().catch(() => {});
    return { status: { kind: "client-gone" }, refreshed: false };
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
    // Re-resolution is expensive browser work: bound it with the provider
    // gate and abort it the moment the client leaves.
    const result = await resolveUrl(validation.parsed.normalized, undefined, {
      bypassCache: true,
      signal: fetchOpts.signal,
    });
    // Pick the refreshed candidate for the SAME media item: rotating CDN
    // signatures keep the media identity in host+pathname, so prefer the
    // item whose identity matches the expired URL. Blindly using media[0]
    // would serve slide 1 when slide N expired (wrong bytes on download).
    const identityMatch = result.media.find(
      (m) =>
        typeof m.url === "string" &&
        m.url !== initialUrl &&
        sameCdnIdentity(m.url, initialUrl)
    );
    const fallback = result.media.find(
      (m) => typeof m.url === "string" && m.url !== initialUrl
    );
    const candidate = identityMatch?.url ?? fallback?.url;
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

  // The refreshed fetch gets ONE bounded, jittered retry on a purely transient
  // transport failure. A timeout is never retried (the caller's budget is
  // already spent) and a client disconnect aborts immediately, so this can
  // neither hang nor double the traffic for a dead client.
  const retry = await withRetry(
    async () => {
      const attempt = await fetchUpstreamMedia(freshUrl as string, { ...fetchOpts });
      if (attempt.kind === "network-error") {
        throw new TransientUpstreamError();
      }
      return attempt;
    },
    {
      attempts: 2,
      isRetryable: (error) => error instanceof TransientUpstreamError,
      signal: fetchOpts.signal,
      logContext: { tag: options.tag, requestId: options.requestId },
    }
  ).catch((err) => {
    logger.warn(`[${options.tag}] retry after refresh failed`, {
      requestId: options.requestId,
      error: err instanceof Error ? err.message : "unknown",
    });
    return fetchUpstreamMedia(freshUrl as string, { ...fetchOpts });
  });

  return { status: retry, refreshed: true };
}

/** Marker for a purely transient upstream transport failure (safe to retry). */
class TransientUpstreamError extends Error {
  constructor() {
    super("upstream transport failure");
    this.name = "TransientUpstreamError";
  }
}

/**
 * Pump an upstream body to the client with backpressure.
 *
 * Memory safety: the loop only ever holds the current chunk plus at most one
 * queued `write()` chunk — it respects `res.write()` backpressure by awaiting
 * `drain` instead of buffering the whole body, so a slow client cannot grow
 * process memory. The upstream reader is cancelled on client disconnect, on a
 * write error, and when the byte cap is hit, so sockets and bandwidth are
 * released immediately.
 */
export async function pipeUpstreamToClient(
  req: Request,
  res: ExpressResponse,
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  tag: string,
  requestId: string,
  signal?: AbortSignal
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

  // An external abort (server drain, gate abandonment) must also release the
  // socket and the upstream bandwidth instead of streaming to completion.
  const onExternalAbort = () => {
    if (!finished) {
      clientGone = true;
      reader.cancel().catch(() => {});
      if (!res.writableEnded) res.destroy();
      logger.warn(`[${tag}] aborted mid-stream`, { requestId, bytes: totalBytes });
    }
  };
  if (signal) {
    if (signal.aborted) {
      req.off("close", onClientClose);
      await reader.cancel().catch(() => {});
      return { completed: false, bytes: 0 };
    }
    signal.addEventListener("abort", onExternalAbort, { once: true });
  }

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
          // A bounded wait: if the client stalls forever, treat it as gone
          // rather than holding the slot, socket, and bandwidth indefinitely.
          const drained = await new Promise<boolean>((resolve) => {
            const onDrain = () => resolve(true);
            const onClose = () => resolve(false);
            res.once("drain", onDrain);
            res.once("close", onClose);
            res.once("error", onClose);
            signal?.addEventListener("abort", () => resolve(false), { once: true });
          });
          if (!drained) {
            finished = true;
            await reader.cancel().catch(() => {});
            return { completed: false, bytes: totalBytes };
          }
        }
      } catch {
        finished = true;
        await reader.cancel().catch(() => {});
        return { completed: false, bytes: totalBytes };
      }
    }
  } finally {
    req.off("close", onClientClose);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}
