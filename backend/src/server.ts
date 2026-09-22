import "dotenv/config";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { getProvider } from "./lib/providers/index.js";

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
});

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully...`);

  const provider = getProvider();
  const cleanup = async () => {
    if ("close" in provider && typeof provider.close === "function") {
      await (provider as { close: () => Promise<void> }).close();
    }
  };

  cleanup().finally(() => {
    server.close(() => {
      logger.info("Server closed");
      process.exit(0);
    });
    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
