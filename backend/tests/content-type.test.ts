import { describe, it, expect } from "vitest";
import { detectContentType, isSupportedContent } from "@/lib/validators/content-type";

describe("detectContentType", () => {
  it("detects reel URLs", () => {
    expect(detectContentType("/reel/Cxyz123/")).toBe("REEL");
  });

  it("detects reels URLs", () => {
    expect(detectContentType("/reels/Cxyz123/")).toBe("REEL");
  });

  it("detects post URLs", () => {
    expect(detectContentType("/p/Cxyz123/")).toBe("POST");
  });

  it("detects TV URLs", () => {
    expect(detectContentType("/tv/Cxyz123/")).toBe("VIDEO");
  });

  it("detects story URLs", () => {
    expect(detectContentType("/stories/johndoe/12345/")).toBe("STORY");
  });

  it("detects highlight URLs", () => {
    expect(detectContentType("/stories/highlights/123456/")).toBe("HIGHLIGHT");
  });

  it("keeps generic post URLs as POST until provider confirms a carousel", () => {
    expect(detectContentType("/p/Cxyz123/?utm_source=abc")).toBe("POST");
  });

  it("detects photo URLs", () => {
    expect(detectContentType("/p/Cxyz123/")).toBe("POST");
  });

  it("returns UNKNOWN for unrecognized paths", () => {
    expect(detectContentType("/explore/")).toBe("UNKNOWN");
  });

  it("returns UNKNOWN for root path", () => {
    expect(detectContentType("/")).toBe("UNKNOWN");
  });
});

describe("isSupportedContent", () => {
  it("returns true for REEL", () => {
    expect(isSupportedContent("REEL")).toBe(true);
  });

  it("returns true for POST", () => {
    expect(isSupportedContent("POST")).toBe(true);
  });

  it("returns true for VIDEO", () => {
    expect(isSupportedContent("VIDEO")).toBe(true);
  });

  it("returns true for STORY", () => {
    expect(isSupportedContent("STORY")).toBe(true);
  });

  it("returns true for HIGHLIGHT", () => {
    expect(isSupportedContent("HIGHLIGHT")).toBe(true);
  });

  it("returns false for UNKNOWN", () => {
    expect(isSupportedContent("UNKNOWN")).toBe(false);
  });

  it("returns true for CAROUSEL", () => {
    expect(isSupportedContent("CAROUSEL")).toBe(true);
  });

  it("returns true for PHOTO", () => {
    expect(isSupportedContent("PHOTO")).toBe(true);
  });
});
