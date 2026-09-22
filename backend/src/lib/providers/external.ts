import type {
  ResolverResult,
  MediaItem,
  InstagramContentType,
  ExternalProviderResponse,
  Author,
} from "../types.js";
import { BaseProvider } from "./base.js";
import { createError, AppError } from "../errors.js";
import { logger } from "../logger.js";
import { decodeNullableText } from "../text.js";

const TIMEOUT_MS = 15_000;

export class ExternalProvider extends BaseProvider {
  readonly name = "external";
  private apiUrl: string;
  private apiKey: string;

  constructor(apiUrl: string, apiKey: string) {
    super();
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  async resolve(url: string): Promise<ResolverResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      logger.info("External provider request", {
        provider: this.name,
        url: url.slice(0, 80),
      });

      const response = await fetch(this.apiUrl, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "User-Agent": "Downloadit/1.0",
        },
        body: JSON.stringify({ url }),
      });

      if (response.status === 429) {
        throw createError("PROVIDER_RATE_LIMITED");
      }

      if (response.status === 401 || response.status === 403) {
        throw createError("PROVIDER_NOT_CONFIGURED");
      }

      if (response.status === 404) {
        throw createError("CONTENT_NOT_FOUND");
      }

      if (!response.ok) {
        throw createError("PROVIDER_UNAVAILABLE");
      }

      let data: ExternalProviderResponse;
      try {
        data = (await response.json()) as ExternalProviderResponse;
      } catch {
        throw createError("INVALID_PROVIDER_RESPONSE");
      }

      return this.normalizeResponse(data, url);
    } catch (error) {
      if (error instanceof AppError) throw error;

      if (error instanceof DOMException && error.name === "AbortError") {
        throw createError("PROVIDER_TIMEOUT");
      }

      throw createError("PROVIDER_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeResponse(
    data: ExternalProviderResponse,
    sourceUrl: string
  ): ResolverResult {
    if (!data || typeof data !== "object") {
      throw createError("INVALID_PROVIDER_RESPONSE");
    }

    if (data.success === false || !data.data) {
      throw createError("CONTENT_UNAVAILABLE");
    }

    const { data: raw } = data;

    const type = this.mapContentType(raw.type);
    if (type === "UNKNOWN") {
      throw createError("UNSUPPORTED_CONTENT");
    }

    const author: Author | null = raw.author
      ? {
          username: raw.author.username || null,
          displayName: decodeNullableText(raw.author.display_name),
        }
      : null;

    const media: MediaItem[] = [];
    if (Array.isArray(raw.media)) {
      for (const item of raw.media) {
        if (!item.url || typeof item.url !== "string") continue;
        if (!this.validateMediaUrl(item.url)) continue;

        media.push({
          url: item.url,
          type: item.type === "video" ? "video" : "image",
          width: typeof item.width === "number" ? item.width : null,
          height: typeof item.height === "number" ? item.height : null,
          duration:
            typeof item.duration === "number" ? item.duration : null,
          size: typeof item.size === "number" ? item.size : null,
          thumbnail:
            typeof item.thumbnail === "string" && this.validateMediaUrl(item.thumbnail)
              ? item.thumbnail
              : null,
          format: typeof item.format === "string" ? item.format : null,
        });
      }
    }

    if (media.length === 0) {
      throw createError("CONTENT_UNAVAILABLE");
    }

    return {
      type,
      sourceUrl,
      thumbnail:
        typeof raw.thumbnail === "string" && this.validateMediaUrl(raw.thumbnail)
          ? raw.thumbnail
          : media[0]?.thumbnail || null,
      title: decodeNullableText(raw.caption),
      author,
      media,
    };
  }

  private mapContentType(rawType: string | undefined): InstagramContentType {
    const map: Record<string, InstagramContentType> = {
      REEL: "REEL",
      reel: "REEL",
      POST: "POST",
      post: "POST",
      CAROUSEL: "CAROUSEL",
      carousel: "CAROUSEL",
      STORY: "STORY",
      story: "STORY",
      HIGHLIGHT: "HIGHLIGHT",
      highlight: "HIGHLIGHT",
      VIDEO: "VIDEO",
      video: "VIDEO",
      PHOTO: "PHOTO",
      photo: "PHOTO",
    };
    return map[rawType || ""] || "UNKNOWN";
  }
}
