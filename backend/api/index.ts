import "dotenv/config";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import app from "../src/app.js";

// Vercel serverless entry point. Every request is routed here via
// vercel.json rewrites; the Express app handles routing internally.
// NOTE: serverless invocations are stateless and short-lived — in-memory
// caches, rate-limit counters and reusable Puppeteer browsers do NOT
// persist reliably between invocations (see report for implications).
export default function handler(req: VercelRequest, res: VercelResponse) {
  return (app as unknown as (req: unknown, res: unknown) => unknown)(req, res);
}
