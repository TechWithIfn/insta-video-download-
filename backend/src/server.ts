import dotenv from "dotenv";
import path from "path";
// Load server-side Instagram session from config/.env (project root) and backend/.env
// config/.env is the dedicated file for sessionid/csrftoken as per Highlight fix spec
try {
  dotenv.config({ path: path.resolve(process.cwd(), "../config/.env") });
  dotenv.config({ path: path.resolve(process.cwd(), "config/.env") });
  dotenv.config(); // also load backend/.env (default)
} catch {}
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { getProvider } from "./lib/providers/index.js";
import { audioProviderStatus } from "./lib/audio-provider.js";
import { performShutdown, registerCleanup, startDraining } from "./lib/shutdown.js";
import { capacitySnapshot } from "./lib/capacity.js";

// Local development / traditional hosting entry point.
// On Vercel serverless, api/index.ts serves the exported app instead and
// this listener never runs.
const PORT = parseInt(process.env.PORT || "3001", 10);

const server = app.listen(PORT, () => {
  logger.info(`Downloadit backend running on port ${PORT}`);

  const providerName = process.env.RESOLVER_PROVIDER || "placeholder";
  const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:3000";
  const resolverTimeout = process.env.RESOLVER_TIMEOUT_MS || "15000";

  logger.info("Configuration loaded", {
    NODE_ENV: process.env.NODE_ENV || "development",
    PORT,
    RESOLVER_PROVIDER: providerName,
    CORS_ORIGIN: corsOrigin,
    RESOLVER_TIMEOUT_MS: resolverTimeout,
    dotenvLoaded: typeof process.env.RESOLVER_PROVIDER !== "undefined",
  });

  if (providerName === "puppeteer") {
    logger.info("Puppeteer provider active — headless Chrome will resolve Instagram URLs");
  }

  logger.info("Audio provider status", {
    audioProvider: audioProviderStatus(),
    detail: "Set AUDIO_PROVIDER_URL + AUDIO_PROVIDER_KEY to enable direct audio-page resolution",
  });

  logger.info("Workload capacity", { capacity: capacitySnapshot() });
});

// Keep-alive slightly below common 60s proxy idle timeouts so the proxy closes
// idle sockets first, freeing file descriptors under sustained load.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;

// Closing the provider is a registered cleanup, so a signal mid-request drains
// first and only then releases Chromium.
registerCleanup("provider-close", async () => {
  const provider = getProvider();
  if ("close" in provider && typeof provider.close === "function") {
    await (provider as { close: () => Promise<void> }).close();
  }
});

let shuttingDown = false;

/**
 * Graceful shutdown order matters:
 *   1. flip readiness so the load balancer and the app middleware stop
 *      admitting new work (in-flight requests keep their slots),
 *   2. stop accepting new connections while letting in-flight requests finish,
 *   3. run bounded cleanups (Chromium, timers),
 *   4. exit — with a hard backstop so a hung socket can never pin the process.
 */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`${signal} received, shutting down gracefully...`);
  startDraining(signal);

  // Stop accepting new connections. The callback only fires once EVERY socket
  // is gone, so it must NOT be awaited before the drain: an in-flight resolve
  // or FFmpeg transcode can hold a socket far longer than the drain budget, and
  // waiting on it first would skip cleanups entirely and hit the hard backstop.
  const closed = new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  server.closeIdleConnections?.();

  // Hard backstop independent of the drain/cleanup budgets.
  const forced = setTimeout(() => {
    logger.error("Forced shutdown after hard timeout", { signal });
    process.exit(1);
  }, 30_000);
  forced.unref();

  try {
    // Wait for in-flight requests, then release Chromium and timers.
    await performShutdown(signal, () => process.exit(signal === "uncaughtException" ? 1 : 0));
  } catch (err) {
    // performShutdown normally exits here. If cleanup itself blew up, do not
    // leave a half-shut-down process serving traffic.
    logger.error("Shutdown failed, exiting", {
      signal,
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  } finally {
    clearTimeout(forced);
    // Nothing should be left, but a lingering keep-alive socket must not keep
    // the process alive after a clean shutdown.
    server.closeAllConnections?.();
    await closed;
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// A crash must not leave Chromium and its children behind.
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception — shutting down", {
    error: err instanceof Error ? err.message : String(err),
  });
  void shutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", { error: reason instanceof Error ? reason.message : String(reason) });
});

export default app;
