import type { ErrorCode, ResolveErrorResponse } from "./types.js";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;

  constructor(code: ErrorCode, message: string, statusCode: number = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
  }

  toResponse(): ResolveErrorResponse {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        retryable: ERRORS[this.code].retryable,
      },
    };
  }
}

export const ERRORS: Record<ErrorCode, { message: string; status: number; retryable: boolean }> = {
  INVALID_URL: {
    message: "The URL provided is not a valid Instagram link.",
    status: 400,
    retryable: false,
  },
  UNSUPPORTED_URL: {
    message: "This Instagram URL pattern is not yet supported.",
    status: 400,
    retryable: false,
  },
  CONTENT_NOT_FOUND: {
    message:
      "That link doesn't appear to be available right now. It may have been deleted or made private.",
    status: 404,
    retryable: false,
  },
  CONTENT_UNAVAILABLE: {
    message:
      "This content is currently unavailable. It may be restricted or temporarily inaccessible.",
    status: 404,
    retryable: true,
  },
  MEDIA_URL_EXPIRED: {
    message: "Media link expired. Please try Get Media again.",
    status: 410,
    retryable: true,
  },
  MEDIA_DOWNLOAD_FAILED: {
    message: "The media could not be downloaded.",
    status: 502,
    retryable: true,
  },
  UPSTREAM_FORBIDDEN: {
    message: "The media server refused the request.",
    status: 403,
    retryable: false,
  },
  UPSTREAM_NOT_FOUND: {
    message: "The media was not found on the media server.",
    status: 404,
    retryable: false,
  },
  UNSUPPORTED_CONTENT: {
    message: "This type of Instagram link isn't supported yet.",
    status: 400,
    retryable: false,
  },
  RESOLVER_ERROR: {
    message: "Something went wrong while fetching the media. Please try again.",
    status: 502,
    retryable: true,
  },
  RESOLVER_TIMEOUT: {
    message: "The media took too long to process. Please try again.",
    status: 504,
    retryable: true,
  },
  RESOLVER_FAILED: {
    message: "The media could not be resolved. Please try again.",
    status: 502,
    retryable: true,
  },
  AUDIO_UNAVAILABLE: {
    message: "Audio extraction is currently unavailable. Please try again.",
    status: 502,
    retryable: true,
  },
  AUDIO_NO_SOURCE: {
    message:
      "This Instagram audio page does not expose a downloadable audio source to anonymous requests. Instagram restricts direct audio access — try pasting a public Reel that uses this sound instead.",
    status: 502,
    retryable: false,
  },
  SERVER_OVERLOADED: {
    message: "Downloadit is busy right now. Please try again shortly.",
    status: 503,
    retryable: true,
  },
  RATE_LIMITED: {
    message: "Too many requests. Please wait a moment before trying again.",
    status: 429,
    retryable: true,
  },
  TEMPORARY_ERROR: {
    message: "A temporary issue occurred. Please try again shortly.",
    status: 503,
    retryable: true,
  },
  PROVIDER_UNAVAILABLE: {
    message: "The media resolution service is currently unavailable.",
    status: 503,
    retryable: true,
  },
  PROVIDER_NOT_CONFIGURED: {
    message:
      "The media service is not configured yet. Please try again later.",
    status: 503,
    retryable: false,
  },
  PROVIDER_TIMEOUT: {
    message:
      "The request took too long. The content may be temporarily unavailable.",
    status: 504,
    retryable: true,
  },
  PROVIDER_RATE_LIMITED: {
    message:
      "The media service is receiving too many requests. Please try again shortly.",
    status: 429,
    retryable: true,
  },
  INVALID_PROVIDER_RESPONSE: {
    message:
      "Received an unexpected response from the media service. Please try again.",
    status: 502,
    retryable: true,
  },
  VALIDATION_ERROR: {
    message: "The request could not be validated. Please check your input.",
    status: 400,
    retryable: false,
  },
  REQUEST_TOO_LARGE: {
    message: "The request is too large to process.",
    status: 413,
    retryable: false,
  },
  VIDEO_SOURCE_NOT_FOUND: {
    message:
      "The video for this Reel could not be loaded. Instagram may be restricting automated access right now. Please try again shortly.",
    status: 502,
    retryable: true,
  },
  STORY_SOURCE_UNAVAILABLE: {
    message: "Instagram did not expose a downloadable story source to this backend.",
    status: 502,
    retryable: false,
  },
};

export function createError(code: ErrorCode): AppError {
  const { message, status } = ERRORS[code];
  return new AppError(code, message, status);
}

export function createErrorResponse(code: ErrorCode): ResolveErrorResponse {
  return createError(code).toResponse();
}
