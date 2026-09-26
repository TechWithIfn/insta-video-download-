import { Router, Request, Response } from "express";
import { isFfmpegAvailable, getFfmpegVersionSync } from "../lib/ffmpeg.js";
import { audioProviderStatus } from "../lib/audio-provider.js";
import { capacitySnapshot } from "../lib/capacity.js";
import { currentDrainReason, drainMetrics, isDraining } from "../lib/shutdown.js";
import { metricsSnapshot } from "../lib/metrics.js";

const router = Router();

/**
 * Liveness: the process is running and able to answer. Deliberately does NOT
 * depend on capacity or dependencies, so a busy instance is not killed by an
 * orchestrator while it is still serving requests correctly.
 */
router.get("/", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/**
 * Readiness: should this instance receive new work?
 *
 * Reports honest saturation (which workload is full and how deep the queue
 * is) and returns 503 while draining so a load balancer stops sending traffic
 * before the process exits. It does not fail on FFmpeg being absent, because
 * that degrades audio conversion only — resolution and proxying still work.
 */
router.get("/ready", async (_req: Request, res: Response) => {
  const providerName = process.env.RESOLVER_PROVIDER || "placeholder";
  const ffmpegAvailable = await isFfmpegAvailable().catch(() => false);
  const capacity = capacitySnapshot();
  const drain = drainMetrics();

  // Only report unavailable when the instance is shutting down. A saturated
  // workload still serves cached and queued work, so it stays ready and lets
  // per-request gates return precise 503s instead of a blanket outage.
  const ready = !drain.draining;

  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "draining",
    provider: providerName,
    providerConfigured: providerName !== "placeholder",
    // Presence flag only — credentials never leave the backend.
    audioProvider: audioProviderStatus(),
    ffmpegAvailable,
    ffmpegVersion: getFfmpegVersionSync(),
    draining: drain.draining,
    drainReason: drain.reason,
    inFlightRequests: drain.inFlight,
    capacity,
    node: process.version,
    platform: process.platform,
    serverless: Boolean(process.env.VERCEL),
    timestamp: new Date().toISOString(),
  });
});

router.get("/capacity", (_req: Request, res: Response) => {
  res.json({
    draining: isDraining(),
    drainReason: currentDrainReason(),
    capacity: capacitySnapshot(),
    // Cache hit rate, provider/browser/transcode volumes, 429/503/5xx counts
    // and per-stage latency: the numbers needed to tell "slow" from "busy"
    // from "broken" without attaching a debugger.
    metrics: metricsSnapshot(),
    timestamp: new Date().toISOString(),
  });
});

router.get("/media", async (_req: Request, res: Response) => {
  const ffmpegAvailable = await isFfmpegAvailable();
  res.json({
    status: "ok",
    ffmpegAvailable,
    ffmpegVersion: getFfmpegVersionSync(),
    timestamp: new Date().toISOString(),
  });
});

export default router;
