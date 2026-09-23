import type { MediaItem } from "./types.js";
import { logger } from "./logger.js";
import { UPSTREAM_HEADERS } from "./media-proxy.js";

/**
 * Best-effort metadata enrichment for resolved media items.
 *
 * Providers (especially page-scraping ones) often return media URLs without
 * width/height/size/format. Instead of showing placeholders, this module
 * probes the actual media bytes with cheap, bounded requests:
 *
 *   - HEAD (videos, or images when only size/format is missing) for
 *     Content-Length / Content-Type.
 *   - A single ranged GET of the first 64 KB (images missing dimensions)
 *     whose header bytes are parsed for real PNG/JPEG/GIF/WebP dimensions.
 *
 * Rules:
 *   - Never overwrites values the provider already supplied.
 *   - Never fails the resolve: every probe is timeout-bounded, runs in
 *     parallel with the others, and any failure leaves the item untouched.
 *   - Never follows redirects (redirect:"manual") and never downloads more
 *     than 64 KB per image.
 */

const PROBE_TIMEOUT_MS = parseInt(process.env.MEDIA_PROBE_TIMEOUT_MS || "5000", 10);
const MAX_PROBE_BYTES = 64 * 1024;

export interface ImageDimensions {
  width: number;
  height: number;
}

function readU16BE(buf: Uint8Array, off: number): number {
  return (buf[off] * 256 + buf[off + 1]) >>> 0;
}

function readU32BE(buf: Uint8Array, off: number): number {
  return (buf[off] * 16777216 + buf[off + 1] * 65536 + buf[off + 2] * 256 + buf[off + 3]) >>> 0;
}

function readU16LE(buf: Uint8Array, off: number): number {
  return (buf[off] + buf[off + 1] * 256) >>> 0;
}

function readU24LE(buf: Uint8Array, off: number): number {
  return (buf[off] + buf[off + 1] * 256 + buf[off + 2] * 65536) >>> 0;
}

function ascii(buf: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(buf[off + i]);
  return s;
}

function parsePng(buf: Uint8Array): ImageDimensions | null {
  if (buf.length < 24) return null;
  if (
    buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47 ||
    buf[4] !== 0x0d || buf[5] !== 0x0a || buf[6] !== 0x1a || buf[7] !== 0x0a
  ) {
    return null;
  }
  if (ascii(buf, 12, 4) !== "IHDR") return null;
  const width = readU32BE(buf, 16);
  const height = readU32BE(buf, 20);
  if (width <= 0 || height <= 0 || width > 30000 || height > 30000) return null;
  return { width, height };
}

function parseGif(buf: Uint8Array): ImageDimensions | null {
  if (buf.length < 10) return null;
  const sig = ascii(buf, 0, 6);
  if (sig !== "GIF87a" && sig !== "GIF89a") return null;
  const width = readU16LE(buf, 6);
  const height = readU16LE(buf, 8);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function parseJpeg(buf: Uint8Array): ImageDimensions | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let off = 2;
  while (off + 4 < buf.length) {
    if (buf[off] !== 0xff) {
      off++;
      continue;
    }
    const marker = buf[off + 1];
    // Markers without a length field.
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      off += 2;
      continue;
    }
    // Start Of Scan: image data follows, no dimensions after this point.
    if (marker === 0xda) return null;
    const len = readU16BE(buf, off + 2);
    if (len < 2 || off + 2 + len > buf.length + 4096) return null;
    // Start Of Frame (baseline/progressive/etc., excluding DHT/DAC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (off + 9 >= buf.length) return null;
      const height = readU16BE(buf, off + 5);
      const width = readU16BE(buf, off + 7);
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    }
    off += 2 + len;
  }
  return null;
}

