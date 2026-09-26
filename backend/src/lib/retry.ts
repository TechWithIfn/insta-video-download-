import { logger } from "./logger.js";
import { readBoundedInt, readNonNegativeInt } from "./env.js";
import { isNetworkError, isTimeoutError } from "./errors.js";

/**
 * Bounded retry with exponential backoff and full jitter.
 *
 * Rules:
 *  - The attempt count is hard-capped. There is no "retry until success".
 *  - Every sleep is abortable, and its timer is `unref()`'d.
 *  - Only transient failures are retried. Timeouts are NOT retried by default
 *    (the caller's budget was already spent); application errors are not
 *    retried at all.
 *  - `signal` aborts immediately and surfaces as the original rejection so the
 *    caller can distinguish "gave up" from "cancelled".
 */

export const DEFAULT_RETRY_ATTEMPTS = readBoundedInt("RETRY_MAX_ATTEMPTS", 3, 1, 10);
export const DEFAULT_RETRY_BASE_MS = readNonNegativeInt("RETRY_BASE_DELAY_MS", 250);
export const DEFAULT_RETRY_MAX_MS = readNonNegativeInt("RETRY_MAX_DELAY_MS", 2_000);

export interface RetryOptions {
  /** Total attempts including the first. Clamped to 1..10. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  /** Return false to fail fast on this error. */
  isRetryable?: (error: unknown, attempt: number) => boolean;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  /** Log context (tag/requestId) so retry noise is attributable. */
  logContext?: Record<string, unknown>;
}

/** Default policy: transient transport failures only, never timeouts. */
export function defaultIsRetryable(error: unknown): boolean {
  if (isTimeoutError(error)) return false;
  return isNetworkError(error);
}

export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = baseMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, maxMs);
  // Full jitter: avoids retry stampedes when a provider recovers.
  return Math.max(0, Math.round(capped * (0.5 + Math.random() * 0.5)));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    timer.unref?.();
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("aborted"));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const attempts = Math.min(Math.max(options.attempts ?? DEFAULT_RETRY_ATTEMPTS, 1), 10);
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_RETRY_BASE_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_RETRY_MAX_MS;
  const isRetryable = options.isRetryable ?? defaultIsRetryable;
  const { signal, onRetry, logContext } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal?.aborted) throw signal.reason ?? new Error("aborted");
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      if (!isRetryable(error, attempt)) break;
      const delayMs = backoffDelay(attempt, baseDelayMs, maxDelayMs);
      logger.warn("[retry] transient failure, retrying", {
        ...logContext,
        attempt,
        attempts,
        delayMs,
        error: error instanceof Error ? error.message : "unknown",
      });
      onRetry?.({ attempt, delayMs, error });
      try {
        await sleep(delayMs, signal);
      } catch (abortErr) {
        throw abortErr;
      }
    }
  }
  throw lastError;
}
