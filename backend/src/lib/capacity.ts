import { createError } from "./errors.js";
import { logger } from "./logger.js";
import { readBoundedInt, readNonNegativeInt } from "./env.js";
import { isDraining } from "./shutdown.js";
import type { CapacitySnapshot, WorkloadCapacity } from "./types.js";

/**
 * Controlled concurrency for every expensive workload.
 *
 * Design rules (all enforced here, not scattered across routes):
 *
 *  1. NOTHING IS UNLIMITED. Every workload has a hard `limit`. When the limit
 *     is reached, callers either queue for a bounded time or receive a
 *     controlled 503 (`CAPACITY_EXHAUSTED`). The process never grows an
 *     unbounded number of browsers, FFmpeg children, streams or promises.
 *  2. WORKLOADS ARE ISOLATED. A saturated `puppeteer` gate can never consume
 *     the `stream` budget, so a burst of resolves cannot starve media
 *     delivery (and vice versa).
 *  3. RELEASES ARE IDEMPOTENT AND LEAK-PROOF. A lease releases its slot in a
 *     `finally`, exactly once, and releasing twice is a no-op. Slots held
 *     longer than `staleMs` (a killed request, a frozen runtime, a lost
 *     socket) are reclaimed so a leak degrades capacity instead of wedging it.
 *  4. WAITERS ARE HANDED THE SLOT DIRECTLY. No polling, no thundering herd,
 *     no lost wakeups: a release transfers ownership to the next waiter.
 *  5. NO TIMER KEEPS THE PROCESS ALIVE. Every internal timer is `unref()`'d.
 *
 * Gates are per-process. On a multi-instance or serverless deployment each
 * instance enforces its own budget, which is exactly why the limits are sized
 * per-instance (see WORKLOAD_DEFAULTS) and why readiness reports saturation
 * per instance.
 */

export type WorkloadName =
  | "request"
  | "resolve"
  | "provider"
  | "puppeteer"
  | "audio"
  | "ffmpeg"
  | "stream"
  | "download"
  | "probe";

interface Waiter {
  resolve: () => void;
  timer: NodeJS.Timeout | null;
  detachSignal: (() => void) | null;
}

export interface AcquireOptions {
  /** Max time to wait in the queue. 0 = fail fast. Default: workload max queue. */
  waitMs?: number;
  /** Abort a queued wait (used for client disconnects and shutdown). */
  signal?: AbortSignal;
}

export interface Lease {
  readonly workload: string;
  /** Idempotent: safe to call from a `finally` more than once. */
  release(): void;
}

interface WorkloadDefaults {
  limit: number;
  maxQueueMs: number;
  staleMs: number;
}

/**
 * Per-instance defaults. These are deliberately conservative and sized so a
 * single Node process cannot exhaust its own memory/CPU. Override per
 * deployment with the env names in WORKLOAD_ENV — always measured, never
 * guessed upward.
 */
const WORKLOAD_DEFAULTS: Record<WorkloadName, WorkloadDefaults> = {
  // Total in-flight HTTP requests. Cheap bookkeeping, but bounded so a flood
  // cannot accumulate unbounded response state.
  request: { limit: 256, maxQueueMs: 1_000, staleMs: 120_000 },
  // Resolve route handlers, including time spent queued for a provider.
  resolve: { limit: 64, maxQueueMs: 5_000, staleMs: 90_000 },
  // Provider.resolve() calls (Puppeteer/external/mock).
  provider: { limit: 24, maxQueueMs: 5_000, staleMs: 60_000 },
  // Browser pages. Each page is a real Chromium tab with its own memory.
  puppeteer: { limit: 6, maxQueueMs: 8_000, staleMs: 60_000 },
  // Audio requests doing resolve + download + transcode work.
  audio: { limit: 4, maxQueueMs: 2_000, staleMs: 120_000 },
  // FFmpeg child processes — the single most CPU/memory hungry operation.
  ffmpeg: { limit: 2, maxQueueMs: 2_000, staleMs: 90_000 },
  // Active media streams proxied to clients.
  stream: { limit: 128, maxQueueMs: 2_000, staleMs: 300_000 },
  // Active file downloads proxied to clients.
  download: { limit: 64, maxQueueMs: 2_000, staleMs: 300_000 },
  // Metadata probes (HEAD + ranged GET) issued during media enrichment.
  probe: { limit: 12, maxQueueMs: 3_000, staleMs: 30_000 },
};

