import type {
  ResolverResult,
  MediaItem,
  InstagramContentType,
  Author,
  ResolveProgressCallback,
} from "../types.js";
import { BaseProvider, isCdnMediaHost } from "./base.js";
import { createError } from "../errors.js";
import { logger } from "../logger.js";
import { decodeHtmlEntities } from "../text.js";

let pptr: typeof import("puppeteer") | null = null;

async function getPuppeteer() {
  if (!pptr) {
    pptr = await import("puppeteer");
  }
  return pptr;
}

/**
 * Serverless detection: Vercel sets VERCEL=1 automatically. PUPPETEER_RUNTIME
 * allows an explicit override ("serverless" | "local"); otherwise auto-detect.
 */
export function isServerlessRuntime(): boolean {
  const override = (process.env.PUPPETEER_RUNTIME || "").toLowerCase();
  if (override === "serverless") return true;
  if (override === "local") return false;
  return Boolean(process.env.VERCEL);
}

const NAVIGATION_TIMEOUT_MS = 15_000;
const DATA_WAIT_TIMEOUT_MS = 5_000;
const MAX_CONCURRENT_PAGES = 3;
// Slots held longer than this are presumed leaked and reclaimed on next
// acquire. Legitimate resolves finish an order of magnitude sooner.
const PAGE_SLOT_STALE_MS = 120_000;
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export interface ExtractedMedia {
  url: string;
  type: "video" | "image";
  width: number | null;
  height: number | null;
}

function unescapeInstagramString(s: string): string {
  return s
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/\\u003C/g, "<")
    .replace(/\\u003E/g, ">")
    .replace(/\\u0022/g, '"')
    .replace(/\\u0027/g, "'")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    // Page HTML/JSON embeds URLs with &amp; entities (e.g. "...?a=1&amp;b=2").
    // Decode to the real query separator or the CDN signature breaks.
    .replace(/&amp;/g, "&");
}

export function extractMediaFromJson(text: string): ExtractedMedia[] {
  const media: ExtractedMedia[] = [];
  const seen = new Set<string>();

  const add = (url: string, type: "video" | "image") => {
    const clean = unescapeInstagramString(url);
    if (!clean || seen.has(clean) || !clean.startsWith("http")) return;
    seen.add(clean);
    media.push({ url: clean, type, width: null, height: null });
  };

  for (const m of text.matchAll(/"video_url"\s*:\s*"([^"]+)"/g)) {
    add(m[1], "video");
  }
  for (const m of text.matchAll(/"playback_url"\s*:\s*"([^"]+)"/g)) {
    add(m[1], "video");
  }
  for (const m of text.matchAll(/"url"\s*:\s*"(https?:[^"]*?\.mp4[^"]*?)"/g)) {
    add(m[1], "video");
  }
  for (const m of text.matchAll(/"display_url"\s*:\s*"([^"]+)"/g)) {
    add(m[1], "image");
  }
  for (const m of text.matchAll(/"thumbnail_src"\s*:\s*"([^"]+)"/g)) {
    add(m[1], "image");
  }

  return media;
}

export interface SidecarPage {
  items: ExtractedMedia[];
  hasMore: boolean;
  endCursor: string | null;
}

/**
 * Structured carousel extraction: parse Instagram API JSON (`edge_sidecar_to_children`
 * edges or `carousel_media` children) instead of regex-scraping URLs. Returns
 * every child in order with real per-slide dimensions, plus pagination state
 * (`page_info.has_next_page` / `end_cursor`) so callers can follow the cursor
 * until the complete collection is retrieved. Never throws; unparseable input
 * yields an empty page. Video slides contribute their playable URL (posters
 * are kept as separate image entries, matching the regex path's behavior).
 */
export function extractSidecarFromJson(text: string): SidecarPage {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { items: [], hasMore: false, endCursor: null };
  }
  return parseSidecarRoot(root);
}

/** Walk a parsed Instagram API object for sidecar/carousel children. */
function parseSidecarRoot(root: unknown): SidecarPage {
  const items: ExtractedMedia[] = [];
  const seen = new Set<string>();
  let hasMore = false;
  let endCursor: string | null = null;

  const push = (url: unknown, type: "video" | "image", w: unknown, h: unknown): void => {
    if (typeof url !== "string") return;
    const clean = unescapeInstagramString(url);
    if (!clean.startsWith("http") || seen.has(clean)) return;
    seen.add(clean);
    items.push({
      url: clean,
      type,
      width: typeof w === "number" && w > 0 ? w : null,
      height: typeof h === "number" && h > 0 ? h : null,
    });
  };

  const visitEdgeNode = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    const dims = n["dimensions"];
    const w = dims && typeof dims === "object" ? (dims as Record<string, unknown>)["width"] : n["width"];
    const h = dims && typeof dims === "object" ? (dims as Record<string, unknown>)["height"] : n["height"];
    if (n["is_video"] === true && typeof n["video_url"] === "string") {
      push(n["video_url"], "video", w, h);
    }
    push(n["display_url"] ?? n["display_src"], "image", w, h);
  };

  const bestByArea = (cands: unknown[]): Record<string, unknown> | null => {
    let best: Record<string, unknown> | null = null;
    let bestArea = -1;
    for (const cd of cands) {
      if (!cd || typeof cd !== "object") continue;
      const cc = cd as Record<string, unknown>;
      if (typeof cc["url"] !== "string") continue;
      const area =
        typeof cc["width"] === "number" && typeof cc["height"] === "number"
          ? (cc["width"] as number) * (cc["height"] as number)
          : 0;
      if (area > bestArea) {
        bestArea = area;
        best = cc;
      }
    }
    return best;
  };

  const visitCarouselChild = (child: unknown): void => {
    if (!child || typeof child !== "object") return;
    const c = child as Record<string, unknown>;
    const vids = c["video_versions"];
    if (Array.isArray(vids) && vids.length > 0) {
      const best = bestByArea(vids);
      if (best) {
        push(best["url"], "video", best["width"], best["height"]);
        push(c["display_url"] ?? c["display_src"], "image", best["width"], best["height"]);
        return;
      }
    }
    const iv2 = c["image_versions2"];
    const cands =
      iv2 && typeof iv2 === "object" && Array.isArray((iv2 as Record<string, unknown>)["candidates"])
        ? ((iv2 as Record<string, unknown>)["candidates"] as unknown[])
        : [];
    const best = bestByArea(cands);
    if (best) {
      push(best["url"], "image", best["width"], best["height"]);
    } else {
      push(c["display_url"] ?? c["display_src"], "image", c["width"], c["height"]);
    }
  };

  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 14) return;
    if (Array.isArray(node)) {
      for (const el of node) walk(el, depth + 1);
      return;
    }
    const rec = node as Record<string, unknown>;
    const sidecar = rec["edge_sidecar_to_children"];
    if (sidecar && typeof sidecar === "object" && !Array.isArray(sidecar)) {
      const sc = sidecar as Record<string, unknown>;
      if (Array.isArray(sc["edges"])) {
        for (const e of sc["edges"] as unknown[]) {
          const en = (e as Record<string, unknown> | null)?.["node"];
          visitEdgeNode(en);
        }
      }
      const pi = sc["page_info"];
      if (pi && typeof pi === "object" && !Array.isArray(pi)) {
        const pir = pi as Record<string, unknown>;
        if (pir["has_next_page"] === true) {
          hasMore = true;
          if (typeof pir["end_cursor"] === "string" && pir["end_cursor"]) {
            endCursor = pir["end_cursor"] as string;
          }
        }
      }
      for (const [k, v] of Object.entries(rec)) {
        if (k === "edge_sidecar_to_children" || k === "carousel_media") continue;
        walk(v, depth + 1);
      }
      return;
    }
    if (Array.isArray(rec["carousel_media"])) {
      for (const child of rec["carousel_media"] as unknown[]) visitCarouselChild(child);
      for (const [k, v] of Object.entries(rec)) {
        if (k === "carousel_media" || k === "edge_sidecar_to_children") continue;
        walk(v, depth + 1);
      }
      return;
    }
    for (const v of Object.values(rec)) walk(v, depth + 1);
  };

  walk(root, 0);
  return { items, hasMore, endCursor };
}

