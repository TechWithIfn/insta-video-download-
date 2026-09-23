import type { ResolverResult, MediaItem } from "./types.js";
import { AppError, createError } from "./errors.js";
import { logger } from "./logger.js";
import { isPrivateOrReservedHost } from "./providers/base.js";

const TIMEOUT_MS = 15_000;

/**
 * Dedicated audio-capable provider, configured ONLY via backend environment:
 *   AUDIO_PROVIDER_URL  — audio API endpoint (server-side, never frontend)
 *   AUDIO_PROVIDER_KEY  — API credential (server-side, never frontend)
 *
 * The API receives `{ audioId, url }` with a Bearer credential and must
 * answer `{ success, data: { audioUrl?, media[]?, title?, duration? } }`.
 * An `audioUrl` (or media item of type "audio") is a direct audio file the
 * audio route serves as MP3; a "video" item goes through FFmpeg extraction.
 */
export function isAudioProviderConfigured(): boolean {
  return Boolean(process.env.AUDIO_PROVIDER_URL && process.env.AUDIO_PROVIDER_KEY);
}

export function audioProviderStatus(): "configured" | "not-configured" {
  return isAudioProviderConfigured() ? "configured" : "not-configured";
}

interface AudioProviderPayload {
  success?: boolean;
  data?: {
    title?: string;
    author?: { username?: string; display_name?: string };
    duration?: number;
    format?: string;
    audioUrl?: string;
    media?: Array<{
      url?: string;
      type?: string;
      width?: number;
      height?: number;
      duration?: number;
      size?: number;
      format?: string;
    }>;
  };
  error?: { code?: string; message?: string };
}

/** Provider-returned file URLs: https + public host (SSRF-safe, no creds). */
export function isTrustedProviderMediaUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    if (isPrivateOrReservedHost(parsed.hostname.toLowerCase())) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve an Instagram audio ID through the configured audio API. Returns an
 * AUDIO result on a usable source, or null when no audio provider is
 * configured. Throws precise AppErrors for provider failures (never hidden,
 * never faked).
 */
export async function resolveAudioViaProvider(
  audioId: string,
  pageUrl: string
): Promise<ResolverResult | null> {
  const apiUrl = process.env.AUDIO_PROVIDER_URL;
  const apiKey = process.env.AUDIO_PROVIDER_KEY;
  if (!apiUrl || !apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    logger.info("[audio-provider] request", { audioId });

    const response = await fetch(apiUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "Downloadit/1.0",
      },
      body: JSON.stringify({ audioId, url: pageUrl }),
    });

    if (response.status === 401 || response.status === 403) {
      throw createError("PROVIDER_NOT_CONFIGURED");
    }
    if (response.status === 404) {
      throw createError("CONTENT_NOT_FOUND");
    }
    if (response.status === 429) {
      throw createError("PROVIDER_RATE_LIMITED");
    }
    if (!response.ok) {
      throw createError("PROVIDER_UNAVAILABLE");
    }

    let payload: AudioProviderPayload;
    try {
      payload = (await response.json()) as AudioProviderPayload;
    } catch {
      throw createError("INVALID_PROVIDER_RESPONSE");
    }

    if (!payload || payload.success === false || !payload.data) {
      const msg =
        payload?.error?.message || "The audio provider returned no usable audio source.";
      throw new AppError("AUDIO_NO_SOURCE", msg.slice(0, 300), 502);
    }

    const raw = payload.data;
    const media: MediaItem[] = [];
    const candidates: Array<{ url?: string; type?: string; extra?: object }> = [];
    if (typeof raw.audioUrl === "string") {
      candidates.push({ url: raw.audioUrl, type: "audio" });
    }
    if (Array.isArray(raw.media)) {
      for (const m of raw.media) candidates.push({ url: m.url, type: m.type, extra: m });
    }

    for (const c of candidates) {
      if (!c.url || typeof c.url !== "string") continue;
      if (!isTrustedProviderMediaUrl(c.url)) continue;
      const kind = c.type === "video" ? "video" : "audio";
      const extra = (c.extra ?? {}) as Record<string, unknown>;
      media.push({
        url: c.url,
        type: kind,
        width: typeof extra["width"] === "number" ? (extra["width"] as number) : null,
        height: typeof extra["height"] === "number" ? (extra["height"] as number) : null,
        duration:
          typeof extra["duration"] === "number"
            ? (extra["duration"] as number)
            : typeof raw.duration === "number"
              ? raw.duration
              : null,
        size: typeof extra["size"] === "number" ? (extra["size"] as number) : null,
        thumbnail: null,
        format:
          typeof extra["format"] === "string"
            ? (extra["format"] as string)
            : typeof raw.format === "string"
              ? raw.format
              : kind === "audio"
                ? "mp3"
                : null,
      });
    }

    if (media.length === 0) {
      throw new AppError(
        "AUDIO_NO_SOURCE",
        "The configured audio provider returned no usable audio source for this audio ID.",
        502
      );
    }

    logger.info("[audio-provider] source found", {
      audioId,
      audioSourceFound: true,
      mediaCount: media.length,
    });
    return {
      type: "AUDIO",
      sourceUrl: pageUrl,
      thumbnail: null,
      title: typeof raw.title === "string" ? raw.title : null,
      author:
        raw.author && typeof raw.author.username === "string"
          ? { username: raw.author.username, displayName: raw.author.display_name ?? null }
          : null,
      media,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw createError("PROVIDER_TIMEOUT");
    }
    throw createError("PROVIDER_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
  }
}
