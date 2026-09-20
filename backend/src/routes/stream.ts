import { Router, Request, Response as ExpressResponse } from "express";
import { logger } from "../lib/logger.js";
import { createError, createErrorResponse } from "../lib/errors.js";
import { generateToken } from "../lib/crypto.js";
import { checkRateLimit } from "../lib/rate-limit.js";
import {
  validateProxyUrl,
  getClientIp,
  fetchUpstreamMedia,
  isHtmlContent,
  pipeUpstreamToClient,
} from "../lib/media-proxy.js";

const MAX_STREAM_BYTES = 200 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 30_000;

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

async function pipeRangeSlice(
  req: Request,
  res: ExpressResponse,
  body: ReadableStream<Uint8Array>,
  start: number,
  end: number | null,
  tag: string,
  requestId: string
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
  req.on("close", onClientClose);
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
  }
}

const router = Router();

router.get("/", async (req: Request, res: ExpressResponse): Promise<void> => {
  const requestId = generateToken();

  try {
    const ip = getClientIp(req);
    logger.info("[STREAM] requested", { requestId, ip });

    const rateLimitResult = checkRateLimit(`stream:${ip}`);
    if (!rateLimitResult.allowed) {
      logger.warn("[STREAM] rate limit exceeded", { requestId, ip });
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
    const upstream = await fetchUpstreamMedia(validation.value.url, {
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      rangeHeader: req.headers.range,
      tag: "STREAM",
      requestId,
    });

    if (upstream.kind === "timeout") {
      res.status(504).json(createErrorResponse("PROVIDER_TIMEOUT"));
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
      const result = await pipeUpstreamToClient(req, res, response.body, MAX_STREAM_BYTES, "STREAM", requestId);
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
      const sent = await pipeRangeSlice(req, res, response.body, clientRange.start, end, "STREAM", requestId);
      logger.info("[STREAM] sliced 206 completed", { requestId, bytes: sent });
      return;
    }

    // Case 3: full 200 stream
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
    const result = await pipeUpstreamToClient(req, res, response.body, MAX_STREAM_BYTES, "STREAM", requestId);
    logger.info("[STREAM] full stream completed", {
      requestId,
      completed: result.completed,
      bytes: result.bytes,
    });
  } catch (error) {
    logger.error("[STREAM] proxy error", {
      requestId,
      error: error instanceof Error ? error.message : "unknown",
    });
    if (!res.headersSent) {
      res.status(500).json(createErrorResponse("TEMPORARY_ERROR"));
    } else {
      res.destroy();
    }
  }
});

export default router;
