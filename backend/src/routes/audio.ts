import { Router, Request, Response as ExpressResponse } from "express";
import { mkdir, rm, readdir, stat } from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { validateInstagramUrl } from "../lib/validators/instagram-url.js";
import type { ParsedInstagramUrl } from "../lib/validators/instagram-url.js";
import { resolveUrl } from "../lib/resolvers/index.js";
import { checkRateLimit, routeRateLimitConfig } from "../lib/rate-limit.js";
import { logger } from "../lib/logger.js";
import { AppError, createError, createErrorResponse, toAppError } from "../lib/errors.js";
import { isFfmpegAvailable, runFfmpeg, getFfmpegVersionSync } from "../lib/ffmpeg.js";
import { scheduleBackgroundTask } from "../lib/background.js";
import { KeyedConcurrency, getGate } from "../lib/capacity.js";
import { readBoundedInt } from "../lib/env.js";
import {
  validateProxyUrl,
  getClientIp,
  fetchUpstreamMedia,
  isHtmlContent,
} from "../lib/media-proxy.js";
import { isTrustedProviderMediaUrl } from "../lib/audio-provider.js";
import type { ErrorCode } from "../lib/types.js";

const router = Router();

const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 60_000;
const FFMPEG_TIMEOUT_MS = 60_000;
const STALE_DIR_TTL_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Concurrency, separated by cost:
 *  - `audio` gate caps how many audio requests run their pipeline at once.
 *  - `ffmpeg` gate caps the number of FFmpeg CHILD PROCESSES (the real CPU
 *    and memory cost). A request may hold an audio slot while queued for an
 *    FFmpeg slot; that is the intended, bounded behaviour.
 *  - per-IP cap stops one client from occupying every audio slot.
 *
 * The previous free-running `activeAudioJobs` counter was decremented in a
 * `finally` that also ran for requests which never incremented it, so repeated
 * early returns pinned the counter at 0 and disabled the limit entirely.
 * Gates cannot drift: a lease is acquired once and released exactly once.
 */
const audioGate = getGate("audio");
const ffmpegGate = getGate("ffmpeg");
const perIpAudio = new KeyedConcurrency(readBoundedInt("MAX_CONCURRENT_AUDIO_PER_IP", 1, 1, 16));

