import { execFile } from "child_process";
import { existsSync } from "fs";
import ffmpegPath from "ffmpeg-static";
import { logger } from "./logger.js";

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

export function runFfmpeg(args: string[], timeoutMs: number): Promise<FfmpegResult> {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) {
    return Promise.reject(new Error("FFmpeg executable is not available"));
  }
  return new Promise((resolve, reject) => {
    const child = execFile(
      ffmpeg,
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const exitCode =
            typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === "number"
              ? ((error as unknown as { code: number }).code)
              : -1;
          reject(
            Object.assign(new Error(`FFmpeg failed (exit ${exitCode})`), {
              exitCode,
              stdout: String(stdout || "").slice(-2000),
              stderr: String(stderr || "").slice(-4000),
            })
          );
          return;
        }
        resolve({ exitCode: 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
      }
    );

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
