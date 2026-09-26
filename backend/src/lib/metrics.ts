/**
 * Process-local counters for the operational questions that matter under
 * load: is the cache working, how often are we paying for a provider/browser
 * job, how many requests are we turning away, and how long does each stage
 * take.
 *
 * Design constraints:
 *  - FIXED key set (no unbounded label/metric names), so a hostile request can
 *    never grow this map.
 *  - Plain in-process numbers: no dependency, no allocation on the hot path
 *    beyond an integer add, and no cost when nobody scrapes the endpoint.
 *  - Every duration is observed, never stored per-request, so there is no
 *    unbounded history to leak.
 *
 * These are single-process counters. Behind multiple instances each instance
 * reports its own view; they are diagnostic, not a distributed metrics system.
 */

export type MetricName =
  // Request funnel
  | "requests"
  | "requestsRejected"
  | "resolveRequests"
  | "downloads"
  | "streamRequests"
  | "audioRequests"
  | "rateLimited"
  | "capacityRejected"
  | "upstreamFailures"
  // Resolution cache
  | "cacheHits"
  | "cacheMisses"
  | "cacheRefreshes"
  | "cacheEvictions"
  | "coalescedResolutions"
  // Expensive work
  | "providerResolutions"
  | "providerFailures"
  | "puppeteerJobs"
  | "puppeteerFailures"
  | "ffmpegJobs"
  | "ffmpegFailures"
  | "ffmpegAborts";

/** Stages we time. Kept fixed for the same reason as MetricName. */
export type DurationName = "resolve" | "provider" | "ffmpeg" | "mediaFetch" | "request";

const COUNTERS: Record<MetricName, number> = {
  requests: 0,
  requestsRejected: 0,
  resolveRequests: 0,
  downloads: 0,
  streamRequests: 0,
  audioRequests: 0,
  rateLimited: 0,
  capacityRejected: 0,
  upstreamFailures: 0,
  cacheHits: 0,
  cacheMisses: 0,
  cacheRefreshes: 0,
  cacheEvictions: 0,
  coalescedResolutions: 0,
  providerResolutions: 0,
  providerFailures: 0,
  puppeteerJobs: 0,
  puppeteerFailures: 0,
  ffmpegJobs: 0,
  ffmpegFailures: 0,
  ffmpegAborts: 0,
};

interface DurationAccumulator {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
}

const DURATIONS: Record<DurationName, DurationAccumulator> = {
  resolve: { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 },
  provider: { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 },
  ffmpeg: { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 },
  mediaFetch: { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 },
  request: { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 },
};

export function inc(name: MetricName, by = 1): void {
  COUNTERS[name] += by;
}

/** Record one observation. Non-finite and negative values are ignored. */
export function observe(name: DurationName, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const acc = DURATIONS[name];
  acc.count += 1;
  acc.totalMs += ms;
  if (ms > acc.maxMs) acc.maxMs = ms;
  acc.lastMs = ms;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export interface MetricsSnapshot {
  counters: Record<MetricName, number>;
  /** cacheHits / (cacheHits + cacheMisses), 0 when nothing was looked up yet. */
  cacheHitRate: number;
  durations: Record<
    DurationName,
    { count: number; avgMs: number; maxMs: number; lastMs: number }
  >;
  uptimeSeconds: number;
}

export function metricsSnapshot(): MetricsSnapshot {
  const lookups = COUNTERS.cacheHits + COUNTERS.cacheMisses;
  const durations = {} as MetricsSnapshot["durations"];
  for (const [name, acc] of Object.entries(DURATIONS) as Array<
    [DurationName, DurationAccumulator]
  >) {
    durations[name] = {
      count: acc.count,
      avgMs: acc.count > 0 ? round1(acc.totalMs / acc.count) : 0,
      maxMs: round1(acc.maxMs),
      lastMs: round1(acc.lastMs),
    };
  }
  return {
    counters: { ...COUNTERS },
    cacheHitRate: lookups > 0 ? round1((COUNTERS.cacheHits / lookups) * 100) : 0,
    durations,
    uptimeSeconds: Math.round(process.uptime()),
  };
}

/** Test-only: restore pristine counters. */
export function resetMetricsForTests(): void {
  for (const key of Object.keys(COUNTERS) as MetricName[]) COUNTERS[key] = 0;
  for (const acc of Object.values(DURATIONS)) {
    acc.count = 0;
    acc.totalMs = 0;
    acc.maxMs = 0;
    acc.lastMs = 0;
  }
}
