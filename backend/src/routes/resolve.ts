import { Router, Request, Response } from "express";
import { validateInstagramUrl } from "../lib/validators/instagram-url.js";
import { resolveUrl } from "../lib/resolvers/index.js";
import { checkRateLimit } from "../lib/rate-limit.js";
import { generateToken } from "../lib/crypto.js";
import { storeMedia } from "../lib/temp-store.js";
import { logger } from "../lib/logger.js";
import { AppError, createErrorResponse } from "../lib/errors.js";
import type { ResolveResponse, ResolveErrorResponse } from "../lib/types.js";

const router = Router();

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
    });

    const result = await resolveUrl(validation.parsed.normalized);

    const mediaId = generateToken();
    storeMedia(mediaId, result.media, result.type);

    const duration = Date.now() - startTime;
    logger.info("Resolution complete", {
      requestId,
      duration,
      provider: "resolved",
      mediaCount: result.media.length,
      mediaId,
    });

    const response: ResolveResponse = {
      success: true,
      data: {
        ...result,
        sourceUrl: validation.parsed.normalized,
        mediaId,
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

export default router;
