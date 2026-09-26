import { Router, Request, Response as ExpressResponse } from "express";
import { logger } from "../lib/logger.js";
import { AppError, createError, createErrorResponse, toMediaAppError } from "../lib/errors.js";
import { generateToken } from "../lib/crypto.js";
import { checkRateLimit, routeRateLimitConfig } from "../lib/rate-limit.js";
import { KeyedConcurrency, getGate } from "../lib/capacity.js";
import { readBoundedInt } from "../lib/env.js";
import {
  validateProxyUrl,
  getClientIp,
  fetchUpstreamMediaResilient,
  isHtmlContent,
  pipeUpstreamToClient,
} from "../lib/media-proxy.js";

const MAX_STREAM_BYTES = 200 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 30_000;

/**
 * Streaming has its own budget, independent of downloads: a video player
 * holds a connection for a long time and browsers often open several range
 * requests for one video, so a low per-IP cap plus a dedicated global gate is
 * what keeps playback from starving everything else.
 */
const streamGate = getGate("stream");
const perIpStream = new KeyedConcurrency(readBoundedInt("MAX_CONCURRENT_STREAMS_PER_IP", 3, 1, 16));

interface ParsedRange {
  start: number;
  end: number | null;
}

function parseRangeHeader(header: string | undefined): ParsedRange | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (startStr === "" && endStr === "") return null;
  if (startStr === "") return null; // suffix ranges need total size; let upstream handle via forward
  const start = parseInt(startStr, 10);
  if (isNaN(start) || start < 0) return null;
  const end = endStr === "" ? null : parseInt(endStr, 10);
  if (end !== null && (isNaN(end) || end < start)) return null;
  return { start, end };
}

function looksLikeMediaBytes(firstBytes: Uint8Array): boolean {
  if (firstBytes.length < 8) return true;
  const text = new TextDecoder("ascii", { fatal: false }).decode(firstBytes.slice(0, 64));
  if (text.includes("<!DOCTYPE") || text.includes("<html") || text.includes("<HTML")) return false;
  if (text.includes("<?xml")) return false;
  if (text.startsWith("{") && (text.includes("login") || text.includes("error") || text.includes("requireLogin"))) return false;
  for (let i = 0; i <= firstBytes.length - 4; i++) {
    if (firstBytes[i] === 0x66 && firstBytes[i + 1] === 0x74 && firstBytes[i + 2] === 0x79 && firstBytes[i + 3] === 0x70) return true;
  }
  if (firstBytes[0] === 0xFF && firstBytes[1] === 0xD8) return true;
  if (firstBytes[0] === 0x89 && firstBytes[1] === 0x50 && firstBytes[2] === 0x4E && firstBytes[3] === 0x47) return true;
  return false;
}