/**
 * Env names per workload. `MAX_CONCURRENT_AUDIO_JOBS` and
 * `MAX_CONCURRENT_PAGES` are the pre-existing names, kept for continuity.
 */
const WORKLOAD_ENV: Record<WorkloadName, { limit: string; queue: string; stale: string }> = {
  request: { limit: "MAX_CONCURRENT_REQUESTS", queue: "REQUEST_QUEUE_WAIT_MS", stale: "REQUEST_STALE_MS" },
  resolve: { limit: "MAX_CONCURRENT_RESOLVES", queue: "RESOLVE_QUEUE_WAIT_MS", stale: "RESOLVE_STALE_MS" },
  provider: { limit: "MAX_CONCURRENT_PROVIDERS", queue: "PROVIDER_QUEUE_WAIT_MS", stale: "PROVIDER_STALE_MS" },
  puppeteer: { limit: "MAX_CONCURRENT_PAGES", queue: "PUPPETEER_QUEUE_WAIT_MS", stale: "PUPPETEER_STALE_MS" },
  audio: { limit: "MAX_CONCURRENT_AUDIO_JOBS", queue: "AUDIO_QUEUE_WAIT_MS", stale: "AUDIO_STALE_MS" },
  ffmpeg: { limit: "MAX_CONCURRENT_FFMPEG", queue: "FFMPEG_QUEUE_WAIT_MS", stale: "FFMPEG_STALE_MS" },
  stream: { limit: "MAX_CONCURRENT_STREAMS", queue: "STREAM_QUEUE_WAIT_MS", stale: "STREAM_STALE_MS" },
  download: { limit: "MAX_CONCURRENT_DOWNLOADS", queue: "DOWNLOAD_QUEUE_WAIT_MS", stale: "DOWNLOAD_STALE_MS" },
  probe: { limit: "MAX_CONCURRENT_PROBES", queue: "PROBE_QUEUE_WAIT_MS", stale: "PROBE_STALE_MS" },
};

function defaultsFor(name: string): WorkloadDefaults {
  const base = WORKLOAD_DEFAULTS[name as WorkloadName];
  if (!base) {
    // Unknown/custom workload (tests, one-off internal use): still bounded.
    return { limit: 16, maxQueueMs: 1_000, staleMs: 60_000 };
  }
  const env = WORKLOAD_ENV[name as WorkloadName];
  return {
    limit: readBoundedInt(env.limit, base.limit, 1, 4096),
    maxQueueMs: readNonNegativeInt(env.queue, base.maxQueueMs, 60_000),
    staleMs: readNonNegativeInt(env.stale, base.staleMs, 3_600_000),
  };
}

/**
 * A bounded-concurrency gate with a FIFO wait queue and leak recovery.
 */
export class WorkloadGate {
  readonly name: string;
  readonly limit: number;
  readonly maxQueueMs: number;
  readonly staleMs: number;

  /** leaseId -> acquisition timestamp. */
  private readonly held = new Map<number, number>();
  private waiters: Waiter[] = [];
  private seq = 0;
  private peak = 0;
  private admitted = 0;
  private rejected = 0;
  private reclaimed = 0;

  constructor(name: string, options: Partial<WorkloadDefaults> = {}) {
    const base = defaultsFor(name);
    this.name = name;
    this.limit = options.limit ?? base.limit;
    this.maxQueueMs = options.maxQueueMs ?? base.maxQueueMs;
    this.staleMs = options.staleMs ?? base.staleMs;
  }

  get inFlight(): number {
    return this.held.size;
  }

  get queued(): number {
    return this.waiters.length;
  }

  /** True when no further work can be admitted without waiting. */
  isSaturated(): boolean {
    return this.held.size >= this.limit;
  }

