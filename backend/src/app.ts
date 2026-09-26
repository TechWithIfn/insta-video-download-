import express from "express";
import cors from "cors";
import resolveRouter from "./routes/resolve.js";
import downloadRouter from "./routes/download.js";
import streamRouter from "./routes/stream.js";
import audioRouter from "./routes/audio.js";
import healthRouter from "./routes/health.js";
import { logger } from "./lib/logger.js";
import { createError, createErrorResponse, toAppError, AppError } from "./lib/errors.js";
import { readNonNegativeInt, readPositiveInt } from "./lib/env.js";
import { getGate } from "./lib/capacity.js";
import { beginRequest, isDraining } from "./lib/shutdown.js";
import { inc, observe } from "./lib/metrics.js";

const app = express();

/* -------------------------------------------------------------------------- */
/* Proxy trust                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Only trust forwarding headers when this process actually sits behind a proxy
 * that rewrites them. Without this, `X-Forwarded-For` is client-supplied and
 * every rate-limit / per-IP concurrency bucket can be trivially rotated.
 */
const trustProxyEnabled =
  process.env.TRUST_PROXY === "true" || process.env.TRUST_PROXY === "1";
if (trustProxyEnabled) {
  const hops = readPositiveInt("TRUST_PROXY_HOPS", 1);
  app.set("trust proxy", hops);
}

/* -------------------------------------------------------------------------- */
/* CORS — unchanged protection, but fails closed                                */
/* -------------------------------------------------------------------------- */

const corsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * An unset CORS_ORIGIN used to fall back to reflecting ANY origin, which let
 * any third-party page drive the resolver from a visitor's browser. It now
 * fails closed to a same-origin-only policy; set CORS_ORIGIN explicitly to
 * allow a separate frontend host.
 */
app.use(cors({
  origin: corsOrigins.length > 0 && !corsOrigins.includes("*")
    ? corsOrigins
    : false,
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
}));

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  // The API is called cross-origin from the frontend host, so it must not be
  // restricted to same-origin subresources.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  // Only meaningful over TLS, and only for a production deployment.
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

/* -------------------------------------------------------------------------- */
/* Request funnel metrics                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One place that turns every completed response into operational counters:
 * request volume, latency, and how many we answered with 429 (rate limited),
 * 503 (capacity/drain) or 5xx (upstream/provider failure). Hooking `finish`
 * here means no route can forget to report, and no route needs to change to
 * be measured.
 */
app.use((req, res, next) => {
  const startedAt = Date.now();
  const path = req.path;
  res.once("finish", () => {
    inc("requests");
    observe("request", Date.now() - startedAt);
    const status = res.statusCode;
    if (path.startsWith("/api/resolve")) inc("resolveRequests");
    else if (path.startsWith("/api/download")) inc("downloads");
    else if (path.startsWith("/api/stream")) inc("streamRequests");
    else if (path.startsWith("/api/audio")) inc("audioRequests");
    if (status === 429) inc("rateLimited");
    else if (status === 503) inc("capacityRejected");
    else if (status >= 500) inc("upstreamFailures");
  });
  next();
});

/* -------------------------------------------------------------------------- */
/* Global request admission control                                            */
/* -------------------------------------------------------------------------- */

const requestGate = getGate("request");
/** Retry-After advertised on a 503 so clients back off instead of hammering. */
const CAPACITY_RETRY_AFTER_SECONDS = Math.max(1, readNonNegativeInt("CAPACITY_RETRY_AFTER_SECONDS", 3, 600));

function rejectControlled(res: express.Response, error: AppError): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (error.statusCode === 503) {
    res.setHeader("Retry-After", String(CAPACITY_RETRY_AFTER_SECONDS));
  }
  res.status(error.statusCode).json(error.toResponse());
}

/**
 * Hard admission control for the whole process.
 *
 * - While draining (SIGTERM) every new request is refused with a controlled
 *   503 so a rolling deploy never accepts work it cannot finish.
 * - The total number of concurrent requests is capped. A flood is rejected
 *   fast instead of accumulating unbounded response buffers/promises.
 * - The slot is released on `finish` OR `close`, so neither a normal response
 *   nor an aborted client can leak capacity.
 */
app.use((req, res, next) => {
  // Health/readiness must stay answerable — before AND during a drain, and
  // while saturated. That is exactly when an operator or load balancer needs
  // to see it, so the bypass is checked first.
  if (req.path === "/" || req.path.startsWith("/api/health")) {
    next();
    return;
  }

  if (isDraining()) {
    rejectControlled(res, createError("SERVER_SHUTTING_DOWN"));
    return;
  }

  const end = beginRequest();

  requestGate
    .acquire()
    .then((lease) => {
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        lease.release();
        end();
      };
      res.once("finish", release);
      res.once("close", release);
      next();
    })
    .catch((err) => {
      end();
      const mapped = err instanceof AppError ? err : createError("CAPACITY_EXHAUSTED");
      logger.warn("[request] rejected at capacity", {
        path: req.path,
        method: req.method,
        inFlight: requestGate.inFlight,
        limit: requestGate.limit,
        queued: requestGate.queued,
      });
      rejectControlled(res, mapped);
    });
});

app.use(express.json({ limit: readPositiveInt("MAX_REQUEST_BODY_SIZE", 1024) }));

// Lightweight service info. No resolver work here.
app.get("/", (_req, res) => {
  res.json({
    service: "Downloadit API",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/health", healthRouter);
app.use("/api/resolve", resolveRouter);
app.use("/api/download", downloadRouter);
app.use("/api/stream", streamRouter);
app.use("/api/audio", audioRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Body-parser failures (malformed JSON, oversized/invalid payloads) are
  // client errors, not unknown server failures — answer honestly instead of
  // the generic 500/TEMPORARY_ERROR.
  const status = Number((err as { status?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode);
  const parseType = (err as { type?: unknown }).type;
  if (status >= 400 && status < 500) {
    logger.warn("Request rejected by middleware", { error: err.message, status, type: parseType });
    const mapped = parseType === "entity.too.large"
      ? createErrorResponse("REQUEST_TOO_LARGE")
      : createErrorResponse("VALIDATION_ERROR");
    res.status(parseType === "entity.too.large" ? 413 : 400).json(mapped);
    return;
  }

  const mapped = toAppError(err, "TEMPORARY_ERROR");
  logger.error("Unhandled error", { error: err.message, errorCode: mapped.code });
  res.status(mapped.statusCode).json(mapped.toResponse());
});

export default app;
