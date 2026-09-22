import { Router, Request, Response } from "express";
import { isFfmpegAvailable, getFfmpegVersionSync } from "../lib/ffmpeg.js";

const router = Router();

router.get("/", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

router.get("/media", async (_req: Request, res: Response) => {
  const ffmpegAvailable = await isFfmpegAvailable();
  res.json({
    status: "ok",
    ffmpegAvailable,
    ffmpegVersion: getFfmpegVersionSync(),
    timestamp: new Date().toISOString(),
  });
});

router.get("/ready", async (_req: Request, res: Response) => {
  const providerName = process.env.RESOLVER_PROVIDER || "placeholder";
  const ffmpegAvailable = await isFfmpegAvailable().catch(() => false);
  res.json({
    status: "ok",
    provider: providerName,
    providerConfigured: providerName !== "placeholder",
    ffmpegAvailable,
    node: process.version,
    platform: process.platform,
    serverless: Boolean(process.env.VERCEL),
    timestamp: new Date().toISOString(),
  });
});

export default router;