function parseWebP(buf: Uint8Array): ImageDimensions | null {
  if (buf.length < 27) return null;
  if (ascii(buf, 0, 4) !== "RIFF" || ascii(buf, 8, 4) !== "WEBP") return null;
  const chunk = ascii(buf, 12, 4);
  if (chunk === "VP8X") {
    if (buf.length < 27) return null;
    const width = readU24LE(buf, 21) + 1;
    const height = readU24LE(buf, 24) + 1;
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  }
  if (chunk === "VP8L") {
    if (buf.length < 25) return null;
    if (buf[20] !== 0x2f) return null;
    const b0 = buf[21];
    const b1 = buf[22];
    const b2 = buf[23];
    const b3 = buf[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  }
  if (chunk === "VP8 ") {
    if (buf.length < 30) return null;
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    const width = readU16LE(buf, 26) & 0x3fff;
    const height = readU16LE(buf, 28) & 0x3fff;
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  }
  return null;
}

/** Parse real dimensions from raw image header bytes. Returns null when unknown. */
export function parseImageDimensions(buf: Uint8Array): ImageDimensions | null {
  if (!buf || buf.length < 10) return null;
  return parsePng(buf) ?? parseJpeg(buf) ?? parseGif(buf) ?? parseWebP(buf);
}

export function formatFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const ct = contentType.toLowerCase().split(";")[0].trim();
  if (ct === "image/jpeg" || ct === "image/jpg") return "jpg";
  if (ct === "image/png") return "png";
  if (ct === "image/webp") return "webp";
  if (ct === "image/gif") return "gif";
  if (ct === "video/mp4" || ct === "video/x-mp4") return "mp4";
  if (ct === "audio/mpeg" || ct === "audio/mp3") return "mp3";
  if (ct === "audio/mp4" || ct === "audio/x-m4a") return "m4a";
  if (ct === "audio/wav" || ct === "audio/x-wav") return "wav";
  if (ct === "audio/ogg") return "ogg";
  return null;
}

function sizeFromHeaders(headers: Headers): number | null {
  const total = headers.get("content-range")?.match(/\/(\d+)\s*$/);
  if (total) {
    const n = parseInt(total[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const len = headers.get("content-length");
  if (len) {
    const n = parseInt(len, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

async function fetchBounded(url: string, init: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: "manual" });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe a single item. Never throws: on any failure the original item is
 * returned untouched.
 */
async function probeItem(item: MediaItem): Promise<MediaItem> {
  try {
    const needsSize = typeof item.size !== "number" || item.size <= 0;
    const needsFormat = !item.format;
    const needsDims = item.type === "image" && (item.width == null || item.height == null);
    if (!needsSize && !needsFormat && !needsDims) return item;

    let parsed: URL;
    try {
      parsed = new URL(item.url);
    } catch {
      return item;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return item;

    let next: MediaItem = item;

    if (item.type === "video" || !needsDims) {
      // Cheap path: headers only.
      const head = await fetchBounded(item.url, { method: "HEAD", headers: { ...UPSTREAM_HEADERS } });
      if (head && head.ok) {
        if (needsSize) {
          const s = sizeFromHeaders(head.headers);
          if (s !== null) next = { ...next, size: s };
        }
        if (needsFormat) {
          const f = formatFromContentType(head.headers.get("content-type"));
          if (f) next = { ...next, format: f };
        }
        await head.body?.cancel().catch(() => {});
        if (!needsDims) return next;
      } else {
        await head?.body?.cancel().catch(() => {});
      }
    }

    // Image path (or header probe failed): one ranged GET gives headers plus
    // enough body bytes to parse real dimensions. Body is capped at 64 KB.
    if (item.type === "image" && (needsDims || needsSize || needsFormat)) {
      const res = await fetchBounded(item.url, {
        method: "GET",
        headers: { ...UPSTREAM_HEADERS, Range: `bytes=0-${MAX_PROBE_BYTES - 1}` },
      });
      if (!res || (!res.ok && res.status !== 206)) {
        await res?.body?.cancel().catch(() => {});
        return next;
      }
      if (needsSize) {
        const s = sizeFromHeaders(res.headers);
        if (s !== null) next = { ...next, size: s };
      }
      if (needsFormat) {
        const f = formatFromContentType(res.headers.get("content-type"));
        if (f) next = { ...next, format: f };
      }
      if (needsDims && res.body) {
        try {
          const buf = await res.arrayBuffer().then((b) => new Uint8Array(b).slice(0, MAX_PROBE_BYTES));
          const dims = parseImageDimensions(buf);
          if (dims) next = { ...next, width: dims.width, height: dims.height };
        } catch {
          await res.body?.cancel().catch(() => {});
        }
      } else {
        await res.body?.cancel().catch(() => {});
      }
    }

    return next;
  } catch {
    return item;
  }
}

/**
 * Enrich every item in parallel (bounded, best-effort). Never throws and
 * never changes the number or order of items.
 */
export async function enrichMediaItems(items: MediaItem[]): Promise<MediaItem[]> {
  if (items.length === 0) return items;
  try {
    const settled = await Promise.allSettled(items.map((item) => probeItem(item)));
    return settled.map((r, i) => (r.status === "fulfilled" ? r.value : items[i]));
  } catch (err) {
    logger.warn("[enrich] probe batch failed", { error: err instanceof Error ? err.message : "unknown" });
    return items;
  }
}