function sanitizeHandle(username: string | null | undefined): string {
  if (!username) return "downloadit";
  return (
    username
      .replace(/[^a-zA-Z0-9._-]/g, "")
      .replace(/^\.+|\.+$/g, "")
      .slice(0, 60) || "downloadit"
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
// Registered (not a bare setInterval) so it is unref'd — it must never be the
// reason the process stays alive — and is cleared deterministically on
// shutdown. Disabled on serverless, where there is no long-lived process.
scheduleBackgroundTask("audio-temp-sweep", SWEEP_INTERVAL_MS, async () => {
  try {
    const base = tmpdir();
    const entries = await readdir(base);
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.startsWith("downloadit-audio-")) continue;
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
});

router.post("/", async (req: Request, res: ExpressResponse): Promise<void> => {
  const requestId = randomBytes(16).toString("hex");
  const ip = getClientIp(req);

  // --- Cheap phase: shape, rate limit and URL validation run BEFORE any
  // capacity is consumed. A malformed request must never be able to occupy an
  // audio slot, an FFmpeg slot, or a temp directory.
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
  const rateLimitResult = checkRateLimit(`audio:${ip}`, routeRateLimitConfig("audio"));
  if (!rateLimitResult.allowed) {
    logger.warn("[AUDIO] rate limit exceeded", { requestId, ip });
    res.setHeader("Retry-After", String(Math.ceil(rateLimitResult.retryAfterMs / 1000)));
    res.status(429).json(createErrorResponse("RATE_LIMITED"));
    return;
  }
  const validation = validateInstagramUrl(url);
  if (!validation.valid || !validation.parsed) {
    logger.info("[AUDIO] URL validation failed", { requestId, error: validation.error });
    res.status(400).json(createErrorResponse("INVALID_URL"));
    return;
  }
  const parsed = validation.parsed;

  // A client that navigates away mid-transcode must not keep a download
  // running and an FFmpeg child alive. Listen on `res`, not `req`: `req`
  // emits "close" as soon as the POST body is consumed, which is not a
  // disconnect.
  const controller = new AbortController();
  const onClose = (): void => {
    if (!res.writableEnded) controller.abort();
  };
  res.on("close", onClose);

  // Per-IP admission first (cheap), then the global audio gate. A full gate
  // produces a controlled 503 rather than an unbounded queue.
  if (!perIpAudio.tryAcquire(ip)) {
    res.off("close", onClose);
    res.setHeader("Retry-After", "3");
    res.status(503).json(createErrorResponse("CAPACITY_EXHAUSTED"));
    return;
  }

  try {
    await audioGate.run(
      () => handleAudioRequest(req, res, requestId, ip, parsed, controller.signal),
      { signal: controller.signal }
    );
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (error instanceof AppError) {
      res.setHeader("Retry-After", "3");
      res.status(error.statusCode).json(error.toResponse());
      return;
    }
    const mapped = toAppError(error, "AUDIO_UNAVAILABLE");
    res.status(mapped.statusCode).json(mapped.toResponse());
  } finally {
    res.off("close", onClose);
    perIpAudio.release(ip);
  }
});

async function handleAudioRequest(
  req: Request,
  res: ExpressResponse,
  requestId: string,
  ip: string,
  parsed: ParsedInstagramUrl,
  signal: AbortSignal
): Promise<void> {
  const startTime = Date.now();
  const tmpDir = join(tmpdir(), `downloadit-audio-${requestId}`);
  const inputPath = join(tmpDir, "input.mp4");
  const outputPath = join(tmpDir, "output.mp3");
  let dirCreated = false;

  try {
    logger.info("[AUDIO] requested", { requestId, ip });

    // --- 1. FFmpeg availability (resolved from ffmpeg-static, not PATH) ---
    const ffmpegOk = await isFfmpegAvailable();
    logger.info("[AUDIO] ffmpeg path detected", {
      requestId,
      available: ffmpegOk,
      version: getFfmpegVersionSync(),
    });
    if (!ffmpegOk) {
      logger.error("[AUDIO] ffmpeg unavailable", { requestId });
      // Truthful code: the resolver is healthy — audio conversion itself is down.
      const unavailable = createError("AUDIO_UNAVAILABLE");
      res.status(unavailable.statusCode).json(unavailable.toResponse());
      return;
    }

    // --- 2. Resolve: dedicated audio lookup for audio pages, normal
    // Reel/video resolve otherwise (shared cache, never duplicated) ---
    // Body shape, rate limit and URL validation already ran before this slot
    // was acquired.
    logger.info("[AUDIO] resolving", { requestId, url: parsed.normalized.slice(0, 100) });
    const result = await resolveUrl(parsed.normalized, undefined, { signal });
    const hasVideo = result.media.some((m) => m.type === "video");
    logger.info("[AUDIO] resolver result", {
      requestId,
      detectedType: parsed.contentType,
      audioId: parsed.audioId,
      provider: result.type === "AUDIO" && parsed.contentType === "AUDIO" ? "audio-lookup" : "resolver",
      type: result.type,
      mediaCount: result.media.length,
      hasVideo,
      audioSourceFound: hasVideo,
      videoSourceFound: hasVideo,
    });

    // --- 3. First usable source: direct audio file preferred, else video ---
    const sourceItem = result.media.find(
      (m) => (m.type === "video" || m.type === "audio") && m.url && typeof m.url === "string"
    );
    const videoItem = sourceItem;
    if (!videoItem) {
      logger.warn("[AUDIO] no usable video found", { requestId });
      // An audio page with no resolvable source clip must get a clear audio
      // error — never the confusing "no video in this post" message.
      const audioPage = result.type === "AUDIO" || parsed.contentType === "AUDIO";
      if (audioPage) {
        const noSource = createError("AUDIO_NO_SOURCE");
        res.status(noSource.statusCode).json(noSource.toResponse());
        return;
      }
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
    // Video sources keep the strict Instagram-CDN allowlist. Direct audio
    // files from the configured audio provider are server-resolved (never
    // user-supplied), so they need https + public-host validation instead.
    let sourceUrl: string;
    let sourceHost: string;
    if (videoItem.type === "audio") {
      if (!isTrustedProviderMediaUrl(videoItem.url)) {
        logger.warn("[AUDIO] audio source blocked", { requestId });
        res.status(403).json(createErrorResponse("CONTENT_UNAVAILABLE"));
        return;
      }
      sourceUrl = videoItem.url;
      sourceHost = new URL(videoItem.url).hostname;
    } else {
      const mediaValidation = validateProxyUrl(videoItem.url);
      if (!mediaValidation.ok) {
        logger.warn("[AUDIO] source blocked", { requestId, error: mediaValidation.error });
        res.status(403).json(createErrorResponse("CONTENT_UNAVAILABLE"));
        return;
      }
      sourceUrl = mediaValidation.value.url;
      sourceHost = mediaValidation.value.hostname;
    }
    logger.info("[AUDIO] source validated", { requestId, hostname: sourceHost });

    // --- 8. Download source video safely ---
    await mkdir(tmpDir, { recursive: true });
    dirCreated = true;

    const upstream = await fetchUpstreamMedia(sourceUrl, {
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      tag: "AUDIO",
      requestId,
      signal,
    });

    if (upstream.kind === "client-gone") {
      logger.info("[AUDIO] client gone before source download", { requestId });
      return;
    }
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
      // The source download is abortable: a client that leaves mid-transfer
      // must not keep pulling 100 MB through the server to a dead socket.
      await pipeline(
        Readable.fromWeb(videoResponse.body as import("stream/web").ReadableStream<Uint8Array>),
        createWriteStream(inputPath),
        { signal }
      );
    } catch (pipeErr) {
      if (pipeErr instanceof Error && pipeErr.name === "AbortError") {
        if (signal.aborted) {
          logger.info("[AUDIO] client gone during source download", { requestId });
          return;
        }
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

    // --- 8b. Direct audio passthrough: a genuine audio file needs no
    // re-encode — serve the verified bytes as MP3 when the source already is
    // one. Anything else falls through to FFmpeg extraction below.
    const sourceIsMp3 =
      videoItem.type === "audio" &&
      (sourceCT.toLowerCase().startsWith("audio/mpeg") ||
        sourceCT.toLowerCase().startsWith("audio/mp3"));
    if (sourceIsMp3) {
      if (inputBytes > MAX_OUTPUT_BYTES) {
        logger.warn("[AUDIO] audio source too large", { requestId, size: inputBytes });
        res.status(413).json(createErrorResponse("REQUEST_TOO_LARGE"));
        return;
      }
      const safeHandle = sanitizeHandle(result.author?.username);
      const filename = `${safeHandle}-audio.mp3`;
      logger.info("[AUDIO] complete", {
        requestId,
        duration: Date.now() - startTime,
        outputSize: inputBytes,
        finalResult: "direct-mp3",
      });
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", String(inputBytes));
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Request-Id", requestId);
      // Streamed from disk: a 20 MB MP3 must not be buffered in process memory
      // per concurrent request.
      await pipeline(createReadStream(inputPath), res).catch((err) => {
        logger.warn("[AUDIO] client aborted mp3 delivery", {
          requestId,
          error: err instanceof Error ? err.message : "unknown",
        });
      });
      return;
    }

    // --- 9. FFmpeg extraction (audio only) ---
    // The ffmpeg gate is the real child-process ceiling. Waiting for a slot is
    // bounded; a full queue yields a controlled 503, never a process pile-up.
    logger.info("[AUDIO] ffmpeg starting", { requestId });
    try {
      await ffmpegGate.run(
        () =>
          runFfmpeg(
            ["-y", "-i", inputPath, "-vn", "-acodec", "libmp3lame", "-b:a", "192k", "-f", "mp3", outputPath],
            FFMPEG_TIMEOUT_MS,
            signal
          ),
        { signal }
      );
    } catch (ffErr) {
      if (ffErr instanceof AppError) {
        logger.warn("[AUDIO] ffmpeg not admitted", { requestId, code: ffErr.code });
        res.setHeader("Retry-After", "3");
        res.status(ffErr.statusCode).json(ffErr.toResponse());
        return;
      }
      if (ffErr instanceof Error && ffErr.name === "AbortError") {
        // Caller vanished (disconnect/drain): kill the child, drop the temp
        // files in `finally`, and write nothing.
        logger.info("[AUDIO] ffmpeg cancelled", { requestId });
        return;
      }
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

    // Size is checked on disk before any byte is sent, so an oversized result
    // is rejected without ever entering the response path.
    const outputStat = await stat(outputPath).catch(() => null);
    const outputBytes = outputStat?.size ?? 0;
    if (outputBytes === 0) {
      logger.error("[AUDIO] ffmpeg produced no output", { requestId });
      res.status(502).json(createErrorResponse("AUDIO_UNAVAILABLE"));
      return;
    }
    if (outputBytes > MAX_OUTPUT_BYTES) {
      logger.warn("[AUDIO] output too large", { requestId, size: outputBytes });
      res.status(413).json(createErrorResponse("REQUEST_TOO_LARGE"));
      return;
    }

    const safeHandle = sanitizeHandle(result.author?.username);
    const filename = `${safeHandle}-audio.mp3`;

    logger.info("[AUDIO] complete", { requestId, duration: Date.now() - startTime, outputSize: outputBytes });

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(outputBytes));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Request-Id", requestId);
    // Streamed from disk; the temp dir is removed by the finally below, so
    // cleanup happens exactly once whether delivery succeeded or was aborted.
    await pipeline(createReadStream(outputPath), res).catch((err) => {
      logger.warn("[AUDIO] client aborted mp3 delivery", {
        requestId,
        error: err instanceof Error ? err.message : "unknown",
      });
    });
  } catch (error) {
    if (error instanceof AppError) {
      logger.warn("[AUDIO] error", {
        requestId,
        code: error.code,
        message: error.message,
      });
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error.statusCode === 503) res.setHeader("Retry-After", "3");
      res.status(error.statusCode).json(error.toResponse());
      return;
    }
    const mapped = toAppError(error, "AUDIO_UNAVAILABLE");
    logger.error("[AUDIO] unexpected error", {
      requestId,
      errorCode: mapped.code,
      error: error instanceof Error ? error.message : "unknown",
    });
    if (!res.headersSent) {
      res.status(mapped.statusCode).json(mapped.toResponse());
    } else {
      res.destroy();
    }
  } finally {
    if (dirCreated) {
      await cleanupDir(tmpDir, requestId).catch(() => {});
    }
  }
}

export default router;
