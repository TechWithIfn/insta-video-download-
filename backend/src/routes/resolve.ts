import { Router, Request, Response } from "express";
import { validateInstagramUrl } from "../lib/validators/instagram-url.js";
import { resolveUrl, getActiveProviderName } from "../lib/resolvers/index.js";
import { checkRateLimit } from "../lib/rate-limit.js";
import { generateToken } from "../lib/crypto.js";
import { storeMedia } from "../lib/temp-store.js";
import { logger } from "../lib/logger.js";
import { AppError, createError, createErrorResponse } from "../lib/errors.js";
import type { ResolveResponse, ResolveErrorResponse } from "../lib/types.js";

const router = Router();

/** [Downloadit Media Debug] first-item type + hostname only (never query/tokens). */
function firstMediaDiag(media: { type: string; url: string }[]): {
  firstMediaType: string | null;
  firstMediaHost: string | null;
} {
  const first = media[0];
  if (!first) return { firstMediaType: null, firstMediaHost: null };
  let host: string | null = null;
  try {
    host = new URL(first.url).hostname;
  } catch {
    host = null;
  }
  return { firstMediaType: first.type, firstMediaHost: host };
}

router.post("/", async (req: Request, res: Response): Promise<void> => {
  const requestId = generateToken();
  const startTime = Date.now();

  try {
    const contentLength = req.headers["content-length"];
    if (contentLength && parseInt(contentLength, 10) > 1024) {
      res.status(413).json(createErrorResponse("REQUEST_TOO_LARGE"));
      return;
    }

    const contentTypeHeader = req.headers["content-type"];
    if (
      !contentTypeHeader ||
      !contentTypeHeader.includes("application/json")
    ) {
      res.status(400).json(createErrorResponse("VALIDATION_ERROR"));
      return;
    }

    const body = req.body;
    if (!body || typeof body !== "object" || !("url" in body)) {
      res.status(400).json(createErrorResponse("VALIDATION_ERROR"));
      return;
    }

    const { url } = body as { url: unknown };
    if (typeof url !== "string") {
      res.status(400).json(createErrorResponse("VALIDATION_ERROR"));
      return;
    }

    logger.info("Request received", { requestId, url: url.slice(0, 100) });

    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      (req.headers["x-real-ip"] as string) ||
      req.ip ||
      "anonymous";

    const rateLimitResult = checkRateLimit(`resolve:${ip}`);
    if (!rateLimitResult.allowed) {
      logger.warn("Rate limit exceeded", { requestId, ip });
      res.status(429).json(createErrorResponse("RATE_LIMITED"));
      return;
    }

    const validation = validateInstagramUrl(url);
    if (!validation.valid || !validation.parsed) {
      logger.info("URL validation failed", {
        requestId,
        error: validation.error,
      });
      res.status(400).json(createErrorResponse("INVALID_URL"));
      return;
    }

    logger.info("URL validated", {
      requestId,
      contentType: validation.parsed.contentType,
      shortcode: validation.parsed.shortcode,
      storyUsername: validation.parsed.storyUsername,
      storyId: validation.parsed.storyId,
    });

    // Route-level timeout (mirrors the SSE stream guard): a hung provider
    // fails fast with 504 while the in-flight work keeps running and warms
    // the cache — so the same URL can be retried immediately and the retry
    // is served from cache instead of hanging again. In-flight cleanup still
    // runs via resolveUrl's finally; nothing is left stuck, and the response
    // below is the single response for this request.
    const timeoutMs = parseInt(process.env.RESOLVER_TIMEOUT_MS || "15000", 10);
    const pending = resolveUrl(validation.parsed.normalized);
    let gateWon = false;
    const timeoutGate = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        gateWon = true;
        reject(createError("RESOLVER_TIMEOUT"));
      }, timeoutMs);
      const cancel = () => clearTimeout(timer);
      pending.then(cancel, cancel);
    });
    // Observe a late outcome for cache-warming visibility (and to avoid
    // unhandled-rejection noise); quiet on the fast path.
    pending.then(
      (late) => {
        if (gateWon) {
          logger.info("Late resolve settled after route timeout (cache warmed)", {
            requestId,
            mediaCount: late.media.length,
          });
        }
      },
      (lateErr) => {
        if (gateWon) {
          logger.warn("Late resolve failed after route timeout", {
            requestId,
            error: lateErr instanceof Error ? lateErr.message : "unknown",
          });
        }
      }
    );

    const result = await Promise.race([pending, timeoutGate]);

    const mediaId = generateToken();
    storeMedia(mediaId, result.media, result.type);

    const duration = Date.now() - startTime;
    logger.info("Resolution complete", {
      requestId,
      duration,
      detectedType: validation.parsed.contentType,
      audioId: validation.parsed.audioId,
      provider: getActiveProviderName(),
      mediaCount: result.media.length,
      failedItems: 0,
      finalResult: result.type,
      mediaId,
      ...firstMediaDiag(result.media),
    });

    const response: ResolveResponse = {
      success: true,
      data: {
        ...result,
        sourceUrl: validation.parsed.normalized,
        mediaId,
        startIndex: validation.parsed.slideIndex,
      },
    };

    res.setHeader("X-Request-Id", requestId);
    res.setHeader("X-RateLimit-Remaining", String(rateLimitResult.remaining));
    res.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof AppError) {
      logger.warn("Resolver error", {
        requestId,
        code: error.code,
        message: error.message,
        duration,
      });
      const response: ResolveResponse = error.toResponse();
      if (process.env.NODE_ENV === "development") {
        (response as ResolveErrorResponse & { _debug?: string })._debug = `[${error.code}] ${error.message}`;
      }
      res.status(error.statusCode).json(response);
      return;
    }

    const errName = error instanceof Error ? error.name : "Unknown";
    const errMsg = error instanceof Error ? error.message : "unknown";
    const errStack = error instanceof Error ? error.stack?.split("\n").slice(0, 4).join(" | ") : "";

    logger.error("Unexpected error", {
      requestId,
      duration,
      errorName: errName,
      errorMessage: errMsg,
      errorStack: errStack,
    });

    const errorResponse = createErrorResponse("TEMPORARY_ERROR");
    if (process.env.NODE_ENV === "development") {
      (errorResponse as ResolveErrorResponse & { _debug?: string })._debug = `${errName}: ${errMsg}`;
    }
    res.status(500).json(errorResponse);
  }
});

