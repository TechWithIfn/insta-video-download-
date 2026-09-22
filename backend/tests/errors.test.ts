import { describe, it, expect } from "vitest";
import { ERRORS, createError, createErrorResponse } from "@/lib/errors";

describe("ERRORS", () => {
  it("has entries for all error codes", () => {
    const codes = [
      "INVALID_URL",
      "UNSUPPORTED_URL",
      "CONTENT_NOT_FOUND",
      "CONTENT_UNAVAILABLE",
      "UNSUPPORTED_CONTENT",
      "RESOLVER_ERROR",
      "RATE_LIMITED",
      "TEMPORARY_ERROR",
      "PROVIDER_UNAVAILABLE",
      "VALIDATION_ERROR",
      "REQUEST_TOO_LARGE",
    ] as const;

    for (const code of codes) {
      expect(ERRORS[code]).toBeDefined();
      expect(ERRORS[code].message).toBeTruthy();
      expect(ERRORS[code].status).toBeGreaterThan(0);
    }
  });
});

describe("createError", () => {
  it("creates an AppError with correct properties", () => {
    const error = createError("INVALID_URL");
    expect(error.code).toBe("INVALID_URL");
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe("The URL provided is not a valid Instagram link.");
  });

  it("creates a toResponse method", () => {
    const error = createError("CONTENT_NOT_FOUND");
    const response = error.toResponse();
    expect(response.success).toBe(false);
    expect(response.error.code).toBe("CONTENT_NOT_FOUND");
  });

  it("maps VIDEO_SOURCE_NOT_FOUND to a retryable honest error", () => {
    const error = createError("VIDEO_SOURCE_NOT_FOUND");
    expect(error.statusCode).toBe(502);
    const response = error.toResponse();
    expect(response.success).toBe(false);
    expect(response.error.code).toBe("VIDEO_SOURCE_NOT_FOUND");
    expect(response.error.retryable).toBe(true);
    expect(response.error.message).toBeTruthy();
  });
});

describe("createErrorResponse", () => {
  it("returns a ResolveErrorResponse", () => {
    const response = createErrorResponse("RATE_LIMITED");
    expect(response.success).toBe(false);
    expect(response.error.code).toBe("RATE_LIMITED");
    expect(response.error.message).toBeTruthy();
  });
});
