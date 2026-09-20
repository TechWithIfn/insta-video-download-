/**
 * Safe plain-text normalization for user-visible strings coming from
 * external providers (captions, display names, titles).
 *
 * This is pure string replacement — it never creates HTML, so decoded
 * text is always safe to render as React text content.
 */
const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&mdash;": "\u2014",
  "&ndash;": "\u2013",
  "&lsquo;": "\u2018",
  "&rsquo;": "\u2019",
  "&ldquo;": "\u201c",
  "&rdquo;": "\u201d",
  "&bull;": "\u2022",
  "&hellip;": "\u2026",
};

export function decodeHtmlEntities(text: string): string {
  if (!text || typeof text !== "string") return text;

  let decoded = text;
  for (const [entity, char] of Object.entries(NAMED_ENTITIES)) {
    decoded = decoded.split(entity).join(char);
  }

  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    const code = parseInt(hex, 16);
    return Number.isSafeInteger(code) ? String.fromCodePoint(code) : _;
  });
  decoded = decoded.replace(/&#(\d+);/g, (_, dec) => {
    const code = parseInt(dec, 10);
    return Number.isSafeInteger(code) ? String.fromCodePoint(code) : _;
  });

  return decoded;
}

/** Decode only when a value is a string, otherwise return null. */
export function decodeNullableText(value: unknown): string | null {
  return typeof value === "string" ? decodeHtmlEntities(value) : null;
}