async function pipeWithValidation(
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
  let validated = false;
  const HEADROOM = 128;
  const firstChunk: Uint8Array[] = [];
  let headroomBytes = 0;

  const stop = (): void => {
    if (finished) return;
    clientGone = true;
    reader.cancel().catch(() => {});
  };
  const onClientClose = () => {
    if (!finished) {
      clientGone = true;
      reader.cancel().catch(() => {});
      logger.warn(`[${tag}] client disconnected mid-stream`, { requestId, bytes: totalBytes });
    }
  };
  req.on("close", onClientClose);
  const onExternalAbort = () => {
    if (!finished) {
      logger.warn(`[${tag}] aborted mid-stream`, { requestId, bytes: totalBytes });
      stop();
      if (!res.writableEnded) res.destroy();
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
      if (!validated) {
        firstChunk.push(value);
        headroomBytes += value.length;
        if (headroomBytes >= HEADROOM) {
          const combined = new Uint8Array(headroomBytes);
          let offset = 0;
          for (const chunk of firstChunk) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }
          if (!looksLikeMediaBytes(combined)) {
            finished = true;
            await reader.cancel().catch(() => {});
            logger.warn(`[${tag}] upstream returned non-media content`, { requestId });
            const err = createError("MEDIA_URL_EXPIRED");
            res.status(err.statusCode).json(err.toResponse());
            return { completed: false, bytes: totalBytes };
          }
          validated = true;
          for (const chunk of firstChunk) {
            try {
              const canContinue = res.write(chunk);
              if (!canContinue) {
                await new Promise<void>((resolve) => res.once("drain", () => resolve()));
              }
            } catch {
              finished = true;
              await reader.cancel().catch(() => {});
              return { completed: false, bytes: totalBytes };
            }
          }
          firstChunk.length = 0;
        }
        continue;
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
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

async function pipeRangeSlice(
  req: Request,
  res: ExpressResponse,
  body: ReadableStream<Uint8Array>,
  start: number,
  end: number | null,
  tag: string,
  requestId: string,
  signal?: AbortSignal
): Promise<number> {
  const reader = body.getReader();
  let skipped = 0;
  let sent = 0;
  let finished = false;
  let clientGone = false;
  const onClientClose = () => {
    if (!finished) {
      clientGone = true;
      reader.cancel().catch(() => {});
    }
  };
  const onExternalAbort = () => {
    if (!finished) {
      clientGone = true;
      reader.cancel().catch(() => {});
      if (!res.writableEnded) res.destroy();
    }
  };
  req.on("close", onClientClose);
  if (signal) {
    if (signal.aborted) {
      req.off("close", onClientClose);
      await reader.cancel().catch(() => {});
      return 0;
    }
    signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  try {
    while (true) {
      if (clientGone) return sent;
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        res.end();
        return sent;
      }
      let chunk = value;
      if (skipped < start) {
        const skipNow = Math.min(chunk.length, start - skipped);
        skipped += skipNow;
        chunk = chunk.slice(skipNow);
        if (chunk.length === 0) continue;
      }
      if (end !== null) {
        const remaining = end - start + 1 - sent;
        if (remaining <= 0) {
          finished = true;
          await reader.cancel().catch(() => {});
          res.end();
          return sent;
        }
        if (chunk.length > remaining) {
          chunk = chunk.slice(0, remaining);
        }
      }
      sent += chunk.length;
      if (sent > MAX_STREAM_BYTES) {
        finished = true;
        await reader.cancel().catch(() => {});
        res.destroy();
        logger.warn(`[${tag}] range slice exceeded size limit`, { requestId });
        return sent;
      }
      try {
        const canContinue = res.write(chunk);
        if (!canContinue) {
          await new Promise<void>((resolve) => res.once("drain", () => resolve()));
        }
      } catch {
        finished = true;
        await reader.cancel().catch(() => {});
        return sent;
      }
      if (end !== null && sent >= end - start + 1) {
        finished = true;
        await reader.cancel().catch(() => {});
        res.end();
        return sent;
      }
    }
  } finally {
    req.off("close", onClientClose);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

const router = Router();

router.get("/", async (req: Request, res: ExpressResponse): Promise<void> => {
  const requestId = generateToken();
  const ip = getClientIp(req);

  const controller = new AbortController();
  const onClose = (): void => {
    if (!res.writableEnded) controller.abort();
  };
  res.on("close", onClose);

  if (!perIpStream.tryAcquire(ip)) {
    res.off("close", onClose);
    logger.warn("[STREAM] per-client stream limit reached", { requestId, ip });
    res.setHeader("Retry-After", "3");
    res.status(503).json(createErrorResponse("CAPACITY_EXHAUSTED"));
    return;
  }

  try {
    await streamGate.run(() => handleStream(req, res, requestId, ip, controller.signal), {
      signal: controller.signal,
    });
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (error instanceof AppError) {
      if (error.statusCode === 503) res.setHeader("Retry-After", "3");
      res.status(error.statusCode).json(error.toResponse());
      return;
    }
    const mapped = toMediaAppError(error);
    logger.error("[STREAM] proxy error", {
      requestId,
      errorCode: mapped.code,
      error: error instanceof Error ? error.message : "unknown",
    });
    res.status(mapped.statusCode).json(mapped.toResponse());
  } finally {
    res.off("close", onClose);
    perIpStream.release(ip);
  }
});

async function handleStream(
  req: Request,
  res: ExpressResponse,
  requestId: string,
  ip: string,
  signal: AbortSignal
): Promise<void> {
  try {
    logger.info("[STREAM] requested", { requestId, ip });

    const rateLimitResult = checkRateLimit(`stream:${ip}`, routeRateLimitConfig("stream"));
    if (!rateLimitResult.allowed) {
      logger.warn("[STREAM] rate limit exceeded", { requestId, ip });
      res.setHeader("Retry-After", String(Math.ceil(rateLimitResult.retryAfterMs / 1000)));
      res.status(429).json(createErrorResponse("RATE_LIMITED"));
      return;
    }

    const validation = validateProxyUrl(req.query.url);
    if (!validation.ok) {
      logger.info("[STREAM] URL validation failed", { requestId, error: validation.error });
      res.status(validation.error === "DISALLOWED_HOST" || validation.error === "PRIVATE_HOST" ? 403 : 400).json(
        createErrorResponse(validation.error === "MISSING" ? "VALIDATION_ERROR" : "INVALID_URL")
      );
      return;
    }

    const clientRange = parseRangeHeader(req.headers.range);

    const upstreamStart = Date.now();
    // Resilient fetch: on expired/invalid CDN URLs the helper re-resolves
    // once from `source` (when supplied) and retries against the fresh URL.
    const { status: upstream, refreshed } = await fetchUpstreamMediaResilient(validation.value.url, {
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      rangeHeader: req.headers.range,
      tag: "STREAM",
      requestId,
      sourceUrl: req.query.source,
      signal,
    });
    if (refreshed) {
      logger.info("[STREAM] serving from refreshed media URL", { requestId });
    }

    if (upstream.kind === "timeout") {
      res.status(504).json(createErrorResponse("PROVIDER_TIMEOUT"));
      return;
    }
    if (upstream.kind === "client-gone") {
      logger.info("[STREAM] client gone before stream", { requestId });
      return;
    }
    if (upstream.kind === "bad-redirect" || upstream.kind === "network-error") {
      res.status(502).json(createErrorResponse("MEDIA_DOWNLOAD_FAILED"));
      return;
    }

    const { response, finalUrl } = upstream;
    const firstByteMs = Date.now() - upstreamStart;
    logger.info("[STREAM] upstream status", {
      requestId,
      status: response.status,
      firstByteMs,
      finalHost: new URL(finalUrl).hostname,
    });

    if (response.status === 401 || response.status === 403 || response.status === 404) {
      await response.body?.cancel().catch(() => {});
      logger.warn("[STREAM] upstream reports expired/missing media", {
        requestId,
        status: response.status,
      });
      const expired = createError("MEDIA_URL_EXPIRED");
      res.status(expired.statusCode).json(expired.toResponse());
      return;
    }

    if (response.status === 416) {
      await response.body?.cancel().catch(() => {});
      res.status(416).setHeader("Accept-Ranges", "bytes").json(createErrorResponse("CONTENT_UNAVAILABLE"));
      return;
    }

    if (response.status !== 200 && response.status !== 206) {
      await response.body?.cancel().catch(() => {});
      logger.warn("[STREAM] upstream error status", { requestId, status: response.status });
      res.status(502).json(createErrorResponse("MEDIA_DOWNLOAD_FAILED"));
      return;
    }

    const upstreamCT = response.headers.get("content-type") || "";
    logger.info("[STREAM] upstream content-type", { requestId, contentType: upstreamCT });

    if (isHtmlContent(upstreamCT)) {
      await response.body?.cancel().catch(() => {});
      logger.warn("[STREAM] rejected HTML masquerading as media", { requestId });
      const expired = createError("MEDIA_URL_EXPIRED");
      res.status(expired.statusCode).json(expired.toResponse());
      return;
    }

    const isVideo = upstreamCT.includes("video") || validation.value.url.includes(".mp4");
    const contentType = isVideo ? "video/mp4" : upstreamCT || "application/octet-stream";

    if (!response.body) {
      logger.warn("[STREAM] empty upstream body", { requestId });
      res.status(502).json(createErrorResponse("CONTENT_UNAVAILABLE"));
      return;
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Request-Id", requestId);

    // Case 1: upstream honored the range — forward 206 as-is
    if (response.status === 206) {
      const contentRange = response.headers.get("content-range");
      const contentLength = response.headers.get("content-length");
      if (contentRange) res.setHeader("Content-Range", contentRange);
      if (contentLength) res.setHeader("Content-Length", contentLength);
      res.status(206);
      logger.info("[STREAM] forwarding 206 partial content", { requestId, contentRange });
      const result = await pipeUpstreamToClient(req, res, response.body, MAX_STREAM_BYTES, "STREAM", requestId, signal);
      logger.info("[STREAM] 206 stream completed", { requestId, bytes: result.bytes });
      return;
    }

    // Case 2: upstream returned 200 but client asked for a range — slice it ourselves
    if (clientRange) {
      const totalHeader = response.headers.get("content-length");
      const total = totalHeader ? parseInt(totalHeader, 10) : NaN;
      const end = clientRange.end ?? (isNaN(total) ? null : total - 1);
      if (!isNaN(total) && clientRange.start >= total) {
        await response.body.cancel().catch(() => {});
        res.status(416).setHeader("Accept-Ranges", "bytes").json(createErrorResponse("CONTENT_UNAVAILABLE"));
        return;
      }
      const rangeEnd = end ?? "";
      const rangeTotal = isNaN(total) ? "*" : String(total);
      res.setHeader("Content-Range", `bytes ${clientRange.start}-${rangeEnd}/${rangeTotal}`);
      if (end !== null) {
        res.setHeader("Content-Length", String(end - clientRange.start + 1));
      }
      res.status(206);
      logger.info("[STREAM] serving 206 from 200 upstream (slicing)", {
        requestId,
        start: clientRange.start,
        end,
      });
      const sent = await pipeRangeSlice(req, res, response.body, clientRange.start, end, "STREAM", requestId, signal);
      logger.info("[STREAM] sliced 206 completed", { requestId, bytes: sent });
      return;
    }

    // Case 3: full 200 stream — validate first bytes are actually media
    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      if (parseInt(contentLength, 10) > MAX_STREAM_BYTES) {
        await response.body.cancel().catch(() => {});
        res.status(413).json(createErrorResponse("REQUEST_TOO_LARGE"));
        return;
      }
      res.setHeader("Content-Length", contentLength);
    }
    logger.info("[STREAM] full 200 stream started", { requestId });
    const result = await pipeWithValidation(req, res, response.body, MAX_STREAM_BYTES, "STREAM", requestId, signal);
    logger.info("[STREAM] full stream completed", {
      requestId,
      completed: result.completed,
      bytes: result.bytes,
    });
  } catch (error) {
    const mapped = toMediaAppError(error);
    logger.error("[STREAM] proxy error", {
      requestId,
      errorCode: mapped.code,
      error: error instanceof Error ? error.message : "unknown",
    });
    if (!res.headersSent) {
      res.status(mapped.statusCode).json(mapped.toResponse());
    } else {
      res.destroy();
    }
  }
}

export default router;