/** Extract a `{...}` balanced block starting at `openIdx`, honoring `\` escapes. */
function extractBalancedJson(text: string, openIdx: number, maxLen = 2_000_000): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openIdx; i < text.length && i - openIdx < maxLen; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(openIdx, i + 1);
    }
  }
  return null;
}

/**
 * Complete carousel extraction from Instagram's public post embed endpoint
 * (`/p/<shortcode>/embed/`), whose `gql_data.shortcode_media` carries the
 * FULL `edge_sidecar_to_children` collection (all slides, in order, with
 * dimensions) — unlike the main page, which only exposes the first slides
 * anonymously. Tries progressive unescape levels since the blob is embedded
 * at varying depths; returns an empty page when unusable. Never throws.
 */
/** Collect nested JSON-string values that themselves carry sidecar data. */
function collectSidecarStrings(node: unknown, out: string[], depth = 0): void {
  if (node == null || depth > 8) return;
  if (typeof node === "string") {
    if (node.includes("edge_sidecar_to_children") || node.includes("carousel_media")) {
      out.push(node);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const el of node) collectSidecarStrings(el, out, depth + 1);
    return;
  }
  if (typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) {
      collectSidecarStrings(v, out, depth + 1);
    }
  }
}

/**
 * Parse the longest valid JSON prefix: on "Unexpected non-whitespace after
 * JSON at position N", the input slice [0, N) is complete — retry with it.
 * Bounded and strictly shrinking, so it always terminates.
 */
function tryParseJsonPrefix(text: string): unknown | null {
  let slice = text;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return JSON.parse(slice);
    } catch (e) {
      const m = /position (\d+)/.exec(e instanceof Error ? e.message : "");
      if (!m) return null;
      const pos = parseInt(m[1], 10);
      if (!(pos > 0) || pos >= slice.length) return null;
      slice = slice.slice(0, pos);
    }
  }
  return null;
}

