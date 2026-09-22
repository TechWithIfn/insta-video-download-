export type InstagramContentType =
  | "REEL"
  | "POST"
  | "CAROUSEL"
  | "STORY"
  | "HIGHLIGHT"
  | "VIDEO"
  | "PHOTO"
  | "UNKNOWN";

export interface Author {
  username: string | null;
  displayName: string | null;
}

export interface MediaItem {
  url: string;
  type: "image" | "video";
  width: number | null;
  height: number | null;
  duration: number | null;
  thumbnail: string | null;
  format: string | null;
}

export interface ResolvedMedia {
  type: InstagramContentType;
  sourceUrl: string;
  thumbnail: string | null;
  title: string | null;
  author: Author | null;
  media: MediaItem[];
  mediaId?: string;
}

export interface ResolveRequest {
  url: string;
}

export interface ResolveSuccessResponse {
  success: true;
  data: ResolvedMedia;
}

export interface ResolveErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
  };
}

export type ResolveResponse = ResolveSuccessResponse | ResolveErrorResponse;

export type ErrorCode =
  | "INVALID_URL"
  | "UNSUPPORTED_URL"
  | "CONTENT_NOT_FOUND"
  | "CONTENT_UNAVAILABLE"
  | "MEDIA_URL_EXPIRED"
  | "MEDIA_DOWNLOAD_FAILED"
  | "UPSTREAM_FORBIDDEN"
  | "UPSTREAM_NOT_FOUND"
  | "UNSUPPORTED_CONTENT"
  | "RESOLVER_ERROR"
  | "RESOLVER_TIMEOUT"
  | "RESOLVER_FAILED"
  | "AUDIO_UNAVAILABLE"
  | "SERVER_OVERLOADED"
  | "RATE_LIMITED"
  | "TEMPORARY_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_RATE_LIMITED"
  | "INVALID_PROVIDER_RESPONSE"
  | "VALIDATION_ERROR"
  | "REQUEST_TOO_LARGE";

export interface ResolverResult {
  type: InstagramContentType;
  sourceUrl: string;
  thumbnail: string | null;
  title: string | null;
  author: Author | null;
  media: MediaItem[];
}

export interface InstagramResolver {
  name: string;
  resolve(url: string, onProgress?: ResolveProgressCallback): Promise<ResolverResult>;
}

/**
 * Optional progress hook for resolvers. Emitted only when a backend stage
 * has ACTUALLY completed — never synthesized on a timer.
 */
export type ResolveProgressCallback = (progress: number, stage: string) => void;

export interface TempStoreEntry {
  id: string;
  media: MediaItem[];
  type?: InstagramContentType;
  createdAt: number;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export interface LoggerContext {
  requestId?: string;
  url?: string;
  duration?: number;
  [key: string]: unknown;
}

export interface ExternalProviderResponse {
  success: boolean;
  data?: {
    type?: string;
    shortcode?: string;
    caption?: string;
    author?: {
      username?: string;
      display_name?: string;
    };
    thumbnail?: string;
    media?: Array<{
      url: string;
      type?: string;
      width?: number;
      height?: number;
      duration?: number;
      format?: string;
      thumbnail?: string;
    }>;
  };
  error?: {
    code?: string;
    message?: string;
  };
}
