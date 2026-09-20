import "dotenv/config";
import express from "express";
import cors from "cors";
import resolveRouter from "./routes/resolve.js";
import downloadRouter from "./routes/download.js";
import streamRouter from "./routes/stream.js";
import audioRouter from "./routes/audio.js";
import healthRouter from "./routes/health.js";
import { logger } from "./lib/logger.js";
import { getProvider } from "./lib/providers/index.js";

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

if (process.env.NODE_ENV === "production") {
  const required = ["CORS_ORIGIN"];
  const missing = required.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
}

app.use(cors({
  origin: process.env.CORS_ORIGIN || "http://localhost:3000",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
}));

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use(express.json({ limit: "1kb" }));

app.use("/api/health", healthRouter);
app.use("/api/resolve", resolveRouter);
app.use("/api/download", downloadRouter);
app.use("/api/stream", streamRouter);
app.use("/api/audio", audioRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("Unhandled error", { error: err.message });
  res.status(500).json({
    success: false,
    error: {
      code: "TEMPORARY_ERROR",
      message: "An unexpected error occurred.",
    },
  });
});

const server = app.listen(PORT, () => {
  logger.info(`SnapSave backend running on port ${PORT}`);

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
