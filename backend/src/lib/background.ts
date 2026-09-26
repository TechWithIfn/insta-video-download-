import { logger } from "./logger.js";

/**
 * Registry for background maintenance timers (cache sweeps, temp-dir sweeps,
 * rate-limit sweeps).
 *
 * Two problems this solves:
 *  - A module-scope `setInterval` keeps the Node event loop alive forever. In
 *    a serverless function that means the invocation is never frozen/released
 *    and keeps billing after the response was sent. Every timer here is
 *    `unref()`'d so it can never hold the process open.
 *  - On shutdown these timers must be cleared deterministically instead of
 *    being left to fight the exit.
 */

const handles = new Map<string, NodeJS.Timeout>();

/** Serverless runtimes get no periodic sweeps: there is no long-lived process. */
export function backgroundTimersEnabled(): boolean {
  if (process.env.DISABLE_BACKGROUND_TIMERS === "true") return false;
  return !process.env.VERCEL;
}

export interface ScheduleOptions {
  /** Run immediately on the first tick instead of after one interval. */
  runImmediately?: boolean;
}

/**
 * Schedule a named, unref'd, replaceable maintenance timer. Calling it again
 * with the same name replaces the previous timer (one owner per name), so
 * module reloads in tests cannot stack duplicate sweeps.
 */
export function scheduleBackgroundTask(
  name: string,
  intervalMs: number,
  task: () => void | Promise<void>,
  options: ScheduleOptions = {}
): NodeJS.Timeout | null {
  stopBackgroundTask(name);
  if (!backgroundTimersEnabled() || !(intervalMs > 0)) return null;

  let running = false;
  const run = (): void => {
    if (running) return; // never let a slow sweep overlap itself
    running = true;
    let result: void | Promise<void>;
    try {
      result = task();
    } catch (err) {
      running = false;
      logger.warn(`[background] task threw: ${name}`, {
        error: err instanceof Error ? err.message : "unknown",
      });
      return;
    }
    if (result && typeof (result as Promise<void>).catch === "function") {
      // The overlap guard must only clear when the async work has actually
      // settled — clearing it synchronously would let a slow sweep re-enter
      // on the next tick.
      void (result as Promise<void>)
        .catch((err) => {
          logger.warn(`[background] task failed: ${name}`, {
            error: err instanceof Error ? err.message : "unknown",
          });
        })
        .finally(() => {
          running = false;
        });
      return;
    }
    running = false;
  };

  const handle = setInterval(run, intervalMs);
  handle.unref?.();
  handles.set(name, handle);
  logger.info(`[background] scheduled ${name}`, { intervalMs });
  if (options.runImmediately) run();
  return handle;
}

export function stopBackgroundTask(name: string): boolean {
  const handle = handles.get(name);
  if (!handle) return false;
  clearInterval(handle);
  handles.delete(name);
  return true;
}

export function stopAllBackgroundTasks(): string[] {
  const names = [...handles.keys()];
  for (const name of names) stopBackgroundTask(name);
  if (names.length > 0) logger.info("[background] stopped all tasks", { names });
  return names;
}

export function backgroundTaskNames(): string[] {
  return [...handles.keys()];
}