  /**
   * Reclaim slots whose holder is presumed dead (killed request, frozen
   * serverless instance, lost socket). Without this a single leak would
   * permanently reduce capacity until restart.
   */
  private reclaimStale(): void {
    if (this.staleMs <= 0 || this.held.size === 0) return;
    const cutoff = Date.now() - this.staleMs;
    let removed = 0;
    for (const [id, at] of this.held) {
      if (at < cutoff) {
        this.held.delete(id);
        removed++;
      }
    }
    if (removed > 0) {
      this.reclaimed += removed;
      logger.warn("[capacity] reclaimed stale slots", {
        workload: this.name,
        reclaimed: removed,
        staleMs: this.staleMs,
        inFlight: this.held.size,
        limit: this.limit,
      });
    }
  }

  private grant(): Lease {
    const id = ++this.seq;
    this.held.set(id, Date.now());
    this.admitted++;
    if (this.held.size > this.peak) this.peak = this.held.size;
    let released = false;
    return {
      workload: this.name,
      release: () => {
        if (released) return;
        released = true;
        this.releaseId(id);
      },
    };
  }

  private releaseId(id: number): void {
    this.held.delete(id);
    this.drainWaiters();
  }

  /** Hand free slots to queued waiters, in FIFO order, without polling. */
  private drainWaiters(): void {
    while (this.waiters.length > 0 && this.held.size < this.limit) {
      const next = this.waiters.shift();
      if (!next) break;
      if (next.timer) clearTimeout(next.timer);
      next.detachSignal?.();
      next.resolve();
    }
  }

