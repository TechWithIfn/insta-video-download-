import { describe, it, expect } from "vitest";
import { decodeHtmlEntities, decodeNullableText } from "@/lib/text";

describe("decodeHtmlEntities", () => {
  it("decodes common named entities", () => {
    expect(decodeHtmlEntities("&quot;Hello&quot;")).toBe('"Hello"');
    expect(decodeHtmlEntities("a &amp; b")).toBe("a & b");
    expect(decodeHtmlEntities("&lt;tag&gt;")).toBe("<tag>");
  });

  it("decodes decimal and hex numeric entities", () => {
    expect(decodeHtmlEntities("&#39;hi&#39;")).toBe("'hi'");
    expect(decodeHtmlEntities("&#x27;hi&#x27;")).toBe("'hi'");
  });

  it("leaves plain text untouched", () => {
    expect(decodeHtmlEntities("just a caption")).toBe("just a caption");
  });
});

describe("decodeNullableText", () => {
  it("returns null for non-strings", () => {
    expect(decodeNullableText(null)).toBeNull();
    expect(decodeNullableText(42)).toBeNull();
    expect(decodeNullableText(undefined)).toBeNull();
  });

  it("decodes strings", () => {
    expect(decodeNullableText("&quot;x&quot;")).toBe('"x"');
  });
});