/**
 * GET /api/resolve/stream?url=<instagram-url>
 *
 * Server-Sent Events endpoint that reports REAL resolution stages as they
 * complete, then delivers the normalized media result. No timers, no fake
 * percentages: every `progress` event is emitted only after the
 * corresponding backend stage has actually finished.
 *
 * Events:
 *   progress  { progress: 0-99, stage: string }
 *   complete  { progress: 100, stage: "Media ready!", data: ResolvedMedia }
 *   error     { code, message, retryable }
 */
router.get("/stream", async (req: Request, res: Response): Promise<void> => {
  const requestId = generateToken();
  const startTime = Date.now();
  let settled = false;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("X-Request-Id", requestId);
  res.flushHeaders();

  const send = (event: string, data: unknown): void => {
    if (settled || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const finish = (): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try {
      res.end();
    } catch {
      /* client already gone */
    }
  };

  const sendError = (error: unknown): void => {
    if (error instanceof AppError) {
      logger.warn("Resolve stream error", {
        requestId,
        code: error.code,
        duration: Date.now() - startTime,
      });
      send("error", error.toResponse().error);
    } else {
      logger.error("Resolve stream unexpected error", {
        requestId,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : "unknown",
      });
      send("error", createErrorResponse("TEMPORARY_ERROR").error);
    }
    finish();
  };

  const timeoutMs = parseInt(process.env.RESOLVER_TIMEOUT_MS || "15000", 10);
  const timer = setTimeout(() => {
    if (settled) return;
    logger.warn("Resolve stream timeout", { requestId, timeoutMs });
    send("error", createErrorResponse("RESOLVER_TIMEOUT").error);
    finish();
  }, timeoutMs);

  req.on("close", () => {
    if (!settled) {
      settled = true;
      clearTimeout(timer);
      logger.info("Resolve stream client disconnected", { requestId });
    }
  });

  try {
    const rawUrl = req.query.url;
    send("progress", { progress: 5, stage: "Request received" });

    if (typeof rawUrl !== "string" || rawUrl.length === 0) {
      send("error", createErrorResponse("VALIDATION_ERROR").error);
      finish();
      return;
    }

    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      (req.headers["x-real-ip"] as string) ||
      req.ip ||
      "anonymous";

    const rateLimitResult = checkRateLimit(`resolve:${ip}`);
    if (!rateLimitResult.allowed) {
      logger.warn("Rate limit exceeded", { requestId, ip });
      send("error", createErrorResponse("RATE_LIMITED").error);
      finish();
      return;
    }

    const validation = validateInstagramUrl(rawUrl);
    if (!validation.valid || !validation.parsed) {
      logger.info("URL validation failed", {
        requestId,
        error: validation.error,
      });
      send("error", createErrorResponse("INVALID_URL").error);
      finish();
      return;
    }
    send("progress", { progress: 15, stage: "Link validated" });

    const result = await resolveUrl(validation.parsed.normalized, (progress, stage) => {
      send("progress", { progress, stage });
    });
    if (settled) return;

    const mediaId = generateToken();
    storeMedia(mediaId, result.media, result.type);

    const duration = Date.now() - startTime;
    logger.info("Resolution complete", {
      requestId,
      duration,
      detectedType: validation.parsed.contentType,
      audioId: validation.parsed.audioId,
      provider: getActiveProviderName(),
      mediaCount: result.media.length,
      failedItems: 0,
      finalResult: result.type,
      mediaId,
      ...firstMediaDiag(result.media),
    });

    const data = {
      ...result,
      sourceUrl: validation.parsed.normalized,
      mediaId,
      startIndex: validation.parsed.slideIndex,
    };
    send("complete", { progress: 100, stage: "Media ready!", data });
    finish();
  } catch (error) {
    if (settled) return;
    sendError(error);
  }
});

export default router;
