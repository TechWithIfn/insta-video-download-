import { randomBytes, createHash } from "crypto";

export function generateToken(): string {
  return randomBytes(16).toString("hex");
}

export function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}
