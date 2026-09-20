import { Router, Request, Response as ExpressResponse } from "express";
import { readFile, mkdir, rm, readdir, stat } from "fs/promises";
import { createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { validateInstagramUrl } from "../lib/validators/instagram-url.js";
import { resolveUrl } from "../lib/resolvers/index.js";
import { checkRateLimit } from "../lib/rate-limit.js";
import { logger } from "../lib/logger.js";
import { AppError, createError, createErrorResponse } from "../lib/errors.js";
import { isFfmpegAvailable, runFfmpeg, getFfmpegVersionSync } from "../lib/ffmpeg.js";
import {
  validateProxyUrl,
  getClientIp,
  fetchUpstreamMedia,
  isHtmlContent,
} from "../lib/media-proxy.js";
import type { ErrorCode } from "../lib/types.js";

const router = Router();

const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 60_000;
const FFMPEG_TIMEOUT_MS = 60_000;
const STALE_DIR_TTL_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

function sanitizeHandle(username: string | null | undefined): string {
  if (!username) return "snapsave";
  return (
    username
      .replace(/[^a-zA-Z0-9._-]/g, "")
      .replace(/^\.+|\.+$/g, "")
      .slice(0, 60) || "snapsave"
  );
}

async function cleanupDir(tmpDir: string, requestId: string): Promise<void> {
  try {
    await rm(tmpDir, { recursive: true, force: true });
    logger.info("[AUDIO] cleanup completed", { requestId });
  } catch (err) {
    logger.warn("[AUDIO] cleanup failed", {
      requestId,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}

// Fallback sweep for abandoned temp dirs (e.g. process killed mid-request).
setInterval(() => {
  (async () => {
    try {
      const base = tmpdir();
      const entries = await readdir(base);
      const now = Date.now();
      for (const entry of entries) {
        if (!entry.startsWith("snapsave-audio-")) continue;
        const full = join(base, entry);
        try {
          const st = await stat(full);
          if (now - st.mtimeMs > STALE_DIR_TTL_MS) {
            await rm(full, { recursive: true, force: true });
            logger.info("[AUDIO] swept stale temp dir", { dir: entry });
          }
        } catch {
          /* ignore per-entry errors */
        }
      }
    } catch {
      /* ignore sweep errors */
    }
  })();
}, SWEEP_INTERVAL_MS);

router.post("/", async (req: Request, res: ExpressResponse): Promise<void> => {
  const requestId = randomBytes(16).toString("hex");
  const startTime = Date.now();
  const tmpDir = join(tmpdir(), `snapsave-audio-${requestId}`);
  const inputPath = join(tmpDir, "input.mp4");
  const outputPath = join(tmpDir, "output.mp3");
  let dirCreated = false;

  try {
    logger.info("[AUDIO] requested", { requestId, ip: getClientIp(req) });

    // --- 1. FFmpeg availability (resolved from ffmpeg-static, not PATH) ---
    const ffmpegOk = await isFfmpegAvailable();
    logger.info("[AUDIO] ffmpeg path detected", {
      requestId,
      available: ffmpegOk,
      version: getFfmpegVersionSync(),
    });
    if (!ffmpegOk) {
      logger.error("[AUDIO] ffmpeg unavailable", { requestId });
      res.status(503).json(createErrorResponse("PROVIDER_UNAVAILABLE"));
      return;
    }

    // --- 2. Validate body ---
    const contentLength = req.headers["content-length"];
    if (contentLength && parseInt(contentLength, 10) > 1024) {
      res.status(413).json(createErrorResponse("REQUEST_TOO_LARGE"));
      return;
    }
    const contentTypeHeader = req.headers["content-type"];
    if (!contentTypeHeader || !contentTypeHeader.includes("application/json")) {
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

    // --- 3. Rate limit ---
    const ip = getClientIp(req);
    const rateLimitResult = checkRateLimit(`audio:${ip}`);
    if (!rateLimitResult.allowed) {
      logger.warn("[AUDIO] rate limit exceeded", { requestId, ip });
      res.status(429).json(createErrorResponse("RATE_LIMITED"));
      return;
    }

    // --- 4. Validate Instagram URL ---
    const validation = validateInstagramUrl(url);
    if (!validation.valid || !validation.parsed) {
      logger.info("[AUDIO] URL validation failed", { requestId, error: validation.error });
      res.status(400).json(createErrorResponse("INVALID_URL"));
      return;
    }

    // --- 5. Resolve via existing resolver ---
    logger.info("[AUDIO] resolving", { requestId, url: url.slice(0, 100) });
    const result = await resolveUrl(validation.parsed.normalized);
    logger.info("[AUDIO] resolver result", {
      requestId,
      type: result.type,
      mediaCount: result.media.length,
      hasVideo: result.media.some((m) => m.type === "video"),
    });

    // --- 6. First usable video only ---
    const videoItem = result.media.find((m) => m.type === "video" && m.url && typeof m.url === "string");
    if (!videoItem) {
      logger.warn("[AUDIO] no usable video found", { requestId });
      res.status(400).json({
        success: false,
        error: {
          code: "UNSUPPORTED_CONTENT" as ErrorCode,
          message: "No video found in this post to extract audio from.",
        },
      });
      return;
    }

    // --- 7. Validate resolved media URL ---
    const mediaValidation = validateProxyUrl(videoItem.url);
    if (!mediaValidation.ok) {
      logger.warn("[AUDIO] source blocked", { requestId, error: mediaValidation.error });
      res.status(403).json(createErrorResponse("CONTENT_UNAVAILABLE"));
      return;
    }
    logger.info("[AUDIO] source validated", { requestId, hostname: mediaValidation.value.hostname });

    // --- 8. Download source video safely ---
    await mkdir(tmpDir, { recursive: true });
    dirCreated = true;

    const upstream = await fetchUpstreamMedia(mediaValidation.value.url, {
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      tag: "AUDIO",
      requestId,
    });

    if (upstream.kind === "timeout") {
      res.status(504).json(createErrorResponse("PROVIDER_TIMEOUT"));
      return;
    }
    if (upstream.kind === "bad-redirect" || upstream.kind === "network-error") {
      res.status(502).json(createErrorResponse("CONTENT_UNAVAILABLE"));
      return;
    }

    const { response: videoResponse } = upstream;
    logger.info("[AUDIO] source status", { requestId, status: videoResponse.status });

    if (videoResponse.status === 401 || videoResponse.status === 403 || videoResponse.status === 404) {
      await videoResponse.body?.cancel().catch(() => {});
      const expired = createError("MEDIA_URL_EXPIRED");
      res.status(expired.statusCode).json(expired.toResponse());
      return;
    }
    if (!videoResponse.ok) {
      await videoResponse.body?.cancel().catch(() => {});
      logger.warn("[AUDIO] source fetch failed", { requestId, status: videoResponse.status });
      res.status(502).json(createErrorResponse("CONTENT_UNAVAILABLE"));
      return;
    }

    const sourceCT = videoResponse.headers.get("content-type") || "";
    logger.info("[AUDIO] source content-type", { requestId, contentType: sourceCT });
    if (isHtmlContent(sourceCT)) {
      await videoResponse.body?.cancel().catch(() => {});
      logger.warn("[AUDIO] source is HTML, not media", { requestId });
      const expired = createError("MEDIA_URL_EXPIRED");
      res.status(expired.statusCode).json(expired.toResponse());
      return;
    }

    const sourceLength = videoResponse.headers.get("content-length");
    if (sourceLength && parseInt(sourceLength, 10) > MAX_INPUT_BYTES) {
      await videoResponse.body?.cancel().catch(() => {});
      res.status(413).json(createErrorResponse("REQUEST_TOO_LARGE"));
      return;
    }

    // Stream the source straight to the temp file (never buffer the whole
    // video in RAM) with a hard byte cap enforced after the pipe.
    if (!videoResponse.body) {
      logger.warn("[AUDIO] empty source body", { requestId });
      res.status(502).json(createErrorResponse("CONTENT_UNAVAILABLE"));
      return;
    }
    try {
      await pipeline(
        Readable.fromWeb(videoResponse.body as import("stream/web").ReadableStream<Uint8Array>),
        createWriteStream(inputPath)
      );
    } catch (pipeErr) {
      if (pipeErr instanceof Error && pipeErr.name === "AbortError") {
        logger.warn("[AUDIO] source download timed out", { requestId });
        res.status(504).json(createErrorResponse("PROVIDER_TIMEOUT"));
        return;
      }
      throw pipeErr;
    }
    const inputStat = await stat(inputPath).catch(() => null);
    const inputBytes = inputStat?.size ?? 0;
    if (inputBytes === 0) {
      logger.warn("[AUDIO] empty source body", { requestId });
      res.status(502).json(createErrorResponse("CONTENT_UNAVAILABLE"));
      return;
    }
    if (inputBytes > MAX_INPUT_BYTES) {
      logger.warn("[AUDIO] source too large", { requestId, size: inputBytes });
      res.status(413).json(createErrorResponse("REQUEST_TOO_LARGE"));
      return;
    }
    logger.info("[AUDIO] source saved to temp", { requestId, bytes: inputBytes });

    // --- 9. FFmpeg extraction (audio only) ---
    logger.info("[AUDIO] ffmpeg started", { requestId });
    try {
      await runFfmpeg(
        ["-y", "-i", inputPath, "-vn", "-acodec", "libmp3lame", "-b:a", "192k", "-f", "mp3", outputPath],
        FFMPEG_TIMEOUT_MS
      );
    } catch (ffErr) {
      const exitCode = (ffErr as { exitCode?: unknown }).exitCode ?? "unknown";
      const stderr = (ffErr as { stderr?: unknown }).stderr ?? "";
      logger.error("[AUDIO] ffmpeg failed", {
        requestId,
        exitCode,
        stderr: String(stderr).slice(-2000),
        inputStatus: videoResponse.status,
        inputContentType: sourceCT,
      });
      res.status(502).json(createErrorResponse("AUDIO_UNAVAILABLE"));
      return;
    }
    logger.info("[AUDIO] ffmpeg completed", { requestId });

    const mp3Buffer = await readFile(outputPath).catch(() => null);
    if (!mp3Buffer || mp3Buffer.length === 0) {
      logger.error("[AUDIO] ffmpeg produced no output", { requestId });
      res.status(502).json(createErrorResponse("AUDIO_UNAVAILABLE"));
      return;
    }
    if (mp3Buffer.length > MAX_OUTPUT_BYTES) {
      logger.warn("[AUDIO] output too large", { requestId, size: mp3Buffer.length });
      res.status(413).json(createErrorResponse("REQUEST_TOO_LARGE"));
      return;
    }

    // --- 10. Cleanup BEFORE responding (MP3 already in memory) ---
    await cleanupDir(tmpDir, requestId);
    dirCreated = false;

    const safeHandle = sanitizeHandle(result.author?.username);
    const filename = `${safeHandle}-audio.mp3`;

    const duration = Date.now() - startTime;
    logger.info("[AUDIO] complete", { requestId, duration, outputSize: mp3Buffer.length });

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(mp3Buffer.length));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Request-Id", requestId);
    res.send(mp3Buffer);
  } catch (error) {
    if (error instanceof AppError) {
      logger.warn("[AUDIO] error", {
        requestId,
        code: error.code,
        message: error.message,
      });
      res.status(error.statusCode).json(error.toResponse());
      return;
    }
    logger.error("[AUDIO] unexpected error", {
      requestId,
      error: error instanceof Error ? error.message : "unknown",
    });
    if (!res.headersSent) {
      res.status(500).json(createErrorResponse("TEMPORARY_ERROR"));
    }
  } finally {
    if (dirCreated) {
      await cleanupDir(tmpDir, requestId).catch(() => {});
    }
  }
});

export default router;
