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

const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 30_000;

function sanitizeDownloadFilename(raw: unknown, contentType: string): string {
  let base = typeof raw === "string" ? raw.toLowerCase().slice(0, 80) : "";
  base = base
    .replace(/\.\.+/g, "-") // kill dot-runs (traversal) first
    .replace(/[^a-zA-Z0-9._-]/g, "-") // dangerous chars incl. quotes, slashes, CRLF
    .replace(/-+/g, "-") // collapse dashes
    .replace(/^-+|-+$/g, "") // trim edge dashes
    .replace(/^\.+|\.+$/g, "") // trim edge dots
    .replace(/\.[a-z0-9]{2,4}$/, ""); // strip client extension; server decides
  if (!base) base = "snapsave-media";
  // Enforce the extension from the VERIFIED upstream content type.
  const ct = contentType.toLowerCase();
  let ext = ".mp4";
  if (ct.includes("image/png")) ext = ".png";
  else if (ct.includes("image/webp")) ext = ".webp";
  else if (ct.includes("image/jpeg") || ct.includes("image/jpg")) ext = ".jpg";
  return base + ext;
}

const router = Router();

router.get("/", async (req: Request, res: ExpressResponse): Promise<void> => {
  const requestId = generateToken();
  const routeStart = Date.now();

  try {
    const ip = getClientIp(req);
    logger.info("[DOWNLOAD] requested", { requestId, ip });

    const rateLimitResult = checkRateLimit(`download:${ip}`);
    if (!rateLimitResult.allowed) {
      logger.warn("[DOWNLOAD] rate limit exceeded", { requestId, ip });
      res.status(429).json(createErrorResponse("RATE_LIMITED"));
      return;
    }

    const validation = validateProxyUrl(req.query.url);
    if (!validation.ok) {
      logger.info("[DOWNLOAD] URL validation failed", { requestId, error: validation.error });
      const code = validation.error === "MISSING" ? "VALIDATION_ERROR" : "INVALID_URL";
      res.status(validation.error === "DISALLOWED_HOST" || validation.error === "PRIVATE_HOST" ? 403 : 400).json(
        createErrorResponse(code)
      );
      return;
    }

    logger.info("[DOWNLOAD] validated URL", { requestId, hostname: validation.value.hostname });

    // Use the already-resolved media URL directly — never re-resolve here.
    // If the CDN reports it expired, the client re-runs Get Media (fast path).
    const upstreamStart = Date.now();
    const upstream = await fetchUpstreamMedia(validation.value.url, {
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      tag: "DOWNLOAD",
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
    logger.info("[DOWNLOAD] upstream status", {
      requestId,
      status: response.status,
      validationMs: upstreamStart - routeStart,
      firstByteMs,
      finalHost: new URL(finalUrl).hostname,
    });

    if (response.status === 401 || response.status === 403 || response.status === 404) {
      await response.body?.cancel().catch(() => {});
      logger.warn("[DOWNLOAD] upstream reports expired/missing media", {
        requestId,
        status: response.status,
      });
      const expired = createError("MEDIA_URL_EXPIRED");
      res.status(expired.statusCode).json(expired.toResponse());
      return;
    }

    if (response.status === 429) {
      await response.body?.cancel().catch(() => {});
      res.status(429).json(createErrorResponse("PROVIDER_RATE_LIMITED"));
      return;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      logger.warn("[DOWNLOAD] upstream error status", { requestId, status: response.status });
      res.status(502).json(createErrorResponse("MEDIA_DOWNLOAD_FAILED"));
      return;
    }

    const upstreamCT = response.headers.get("content-type") || "";
    logger.info("[DOWNLOAD] upstream content-type", { requestId, contentType: upstreamCT });

    if (isHtmlContent(upstreamCT)) {
      await response.body?.cancel().catch(() => {});
      logger.warn("[DOWNLOAD] rejected HTML masquerading as media", { requestId });
      const expired = createError("MEDIA_URL_EXPIRED");
      res.status(expired.statusCode).json(expired.toResponse());
      return;
    }

    const isMediaCT =
      upstreamCT.includes("video") || upstreamCT.includes("image") || upstreamCT.includes("octet-stream");
    if (upstreamCT && !isMediaCT) {
      await response.body?.cancel().catch(() => {});
      logger.warn("[DOWNLOAD] rejected unexpected content type", { requestId, contentType: upstreamCT });
      res.status(502).json(createErrorResponse("CONTENT_UNAVAILABLE"));
      return;
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_DOWNLOAD_BYTES) {
      await response.body?.cancel().catch(() => {});
      logger.warn("[DOWNLOAD] exceeds size limit", { requestId, contentLength });
      res.status(413).json(createErrorResponse("REQUEST_TOO_LARGE"));
      return;
    }

    const filename = sanitizeDownloadFilename(req.query.filename, upstreamCT);
    const isVideo = upstreamCT.includes("video") || !upstreamCT.includes("image");

    res.setHeader("Content-Type", isVideo ? "video/mp4" : upstreamCT || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Request-Id", requestId);

    if (!response.body) {
      logger.warn("[DOWNLOAD] empty upstream body", { requestId });
      res.status(502).json(createErrorResponse("CONTENT_UNAVAILABLE"));
      return;
    }

    logger.info("[DOWNLOAD] stream started", { requestId, filename });
    const result = await pipeUpstreamToClient(req, res, response.body, MAX_DOWNLOAD_BYTES, "DOWNLOAD", requestId);
    logger.info("[DOWNLOAD] stream completed", {
      requestId,
      completed: result.completed,
      bytes: result.bytes,
    });
  } catch (error) {
    logger.error("[DOWNLOAD] proxy error", {
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
