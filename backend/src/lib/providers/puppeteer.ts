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

const NAVIGATION_TIMEOUT_MS = 15_000;
const DATA_WAIT_TIMEOUT_MS = 5_000;
const MAX_CONCURRENT_PAGES = 3;
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

interface ExtractedMedia {
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

function extractMediaFromJson(text: string): ExtractedMedia[] {
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

async function fetchMetadata(url: string): Promise<{
  ogImage: string | null;
  ogVideo: string | null;
  title: string | null;
  description: string | null;
  author: Author | null;
  loginWall: boolean;
}> {
  const empty = {
    ogImage: null,
    ogVideo: null,
    title: null,
    description: null,
    author: extractAuthorFromUrl(url),
    loginWall: false,
  };
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": MOBILE_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || (!ct.includes("text/html") && !ct.includes("application/xhtml"))) {
      return empty;
    }
    const html = await res.text();

    // Instagram serves its login page (with ITS OWN og:image) to anonymous
    // requests for gated content. Never treat that as the post's media.
    if (
      html.includes('name="username"') ||
      html.includes("Log in to Instagram") ||
      html.includes("loginForm") ||
      html.includes('"requireLogin":true')
    ) {
      return { ...empty, loginWall: true };
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
    const rawVideo = ogVideoMatch ? unescapeInstagramString(ogVideoMatch[1]) : null;

    return {
      ogImage: rawImage && isTrustedCdnUrl(rawImage) ? rawImage : null,
      ogVideo: rawVideo && isTrustedCdnUrl(rawVideo) ? rawVideo : null,
      title: extractTitleFromHtml(html),
      description: extractDescriptionFromHtml(html),
      author: extractAuthorFromHtml(html) || extractAuthorFromUrl(url),
      loginWall: false,
    };
  } catch {
    return empty;
  }
}

export class PuppeteerProvider extends BaseProvider {
  readonly name = "puppeteer";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private browser: any = null;
  private launching: Promise<void> | null = null;
  private activePages = 0;
  private pageWaiters: Array<() => void> = [];

  private async ensureBrowser(): Promise<void> {
    if (this.browser) return;
    if (this.launching) {
      await this.launching;
      return;
    }

    this.launching = (async () => {
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

  /** Bounded page concurrency: fail fast instead of spawning unlimited pages. */
  private async acquirePageSlot(): Promise<boolean> {
    if (this.activePages < MAX_CONCURRENT_PAGES) {
      this.activePages++;
      return true;
    }
    const waited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 5_000);
      this.pageWaiters.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (waited) this.activePages++;
    return waited;
  }

  private releasePageSlot(): void {
    this.activePages = Math.max(0, this.activePages - 1);
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

      // Fast path: video pages usually expose og:video in plain HTML.
      // Skips Chromium entirely when the direct video URL is already known.
      const isVideoPage = url.includes("/reel/") || url.includes("/reels/") || url.includes("/tv/");
      if (isVideoPage && fetchMeta.ogVideo && !fetchMeta.loginWall) {
        const result = this.buildResultFromVideo(url, fetchMeta.ogVideo, fetchMeta);
        timings.totalMs = Date.now() - startTime;
        logger.info("[resolve] fast path complete", { ...timings, mediaCount: 1 });
        return result;
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
        if (fetchMeta.ogImage) {
          return this.buildResultFromMetadata(url, fetchMeta);
        }
        throw createError("PROVIDER_UNAVAILABLE");
      }
      timings.browserMs = Date.now() - browserStart;
      onProgress?.(50, "Browser ready");

      if (!this.browser) {
        if (fetchMeta.ogImage) {
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

      // Block heavy resources we never need: extraction reads media URLs
      // from markup and JSON payloads, never from downloaded bytes.
      // Scripts/XHR/fetch stay enabled — API JSON interception depends on them.
      await page.setRequestInterception(true).catch(() => {});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      page.on("request", (intercepted: any) => {
        try {
          const type = intercepted.resourceType();
          const target = intercepted.url();
          if (
            type === "image" ||
            type === "media" ||
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
                text.includes("playback_url")
              ) {
                const media = extractMediaFromJson(text);
                for (const item of media) {
                  const exists = interceptedMedia.some((m) => m.url === item.url);
                  if (!exists) interceptedMedia.push(item);
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
          `!!document.querySelector('video[src], article, meta[property="og:video"]')`,
          { timeout: DATA_WAIT_TIMEOUT_MS }
        )
        .catch(() => {});
      timings.dataWaitMs = Date.now() - waitStart;

      // Check page state
      const pageState = await page.evaluate(PAGE_STATE_FN).catch(() => ({
        title: "",
        hasUnavailableMessage: false,
        hasLoginWall: false,
        hasChallenge: false,
      }));

      if (pageState.hasLoginWall) {
        logger.warn("Instagram login wall detected", { url });
        if (fetchMeta.ogImage) {
          return this.buildResultFromMetadata(url, fetchMeta);
        }
        throw createError("CONTENT_UNAVAILABLE");
      }

      if (pageState.hasChallenge) {
        logger.warn("Instagram challenge detected", { url });
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

      // Also try to extract from rendered HTML
      let renderedHtmlMedia: ExtractedMedia[] = [];
      try {
        const renderedHtml = await page.content();
        renderedHtmlMedia = extractMediaFromHtml(renderedHtml);
      } catch {
        // Page content not available
      }

      // Combine all sources
      const allMedia: ExtractedMedia[] = [];
      const seenUrls = new Set<string>();

      const addUnique = (item: ExtractedMedia) => {
        if (!seenUrls.has(item.url)) {
          seenUrls.add(item.url);
          allMedia.push(item);
        }
      };

      for (const item of interceptedMedia) addUnique(item);
      for (const item of renderedHtmlMedia) addUnique(item);

      for (const src of domResult.videos) {
        addUnique({ url: src, type: "video", width: null, height: null });
      }
      for (const src of domResult.images) {
        addUnique({ url: src, type: "image", width: null, height: null });
      }

      if (fetchMeta.ogImage && !seenUrls.has(fetchMeta.ogImage)) {
        addUnique({ url: fetchMeta.ogImage, type: "image", width: null, height: null });
      }

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
        if (fetchMeta.ogImage) {
          return this.buildResultFromMetadata(url, fetchMeta);
        }

        logger.error("Puppeteer NO_MEDIA_FOUND", {
          url,
          interceptedCount: interceptedMedia.length,
          domVideoCount: domResult.videos.length,
          domImageCount: domResult.images.length,
          renderedHtmlMediaCount: renderedHtmlMedia.length,
          duration: Date.now() - startTime,
        });
        throw createError("CONTENT_UNAVAILABLE");
      }

      const contentType = this.detectContentType(url);

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
        mediaCount: validMedia.length,
        hasVideo: validMedia.some((m) => m.type === "video"),
        contentType,
        duration: Date.now() - startTime,
      });
      onProgress?.(85, "Media extracted");

      return {
        type: contentType,
        sourceUrl: url,
        thumbnail,
        title,
        author: decodedAuthor,
        media: validMedia,
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
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }

  private buildResultFromMetadata(
    url: string,
    meta: { ogImage: string | null; title: string | null; description: string | null; author: Author | null }
  ): ResolverResult {
    const contentType = this.detectContentType(url);
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
