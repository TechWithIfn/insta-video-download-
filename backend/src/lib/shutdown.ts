import { logger } from "./logger.js";
import { stopAllBackgroundTasks } from "./background.js";
import { readNonNegativeInt } from "./env.js";

/**
 * Graceful shutdown + request draining.
 *
 * Sequence on SIGTERM:
 *   1. `startDraining()` flips the readiness gate so the load balancer stops
 *      sending new traffic and every new request gets a controlled 503.
 *   2. `waitForDrain()` waits for in-flight requests to finish, bounded by
 *      SHUTDOWN_DRAIN_TIMEOUT_MS. It never waits forever.
 *   3. Registered cleanups run (Chromium close, temp sweep timers, provider
 *      reset), each independently time-bounded so one hung cleanup cannot
 *      block the exit.
 *   4. Background timers are cleared so nothing re-arms work mid-exit.
 *
 * In-flight accounting is exact: `beginRequest()` returns an `end()` that is
 * idempotent, and both the `finish` and `close` response events call it, so a
 * request is never counted twice or left counted forever.
 */

type CleanupFn = () => void | Promise<void>;

interface Cleanup {
  name: string;
  fn: CleanupFn;
}

let draining = false;
let drainCause: string | null = null;
let inFlight = 0;
let peakInFlight = 0;
let totalRequests = 0;
const cleanups: Cleanup[] = [];
const drainWaiters: Array<() => void> = [];

export const DRAIN_TIMEOUT_MS = readNonNegativeInt("SHUTDOWN_DRAIN_TIMEOUT_MS", 10_000);
const CLEANUP_TIMEOUT_MS = readNonNegativeInt("SHUTDOWN_CLEANUP_TIMEOUT_MS", 8_000);

export function isDraining(): boolean {
  return draining;
}

export function currentDrainReason(): string | null {
  return drainCause;
}

export function inFlightRequests(): number {
  return inFlight;
}

/**
 * Track one in-flight request. Call the returned function exactly once when
 * the response finishes or the socket closes; it is safe to call twice.
 */
export function beginRequest(): () => void {
  inFlight++;
  totalRequests++;
  if (inFlight > peakInFlight) peakInFlight = inFlight;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    inFlight = Math.max(0, inFlight - 1);
    if (inFlight === 0) {
      while (drainWaiters.length > 0) {
        const notify = drainWaiters.shift();
        notify?.();
      }
    }
  };
}

export function drainMetrics(): {
  draining: boolean;
  reason: string | null;
  inFlight: number;
  peakInFlight: number;
  totalRequests: number;
} {
  return { draining, reason: drainCause, inFlight, peakInFlight, totalRequests };
}

export function startDraining(reason: string): void {
  if (draining) return;
  draining = true;
  drainCause = reason;
  logger.warn("Drain started — rejecting new work, finishing in-flight requests", {
    reason,
    inFlight,
    drainTimeoutMs: DRAIN_TIMEOUT_MS,
  });
}

export function waitForDrain(timeoutMs: number = DRAIN_TIMEOUT_MS): Promise<boolean> {
  if (inFlight === 0) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const i = drainWaiters.indexOf(notify);
      if (i >= 0) drainWaiters.splice(i, 1);
      resolve(ok);
    };
    const notify = (): void => finish(true);
    drainWaiters.push(notify);
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
  });
}

/** Register a bounded cleanup step. Later registrations run after earlier ones. */
export function registerCleanup(name: string, fn: CleanupFn): void {
  cleanups.push({ name, fn });
}

export function unregisterCleanup(name: string): void {
  const i = cleanups.findIndex((c) => c.name === name);
  if (i >= 0) cleanups.splice(i, 1);
}

async function withTimeout(fn: CleanupFn, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | null = null;
  const guard = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
    timer.unref?.();
  });
  try {
    await Promise.race([Promise.resolve().then(fn), guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Run every registered cleanup, each independently time-bounded. */
export async function runCleanups(): Promise<void> {
  for (const cleanup of cleanups) {
    const started = Date.now();
    try {
      await withTimeout(cleanup.fn, CLEANUP_TIMEOUT_MS);
      logger.info("Cleanup completed", { name: cleanup.name, durationMs: Date.now() - started });
    } catch (err) {
      logger.error("Cleanup failed", {
        name: cleanup.name,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }
}

export function stopBackgroundTasks(): void {
  stopAllBackgroundTasks();
}

/**
 * Full shutdown sequence. Safe to call twice. `exit` is injected so tests can
 * drive the sequence without terminating the runner.
 */
export async function performShutdown(
  reason: string,
  exit: (code: number) => void = (code) => process.exit(code)
): Promise<void> {
  startDraining(reason);
  const drained = await waitForDrain(DRAIN_TIMEOUT_MS);
  if (!drained) {
    logger.warn("Drain timed out with requests still in flight", { inFlight });
  }
  await runCleanups();
  stopBackgroundTasks();
  logger.info("Shutdown complete", { reason, drained, totalRequests });
  exit(0);
}

/** Test-only: restore a pristine shutdown state. */
export function resetShutdownStateForTests(): void {
  draining = false;
  drainCause = null;
  inFlight = 0;
  peakInFlight = 0;
  totalRequests = 0;
  cleanups.length = 0;
  drainWaiters.length = 0;
}
