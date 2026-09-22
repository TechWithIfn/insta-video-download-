import express from "express";
import cors from "cors";
import resolveRouter from "./routes/resolve.js";
import downloadRouter from "./routes/download.js";
import streamRouter from "./routes/stream.js";
import audioRouter from "./routes/audio.js";
import healthRouter from "./routes/health.js";
import { logger } from "./lib/logger.js";
import { readPositiveInt } from "./lib/env.js";

const app = express();

const corsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: corsOrigins.length > 0 && !corsOrigins.includes("*")
    ? corsOrigins
    : true,
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

app.use(express.json({ limit: readPositiveInt("MAX_REQUEST_BODY_SIZE", 1024) }));

// Lightweight service info. No resolver work here.
app.get("/", (_req, res) => {
  res.json({
    service: "SnapSave API",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

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

export default app;
