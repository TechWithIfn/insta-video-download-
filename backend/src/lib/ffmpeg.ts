import { execFile } from "child_process";
import { existsSync } from "fs";
import ffmpegPath from "ffmpeg-static";
import { logger } from "./logger.js";
import { inc, observe } from "./metrics.js";

let cachedAvailability: boolean | null = null;
let cachedVersion: string | null = null;

export function getFfmpegPath(): string | null {
  if (typeof ffmpegPath !== "string" || ffmpegPath.length === 0) {
    return null;
  }
  try {
    return existsSync(ffmpegPath) ? ffmpegPath : null;
  } catch {
    return null;
  }
}

function queryVersion(ffmpeg: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(ffmpeg, ["-version"], { timeout: 10_000 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const firstLine = String(stdout || "").split("\n")[0] || "";
      const match = firstLine.match(/ffmpeg version ([^\s]+)/);
      resolve(match ? match[1] : firstLine.trim() || null);
    });
  });
}

export async function isFfmpegAvailable(): Promise<boolean> {
  if (cachedAvailability !== null) return cachedAvailability;
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) {
    cachedAvailability = false;
    return false;
  }
  const version = await queryVersion(ffmpeg);
  cachedVersion = version;
  cachedAvailability = version !== null;
  logger.info("[FFMPEG] executable resolved", {
    available: cachedAvailability,
    version: cachedVersion,
  });
  return cachedAvailability;
}

export function getFfmpegVersionSync(): string | null {
  return cachedVersion;
}

export interface FfmpegResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class FfmpegAbortedError extends Error {
  readonly reason: "aborted" | "timeout";
  constructor(reason: "aborted" | "timeout") {
    super(reason === "aborted" ? "FFmpeg cancelled by caller" : "FFmpeg timed out");
    this.name = "AbortError";
    this.reason = reason;
  }
}

/**
 * Every invocation is a real OS process holding native memory and CPU, so a
 * cancelled caller (client disconnect, drain, or gate abandonment) must kill
 * the child immediately instead of letting it run to completion unobserved.
 * `signal` is optional so existing callers keep working, but every new caller
 * should pass one.
 *
 * Hardening notes:
 *  - `execFile` + an argument ARRAY: no shell is spawned, so nothing derived
 *    from user input can ever be interpreted as a command.
 *  - Timeout is enforced by the child runner AND a SIGKILL backstop, so even a
 *    process that ignores SIGTERM cannot outlive its budget.
 *  - `maxBuffer` caps captured stdout/stderr so a chatty ffmpeg cannot grow
 *    the heap.
 */
export function runFfmpeg(
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal
): Promise<FfmpegResult> {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) {
    return Promise.reject(new Error("FFmpeg executable is not available"));
  }
  if (signal?.aborted) {
    return Promise.reject(new FfmpegAbortedError("aborted"));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const startedAt = Date.now();
    inc("ffmpegJobs");
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
      observe("ffmpeg", Date.now() - startedAt);
      fn();
    };

    const child = execFile(
      ffmpeg,
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          if (signal?.aborted) {
            inc("ffmpegAborts");
            finish(() => reject(new FfmpegAbortedError("aborted")));
            return;
          }
          const exitCode =
            typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === "number"
              ? ((error as unknown as { code: number }).code)
              : -1;
          inc("ffmpegFailures");
          finish(() =>
            reject(
              Object.assign(new Error(`FFmpeg failed (exit ${exitCode})`), {
                exitCode,
                stdout: String(stdout || "").slice(-2000),
                stderr: String(stderr || "").slice(-4000),
              })
            )
          );
          return;
        }
        finish(() => resolve({ exitCode: 0, stdout: String(stdout || ""), stderr: String(stderr || "") }));
      }
    );

    // SIGTERM first so ffmpeg can flush/close its output file, SIGKILL as a
    // backstop in case it is stuck in a decode loop.
    const kill = (): void => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already exited */
      }
      setTimeout(() => {
        try {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        } catch {
          /* already exited */
        }
      }, 2_000).unref();
    };

    const onAbort = (): void => kill();
    signal?.addEventListener("abort", onAbort, { once: true });

    const killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already exited */
      }
    }, timeoutMs + 2000);
    child.on("close", () => clearTimeout(killTimer));
  });
}
