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

export default router;