export function extractSidecarFromEmbedHtml(html: string): SidecarPage {
  const empty: SidecarPage = { items: [], hasMore: false, endCursor: null };
  try {
    // &quot; entities would otherwise look like raw quotes to the scanner.
    const flat = html.replace(/\\\//g, "/").replace(/&quot;/g, '\\"');
    const anchor = flat.indexOf("gql_data");
    if (anchor === -1) return empty;
    const openIdx = flat.indexOf("{", anchor);
    if (openIdx === -1) return empty;
    const block = extractBalancedJson(flat, openIdx);
    if (!block) return empty;
    // The blob may itself be escape-prefixed ({\"shortcode_media\"...}, i.e.
    // a JSON string's content rather than a standalone object). Retry the
    // whole block through progressive unescape levels; at each level also
    // probe nested JSON-string blobs in both raw and unescaped forms.
    let candidate: string = block;
    for (let pass = 0; pass < 3; pass++) {
      const root: unknown = tryParseJsonPrefix(candidate);
      if (root) {
        const direct = parseSidecarRoot(root);
        if (direct.items.length > 0) return direct;
        const nested: string[] = [];
        collectSidecarStrings(root, nested);
        for (const s of nested.slice(0, 4)) {
          for (const form of [s, s.replace(/\\"/g, '"')]) {
            const sub = tryParseJsonPrefix(form);
            if (sub) {
              const page = parseSidecarRoot(sub);
              if (page.items.length > 0) return page;
            }
          }
        }
      }
      candidate = candidate.replace(/\\"/g, '"');
    }
    return empty;
  } catch {
    return empty;
  }
}

function extractMediaFromHtml(html: string): ExtractedMedia[] {
  const media: ExtractedMedia[] = [];
  const seen = new Set<string>();

  const add = (url: string, type: "video" | "image") => {
    const clean = unescapeInstagramString(url);
    if (!clean || seen.has(clean) || !clean.startsWith("http")) return;
    seen.add(clean);
    media.push({ url: clean, type, width: null, height: null });
  };

  for (const m of html.matchAll(
    /property=["']og:video["'][^>]*content=["']([^"']+)["']/gi
  )) {
    add(m[1], "video");
  }
  for (const m of html.matchAll(
    /content=["']([^"']+)["'][^>]*property=["']og:video["']/gi
  )) {
    add(m[1], "video");
  }
  for (const m of html.matchAll(
    /property=["']og:image["'][^>]*content=["']([^"']+)["']/gi
  )) {
    add(m[1], "image");
  }
  for (const m of html.matchAll(
    /content=["']([^"']+)["'][^>]*property=["']og:image["']/gi
  )) {
    add(m[1], "image");
  }
  for (const m of html.matchAll(
    /name=["']twitter:player:stream["'][^>]*content=["']([^"']+)["']/gi
  )) {
    add(m[1], "video");
  }
  for (const m of html.matchAll(
    /name=["']twitter:image["'][^>]*content=["']([^"']+)["']/gi
  )) {
    add(m[1], "image");
  }
  for (const m of html.matchAll(/"video_url"\s*:\s*"([^"]+)"/g)) {
    add(m[1], "video");
  }
  for (const m of html.matchAll(/"display_url"\s*:\s*"([^"]+)"/g)) {
    add(m[1], "image");
  }
  for (const m of html.matchAll(
    /https?:\/\/[^"'\s]*?scontent[^"'\s]*?\.(?:jpg|jpeg|png|webp)/gi
  )) {
    add(m[0], "image");
  }

  return media;
}

function extractAuthorFromHtml(html: string): Author | null {
  const usernameMatch =
    html.match(/"username"\s*:\s*"([^"]+)"/) ||
    html.match(/"owner"\s*:\s*\{[^}]*"username"\s*:\s*"([^"]+)"/);
  if (usernameMatch) {
    const displayNameMatch =
      html.match(/"full_name"\s*:\s*"([^"]+)"/) ||
      html.match(/"owner"\s*:\s*\{[^}]*"full_name"\s*:\s*"([^"]+)"/);
    return {
      username: usernameMatch[1],
      displayName: displayNameMatch ? displayNameMatch[1] : null,
    };
  }

  // Try to extract from og:title or twitter:title (format: "Name (@username) • Instagram")
  const ogTitleMatch =
    html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/) ||
    html.match(/content=["']([^"']+)["'][^>]*property=["']og:title["']/) ||
    html.match(/name=["']twitter:title["'][^>]*content=["']([^"']+)["']/) ||
    html.match(/content=["']([^"']+)["'][^>]*name=["']twitter:title["']/);
  if (ogTitleMatch) {
    const title = unescapeInstagramString(ogTitleMatch[1]);
    const atMatch = title.match(/@([a-zA-Z0-9._]+)/);
    if (atMatch) {
      const beforeAt = title.slice(0, title.indexOf("@")).replace(/\s*[|•·]\s*$/, "").trim();
      return {
        username: atMatch[1],
        displayName: beforeAt || null,
      };
    }
  }

  // Try to extract from description (format: "... - username on date:")
  const descMatch =
    html.match(/property=["']og:description["'][^>]*content=["']([^"']+)["']/) ||
    html.match(/content=["']([^"']+)["'][^>]*property=["']og:description["']/) ||
    html.match(/name=["']description["'][^>]*content=["']([^"']+)["']/);
  if (descMatch) {
    const desc = unescapeInstagramString(descMatch[1]);
    const userMatch = desc.match(/(?:-|\u2013)\s*([a-zA-Z0-9._]+)\s+on\s+/);
    if (userMatch) {
      return { username: userMatch[1], displayName: null };
    }
  }

  return null;
}

function extractAuthorFromUrl(url: string): Author | null {
  const match = url.match(/instagram\.com\/([a-zA-Z0-9._]+)\/(?:p|reel|tv|stories)/);
  if (match && !["p", "reel", "reels", "tv", "stories", "accounts", "explore"].includes(match[1])) {
    return { username: match[1], displayName: null };
  }
  return null;
}

function extractTitleFromHtml(html: string): string | null {
  const ogTitleMatch =
    html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/) ||
    html.match(/content=["']([^"']+)["'][^>]*property=["']og:title["']/);
  if (ogTitleMatch) return unescapeInstagramString(ogTitleMatch[1]);

  const descMatch =
    html.match(/property=["']og:description["'][^>]*content=["']([^"']+)["']/) ||
    html.match(/content=["']([^"']+)["'][^>]*property=["']og:description["']/);
  if (descMatch) return unescapeInstagramString(descMatch[1]);

  const twitterTitle =
    html.match(/name=["']twitter:title["'][^>]*content=["']([^"']+)["']/) ||
    html.match(/content=["']([^"']+)["'][^>]*name=["']twitter:title["']/);
  if (twitterTitle) return unescapeInstagramString(twitterTitle[1]);

  return null;
}

function extractDescriptionFromHtml(html: string): string | null {
  const descMatch =
    html.match(/property=["']og:description["'][^>]*content=["']([^"']+)["']/) ||
    html.match(/content=["']([^"']+)["'][^>]*property=["']og:description["']/) ||
    html.match(/name=["']description["'][^>]*content=["']([^"']+)["']/) ||
    html.match(/content=["']([^"']+)["'][^>]*name=["']description["']/);
  return descMatch ? unescapeInstagramString(descMatch[1]) : null;
}

/**
 * For Reel/Video content the playable item must win: provider responses may
 * list thumbnails/posters before the actual video. Stable sort — videos
 * first (discovery order preserved), everything else untouched. Other
 * content types keep provider order (carousels keep per-item types/order).
 */
export function sortVideoFirst(media: MediaItem[], contentType: InstagramContentType): MediaItem[] {
  if (contentType !== "REEL" && contentType !== "VIDEO") return media;
  const videos = media.filter((m) => m.type === "video");
  if (videos.length === 0) return media;
  return [...videos, ...media.filter((m) => m.type !== "video")];
}

const FETCH_META_FN = `
(function() {
  var result = { videos: [], images: [], hasArticle: false, bodySnippet: '' };

  var videos = document.querySelectorAll('video');
  for (var i = 0; i < videos.length; i++) {
    var v = videos[i];
    var src = v.getAttribute('src');
    if (src && src.indexOf('http') === 0) result.videos.push(src);
    var sources = v.querySelectorAll('source');
    for (var j = 0; j < sources.length; j++) {
      var sSrc = sources[j].getAttribute('src');
      if (sSrc && sSrc.indexOf('http') === 0) result.videos.push(sSrc);
    }
  }

  var imgs = document.querySelectorAll('img[src]');
  for (var k = 0; k < imgs.length; k++) {
    var imgSrc = imgs[k].getAttribute('src') || '';
    if (imgSrc.indexOf('scontent') !== -1 || imgSrc.indexOf('fbcdn') !== -1 || imgSrc.indexOf('cdninstagram') !== -1) {
      if (imgSrc.indexOf('static.cdninstagram.com') === -1) {
        result.images.push(imgSrc);
      }
    }
  }

  var article = document.querySelector('article');
  result.hasArticle = !!article;

  result.bodySnippet = (document.body ? document.body.innerText || '' : '').slice(0, 500);

  return result;
})()
`;

const PAGE_STATE_FN = `
(function() {
  var title = document.title || '';
  var bodyText = document.body ? document.body.innerText || '' : '';
  return {
    title: title,
    hasUnavailableMessage:
      title.indexOf('isn\\'t available') !== -1 ||
      title.indexOf('Page Not Found') !== -1 ||
      bodyText.indexOf('isn\\'t available') !== -1 ||
      bodyText.indexOf('This page isn\\'t available') !== -1 ||
      bodyText.indexOf('The link you followed may be broken') !== -1,
    hasLoginWall:
      bodyText.indexOf('Log in to Instagram') !== -1 ||
      !!document.querySelector('input[name="username"]'),
    hasChallenge:
      bodyText.indexOf('suspicious activity') !== -1 ||
      bodyText.indexOf('verify your identity') !== -1,
  };
})()
`;

const STEALTH_FN = `
(function() {
  // Override navigator.webdriver
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // Override navigator.plugins
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
  });

  // Override navigator.languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
  });

  // Override chrome detection
  window.chrome = { runtime: {}, loadTimes: function() { return {}; }, csi: function() { return {}; } };

  // Override permissions
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
      Promise.resolve({ state: Notification.permission }) :
      originalQuery(parameters)
  );
})()
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyStealthPatches(page: any) {
  try {
    await page.evaluateOnNewDocument(STEALTH_FN);
  } catch {
    // Ignore if page is already closed
  }
}

function isTrustedCdnUrl(raw: string): boolean {
  try {
    const parsed = new URL(unescapeInstagramString(raw));
    if (parsed.protocol !== "https:") return false;
    return isCdnMediaHost(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Plain-HTTP page fetch shared by metadata extraction and the dedicated
 * audio-page resolver. Returns raw HTML, or null on any failure.
 */
interface PageFetchResult {
  html: string | null;
  status: number | null;
  contentType: string | null;
  finalHost: string | null;
  finalPath: string | null;
  error: string | null;
}

async function fetchPageSnapshot(url: string, timeoutMs = 10_000): Promise<PageFetchResult> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": MOBILE_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ct = res.headers.get("content-type") || "";
    const final = new URL(res.url || url);
    const base = {
      status: res.status,
      contentType: ct || null,
      finalHost: final.hostname,
      finalPath: final.pathname,
      error: null,
    };
    if (!res.ok || (!ct.includes("text/html") && !ct.includes("application/xhtml"))) {
      await res.body?.cancel().catch(() => {});
      return { ...base, html: null };
    }
    return { ...base, html: await res.text() };
  } catch (error) {
    return {
      html: null,
      status: null,
      contentType: null,
      finalHost: null,
      finalPath: null,
      error: error instanceof Error ? error.name : "fetch-failed",
    };
  }
}

export async function fetchPageHtml(url: string, timeoutMs = 10_000): Promise<string | null> {
  return (await fetchPageSnapshot(url, timeoutMs)).html;
}

function isLikelyProfileImageUrl(url: string): boolean {
  try {
    return /\/t51\.[^/]+-19\//i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export async function fetchMetadata(url: string): Promise<{
  ogImage: string | null;
  ogVideo: string | null;
  embeddedMedia: ExtractedMedia[];
  pageStatus: number | null;
  pageContentType: string | null;
  pageFinalHost: string | null;
  pageFinalPath: string | null;
  pageError: string | null;
  htmlLength: number;
  hasChallenge: boolean;
  title: string | null;
  description: string | null;
  author: Author | null;
  loginWall: boolean;
}> {
  const empty = {
    ogImage: null,
    ogVideo: null,
    embeddedMedia: [],
    pageStatus: null,
    pageContentType: null,
    pageFinalHost: null,
    pageFinalPath: null,
    pageError: null,
    htmlLength: 0,
    hasChallenge: false,
    title: null,
    description: null,
    author: extractAuthorFromUrl(url),
    loginWall: false,
  };
  try {
    const page = await fetchPageSnapshot(url);
    const html = page.html;
    const pageInfo = {
      pageStatus: page.status,
      pageContentType: page.contentType,
      pageFinalHost: page.finalHost,
      pageFinalPath: page.finalPath,
      pageError: page.error,
      htmlLength: html?.length || 0,
    };
    if (!html) return { ...empty, ...pageInfo };

    const hasChallenge = /suspicious activity|verify your identity/i.test(html);

    // Instagram serves its login page (with ITS OWN og:image) to anonymous
    // requests for gated content. Never treat that as the post's media.
    if (
      html.includes('name="username"') ||
      html.includes("Log in to Instagram") ||
      html.includes("loginForm") ||
      html.includes('"requireLogin":true')
    ) {
      return { ...empty, ...pageInfo, hasChallenge, loginWall: true };
    }

    const ogImageMatch =
      html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/) ||
      html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/) ||
      html.match(/name=["']twitter:image["'][^>]*content=["']([^"']+)["']/);

    const ogVideoMatch =
      html.match(/property=["']og:video(?:_secure_url)?["'][^>]*content=["']([^"']+)["']/) ||
      html.match(/content=["']([^"']+)["'][^>]*property=["']og:video(?:_secure_url)?["']/) ||
      html.match(/name=["']twitter:player:stream["'][^>]*content=["']([^"']+)["']/);

    const rawImage = ogImageMatch ? unescapeInstagramString(ogImageMatch[1]) : null;
    let rawVideo = ogVideoMatch ? unescapeInstagramString(ogVideoMatch[1]) : null;

    // No-browser fallback scan: some pages embed video data as JSON without
    // an og:video tag. Same patterns (and CDN trust gate below) as the
    // Puppeteer interception path, so serverless resolves gain coverage.
    const embeddedMedia = extractMediaFromJson(html).filter((item) => isTrustedCdnUrl(item.url));
    if (!rawVideo) {
      for (const item of embeddedMedia) {
        if (item.type === "video") {
          rawVideo = item.url;
          break;
        }
      }
    }

    return {
      ogImage: rawImage && isTrustedCdnUrl(rawImage) ? rawImage : null,
      ogVideo: rawVideo && isTrustedCdnUrl(rawVideo) ? rawVideo : null,
      embeddedMedia,
      ...pageInfo,
      hasChallenge,
      title: extractTitleFromHtml(html),
      description: extractDescriptionFromHtml(html),
      author: extractAuthorFromHtml(html) || extractAuthorFromUrl(url),
      loginWall: false,
    };
  } catch {
    return empty;
  }
}

const SIDECAR_PAGE_TIMEOUT_MS = 8_000;
const SIDECAR_MAX_EXTRA_PAGES = 3;

/**
 * Follow a sidecar `end_cursor` with a plain-HTTP request against the same API
 * endpoint the browser used. Returns the next structured page, or null when
 * the provider refuses (login/session-gated — the caller keeps whatever was
 * already collected and logs the outcome honestly). Never throws.
 */
async function fetchSidecarPage(requestUrl: string, endCursor: string): Promise<SidecarPage | null> {
  try {
    let url = requestUrl;
    const encoded = encodeURIComponent(endCursor);
    if (/"after":"[^"]*"/.test(url)) {
      url = url.replace(/"after":"[^"]*"/, `"after":"${endCursor}"`);
    } else if (/after%22%3A%22[^&"]*/i.test(url)) {
      url = url.replace(/after%22%3A%22[^&"]*/i, `after%22%3A%22${encoded}`);
    } else if (/([?&])after=([^&]*)/.test(url)) {
      url = url.replace(/([?&])after=([^&]*)/, `$1after=${encoded}`);
    } else {
      url = `${url}${url.includes("?") ? "&" : "?"}after=${encoded}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SIDECAR_PAGE_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": MOBILE_UA,
          Accept: "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.instagram.com/",
          "X-IG-App-ID": "936619743392459",
        },
        redirect: "manual",
      });
      const ct = res.headers.get("content-type") || "";
      if (!res.ok || !ct.includes("json")) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      const text = await res.text();
      return extractSidecarFromJson(text);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

export class PuppeteerProvider extends BaseProvider {
  readonly name = "puppeteer";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private browser: any = null;
  private launching: Promise<void> | null = null;
  // Acquisition timestamps of held page slots (single source of truth for
  // concurrency). Timestamps let us reclaim slots leaked by killed/frozen
  // runtimes (e.g. a serverless instance frozen mid-resolve).
  private pageSlots: number[] = [];
  private pageWaiters: Array<() => void> = [];

  private async ensureBrowser(): Promise<void> {
    if (this.browser) return;
    if (this.launching) {
      await this.launching;
      return;
    }

    this.launching = (async () => {
      if (isServerlessRuntime()) {
        await this.launchServerless();
      } else {
        const p = await getPuppeteer();
        this.browser = await p.default.launch({
          headless: true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-web-security",
            "--disable-features=VizDisplayCompositor",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--disable-blink-features=AutomationControlled",
          ],
        });
      }

      // Apply stealth patches manually
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pages = await this.browser!.pages();
      for (const pg of pages) {
        await applyStealthPatches(pg);
      }

      logger.info("Puppeteer browser launched (stealth-patched)");
      this.launching = null;
    })();

    await this.launching;
  }

  /**
   * Vercel/serverless launch path: headless-shell Chromium provided by
   * @sparticuz/chromium, driven via puppeteer-core. No locally installed
   * Chrome is used or required. The local launch path above is untouched.
   */
  private async launchServerless(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coreMod = (await import("puppeteer-core")) as any;
    const core = coreMod.default ?? coreMod;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chromiumMod = (await import("@sparticuz/chromium")) as any;
    const chromium = chromiumMod.default ?? chromiumMod;

    // No WebGL needed for DOM/API extraction; skips swiftshader extraction.
    chromium.setGraphicsMode = false;
    const executablePath: string = await chromium.executablePath();
    const defaultArgsFn =
      typeof core.defaultArgs === "function" ? core.defaultArgs.bind(core) : null;
    const args: string[] = defaultArgsFn
      ? await defaultArgsFn({ args: chromium.args, headless: "shell" })
      : [...(chromium.args as string[])];

    this.browser = await core.launch({
      args,
      defaultViewport: { width: 375, height: 812, isMobile: true, hasTouch: true },
      executablePath,
      headless: "shell",
    });

    logger.info("Puppeteer serverless browser launched (@sparticuz/chromium)");
  }

  /** Drop slots held far longer than any legitimate resolve (leak recovery). */
  private reclaimStalePageSlots(): void {
    const cutoff = Date.now() - PAGE_SLOT_STALE_MS;
    while (this.pageSlots.length > 0 && this.pageSlots[0] < cutoff) {
      this.pageSlots.shift();
    }
  }

  /** Bounded page concurrency: fail fast instead of spawning unlimited pages. */
  private async acquirePageSlot(): Promise<boolean> {
    this.reclaimStalePageSlots();
    if (this.pageSlots.length < MAX_CONCURRENT_PAGES) {
      this.pageSlots.push(Date.now());
      return true;
    }
    const waited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 5_000);
      this.pageWaiters.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (!waited) return false;
    this.reclaimStalePageSlots();
    if (this.pageSlots.length >= MAX_CONCURRENT_PAGES) return false;
    this.pageSlots.push(Date.now());
    return true;
  }

  private releasePageSlot(): void {
    this.pageSlots.shift();
    const next = this.pageWaiters.shift();
    if (next) next();
  }

  /** Fast path: plain-HTML metadata already yielded a direct video URL. */
  private buildResultFromVideo(
    url: string,
    videoUrl: string,
    meta: { ogImage: string | null; title: string | null; description: string | null; author: Author | null }
  ): ResolverResult {
    const contentType = this.detectContentType(url);
    const author = meta.author || extractAuthorFromUrl(url);
    const decodedAuthor: Author | null = author
      ? {
          username: author.username,
          displayName: author.displayName ? decodeHtmlEntities(author.displayName) : null,
        }
      : null;
    const rawTitle = meta.title || meta.description;
    const media: MediaItem[] = [
      {
        url: videoUrl,
        type: "video",
        width: null,
        height: null,
        duration: null,
        thumbnail: meta.ogImage,
        format: "mp4",
      },
    ];
    logger.info("Puppeteer resolve via fast metadata path (no browser)", {
      contentType,
    });
    return {
      type: contentType,
      sourceUrl: url,
      thumbnail: meta.ogImage,
      title: rawTitle ? decodeHtmlEntities(rawTitle) : null,
      author: decodedAuthor,
      media,
    };
  }

  async resolve(url: string, onProgress?: ResolveProgressCallback): Promise<ResolverResult> {
    const startTime = Date.now();
    const timings: Record<string, number> = {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let page: any;
    let slotHeld = false;
    try {
      // Step 0: Fetch metadata via plain HTTP (~1s, no browser, no bot detection)
      const metaStart = Date.now();
      const fetchMeta = await fetchMetadata(url);
      timings.metadataMs = Date.now() - metaStart;
      onProgress?.(35, "Media source opened");

      const isStory = this.detectContentType(url) === "STORY";
      const storySegments = new URL(url).pathname.split("/").filter(Boolean);
      if (isStory) {
        logger.info("Story extraction diagnostics", {
          normalizedUrl: url,
          username: storySegments[1] || null,
          storyId: storySegments[2] || null,
          pageStatus: fetchMeta.pageStatus,
          pageFinalHost: fetchMeta.pageFinalHost,
          pageFinalPath: fetchMeta.pageFinalPath,
          loginWall: fetchMeta.loginWall,
          challenge: fetchMeta.hasChallenge,
          hasOgImage: Boolean(fetchMeta.ogImage),
          hasOgVideo: Boolean(fetchMeta.ogVideo),
          embeddedMediaCount: fetchMeta.embeddedMedia.length,
          htmlLength: fetchMeta.htmlLength,
          pageError: fetchMeta.pageError,
        });
      }

      // Story pages may expose the actual item as og metadata or embedded
      // JSON. Resolve those candidates before opening a browser, while never
      // treating the story ID as a post shortcode.
      if (url.includes("/stories/") && !fetchMeta.loginWall) {
        const storyCandidate =
          (fetchMeta.ogVideo && { url: fetchMeta.ogVideo, type: "video" as const }) ||
          fetchMeta.embeddedMedia.find((item) => item.type === "video") ||
          (fetchMeta.ogImage && !isLikelyProfileImageUrl(fetchMeta.ogImage) && {
            url: fetchMeta.ogImage,
            type: "image" as const,
          }) ||
          fetchMeta.embeddedMedia.find((item) => item.type === "image");
        if (storyCandidate && this.validateMediaUrl(storyCandidate.url)) {
          logger.info("Puppeteer story fast path", {
            storyUrl: url,
            mediaType: storyCandidate.type,
          });
          const storyMeta = {
            ...fetchMeta,
            ogImage:
              fetchMeta.ogImage || (storyCandidate.type === "image" ? storyCandidate.url : null),
          };
          return storyCandidate.type === "video"
            ? this.buildResultFromVideo(url, storyCandidate.url, storyMeta)
            : this.buildResultFromMetadata(url, storyMeta);
        }
      }

      // Fast path: video pages usually expose og:video in plain HTML.
      // Skips Chromium entirely when the direct video URL is already known.
      // Audio pages are included: when their sound page exposes a playable
      // source the audio flow can proceed without launching the browser.
      const isVideoPage =
        url.includes("/reel/") ||
        url.includes("/reels/") ||
        url.includes("/tv/") ||
        url.includes("/reels/audio/");
      if (isVideoPage && fetchMeta.ogVideo && !fetchMeta.loginWall) {
        const result = this.buildResultFromVideo(url, fetchMeta.ogVideo, fetchMeta);
        timings.totalMs = Date.now() - startTime;
        logger.info("[resolve] fast path complete", { ...timings, mediaCount: 1 });
        return result;
      }

      // Post fast path: the public embed endpoint carries the COMPLETE
      // sidecar collection (every slide, in order, with dimensions), unlike
      // the main page which only exposes the first slides anonymously. When
      // it yields items, the browser pass is skipped entirely.
      if (url.includes("/p/")) {
        const postMatch = /instagram\.com\/p\/([A-Za-z0-9_-]+)/.exec(url);
        if (postMatch?.[1]) {
          const embedStart = Date.now();
          const embedHtml = await fetchPageHtml(
            `https://www.instagram.com/p/${postMatch[1]}/embed/`
          );
          timings.embedMs = Date.now() - embedStart;
          const embed = embedHtml ? extractSidecarFromEmbedHtml(embedHtml) : null;
          if (embed && embed.items.length > 0) {
            const validEmbed: MediaItem[] = [];
            for (const item of embed.items) {
              if (this.validateMediaUrl(item.url)) {
                validEmbed.push({
                  url: item.url,
                  type: item.type,
                  width: item.width,
                  height: item.height,
                  duration: null,
                  thumbnail: null,
                  format: item.type === "video" ? "mp4" : null,
                });
              }
            }
            if (validEmbed.length > 0) {
              const author =
                fetchMeta.author ||
                extractAuthorFromUrl(url);
              const rawTitle = fetchMeta.title || fetchMeta.description;
              const decodedAuthor: Author | null = author
                ? {
                    username: author.username,
                    displayName: author.displayName
                      ? decodeHtmlEntities(author.displayName)
                      : null,
                  }
                : null;
              logger.info("Puppeteer resolve via embed sidecar (no browser)", {
                contentType: this.detectContentType(url),
                mediaCount: validEmbed.length,
                hasVideo: validEmbed.some((m) => m.type === "video"),
              });
              timings.totalMs = Date.now() - startTime;
              onProgress?.(85, "Media extracted");
              return {
                type: this.detectContentType(url),
                sourceUrl: url,
                thumbnail:
                  validEmbed.find((m) => m.type === "image")?.url ||
                  fetchMeta.ogImage ||
                  null,
                title: rawTitle ? decodeHtmlEntities(rawTitle) : null,
                author: decodedAuthor,
                media: validEmbed,
              };
            }
            logger.info("Embed sidecar had no valid media, continuing to browser", {
              discovered: embed.items.length,
            });
          }
        }
      }

      if (!(await this.acquirePageSlot())) {
        throw createError("SERVER_OVERLOADED");
      }
      slotHeld = true;

      const browserStart = Date.now();
      try {
        await this.ensureBrowser();
      } catch (err) {
        logger.error("Puppeteer BROWSER_LAUNCH_FAILED", {
          error: err instanceof Error ? err.message : String(err),
          duration: Date.now() - startTime,
        });

        // If browser fails, return what we got from fetch
        if (fetchMeta.ogImage && (!isStory || !isLikelyProfileImageUrl(fetchMeta.ogImage))) {
          return this.buildResultFromMetadata(url, fetchMeta);
        }
        throw createError("PROVIDER_UNAVAILABLE");
      }
      timings.browserMs = Date.now() - browserStart;
      onProgress?.(50, "Browser ready");

      if (!this.browser) {
        if (fetchMeta.ogImage && (!isStory || !isLikelyProfileImageUrl(fetchMeta.ogImage))) {
          return this.buildResultFromMetadata(url, fetchMeta);
        }
        throw createError("PROVIDER_UNAVAILABLE");
      }

      page = await this.browser.newPage();

      // Apply stealth patches to this page
      await applyStealthPatches(page);

      // Use mobile viewport + user agent - Instagram serves more metadata to mobile
      await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
      await page.setUserAgent(MOBILE_UA);

      await page.setExtraHTTPHeaders({
        "Accept-Language": "en-US,en;q=0.9",
        "X-IG-App-ID": "936619743392459",
      });

      // Block heavy resources we never need, but NEVER abort video/media
      // requests: media delivery responses (resourceType "media",
      // video/*) and <video> currentSrc are primary extraction signals.
      // Scripts/XHR/fetch stay enabled — API JSON interception depends on them.
      await page.setRequestInterception(true).catch(() => {});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      page.on("request", (intercepted: any) => {
        try {
          const type = intercepted.resourceType();
          const target = intercepted.url();
          if (type === "media" || type === "image" || type === "video") {
            interceptedMediaRequestCount++;
          }
          let isTrustedImage = false;
          if (type === "image") {
            try {
              isTrustedImage = isCdnMediaHost(new URL(target).hostname);
            } catch {
              isTrustedImage = false;
            }
          }
          if (
            (type === "image" && !isTrustedImage) ||
            type === "font" ||
            type === "stylesheet" ||
            /googletagmanager|google-analytics|facebook\.net\/tr|connect\.facebook/i.test(target)
          ) {
            intercepted.abort().catch(() => {});
          } else {
            intercepted.continue().catch(() => {});
          }
        } catch {
          try {
            intercepted.continue().catch(() => {});
          } catch {
            /* page already closed */
          }
        }
      });

      // Intercept responses to capture API data with media URLs.
      // Use a broad content check: Instagram serves media data from many
      // different API endpoints (GraphQL, web API, feed, etc.) so we must
      // check ALL JSON responses for media-related keywords.
      const interceptedMedia: ExtractedMedia[] = [];
      let interceptedMediaRequestCount = 0;
      let capturedCdnMediaUrlCount = 0;
      // Pagination state for sidecar children: when an intercepted API page
      // reports has_next_page, the cursor is followed after the browser pass.
      // Stored on a const container because TS control-flow ignores writes
      // made inside the response callback when narrowing a plain `let`.
      const sidecarState: { page: { url: string; endCursor: string } | null } = { page: null };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      page.on("response", async (res: any) => {
        try {
          const resUrl = res.url();
          const resContentType = res.headers()["content-type"] || "";

          if (resContentType.includes("json")) {
            try {
              const text = await res.text();
              if (
                text.includes("video_url") ||
                text.includes("display_url") ||
                text.includes("image_versions") ||
                text.includes("playback_url") ||
                text.includes("edge_sidecar_to_children") ||
                text.includes("carousel_media")
              ) {
                const media = extractMediaFromJson(text);
                for (const item of media) {
                  const exists = interceptedMedia.some((m) => m.url === item.url);
                  if (!exists) interceptedMedia.push(item);
                }
                // Structured pass: complete ordered children with real
                // per-slide dimensions plus pagination state.
                const sidecar = extractSidecarFromJson(text);
                for (const item of sidecar.items) {
                  const exists = interceptedMedia.some((m) => m.url === item.url);
                  if (!exists) {
                    interceptedMedia.push(item);
                  } else if (item.width && item.height) {
                    // Upgrade the regex-found entry with real dimensions.
                    const prev = interceptedMedia.find((m) => m.url === item.url);
                    if (prev && (!prev.width || !prev.height)) {
                      prev.width = item.width;
                      prev.height = item.height;
                    }
                  }
                }
                if (sidecar.hasMore && sidecar.endCursor) {
                  sidecarState.page = { url: resUrl, endCursor: sidecar.endCursor };
                }
                logger.debug("Intercepted media from API", {
                  url: resUrl.slice(0, 100),
                  count: media.length,
                });
              }
            } catch {
              // Response body may not be available
            }
          }

          // Media-delivery diagnostics (dev only via logger.debug): surface
          // any response that looks like actual video bytes being delivered.
          // Hostname only — never query strings or tokens.
          try {
            const req = typeof res.request === "function" ? res.request() : null;
            const resourceType =
              req && typeof req.resourceType === "function" ? req.resourceType() : "unknown";
            const ctLower = resContentType.toLowerCase();
            const statusCode = typeof res.status === "function" ? res.status() : -1;
            const looksLikeMedia =
              resourceType === "media" ||
              ctLower.startsWith("video/") ||
              (ctLower.includes("octet-stream") && /fbcdn|cdninstagram|scontent/i.test(resUrl));
            if (looksLikeMedia) {
              let host: string | null = null;
              try {
                host = new URL(resUrl).hostname;
              } catch {
                host = null;
              }
              logger.debug("[Downloadit Puppeteer Media Debug] media response", {
                host,
                resourceType,
                status: statusCode,
                contentType: resContentType.slice(0, 80),
              });
              if (isTrustedCdnUrl(resUrl) && !interceptedMedia.some((m) => m.url === resUrl)) {
                capturedCdnMediaUrlCount++;
                interceptedMedia.push({
                  url: resUrl,
                  type: ctLower.startsWith("video/") || resourceType === "media" ? "video" : "image",
                  width: null,
                  height: null,
                });
              }
            }
          } catch {
            /* diagnostics must never break interception */
          }
        } catch {
          // Ignore response processing errors
        }
      });

      const navStart = Date.now();
      try {
        // domcontentloaded instead of networkidle2: Instagram never goes idle
        // (analytics/background polling), so networkidle would burn the full
        // timeout on nearly every request.
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: NAVIGATION_TIMEOUT_MS,
        });
      } catch (err) {
        logger.warn("Puppeteer PAGE_NAVIGATION_INTERRUPTED", {
          error: err instanceof Error ? err.message : String(err),
          url,
        });
      }
      timings.navigationMs = Date.now() - navStart;
      onProgress?.(65, "Page loaded");

      // Wait only for the data we actually need (video tag, article, or
      // video meta) instead of a blind multi-second sleep.
      const waitStart = Date.now();
      await page
        .waitForFunction(
          `!!document.querySelector('video[src], img[src], article, meta[property="og:video"]')`,
          { timeout: DATA_WAIT_TIMEOUT_MS }
        )
        .catch(() => {});
      timings.dataWaitMs = Date.now() - waitStart;

      // Bounded settle window: if no media response was captured yet, allow
      // late network responses / late video elements a short extra window
      // instead of inspecting too early. Strictly bounded — never indefinite.
      if (interceptedMedia.length === 0) {
        const settleStart = Date.now();
        const SETTLE_BUDGET_MS = 2000;
        while (Date.now() - settleStart < SETTLE_BUDGET_MS) {
          const hasVideoEl = await page
            .evaluate(`!!document.querySelector("video")`)
            .catch(() => true);
          if (hasVideoEl || interceptedMedia.length > 0) break;
          await new Promise((r) => setTimeout(r, 250));
        }
        timings.settleMs = Date.now() - settleStart;
      }

      // Check page state
      const pageState = await page.evaluate(PAGE_STATE_FN).catch(() => ({
        title: "",
        hasUnavailableMessage: false,
        hasLoginWall: false,
        hasChallenge: false,
      }));

      if (pageState.hasLoginWall) {
        logger.warn("Instagram login wall detected", { url });
        if (this.detectContentType(url) === "STORY") {
          logger.warn("STORY_SOURCE_UNAVAILABLE", { url, reason: "authentication-required" });
          throw createError("STORY_SOURCE_UNAVAILABLE");
        }
        if (fetchMeta.ogImage) {
          return this.buildResultFromMetadata(url, fetchMeta);
        }
        throw createError("CONTENT_UNAVAILABLE");
      }

      if (pageState.hasChallenge) {
        logger.warn("Instagram challenge detected", { url });
        if (this.detectContentType(url) === "STORY") {
          logger.warn("STORY_SOURCE_UNAVAILABLE", { url, reason: "challenge-required" });
          throw createError("STORY_SOURCE_UNAVAILABLE");
        }
        if (fetchMeta.ogImage) {
          return this.buildResultFromMetadata(url, fetchMeta);
        }
        throw createError("CONTENT_UNAVAILABLE");
      }

      if (pageState.hasUnavailableMessage) {
        logger.info("Instagram reports content unavailable", {
          url,
          title: pageState.title,
        });
        if (this.detectContentType(url) === "STORY") {
          logger.warn("STORY_SOURCE_UNAVAILABLE", { url, reason: "instagram-reported-unavailable" });
          throw createError("STORY_SOURCE_UNAVAILABLE");
        }
        throw createError("CONTENT_NOT_FOUND");
      }

      // Try to get additional media from the rendered DOM
      let domResult: {
        videos: string[];
        images: string[];
        hasArticle: boolean;
        bodySnippet: string;
      } = { videos: [], images: [], hasArticle: false, bodySnippet: "" };
      try {
        domResult = await page.evaluate(FETCH_META_FN);
      } catch {
        // DOM extraction failed
      }

      // Carousel expansion: post slides beyond the first lazy-load as the
      // user advances, so a single DOM snapshot undercounts multi-image
      // posts. For /p/ URLs, click the carousel "Next" control (bounded:
      // max 10 advances, stop after 2 consecutive advances with no new
      // media) and accumulate every newly exposed image/video URL.
      if (url.includes("/p/")) {
        const seenDom = new Set<string>([...domResult.videos, ...domResult.images]);
        let quietClicks = 0;
        for (let step = 0; step < 10 && quietClicks < 2; step++) {
          let clicked = false;
          try {
            clicked = await page.evaluate(
              `(function(){` +
                `var btns=Array.from(document.querySelectorAll('button[aria-label="Next"]'));` +
                `if(!btns.length){btns=Array.from(document.querySelectorAll('button')).filter(function(b){return (b.getAttribute('aria-label')||'').toLowerCase().indexOf('next')!==-1;});}` +
                `for(var i=0;i<btns.length;i++){var r=btns[i].getBoundingClientRect();if(r.width>0&&r.height>0){btns[i].click();return true;}}` +
                `return false;` +
                `})()`
            );
          } catch {
            break;
          }
          if (!clicked) break;
          await new Promise((r) => setTimeout(r, 800));
          let more: { videos: string[]; images: string[] } | null = null;
          try {
            more = await page.evaluate(FETCH_META_FN);
          } catch {
            break;
          }
          if (!more) break;
          let grew = false;
          const videoSet = new Set(more.videos);
          for (const src of [...more.videos, ...more.images]) {
            if (!seenDom.has(src)) {
              seenDom.add(src);
              grew = true;
              if (videoSet.has(src)) {
                domResult.videos.push(src);
              } else {
                domResult.images.push(src);
              }
            }
          }
          if (grew) {
            quietClicks = 0;
          } else {
            quietClicks++;
          }
        }
        if (typeof timings === "object") {
          timings.carouselExpandSlides = seenDom.size;
        }
      }

      // Sidecar pagination: when the API exposed only the first page of
      // children, follow the cursor (bounded to extra pages, never a media
      // limit) so the COMPLETE collection is returned. If the provider
      // refuses, whatever was collected stands and the outcome is logged.
      const pagedMedia: ExtractedMedia[] = [];
      const pagination = sidecarState.page;
      if (pagination) {
        let cursor: string | null = pagination.endCursor;
        for (let p = 0; p < SIDECAR_MAX_EXTRA_PAGES && cursor; p++) {
          const next = await fetchSidecarPage(pagination.url, cursor);
          if (!next || next.items.length === 0) {
            logger.info("Sidecar pagination stopped", {
              page: p + 1,
              reason: next ? "empty-page" : "provider-blocked",
            });
            break;
          }
          const known = new Set([...interceptedMedia, ...pagedMedia].map((m) => m.url));
          let fresh = 0;
          for (const item of next.items) {
            if (!known.has(item.url)) {
              known.add(item.url);
              pagedMedia.push(item);
              fresh++;
            }
          }
          logger.info("Sidecar page merged", { page: p + 1, fresh, total: pagedMedia.length });
          cursor = next.hasMore ? next.endCursor : null;
        }
      }

      // Inspect actual <video> elements: currentSrc (not just the src
      // attribute) reveals blob:-based playback; poster is logged as a
      // boolean only. Hostnames only — never query strings or tokens.
      try {
        const videoDetails = (await page
          .evaluate(
            `Array.from(document.querySelectorAll("video")).slice(0, 5).map((v) => { var host = null; try { var u = new URL(v.currentSrc); host = u.protocol === "blob:" ? ("blob:" + u.hostname) : u.hostname; } catch (e) { host = null; } return { hasSrcAttr: !!v.getAttribute("src"), currentSrcHost: host, hasPoster: !!v.getAttribute("poster") }; })`
          )
          .catch(() => [])) as Array<{
          hasSrcAttr: boolean;
          currentSrcHost: string | null;
          hasPoster: boolean;
        }>;
        logger.debug("[Downloadit Puppeteer Media Debug] video elements", {
          count: videoDetails.length,
          details: videoDetails,
        });
      } catch {
        /* diagnostics must never break extraction */
      }

      // Also try to extract from rendered HTML
      let renderedHtmlMedia: ExtractedMedia[] = [];
      let renderedHtmlText = "";
      try {
        renderedHtmlText = await page.content();
        renderedHtmlMedia = extractMediaFromHtml(renderedHtmlText);
      } catch {
        // Page content not available
      }

      // Combine all sources
      const allMedia: ExtractedMedia[] = [];
      const seenUrls = new Set<string>();

      const addUnique = (item: ExtractedMedia) => {
        if (isStory && item.type === "image" && isLikelyProfileImageUrl(item.url)) return;
        if (!seenUrls.has(item.url)) {
          seenUrls.add(item.url);
          allMedia.push(item);
        }
      };

      for (const item of interceptedMedia) addUnique(item);
      for (const item of pagedMedia) addUnique(item);
      for (const item of renderedHtmlMedia) addUnique(item);

      for (const src of domResult.videos) {
        addUnique({ url: src, type: "video", width: null, height: null });
      }
      for (const src of domResult.images) {
        addUnique({ url: src, type: "image", width: null, height: null });
      }

      // Server-side metadata may already hold a trusted video URL (og:video
      // or embedded page JSON). Seed it first so video posts are covered
      // even when the browser pass finds nothing new.
      if (fetchMeta.ogVideo && !seenUrls.has(fetchMeta.ogVideo)) {
        addUnique({ url: fetchMeta.ogVideo, type: "video", width: null, height: null });
      }
      if (fetchMeta.ogImage && !seenUrls.has(fetchMeta.ogImage)) {
        if (!isStory || !isLikelyProfileImageUrl(fetchMeta.ogImage)) {
          addUnique({ url: fetchMeta.ogImage, type: "image", width: null, height: null });
        }
      }

      logger.debug("[Downloadit Puppeteer Media Debug] candidates", {
        intercepted: interceptedMedia.length,
        paged: pagedMedia.length,
        renderedHtml: renderedHtmlMedia.length,
        domVideos: domResult.videos.length,
        domImages: domResult.images.length,
        combined: allMedia.length,
        videoCandidates: allMedia.filter((m) => m.type === "video").length,
      });

      // Validate and filter
      const validMedia: MediaItem[] = [];
      for (const item of allMedia) {
        if (this.validateMediaUrl(item.url)) {
          validMedia.push({
            url: item.url,
            type: item.type,
            width: item.width,
            height: item.height,
            duration: null,
            thumbnail:
              item.type === "video"
                ? allMedia.find((m) => m.type === "image")?.url ||
                  fetchMeta.ogImage ||
                  null
                : null,
            format: item.type === "video" ? "mp4" : null,
          });
        }
      }

      if (validMedia.length === 0) {
        logger.error("Puppeteer NO_MEDIA_FOUND", {
          url,
          interceptedCount: interceptedMedia.length,
          interceptedMediaRequestCount,
          capturedCdnMediaUrlCount,
          domVideoCount: domResult.videos.length,
          domImageCount: domResult.images.length,
          renderedHtmlMediaCount: renderedHtmlMedia.length,
          renderedHtmlStoryMediaCount: renderedHtmlMedia.filter(
            (item) => !isStory || !isLikelyProfileImageUrl(item.url)
          ).length,
          domStoryMediaCount: isStory
            ? [...domResult.videos, ...domResult.images].filter(
                (item) => !isLikelyProfileImageUrl(item)
              ).length
            : domResult.videos.length + domResult.images.length,
          embeddedMediaCount: fetchMeta.embeddedMedia.length,
          pageStatus: fetchMeta.pageStatus,
          loginWall: fetchMeta.loginWall,
          challenge: fetchMeta.hasChallenge,
          duration: Date.now() - startTime,
        });
        // A Reel/TV page with no discoverable video must NEVER degrade into
        // a fake photo result — surface an honest diagnostic error instead.
        const noVideoKind = this.detectContentType(url);
        if (noVideoKind === "AUDIO") {
          // Audio pages often link the clips using the sound instead of
          // embedding a playable video: try those before giving up.
          const clip = await this.tryResolveAudioClip(url, renderedHtmlText, fetchMeta);
          if (clip) {
            onProgress?.(85, "Audio source found");
            return clip;
          }
          throw createError("AUDIO_NO_SOURCE");
        }
        if (noVideoKind === "REEL" || noVideoKind === "VIDEO") {
          throw createError("VIDEO_SOURCE_NOT_FOUND");
        }
        if (noVideoKind === "STORY") {
          logger.warn("STORY_SOURCE_UNAVAILABLE", {
            url,
            reason: pageState.hasLoginWall
              ? "authentication-required"
              : pageState.hasChallenge
                ? "challenge-required"
                : fetchMeta.pageStatus !== 200
                  ? `instagram-page-status-${fetchMeta.pageStatus ?? "unknown"}`
                  : "no-public-media-exposed",
            interceptedMediaRequestCount,
            capturedCdnMediaUrlCount,
            renderedHtmlMediaCount: renderedHtmlMedia.length,
            embeddedMediaCount: fetchMeta.embeddedMedia.length,
          });
          throw createError("STORY_SOURCE_UNAVAILABLE");
        }
        if (fetchMeta.ogImage) {
          return this.buildResultFromMetadata(url, fetchMeta);
        }
        throw createError("CONTENT_UNAVAILABLE");
      }

      const contentType = this.detectContentType(url);

      // An audio page whose media is only cover art (no playable video) must
      // never masquerade as a result: look for a linked clip first, then fail
      // honestly so the audio route never reports a confusing "no video".
      if (contentType === "AUDIO" && !validMedia.some((m) => m.type === "video")) {
        const clip = await this.tryResolveAudioClip(url, renderedHtmlText, fetchMeta);
        if (clip) {
          onProgress?.(85, "Audio source found");
          return clip;
        }
        throw createError("AUDIO_NO_SOURCE");
      }

      const orderedMedia = sortVideoFirst(validMedia, contentType);

      const author =
        fetchMeta.author ||
        extractAuthorFromUrl(url) ||
        extractAuthorFromHtml(JSON.stringify(domResult));

      const rawTitle =
        fetchMeta.title || extractDescriptionFromHtml(JSON.stringify(domResult)) || null;
      const title = rawTitle ? decodeHtmlEntities(rawTitle) : null;
      const decodedAuthor: Author | null = author
        ? {
            username: author.username,
            displayName: author.displayName
              ? decodeHtmlEntities(author.displayName)
              : null,
          }
        : null;

      const thumbnail =
        validMedia.find((m) => m.type === "image")?.url ||
        fetchMeta.ogImage ||
        null;

      logger.info("Puppeteer resolve SUCCESS", {
        contentType,
        discovered: allMedia.length,
        invalidSkipped: allMedia.length - validMedia.length,
        returned: validMedia.length,
        finalCount: orderedMedia.length,
        hasVideo: validMedia.some((m) => m.type === "video"),
        selectedType: orderedMedia[0]?.type ?? null,
        duration: Date.now() - startTime,
      });
      onProgress?.(85, "Media extracted");

      return {
        type: contentType,
        sourceUrl: url,
        thumbnail,
        title,
        author: decodedAuthor,
        media: orderedMedia,
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) throw error;

      logger.error("Puppeteer RESOLVER_FAILED", {
        error: error instanceof Error ? error.message : String(error),
        url,
        duration: Date.now() - startTime,
      });
      throw createError("PROVIDER_UNAVAILABLE");
    } finally {
      if (slotHeld) {
        slotHeld = false;
        this.releasePageSlot();
      }
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }

  /**
   * Audio-page recovery: `/reels/audio/<id>/` pages frequently contain no
   * playable video themselves but link clips using the sound. Scan the
   * rendered page for up to 2 linked reel/post shortcodes and probe each with
   * a cheap plain-HTTP metadata fetch (no extra browser work). Returns an
   * AUDIO result backed by the first clip with a trusted playable video, or
   * null when no accessible source exists. Never throws.
   */
  private async tryResolveAudioClip(
    url: string,
    renderedHtml: string,
    meta: { ogImage: string | null; title: string | null; description: string | null; author: Author | null }
  ): Promise<ResolverResult | null> {
    const codes: string[] = [];
    const seen = new Set<string>();
    try {
      const re = /\/(?:reel|reels|p)\/([A-Za-z0-9_-]{5,30})\/?/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(renderedHtml)) !== null && codes.length < 2) {
        const code = m[1];
        if (!seen.has(code) && code !== "audio") {
          seen.add(code);
          codes.push(code);
        }
      }
    } catch {
      return null;
    }

    for (const code of codes) {
      try {
        const clipMeta = await fetchMetadata(`https://www.instagram.com/reel/${code}/`);
        if (!clipMeta.ogVideo || clipMeta.loginWall) continue;
        const author = meta.author || clipMeta.author || extractAuthorFromUrl(url);
        const decodedAuthor: Author | null = author
          ? {
              username: author.username,
              displayName: author.displayName ? decodeHtmlEntities(author.displayName) : null,
            }
          : null;
        const rawTitle = meta.title || meta.description || clipMeta.title || clipMeta.description;
        logger.info("Puppeteer audio page resolved via linked clip", { code: code.slice(0, 12) });
        return {
          type: "AUDIO",
          sourceUrl: url,
          thumbnail: clipMeta.ogImage || meta.ogImage,
          title: rawTitle ? decodeHtmlEntities(rawTitle) : null,
          author: decodedAuthor,
          media: [
            {
              url: clipMeta.ogVideo,
              type: "video",
              width: null,
              height: null,
              duration: null,
              thumbnail: clipMeta.ogImage || meta.ogImage,
              format: "mp4",
            },
          ],
        };
      } catch {
        // Try the next candidate clip.
      }
    }
    return null;
  }

  private buildResultFromMetadata(
    url: string,
    meta: { ogImage: string | null; title: string | null; description: string | null; author: Author | null }
  ): ResolverResult {
    const contentType = this.detectContentType(url);
    if (contentType === "AUDIO") {
      // Cover art alone is not an audio result: the audio route could only
      // fail downstream with a confusing "no video" message. Fail honestly
      // here so callers get a clear audio error instead.
      throw createError("AUDIO_NO_SOURCE");
    }
    const author = meta.author || extractAuthorFromUrl(url);

    const decodedAuthor: Author | null = author
      ? {
          username: author.username,
          displayName: author.displayName
            ? decodeHtmlEntities(author.displayName)
            : null,
        }
      : null;
    const rawTitle = meta.title || meta.description;
    const title = rawTitle ? decodeHtmlEntities(rawTitle) : null;

    const media: MediaItem[] = [];
    if (meta.ogImage && this.validateMediaUrl(meta.ogImage)) {
      media.push({
        url: meta.ogImage,
        type: "image",
        width: null,
        height: null,
        duration: null,
        thumbnail: null,
        format: null,
      });
    }

    if (media.length === 0) {
      // Same honesty rule as the main path: never fake a photo for a Reel.
      const fallbackKind = this.detectContentType(url);
      if (fallbackKind === "REEL" || fallbackKind === "VIDEO") {
        throw createError("VIDEO_SOURCE_NOT_FOUND");
      }
      throw createError("CONTENT_UNAVAILABLE");
    }

    logger.info("Puppeteer resolve from metadata (no video)", {
      contentType,
      mediaCount: media.length,
    });

    return {
      type: contentType,
      sourceUrl: url,
      thumbnail: meta.ogImage,
      title,
      author: decodedAuthor,
      media,
    };
  }

  private detectContentType(url: string): InstagramContentType {
    if (url.includes("/reels/audio/")) return "AUDIO";
    if (url.includes("/reel/") || url.includes("/reels/")) return "REEL";
    if (url.includes("/stories/")) {
      if (url.includes("/highlights/")) return "HIGHLIGHT";
      return "STORY";
    }
    if (url.includes("/p/")) return "POST";
    if (url.includes("/tv/")) return "VIDEO";
    return "UNKNOWN";
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info("Puppeteer browser closed");
    }
  }
}