  /**
   * Acquire a slot. Resolves with a lease, or throws `CAPACITY_EXHAUSTED`
   * (a controlled 503) when the queue window elapses. Never blocks forever.
   */
  async acquire(options: AcquireOptions = {}): Promise<Lease> {
    const waitMs = options.waitMs ?? this.maxQueueMs;
    const { signal } = options;

    if (signal?.aborted) {
      this.rejected++;
      throw createError("CAPACITY_EXHAUSTED");
    }

    this.reclaimStale();
    if (this.held.size < this.limit) {
      return this.grant();
    }

    if (!(waitMs > 0)) {
      this.rejected++;
      logger.warn("[capacity] rejected, no capacity", {
        workload: this.name,
        inFlight: this.held.size,
        limit: this.limit,
      });
      throw createError("CAPACITY_EXHAUSTED");
    }

    return new Promise<Lease>((resolve, reject) => {
      const waiter: Waiter = { resolve: () => {}, timer: null, detachSignal: null };

      const drop = (): void => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        if (waiter.timer) clearTimeout(waiter.timer);
        waiter.detachSignal?.();
      };

      const timer = setTimeout(() => {
        drop();
        this.rejected++;
        logger.warn("[capacity] rejected, queue wait elapsed", {
          workload: this.name,
          waitedMs: waitMs,
          inFlight: this.held.size,
          limit: this.limit,
          queued: this.waiters.length,
        });
        reject(createError("CAPACITY_EXHAUSTED"));
      }, waitMs);
      // Never let a queue timer alone keep the process alive.
      timer.unref?.();
      waiter.timer = timer;

      if (signal) {
        const onAbort = (): void => {
          drop();
          this.rejected++;
          reject(createError("CAPACITY_EXHAUSTED"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        waiter.detachSignal = () => signal.removeEventListener("abort", onAbort);
      }

      // A slot may have freed up between the capacity check and this push.
      waiter.resolve = () => {
        if (this.held.size < this.limit) {
          resolve(this.grant());
          return;
        }
        this.drainWaiters();
      };

      this.waiters.push(waiter);
      this.drainWaiters();
    });
  }

  /** Acquire, run, and always release — the only correct way to hold a slot. */
  async run<T>(fn: (lease: Lease) => Promise<T> | T, options?: AcquireOptions): Promise<T> {
    const lease = await this.acquire(options);
    try {
      return await fn(lease);
    } finally {
      lease.release();
    }
  }

  snapshot(): WorkloadCapacity {
    return {
      name: this.name,
      limit: this.limit,
      inFlight: this.held.size,
      queued: this.waiters.length,
      peak: this.peak,
      admitted: this.admitted,
      rejected: this.rejected,
      reclaimed: this.reclaimed,
      utilization: this.limit > 0 ? Number((this.held.size / this.limit).toFixed(3)) : 0,
    };
  }

  /** Test-only: forget all state without touching the configured limits. */
  reset(): void {
    for (const waiter of this.waiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.detachSignal?.();
    }
    this.waiters = [];
    this.held.clear();
    this.peak = 0;
    this.admitted = 0;
    this.rejected = 0;
    this.reclaimed = 0;
  }
}

/* -------------------------------------------------------------------------- */
/* Per-key (per-IP) concurrency                                                */
/* -------------------------------------------------------------------------- */

interface KeyedEntry {
  count: number;
  lastAt: number;
}

/**
 * Bounds concurrent work per client key so one client (or one spoofed-IP bot
 * fleet) cannot monopolize a global workload. The key map is itself bounded
 * and swept, so rotating keys cannot grow memory without limit.
 */
export class KeyedConcurrency {
  private readonly entries = new Map<string, KeyedEntry>();

  constructor(
    readonly limitPerKey: number,
    readonly maxKeys: number = 20_000,
    private readonly idleTtlMs: number = 120_000
  ) {}

  tryAcquire(key: string): boolean {
    if (this.limitPerKey <= 0) return true;
    const now = Date.now();
    const entry = this.entries.get(key);
    if (entry && entry.count >= this.limitPerKey) {
      entry.lastAt = now;
      return false;
    }
    if (!entry) {
      if (this.entries.size >= this.maxKeys) this.evictOldest();
      this.entries.set(key, { count: 1, lastAt: now });
    } else {
      entry.count++;
      entry.lastAt = now;
    }
    return true;
  }

  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.count = Math.max(0, entry.count - 1);
    entry.lastAt = Date.now();
  }

  /** Wrap a unit of work; returns false instead of throwing when full. */
  async run<T>(key: string, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
    if (!this.tryAcquire(key)) return { ok: false };
    try {
      return { ok: true, value: await fn() };
    } finally {
      this.release(key);
    }
  }

  count(key: string): number {
    return this.entries.get(key)?.count ?? 0;
  }

  size(): number {
    return this.entries.size;
  }

  sweep(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.count <= 0 && now - entry.lastAt > this.idleTtlMs) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [key, entry] of this.entries) {
      if (entry.lastAt < oldestAt) {
        oldestAt = entry.lastAt;
        oldestKey = key;
      }
    }
    if (oldestKey) this.entries.delete(oldestKey);
  }

  reset(): void {
    this.entries.clear();
  }
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

const gates = new Map<WorkloadName, WorkloadGate>();

export function getGate(name: WorkloadName): WorkloadGate {
  let gate = gates.get(name);
  if (!gate) {
    gate = new WorkloadGate(name);
    gates.set(name, gate);
  }
  return gate;
}

export function allGates(): WorkloadGate[] {
  return WORKLOAD_NAMES.map((name) => getGate(name));
}

export const WORKLOAD_NAMES: readonly WorkloadName[] = [
  "request",
  "resolve",
  "provider",
  "puppeteer",
  "audio",
  "ffmpeg",
  "stream",
  "download",
  "probe",
] as const;

function memoryUsage(): CapacitySnapshot["memory"] {
  const usage = process.memoryUsage();
  const mb = (bytes: number): number => Math.round((bytes / (1024 * 1024)) * 10) / 10;
  return { rssMb: mb(usage.rss), heapUsedMb: mb(usage.heapUsed), heapTotalMb: mb(usage.heapTotal) };
}

export function capacitySnapshot(): CapacitySnapshot {
  return {
    workloads: allGates().map((gate) => gate.snapshot()),
    memory: memoryUsage(),
    draining: isDraining(),
    uptimeSeconds: Math.round(process.uptime()),
  };
}

export function resetGatesForTests(): void {
  for (const gate of gates.values()) gate.reset();
  gates.clear();
}
