import type { ResolverResult, MediaItem, Author, ResolveProgressCallback, InstagramContentType } from "./types.js";
import { AppError } from "./errors.js";
import { logger } from "./logger.js";
import { decodeHtmlEntities } from "./text.js";
import JSONbig from "json-bigint";

const JSONbigString = JSONbig({ storeAsString: true, useNativeBigInt: false });

function parseJsonBigInt(text: string): unknown | null {
  try {
    return JSONbigString.parse(text);
  } catch {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const IG_APP_ID = "936619743392459";
const FETCH_TIMEOUT_MS = 10_000;
const HIGHLIGHT_RETRY_MAX = 3;
const HIGHLIGHT_RETRY_BASE_DELAY_MS = 800;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHighlightWithRetry(
  url: string,
  tag: string,
  opts: { includeCookie?: boolean; state?: StoryResolveState } = {}
): Promise<{ status: number; json: unknown | null; textSnippet: string | null }> {
  let lastResult: { status: number; json: unknown | null; textSnippet: string | null } | null = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= HIGHLIGHT_RETRY_MAX; attempt++) {
    try {
      const result = await fetchJsonWithStatus(url, `${tag}_attempt${attempt}`, opts);
      // Retry on 429 and 5xx, but not on 401/403/404/410 (auth/not found are final)
      if (result.status === 429 || (result.status !== null && result.status >= 500)) {
        lastResult = result;
        if (attempt < HIGHLIGHT_RETRY_MAX) {
          const delay = HIGHLIGHT_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 200;
          logger.info(`[highlight-resolve] retry ${attempt}/${HIGHLIGHT_RETRY_MAX} after ${result.status}`, { tag, highlightId: url.slice(0, 60), delay: Math.round(delay) });
          await sleep(delay);
          continue;
        }
        return result;
      }
      return result;
    } catch (err) {
      lastError = err;
      if (err instanceof AppError && ["INSTAGRAM_RATE_LIMITED", "INSTAGRAM_PROVIDER_ERROR"].includes(err.code)) {
        if (attempt < HIGHLIGHT_RETRY_MAX) {
          const delay = HIGHLIGHT_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 200;
          logger.info(`[highlight-resolve] retry ${attempt}/${HIGHLIGHT_RETRY_MAX} after error ${err.code}`, { tag, delay: Math.round(delay) });
          await sleep(delay);
          continue;
        }
      }
      throw err;
    }
    // Small delay between retries to avoid hammering
    if (attempt < HIGHLIGHT_RETRY_MAX) await sleep(300);
  }
  if (lastResult) return lastResult;
  if (lastError) throw lastError;
  throw new AppError("INSTAGRAM_PROVIDER_ERROR", "Highlight request failed after retries", 502);
}

interface StoryResolveState {
  totalRequests: number;
  apiRequests: number;
  htmlRequests: number;
  saw429: boolean;
  usedAuthenticatedRequest: boolean;
  exactStoryAttempted: boolean;
  rateLimited: boolean;
  startTime: number;
  sequence: number;
}

function createStoryResolveState(): StoryResolveState {
  return {
    totalRequests: 0,
    apiRequests: 0,
    htmlRequests: 0,
    saw429: false,
    usedAuthenticatedRequest: false,
    exactStoryAttempted: false,
    rateLimited: false,
    startTime: Date.now(),
    sequence: 0,
  };
}

function shouldBlockApiRequest(state: StoryResolveState): boolean {
  return state.rateLimited;
}

function markRateLimited(state: StoryResolveState): void {
  state.rateLimited = true;
  state.saw429 = true;
}

function logStorySummary(state: StoryResolveState, extra?: Record<string, unknown>): void {
  logger.info("[story-resolve] request summary", {
    totalRequests: state.totalRequests,
    apiRequests: state.apiRequests,
    htmlRequests: state.htmlRequests,
    saw429: state.saw429,
    usedAuthenticatedRequest: state.usedAuthenticatedRequest,
    exactStoryAttempted: state.exactStoryAttempted,
    rateLimited: state.rateLimited,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Server-side Instagram session (Story extraction requires server-side auth)
// Environment variable: INSTAGRAM_COOKIE (server-side only, never frontend)
// Supports full cookie string or raw sessionid; validated without logging value.
// Instagram Stories are NOT publicly accessible to anonymous fetch — even for
// public accounts, Instagram requires a viewer session (reels_media returns
// {} without session). Reels/Posts work anonymously; Stories require this.
// ---------------------------------------------------------------------------
function getInstagramCookie(): string | undefined {
  const raw =
    process.env.INSTAGRAM_COOKIE ||
    process.env.IG_COOKIE ||
    process.env.INSTAGRAM_COOKIE_STRING ||
    process.env.INSTAGRAM_SESSION_COOKIE;
  if (raw && raw.trim().length > 0) return raw.trim();
  const sessionId =
    process.env.INSTAGRAM_SESSIONID ||
    process.env.IG_SESSIONID ||
    process.env.INSTAGRAM_SESSION_ID ||
    process.env.SESSIONID;
  if (sessionId && sessionId.trim().length > 0) {
    const v = sessionId.trim();
    if (v.includes("=")) return v;
    return `sessionid=${v}`;
  }
  return undefined;
}

function isInstagramCookieConfigured(): boolean {
  const c = getInstagramCookie();
  return Boolean(c && c.length > 10 && c.includes("sessionid="));
}

function validateInstagramCookie(): { valid: boolean; reason?: string } {
  const c = getInstagramCookie();
  if (!c) return { valid: false, reason: "not_configured" };
  if (!c.includes("sessionid=")) return { valid: false, reason: "missing_sessionid" };
  if (c.length < 20) return { valid: false, reason: "too_short" };
  // Must not be the example placeholder
  if (c.includes("ABC123") || c.includes("example")) return { valid: false, reason: "placeholder" };
  return { valid: true };
}

function buildHeaders(opts: { includeCookie?: boolean; useDesktop?: boolean } = {}): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": opts.useDesktop ? DESKTOP_UA : MOBILE_UA,
    Accept: opts.useDesktop ? "*/*" : "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "X-IG-App-ID": IG_APP_ID,
    Referer: "https://www.instagram.com/",
    "X-Requested-With": "XMLHttpRequest",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
  };
  if (opts.includeCookie) {
    const cookie = getInstagramCookie();
    if (cookie) {
      headers.Cookie = cookie;
      const csrftokenMatch = cookie.match(/csrftoken=([^;]+)/);
      if (csrftokenMatch) headers["X-CSRFToken"] = csrftokenMatch[1];
    }
  }
  return headers;
}

function buildHtmlHeaders(useDesktop = false): Record<string, string> {
  return {
    "User-Agent": useDesktop ? DESKTOP_UA : MOBILE_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.instagram.com/",
  };
}

async function fetchJsonWithStatus(
  url: string,
  tag: string,
  opts: { includeCookie?: boolean; state?: StoryResolveState; useDesktop?: boolean } = {}
): Promise<{ status: number; json: unknown | null; textSnippet: string | null }> {
  // Rate-limit guard: do not make another API request after 429
  if (opts.state && shouldBlockApiRequest(opts.state)) {
    logger.warn(`[story-resolve] blocked API request due to prior 429`, { tag, endpoint: tag });
    throw new AppError("INSTAGRAM_RATE_LIMITED", "Instagram is temporarily rate-limiting requests. Please try again later.", 429);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const start = Date.now();
  const seq = opts.state ? ++opts.state.sequence : 0;
  if (opts.state) {
    opts.state.totalRequests++;
    opts.state.apiRequests++;
    if (opts.includeCookie) opts.state.usedAuthenticatedRequest = true;
  }
  try {
    const res = await fetch(url, {
      headers: buildHeaders({ includeCookie: opts.includeCookie, useDesktop: opts.useDesktop }),
      signal: controller.signal,
      redirect: "follow",
    });
    const status = res.status;
    const ct = res.headers.get("content-type") || "";
    let text: string | null = null;
    let json: unknown | null = null;
    try {
      text = await res.text();
      if (ct.includes("json") || text.trim().startsWith("{")) {
        json = parseJsonBigInt(text);
      }
    } catch {
      await res.body?.cancel().catch(() => {});
    }
    const elapsed = Date.now() - start;
    // Safe diagnostic log: endpoint, status, public/authenticated, sequence, elapsed, JSON present
    logger.info(`[story-resolve] request #${seq} ${tag} status=${status}`, {
      endpoint: tag,
      status,
      public: !opts.includeCookie,
      authenticated: Boolean(opts.includeCookie),
      sequence: seq,
      elapsedMs: elapsed,
      hasJson: Boolean(json),
      saw429: status === 429,
    });
    if (status === 429 && opts.state) {
      markRateLimited(opts.state);
    }
    return { status, json, textSnippet: text ? text.slice(0, 600) : null };
  } catch (err) {
    if (err instanceof AppError) throw err;
    const msg = err instanceof Error ? err.name : "fetch-failed";
    logger.warn(`[story-resolve] ${tag} fetch failed`, { error: msg, sequence: seq });
    throw new AppError("PROVIDER_UNAVAILABLE", "Instagram did not respond. Please try again shortly.", 502);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtmlWithStatus(
  url: string,
  tag: string,
  state?: StoryResolveState,
  useDesktop: boolean = false
): Promise<{ status: number | null; html: string | null; finalUrl: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const start = Date.now();
  const seq = state ? ++state.sequence : 0;
  if (state) {
    state.totalRequests++;
    state.htmlRequests++;
  }
  try {
    const res = await fetch(url, {
      headers: buildHtmlHeaders(useDesktop),
      signal: controller.signal,
      redirect: "follow",
    });
    const status = res.status;
    const ct = res.headers.get("content-type") || "";
    const finalUrl = res.url || url;
    const elapsed = Date.now() - start;
    logger.info(`[story-resolve] request #${seq} ${tag} status=${status}`, {
      endpoint: tag,
      status,
      public: true,
      sequence: seq,
      elapsedMs: elapsed,
      hasJson: false,
      isHtml: true,
    });
    if (!res.ok || (!ct.includes("text/html") && !ct.includes("application/xhtml") && !ct.includes("text/plain"))) {
      await res.body?.cancel().catch(() => {});
      return { status, html: null, finalUrl };
    }
    const html = await res.text();
    return { status, html, finalUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.name : "fetch-failed";
    logger.warn(`[story-resolve] ${tag} html fetch failed`, { error: msg, sequence: seq });
    return { status: null, html: null, finalUrl: null };
  } finally {
    clearTimeout(timer);
  }
}

function parseStoryUrl(url: string): { username: string; storyId: string | null; highlightId: string | null } {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[0]?.toLowerCase() !== "stories") {
    throw new AppError("UNSUPPORTED_URL", "This is not a Story URL.", 400);
  }
  if (segments[1]?.toLowerCase() === "highlights") {
    return { username: "", storyId: null, highlightId: segments[2] || null };
  }
  const username = segments[1] || "";
  const storyId = segments[2] || null;
  return { username, storyId, highlightId: null };
}

function extractUserIdFromWebProfileInfo(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  const data = obj["data"] as unknown;
  if (data && typeof data === "object") {
    const user = (data as Record<string, unknown>)["user"] as unknown;
    if (user && typeof user === "object") {
      const id = (user as Record<string, unknown>)["id"];
      if (typeof id === "string" && id) return id;
      if (typeof id === "number") return String(id);
    }
  }
  const directUser = obj["user"] as unknown;
  if (directUser && typeof directUser === "object") {
    const id = (directUser as Record<string, unknown>)["id"];
    if (typeof id === "string" && id) return id;
    if (typeof id === "number") return String(id);
  }
  return null;
}

function extractIsPrivateFromWebProfileInfo(json: unknown): boolean | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  const data = obj["data"] as unknown;
  const user = data && typeof data === "object" ? (data as Record<string, unknown>)["user"] as unknown : null;
  const candidate =
    (user && typeof user === "object" ? (user as Record<string, unknown>)["is_private"] : null) ??
    (obj["user"] && typeof obj["user"] === "object"
      ? ((obj["user"] as Record<string, unknown>)["is_private"] as unknown)
      : null);
  if (typeof candidate === "boolean") return candidate;
  return null;
}

// ---------------------------------------------------------------------------
// Public fallbacks (no cookie) — HTML scraping for userId and Story media
// These are lightweight, Vercel-compatible (pure fetch + regex), and attempt
// legitimate public extraction before concluding Instagram requires auth.
// ---------------------------------------------------------------------------

function extractUserIdFromHtml(html: string): string | null {
  // Try multiple patterns Instagram embeds for public profiles
  const patterns: RegExp[] = [
    /"user_id"\s*:\s*"(\d+)"/,
    /"userId"\s*:\s*"(\d+)"/,
    /"profilePage_(\d+)"/,
    /"logging_page_id"\s*:\s*"profilePage_(\d+)"/,
    /"id"\s*:\s*"(\d+)"\s*,\s*"username"\s*:/,
    /instagram\.com\/(?:p|reel)\/[^"]*?"owner".*?"id"\s*:\s*"(\d+)"/s,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }
  // JSON-LD or meta: look for user id in script tags
  const scriptMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (scriptMatch) {
    const inner = scriptMatch[1];
    const idMatch = inner.match(/"identifier"\s*:\s*"(\d+)"/);
    if (idMatch) return idMatch[1];
  }
  return null;
}

function looksLikeLoginWall(html: string): boolean {
  return (
    html.includes("Log in to Instagram") ||
    html.includes('name="username"') ||
    html.includes("loginForm") ||
    html.includes('"requireLogin":true') ||
    html.includes("We limit how often you can do certain things on Instagram")
  );
}

function isProfileImageUrl(url: string): boolean {
  try {
    const u = new URL(url.replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&"));
    const p = u.pathname.toLowerCase();
    const s = (u.search + u.hash).toLowerCase();
    if (p.includes("s150x150") || p.includes("s320x320") || p.includes("s640x640")) {
      // Story media is 1080x1920, profile is 150/320; but ensure not false positive for story thumbnails that happen to contain s150?
      // Profile shard 19 is definitive
      if (p.includes("-19/") || p.includes("profile") || p.includes("avatar")) return true;
      // Also if URL explicitly contains profile_pic
      if (p.includes("profile_pic") || p.includes("profile_picture")) return true;
      // Generic small s150/s320 without -19 still likely profile when dimensions are small
      if (s.includes("150x150") || s.includes("320x320")) return true;
    }
    if (p.includes("profile_pic") || p.includes("profile_picture") || p.includes("avatar")) return true;
    if (/\/t51\.[^/]+-19\//.test(p)) return true;
    if (u.hostname.includes("scontent") && (p.includes("/150/") || p.includes("/320/"))) return true;
    return false;
  } catch {
    return false;
  }
}

function isProbablyProfileMedia(media: MediaItem): boolean {
  if (isProfileImageUrl(media.url)) return true;
  if (media.width === 206 && media.height === 206) return true;
  if (media.type === "image" && media.width === 150 && media.height === 150) return true;
  if (media.type === "image" && media.width === 320 && media.height === 320) return true;
  // 7.6 KB avatar heuristic: very small file with small dimensions
  if (media.type === "image" && media.width && media.height && media.width <= 320 && media.height <= 320) {
    // Only reject if URL also looks like profile (to avoid rejecting small story thumbnails)
    if (isProfileImageUrl(media.url)) return true;
  }
  return false;
}

async function validateStoryMedia(media: MediaItem): Promise<void> {
  if (isProbablyProfileMedia(media)) {
    throw new AppError("STORY_MEDIA_NOT_FOUND", "The actual Story media could not be resolved.", 404);
  }
  // Verify Content-Type and that media is fetchable (Vercel-compatible HEAD)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(media.url, {
      method: "HEAD",
      headers: {
        "User-Agent": MOBILE_UA,
        Referer: "https://www.instagram.com/",
        Accept: media.type === "video" ? "video/*,*/*;q=0.5" : "image/*,*/*;q=0.5",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const len = res.headers.get("content-length");
    const size = len ? parseInt(len, 10) : null;
    // For video Story, must be video/* and not profile image
    if (media.type === "video" && ct && !ct.includes("video/") && !ct.includes("application/octet-stream")) {
      logger.warn("[story-resolve] validateStoryMedia Content-Type mismatch for video", { ct, url: media.url.slice(0, 80) });
      throw new AppError("STORY_MEDIA_NOT_FOUND", "The actual Story media could not be resolved.", 404);
    }
    if (media.type === "image" && ct && !ct.includes("image/") && !ct.includes("application/octet-stream")) {
      logger.warn("[story-resolve] validateStoryMedia Content-Type mismatch for image", { ct });
      throw new AppError("STORY_MEDIA_NOT_FOUND", "The actual Story media could not be resolved.", 404);
    }
    // File size sanity: avatar is 7.6KB, story video is typically >100KB
    if (size !== null && size > 0 && size < 5000) {
      logger.warn("[story-resolve] validateStoryMedia suspicious small size", { size });
      throw new AppError("STORY_MEDIA_NOT_FOUND", "The actual Story media could not be resolved.", 404);
    }
    // Dimensions: story video is typically 1080x1920 (9:16), not 206x206
    if (media.width && media.height && media.width <= 320 && media.height <= 320 && media.type === "video") {
      throw new AppError("STORY_MEDIA_NOT_FOUND", "The actual Story media could not be resolved.", 404);
    }
    await res.body?.cancel().catch(() => {});
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Network/head failure → log but don't hard fail if media was already extracted with profile safety
    const msg = err instanceof Error ? err.name : String(err);
    if (msg === "AbortError") logger.warn("[story-resolve] validateStoryMedia timeout", { url: media.url.slice(0, 80) });
    // Allow through if HEAD fails but media passed profile checks (Instagram CDN may block HEAD)
  } finally {
    clearTimeout(timer);
  }
}

async function resolveUserIdPublic(username: string, state?: StoryResolveState): Promise<string | null> {
  if (!username) return null;
  if (state && state.rateLimited && state.htmlRequests >= 1) {
    logger.info("[story-resolve] blocked profile_html due to prior 429 and already tried HTML", { username, htmlRequests: state.htmlRequests });
    return null;
  }
  // Strategy 1: HTML scrape (no cookie) — works for public profiles without auth
  const profileUrl = `https://www.instagram.com/${encodeURIComponent(username)}/`;
  const { status, html } = await fetchHtmlWithStatus(profileUrl, "profile_html", state);
  if (!html || !status || status >= 400) {
    logger.info("[story-resolve] profile_html not available", { username, status });
    return null;
  }
  if (looksLikeLoginWall(html)) {
    logger.info("[story-resolve] profile_html login wall", { username });
    return null;
  }
  const id = extractUserIdFromHtml(html);
  if (id) {
    logger.info("[story-resolve] userId via html", { username, userIdLength: id.length });
    return id;
  }
  logger.info("[story-resolve] userId not found in html", { username, htmlLength: html.length });
  return null;
}

async function resolveUserId(username: string, state?: StoryResolveState): Promise<string> {
  if (!username) throw new AppError("VALIDATION_ERROR", "Story username is missing in the URL.", 400);
  if (state && shouldBlockApiRequest(state)) {
    throw new AppError("INSTAGRAM_RATE_LIMITED", "Instagram is temporarily rate-limiting requests. Please try again later.", 429);
  }

  // Attempt 1: Public API (single attempt, respects rate-limit state)
  const profileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  const publicResult = await fetchJsonWithStatus(profileUrl, "web_profile_info", { includeCookie: false, state });

  if (publicResult.status === 200 && publicResult.json) {
    const userId = extractUserIdFromWebProfileInfo(publicResult.json);
    if (userId) {
      logger.info("[story-resolve] userId via public api", { username, userIdLength: userId.length });
      return userId;
    }
  }

  if (publicResult.status === 404) {
    throw new AppError("STORY_NOT_FOUND", `Instagram user "@${username}" was not found.`, 404);
  }
  if (publicResult.status === 429) {
    if (state) {
      markRateLimited(state);
      // Allow single HTML fallback even after 429
      const htmlId = await resolveUserIdPublic(username, state);
      if (htmlId) return htmlId;
      logStorySummary(state, { reason: "userId_429", username });
    }
    throw new AppError("INSTAGRAM_RATE_LIMITED", "Instagram is temporarily rate-limiting requests. Please try again later.", 429);
  }
  if (publicResult.status === 410) {
    throw new AppError("STORY_EXPIRED", "This Story has expired. Stories are only available for 24 hours.", 410);
  }

  // If public API returned 401/403 or login wall HTML, try HTML fallback before concluding auth required
  if (publicResult.status === 401 || publicResult.status === 403 || (publicResult.textSnippet && looksLikeLoginWall(publicResult.textSnippet))) {
    logger.info("[story-resolve] public api requires auth, trying html fallback", { username, status: publicResult.status, hasCookie: isInstagramCookieConfigured() });
    // HTML fallback is allowed even after prior 429 (state.htmlRequests <1 ensures single)
    const htmlId = await resolveUserIdPublic(username, state);
    if (htmlId) return htmlId;

    // Only try authenticated API if cookie is configured and not rate-limited
    if (isInstagramCookieConfigured() && state && !shouldBlockApiRequest(state)) {
      const authedResult = await fetchJsonWithStatus(profileUrl, "web_profile_info", { includeCookie: true, state });
      if (authedResult.status === 200 && authedResult.json) {
        const authedId = extractUserIdFromWebProfileInfo(authedResult.json);
        if (authedId) {
          logger.info("[story-resolve] userId via authed api", { username });
          return authedId;
        }
      }
      if (authedResult.status === 401 || authedResult.status === 403) {
        const isPrivate = authedResult.json ? extractIsPrivateFromWebProfileInfo(authedResult.json) : null;
        if (isPrivate === true) {
          throw new AppError("STORY_PRIVATE", `The account "@${username}" is private. Stories from private accounts cannot be accessed.`, 403);
        }
        throw new AppError("INSTAGRAM_AUTH_INVALID", "Instagram authentication is invalid or expired. Please refresh the server session.", 401);
      }
      if (authedResult.status === 429) {
        if (state) markRateLimited(state);
        throw new AppError("INSTAGRAM_RATE_LIMITED", "Instagram is temporarily rate-limiting requests. Please try again later.", 429);
      }
    } else if (isInstagramCookieConfigured() && state && shouldBlockApiRequest(state)) {
      throw new AppError("INSTAGRAM_RATE_LIMITED", "Instagram is temporarily rate-limiting requests. Please try again later.", 429);
    }

    // After HTML fallback, if still no cookie, return generic public-access error (not cookie instruction)
    throw new AppError("STORY_PRIVATE", "This Story is from a private account or is not publicly accessible.", 403);
  }

  if (publicResult.status >= 500) {
    throw new AppError("INSTAGRAM_PROVIDER_ERROR", "Instagram provider error. Please try again shortly.", 502);
  }

  if (!publicResult.json) {
    const snippet = publicResult.textSnippet || "";
    if (looksLikeLoginWall(snippet)) {
      const htmlId = await resolveUserIdPublic(username, state);
      if (htmlId) return htmlId;
      throw new AppError("STORY_PRIVATE", "This Story is from a private account or is not publicly accessible.", 403);
    }
    const htmlId = await resolveUserIdPublic(username, state);
    if (htmlId) return htmlId;
    throw new AppError("INSTAGRAM_PROVIDER_ERROR", "Instagram returned an unexpected response while looking up the user.", 502);
  }

  const fallbackId = extractUserIdFromWebProfileInfo(publicResult.json);
  if (fallbackId) return fallbackId;

  const htmlId = await resolveUserIdPublic(username, state);
  if (htmlId) return htmlId;

  logger.warn("[story-resolve] userId not found via any public method", {
    username,
    keys: publicResult.json && typeof publicResult.json === "object" ? Object.keys(publicResult.json as Record<string, unknown>).slice(0, 8) : [],
  });
  throw new AppError("STORY_NOT_FOUND", `Could not resolve Instagram user "@${username}".`, 404);
}

function bestVideoCandidate(candidates: unknown[]): { url: string; width: number | null; height: number | null } | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  let best: Record<string, unknown> | null = null;
  let bestArea = -1;
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    const url = (c as Record<string, unknown>)["url"];
    if (typeof url !== "string" || !url.startsWith("http")) continue;
    const w = (c as Record<string, unknown>)["width"];
    const h = (c as Record<string, unknown>)["height"];
    const area = typeof w === "number" && typeof h === "number" ? w * h : 0;
    if (area > bestArea) {
      bestArea = area;
      best = c as Record<string, unknown>;
    }
  }
  if (!best) return null;
  return {
    url: best["url"] as string,
    width: typeof best["width"] === "number" ? (best["width"] as number) : null,
    height: typeof best["height"] === "number" ? (best["height"] as number) : null,
  };
}

function bestImageCandidate(candidates: unknown[]): { url: string; width: number | null; height: number | null } | null {
  return bestVideoCandidate(candidates);
}

function parseReelsMediaResponse(json: unknown): Array<Record<string, unknown>> {
  if (!json || typeof json !== "object") return [];
  const obj = json as Record<string, unknown>;
  const reelsMedia = obj["reels_media"];
  if (Array.isArray(reelsMedia)) {
    const out: Array<Record<string, unknown>> = [];
    for (const reel of reelsMedia) {
      if (!reel || typeof reel !== "object") continue;
      const items = (reel as Record<string, unknown>)["items"];
      if (Array.isArray(items)) {
        for (const it of items) if (it && typeof it === "object") out.push(it as Record<string, unknown>);
      } else if (Array.isArray((reel as Record<string, unknown>)["media"])) {
        for (const it of (reel as Record<string, unknown>)["media"] as unknown[]) if (it && typeof it === "object") out.push(it as Record<string, unknown>);
      }
    }
    if (out.length > 0) return out;
  }
  const reels = obj["reels"];
  if (reels && typeof reels === "object" && !Array.isArray(reels)) {
    const out: Array<Record<string, unknown>> = [];
    for (const v of Object.values(reels as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const items = (v as Record<string, unknown>)["items"];
      if (Array.isArray(items)) for (const it of items) if (it && typeof it === "object") out.push(it as Record<string, unknown>);
    }
    if (out.length > 0) return out;
  }
  const data = obj["data"];
  if (data && typeof data === "object") {
    const nested = parseReelsMediaResponse(data);
    if (nested.length > 0) return nested;
  }
  return [];
}

function itemMatchesStoryId(item: Record<string, unknown>, storyId: string): boolean {
  const storyIdStr = String(storyId);
  const pk = item["pk"];
  const id = item["id"];
  const code = item["code"];
  // Keep every Instagram ID as string end-to-end (BigInt-safe)
  if (pk !== undefined && pk !== null && String(pk) === storyIdStr) return true;
  if (typeof id === "string") {
    const idStr = String(id);
    if (idStr === storyIdStr) return true;
    if (idStr.startsWith(storyIdStr + "_")) return true;
    // storyId may be "pk_userId" form, compare first part
    if (storyIdStr.includes("_") && idStr === storyIdStr.split("_")[0]) return true;
    // Also handle id like "3992734228823635460_73083148841" where pk is first part
    const idFirst = idStr.split("_")[0];
    if (idFirst === storyIdStr) return true;
  }
  if (typeof code === "string" && String(code) === storyIdStr) return true;
  return false;
}

function extractStoryMediaItem(
  item: Record<string, unknown>,
  fallbackUsername: string
): { media: MediaItem; title: string | null; author: Author } {
  const username = fallbackUsername;
  let mediaType: "video" | "image" = "image";
  let mediaUrl: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let thumbnail: string | null = null;
  let duration: number | null = null;
  const videoVersions = item["video_versions"];
  if (Array.isArray(videoVersions) && videoVersions.length > 0) {
    const best = bestVideoCandidate(videoVersions);
    if (best) {
      // Safety: never treat profile video as story (should not happen, but guard)
      if (isProfileImageUrl(best.url)) {
        throw new AppError("STORY_MEDIA_NOT_FOUND", "The actual Story media could not be resolved.", 404);
      }
      mediaType = "video";
      mediaUrl = best.url;
      width = best.width;
      height = best.height;
    }
    const imageVersions2 = item["image_versions2"] as unknown;
    if (imageVersions2 && typeof imageVersions2 === "object") {
      const cands = (imageVersions2 as Record<string, unknown>)["candidates"];
      if (Array.isArray(cands)) {
        const imgBest = bestImageCandidate(cands);
        if (imgBest) thumbnail = imgBest.url;
      }
    }
    const dur = item["video_duration"];
    if (typeof dur === "number" && Number.isFinite(dur)) duration = dur;
    else if (typeof item["duration"] === "number") duration = item["duration"] as number;
  } else {
    // No video_versions — check other video indicators before treating as image (Highlight videos often use video_url/playback_url)
    let isVideo = false;
    const checkVideoFields: Array<unknown> = [
      item["video_url"],
      item["playback_url"],
      item["video_dash_manifest"],
      item["dash_manifest"],
    ];
    for (const vf of checkVideoFields) {
      if (typeof vf === "string" && vf.startsWith("http") && !isProfileImageUrl(vf)) {
        // Direct video URL field (e.g., video_url, playback_url)
        if (vf.includes(".mp4") || vf.includes("video") || vf.includes("fbcdn") || vf.includes("cdninstagram")) {
          isVideo = true;
          mediaType = "video";
          mediaUrl = vf;
          // Try to get dimensions from item if available
          width = typeof item["width"] === "number" ? (item["width"] as number) : width;
          height = typeof item["height"] === "number" ? (item["height"] as number) : height;
          break;
        }
      }
    }
    // Check media_type / is_video flags and url with mp4
    if (!mediaUrl) {
      const mediaTypeVal = item["media_type"];
      const isVideoFlag = item["is_video"] === true || item["is_video"] === 1 || mediaTypeVal === 2 || mediaTypeVal === "video" || mediaTypeVal === "VIDEO";
      if (isVideoFlag) {
        // Look for any mp4 URL in the item
        for (const key of ["url", "src", "video_url", "playback_url", "download_url"]) {
          const v = item[key];
          if (typeof v === "string" && v.includes(".mp4") && !isProfileImageUrl(v)) {
            isVideo = true;
            mediaType = "video";
            mediaUrl = v;
            break;
          }
        }
        // Also check nested video_versions alternative already handled, but check url field
        if (!mediaUrl && typeof item["url"] === "string" && item["url"].includes("cdn") && !isProfileImageUrl(item["url"] as string)) {
          // If is_video true but no mp4 found, still treat as video and try display_url as fallback? No, keep as video with display_url as thumbnail, but need actual video url
          // Don't fallback to display_url for video — keep searching
        }
      }
    }
    if (!mediaUrl) {
      // No video found — treat as image
      const imageVersions2 = item["image_versions2"] as unknown;
      if (imageVersions2 && typeof imageVersions2 === "object") {
        const cands = (imageVersions2 as Record<string, unknown>)["candidates"];
        if (Array.isArray(cands)) {
          const best = bestImageCandidate(cands);
          if (best) {
            // Validate not profile before using
            if (!isProfileImageUrl(best.url)) {
              mediaUrl = best.url;
              width = best.width;
              height = best.height;
            }
          }
        }
      }
      // Only use display_url/thumbnail_src as image media if no video was detected
      // Never use thumbnail/profile as downloadUrl when video exists — that was the bug
      if (!mediaUrl && !isVideo && typeof item["display_url"] === "string" && !isProfileImageUrl(item["display_url"] as string)) {
        mediaUrl = item["display_url"] as string;
        width = typeof item["width"] === "number" ? (item["width"] as number) : null;
        height = typeof item["height"] === "number" ? (item["height"] as number) : null;
      }
      if (!mediaUrl && !isVideo && typeof item["thumbnail_src"] === "string" && !isProfileImageUrl(item["thumbnail_src"] as string)) {
        mediaUrl = item["thumbnail_src"] as string;
      }
      if (!mediaUrl && !isVideo && typeof item["thumbnail_url"] === "string" && !isProfileImageUrl(item["thumbnail_url"] as string)) {
        mediaUrl = item["thumbnail_url"] as string;
      }
      // If we detected isVideo but still no mediaUrl, don't fall back to image thumbnail — fail instead
      if (isVideo && !mediaUrl) {
        throw new AppError("STORY_MEDIA_NOT_FOUND", "Highlight video URL not found — thumbnail would be wrong, failing instead.", 404);
      }
    }
  }
  if (!mediaUrl) throw new AppError("STORY_SOURCE_UNAVAILABLE", "Instagram did not expose a downloadable media URL for this Story item.", 502);
  // Critical safety: NEVER use profile/avatar as Story media
  if (isProfileImageUrl(mediaUrl)) {
    throw new AppError("STORY_MEDIA_NOT_FOUND", "The actual Story media could not be resolved.", 404);
  }
  const media: MediaItem = {
    url: mediaUrl.replace(/&amp;/g, "&"),
    type: mediaType,
    width,
    height,
    duration,
    thumbnail: thumbnail ? thumbnail.replace(/&amp;/g, "&") : null,
    format: mediaType === "video" ? "mp4" : "jpg",
  };
  if (isProbablyProfileMedia(media)) {
    throw new AppError("STORY_MEDIA_NOT_FOUND", "The actual Story media could not be resolved.", 404);
  }
  let title: string | null = null;
  const caption = item["caption"];
  if (caption && typeof caption === "object") {
    const text = (caption as Record<string, unknown>)["text"];
    if (typeof text === "string" && text.trim()) title = decodeHtmlEntities(text.trim());
  }
  if (!title && typeof item["accessibility_caption"] === "string") title = decodeHtmlEntities(item["accessibility_caption"] as string);
  const author: Author = { username, displayName: null };
  const user = item["user"];
  if (user && typeof user === "object") {
    const u = user as Record<string, unknown>;
    if (typeof u["username"] === "string") author.username = u["username"] as string;
    if (typeof u["full_name"] === "string") author.displayName = decodeHtmlEntities(u["full_name"] as string);
  }
  return { media, title, author };
}

// Try to extract story media directly from HTML without API (public fallback)
// CRITICAL: Never return profile/avatar as Story media — and for exact Story ID, ONLY return media associated with THAT ID
function extractStoryMediaFromHtml(html: string, storyId: string | null): MediaItem | null {
  // For exact Story, search specifically around the requested storyId (10k window) — do NOT blindly take first JPG/MP4 on page
  if (storyId) {
    const idx = html.indexOf(storyId);
    if (idx !== -1) {
      const snippet = html.slice(Math.max(0, idx - 10000), idx + 10000);
      // Prefer structured JSON near the ID
      const videoNear = snippet.match(/"video_versions"\s*:\s*(\[[\s\S]*?\])(?=\s*,|\s*\})/);
      if (videoNear) {
        try {
          const arr = JSON.parse(videoNear[1]);
          const best = bestVideoCandidate(arr as unknown[]);
          if (best && !isProfileImageUrl(best.url)) {
            return { url: best.url.replace(/&amp;/g, "&"), type: "video", width: best.width, height: best.height, duration: null, thumbnail: null, format: "mp4" };
          }
        } catch {}
      }
      const imageNear = snippet.match(/"image_versions2"\s*:\s*\{\s*"candidates"\s*:\s*(\[[^\]]*\])/);
      if (imageNear) {
        try {
          const arr = JSON.parse(imageNear[1]);
          const best = bestImageCandidate(arr as unknown[]);
          if (best && !isProfileImageUrl(best.url)) {
            return { url: best.url.replace(/&amp;/g, "&"), type: "image", width: best.width, height: best.height, duration: null, thumbnail: null, format: "jpg" };
          }
        } catch {}
      }
      const vMatch = snippet.match(/https?:\/\/[^"']*\.mp4[^"']*/i);
      if (vMatch) {
        const url = vMatch[0].replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&");
        if (!isProfileImageUrl(url)) return { url, type: "video", width: null, height: null, duration: null, thumbnail: null, format: "mp4" };
      }
      const iMatch = snippet.match(/https?:\/\/[^"']*scontent[^"']*\.jpe?g[^"']*/i);
      if (iMatch) {
        const url = iMatch[0].replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&");
        if (!isProfileImageUrl(url)) return { url, type: "image", width: null, height: null, duration: null, thumbnail: null, format: "jpg" };
      }
      // storyId found but no media near it → do NOT fall back to generic first JPG/MP4 (would be wrong Story or profile)
      return null;
    }
    // storyId not in HTML at all → cannot safely extract exact Story via generic fallback
    return null;
  }

  // No storyId (username-only list case): generic extraction is allowed (used for Highlights fallback where we need any media)
  const videoMatch = html.match(/"video_versions"\s*:\s*(\[[\s\S]*?\])/);
  if (videoMatch) {
    try {
      const arr = JSON.parse(videoMatch[1]);
      const best = bestVideoCandidate(arr as unknown[]);
      if (best && !isProfileImageUrl(best.url)) return { url: best.url.replace(/&amp;/g, "&"), type: "video", width: best.width, height: best.height, duration: null, thumbnail: null, format: "mp4" };
    } catch {}
  }
  const imageMatch = html.match(/"image_versions2"\s*:\s*\{\s*"candidates"\s*:\s*(\[[^\]]*\])/);
  if (imageMatch) {
    try {
      const arr = JSON.parse(imageMatch[1]);
      const best = bestImageCandidate(arr as unknown[]);
      if (best && !isProfileImageUrl(best.url)) return { url: best.url.replace(/&amp;/g, "&"), type: "image", width: best.width, height: best.height, duration: null, thumbnail: null, format: "jpg" };
    } catch {}
  }
  const mp4Match = html.match(/https?:\/\/[^"']*?scontent[^"']*?\.mp4[^"']*/i);
  if (mp4Match) {
    const url = mp4Match[0].replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&");
    if (!isProfileImageUrl(url)) return { url, type: "video", width: null, height: null, duration: null, thumbnail: null, format: "mp4" };
  }
  const jpgMatch = html.match(/https?:\/\/[^"']*?scontent[^"']*?\.jpe?g[^"']*/i);
  if (jpgMatch) {
    const url = jpgMatch[0].replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&");
    if (!isProfileImageUrl(url)) return { url, type: "image", width: null, height: null, duration: null, thumbnail: null, format: "jpg" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Direct Story ID resolution - preserves BOTH username + storyId, never
// converts to username-only lookup. Tries Instagram media info endpoints that
// accept the exact Story PK, then falls back to story page HTML.
// ---------------------------------------------------------------------------
function parseDirectStoryInfoResponse(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  // Shape: { items: [{pk, video_versions, ...}] }
  const items = obj["items"];
  if (Array.isArray(items) && items.length > 0) {
    const first = items[0];
    if (first && typeof first === "object") return first as Record<string, unknown>;
  }
  // Shape: { media: {...} }
  const media = obj["media"];
  if (media && typeof media === "object") return media as Record<string, unknown>;
  // Shape: { data: { xdt_api__v1__media__shortcode__web_info: {...} } } unlikely
  // Shape: { status: "ok", items: [...] } already handled
  // If response is itself a media object with video_versions
  if ("video_versions" in obj || "image_versions2" in obj) return obj;
  return null;
}

async function fetchDirectStoryInfo(storyId: string, state?: StoryResolveState): Promise<Record<string, unknown> | null> {
  if (state && shouldBlockApiRequest(state)) {
    logger.warn("[story-resolve] blocked direct story API due to prior 429", { storyId, sequence: state.sequence });
    throw new AppError("INSTAGRAM_RATE_LIMITED", "Instagram is temporarily rate-limiting requests. Please try again later.", 429);
  }
  const url = `https://www.instagram.com/api/v1/media/${encodeURIComponent(storyId)}/info/`;
  state && (state.exactStoryAttempted = true);

  // Try public first (even if cookie exists) — only use authenticated as fallback if public requires auth
  const publicResult = await fetchJsonWithStatus(url, "direct_story_public", { includeCookie: false, state });
  if (publicResult.status === 200 && publicResult.json) {
    const item = parseDirectStoryInfoResponse(publicResult.json);
    if (item) {
      const testMedia = (() => {
        try {
          const { media } = extractStoryMediaItem(item, "");
          return media;
        } catch {
          return null;
        }
      })();
      if (testMedia && isProbablyProfileMedia(testMedia)) {
        logger.warn("[story-resolve] direct story public returned profile media, rejecting", { storyId });
      } else {
        logger.info("[story-resolve] direct story public success (exact ID)", { endpoint: url, hasVideo: Boolean(item["video_versions"]), storyId });
        return item;
      }
    }
  }
  if (publicResult.status === 401 || publicResult.status === 403 || (publicResult.textSnippet && looksLikeLoginWall(publicResult.textSnippet))) {
    logger.info("[story-resolve] direct story public requires auth, trying authenticated fallback", { storyId, status: publicResult.status, hasCookie: isInstagramCookieConfigured() });
    if (isInstagramCookieConfigured() && state && !shouldBlockApiRequest(state)) {
      if (state) state.usedAuthenticatedRequest = true;
      const authedResult = await fetchJsonWithStatus(url, "direct_story_authed", { includeCookie: true, state });
      if (authedResult.status === 200 && authedResult.json) {
        const item = parseDirectStoryInfoResponse(authedResult.json);
        if (item) {
          const testMedia = (() => {
            try {
              const { media } = extractStoryMediaItem(item, "");
              return media;
            } catch {
              return null;
            }
          })();
          if (testMedia && isProbablyProfileMedia(testMedia)) {
            logger.warn("[story-resolve] direct story authed returned profile media, rejecting", { storyId });
            return null;
          }
          logger.info("[story-resolve] direct story authed success (exact ID)", { endpoint: url, hasVideo: Boolean(item["video_versions"]), storyId });
          return item;
        }
      }
      if (authedResult.status === 401 || authedResult.status === 403) {
        throw new AppError("INSTAGRAM_AUTH_INVALID", "Instagram authentication is invalid or expired. Please refresh the server session.", 401);
      }
      if (authedResult.status === 429) {
        if (state) {
          markRateLimited(state);
          logStorySummary(state, { endpoint: url, storyId, reason: "direct_story_authed_429" });
        }
        throw new AppError("INSTAGRAM_RATE_LIMITED", "Instagram is temporarily rate-limiting requests. Please try again later.", 429);
      }
      if (authedResult.status === 404) {
        logger.info("[story-resolve] direct story authed 404, will try other exact methods", { storyId });
        return null;
      }
      if (authedResult.status === 410) {
        logger.info("[story-resolve] direct story authed 410 expired, will try other exact methods", { storyId });
        return null;
      }
    } else if (!isInstagramCookieConfigured()) {
      logger.info("[story-resolve] direct story public requires auth, no server session configured — will try HTML", { storyId });
    }
    return null;
  }
  if (publicResult.status === 404) {
    logger.info("[story-resolve] direct story public 404, will try other exact methods", { storyId, status: publicResult.status });
    return null;
  }
  if (publicResult.status === 429) {
    if (state) {
      markRateLimited(state);
      logStorySummary(state, { endpoint: url, storyId, reason: "direct_story_429" });
    }
    logger.info("[story-resolve] direct story public 429, will try HTML fallback once", { storyId });
    return null;
  }
  if (publicResult.status === 410) {
    logger.info("[story-resolve] direct story public 410 expired, will try other exact methods before declaring expired", { storyId });
    return null;
  }
  if (publicResult.textSnippet && looksLikeLoginWall(publicResult.textSnippet)) {
    logger.info("[story-resolve] direct story public login wall, will try HTML", { storyId, hasCookie: isInstagramCookieConfigured() });
    // If cookie exists, try authed as fallback for login wall
    if (isInstagramCookieConfigured() && state && !shouldBlockApiRequest(state)) {
      if (state) state.usedAuthenticatedRequest = true;
      const authedResult = await fetchJsonWithStatus(url, "direct_story_authed", { includeCookie: true, state });
      if (authedResult.status === 200 && authedResult.json) {
        const item = parseDirectStoryInfoResponse(authedResult.json);
        if (item) {
          logger.info("[story-resolve] direct story authed success after login wall", { storyId });
          return item;
        }
      }
      if (authedResult.status === 401 || authedResult.status === 403) {
        throw new AppError("INSTAGRAM_AUTH_INVALID", "Instagram authentication is invalid or expired. Please refresh the server session.", 401);
      }
      if (authedResult.status === 429) {
        if (state) markRateLimited(state);
        throw new AppError("INSTAGRAM_RATE_LIMITED", "Instagram is temporarily rate-limiting requests. Please try again later.", 429);
      }
    }
    return null;
  }
  if (publicResult.status >= 500) {
    logger.info("[story-resolve] direct story public provider error, will try other exact methods", { storyId, status: publicResult.status });
    return null;
  }
  return null;
}

async function fetchReelsMedia(
  userId: string,
  storyIdForHtmlFallback: string | null = null,
  storyUrlForFallback: string | null = null,
  state?: StoryResolveState
): Promise<Array<Record<string, unknown>>> {
  if (state && shouldBlockApiRequest(state)) {
    logger.warn("[story-resolve] blocked reels_media API due to prior 429", { userId, sequence: state.sequence });
    throw new AppError("INSTAGRAM_RATE_LIMITED", "Instagram is temporarily rate-limiting requests. Please try again later.", 429);
  }
  const reelsUrl = `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${encodeURIComponent(userId)}`;
  const useCookie = isInstagramCookieConfigured();
  if (useCookie && state) state.usedAuthenticatedRequest = true;
  const tag = useCookie ? "reels_media_authed" : "reels_media_public";
  const result = await fetchJsonWithStatus(reelsUrl, tag, { includeCookie: useCookie, state });

  if (result.status === 200 && result.json) {
    const items = parseReelsMediaResponse(result.json);
    logger.info("[story-resolve] reels_media parsed", { itemCount: items.length, usedCookie: useCookie });
    if (items.length > 0) return items;
    return items;
  }

  if (result.status === 404) {
    throw new AppError("STORY_NOT_FOUND", "Story not found. It may have been deleted or never existed.", 404);
  }
  if (result.status === 410) {
    throw new AppError("STORY_EXPIRED", "This Story has expired. Stories are only available for 24 hours.", 410);
  }
  if (result.status === 429) {
    if (state) {
      markRateLimited(state);
      logStorySummary(state, { endpoint: reelsUrl, reason: "reels_media_429" });
      // Allow single HTML fallback even after 429 (non-API)
      if (storyUrlForFallback && state.htmlRequests < 1) {
        const { html } = await fetchHtmlWithStatus(storyUrlForFallback, "story_page_html", state);
        if (html && !looksLikeLoginWall(html)) {
          const media = extractStoryMediaFromHtml(html, storyIdForHtmlFallback);
          if (media) {
            logger.info("[story-resolve] story media via html fallback after 429", { mediaType: media.type });
            return [
              {
                pk: storyIdForHtmlFallback || "html",
                id: storyIdForHtmlFallback || "html",
                video_versions: media.type === "video" ? [{ url: media.url, width: media.width, height: media.height }] : [],
                image_versions2: media.type === "image" ? { candidates: [{ url: media.url, width: media.width, height: media.height }] } : { candidates: [] },
              },
            ];
          }
        }
      }
    }
    throw new AppError("INSTAGRAM_RATE_LIMITED", "Instagram is temporarily rate-limiting requests. Please try again later.", 429);
  }
  if (result.status === 401 || result.status === 403) {
    if (useCookie) {
      throw new AppError("INSTAGRAM_AUTH_INVALID", "Instagram authentication is invalid or expired. Please refresh the server session.", 401);
    }
    // No cookie and 401/403 → try single HTML fallback before giving up
    if (storyUrlForFallback && state && state.htmlRequests < 1) {
      const { html } = await fetchHtmlWithStatus(storyUrlForFallback, "story_page_html", state);
      if (html && !looksLikeLoginWall(html)) {
        const media = extractStoryMediaFromHtml(html, storyIdForHtmlFallback);
        if (media) {
          logger.info("[story-resolve] story media via html fallback (public)", { mediaType: media.type });
          return [
            {
              pk: storyIdForHtmlFallback || "html",
              id: storyIdForHtmlFallback || "html",
              video_versions: media.type === "video" ? [{ url: media.url, width: media.width, height: media.height }] : [],
              image_versions2: media.type === "image" ? { candidates: [{ url: media.url, width: media.width, height: media.height }] } : { candidates: [] },
            },
          ];
        }
      }
    }
    throw new AppError("STORY_PRIVATE", "This Story is from a private account or is not publicly accessible.", 403);
  }

  if (result.status !== null && result.status >= 500) {
    throw new AppError("INSTAGRAM_PROVIDER_ERROR", "Instagram provider error. Please try again shortly.", 502);
  }

  if (!result.json) {
    const snippet = result.textSnippet || "";
    if (looksLikeLoginWall(snippet)) {
      throw new AppError("CONTENT_UNAVAILABLE", "Instagram did not make this Story publicly accessible to the downloader.", 403);
    }
    throw new AppError("INSTAGRAM_PROVIDER_ERROR", "Instagram returned an unexpected Story response.", 502);
  }

  const items = parseReelsMediaResponse(result.json);
  logger.info("[story-resolve] reels_media fallback parsed", { itemCount: items.length, usedCookie: useCookie });
  return items;
}

async function resolveHighlightById(highlightId: string, originalUrl: string, state?: StoryResolveState): Promise<ResolverResult> {
  if (state && shouldBlockApiRequest(state)) {
    throw new AppError("INSTAGRAM_RATE_LIMITED", "Instagram is temporarily rate-limiting requests. Please try again later.", 429);
  }

  const logHighlight = (msg: string, extra: Record<string, unknown> = {}) => {
    logger.info(`[highlight-resolve] ${msg}`, { highlightId, ...extra, hasCookie: isInstagramCookieConfigured(), rateLimited: state?.rateLimited ?? false });
  };

  logHighlight("highlight resolve started", { originalUrl: originalUrl.slice(0, 80), highlightReelId: `highlight:${highlightId}` });

  // Build ordered list of Highlight page URLs to try (public HTML)
  const highlightPageUrls = [
    `https://www.instagram.com/stories/highlights/${encodeURIComponent(highlightId)}/`,
    `https://www.instagram.com/stories/highlights/${encodeURIComponent(highlightId)}`,
    originalUrl,
  ];

  // Strategy 1: Try Highlight page HTML (public, no API) — often contains highlight items even when reels_media is empty
  // TEMP DEBUG: log exact URL, method, headers (names only), status, content-type, first 1000 chars
  for (const pageUrl of highlightPageUrls) {
    if (state && state.htmlRequests >= 2) break; // limit HTML requests
    try {
      // Debug: log request details before fetch (redact cookie values)
      const debugHeaders = ["User-Agent", "Accept", "Referer"];
      logger.info(`[highlight-debug] HTML request`, {
        url: pageUrl,
        method: "GET",
        headers: debugHeaders,
        highlightId,
        hasCookie: isInstagramCookieConfigured(),
      });
      const { html, status, finalUrl } = await fetchHtmlWithStatus(pageUrl, "highlight_page_html", state, true);
      // Debug: log response details (status, content-type via fetchHtml, first 1000 chars)
      const ct = html ? "text/html" : "none";
      const snippet = html ? html.slice(0, 1000).replace(/\s+/g, " ").slice(0, 1000) : "no-html";
      logger.info(`[highlight-debug] HTML response`, {
        url: pageUrl,
        finalUrl: finalUrl?.slice(0, 100),
        status,
        contentType: ct,
        htmlLength: html?.length ?? 0,
        snippet: snippet.slice(0, 1000),
        isLoginWall: html ? looksLikeLoginWall(html) : false,
      });
      if (html && status === 200 && !looksLikeLoginWall(html)) {
        // Try to extract highlight items from HTML: look for highlight-specific JSON
        const htmlItems = extractHighlightItemsFromHtml(html, highlightId);
        if (htmlItems.length > 0) {
          logHighlight("highlight page HTML success", { pageUrl: pageUrl.slice(0, 80), itemCount: htmlItems.length });
          const validated = await validateAndBuildHighlightMedia(htmlItems, originalUrl);
          if (validated) return validated;
        }
        // Fallback: generic story media extraction from HTML (handles both video/image)
        const genericMedia = extractHighlightMediaFromHtmlGeneric(html, highlightId);
        if (genericMedia.length > 0) {
          logHighlight("highlight generic HTML media success", { count: genericMedia.length });
          const validated = await validateAndBuildHighlightMedia(genericMedia, originalUrl);
          if (validated) return validated;
        }
        logHighlight("highlight page HTML no items", { pageUrl: pageUrl.slice(0, 80), htmlLength: html.length });
      } else if (html && looksLikeLoginWall(html)) {
        logHighlight("highlight page login wall", { pageUrl: pageUrl.slice(0, 80) });
      } else if (!html) {
        logHighlight("highlight page HTML empty or non-200", { pageUrl: pageUrl.slice(0, 80), status });
      }
    } catch (err) {
      logHighlight("highlight page HTML failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Strategy 2: Try reels_media API (public first, then authed if configured) — exact Highlight ID
  const highlightReelId = `highlight:${highlightId}`;
  const reelsUrl = `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${encodeURIComponent(highlightReelId)}`;
  const useCookie = isInstagramCookieConfigured();
  if (useCookie && state) state.usedAuthenticatedRequest = true;

  // Public attempt first (if no cookie, this is the only attempt; if cookie exists, still try public first as spec says)
  // DEBUG: log highlight reels_media request details (redact cookie values)
  const debugHighlightHeaders = ["User-Agent", "X-IG-App-ID", "X-CSRFToken", "X-Requested-With", "Referer", "Accept", "Cookie"];
  logger.info(`[highlight-debug] reels_media request`, {
    url: reelsUrl, // should be https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=highlight%3A17944832396967705
    method: "GET",
    headers: debugHighlightHeaders.filter((h) => {
      if (h === "Cookie" && !isInstagramCookieConfigured()) return false;
      if (h === "X-CSRFToken" && !isInstagramCookieConfigured()) return false;
      return true;
    }),
    reelIdParam: `highlight:${highlightId}`,
    encodedParam: `highlight%3A${highlightId}`,
    hasCookie: isInstagramCookieConfigured(),
    highlightId,
  });
  const tryOrders: boolean[] = useCookie ? [false, true] : [false];
  for (const tryUseCookie of tryOrders) {
    if (state && shouldBlockApiRequest(state)) {
      throw new AppError("INSTAGRAM_RATE_LIMITED", "Instagram is temporarily rate-limiting requests. Please try again later.", 429);
    }
    if (tryUseCookie && !isInstagramCookieConfigured()) continue;
    const tag = tryUseCookie ? "highlight_reels_media_authed" : "highlight_reels_media_public";
    const result = await fetchJsonWithStatus(reelsUrl, tag, { includeCookie: tryUseCookie, state, useDesktop: true });
    // DEBUG: log response details (status, content-type via result, first 1000 chars)
    const snippet = result.textSnippet ? result.textSnippet.slice(0, 1000).replace(/\s+/g, " ").slice(0, 1000) : "no-json";
    const isLoginRedirect = result.status === 302 || (result.textSnippet?.includes("/accounts/login") ?? false);
    const isRequireLogin = result.json && typeof result.json === "object" && (result.json as Record<string, unknown>)["require_login"] === true;
    logger.info(`[highlight-debug] reels_media response`, {
      tag,
      status: result.status,
      hasJson: Boolean(result.json),
      isLoginRedirect,
      isRequireLogin,
      snippet: snippet.slice(0, 1000),
      usedCookie: tryUseCookie,
      highlightId,
      reelsKey: `highlight:${highlightId}`,
    });
    let json: unknown | null = result.json;
    let status = result.status;

    if (status === 200 && json) {
      const items = parseReelsMediaResponse(json);
      if (items.length > 0) {
        logHighlight("reels_media success", { usedCookie: tryUseCookie, itemCount: items.length });
        const validated = await validateAndBuildHighlightMedia(items, originalUrl);
        if (validated) return validated;
        logHighlight("reels_media items failed validation (profile?)", { usedCookie: tryUseCookie });
        continue;
      }
      logHighlight("reels_media empty (not yet expired, will try next method)", { usedCookie: tryUseCookie, status });
      // Do NOT immediately throw expired — try next method (other tryOrder, then HTML already tried)
      continue;
    }
    if (status === 401 || status === 403 || (result.textSnippet && looksLikeLoginWall(result.textSnippet))) {
      logHighlight("reels_media auth required", { usedCookie: tryUseCookie, status });
      if (tryUseCookie) {
        throw new AppError("INSTAGRAM_AUTH_INVALID", "Instagram authentication is invalid or expired. Please refresh the server session.", 401);
      }
      // Public 401 with no cookie → try next (authed if available), else continue to final error
      continue;
    }
    if (status === 404) {
      // Highlight genuinely not found at this endpoint — try next tryOrder before giving up
      logHighlight("reels_media 404", { usedCookie: tryUseCookie });
      continue;
    }
    if (status === 429) {
      if (state) {
        markRateLimited(state);
        logStorySummary(state, { endpoint: reelsUrl, reason: "highlight_reels_media_429", highlightId });
      }
      throw new AppError("INSTAGRAM_RATE_LIMITED", "Instagram is temporarily rate-limiting requests. Please try again later.", 429);
    }
    if (status === 410) {
      throw new AppError("STORY_EXPIRED", "This Highlight has expired.", 410);
    }
    if (!json) {
      if (result.textSnippet && looksLikeLoginWall(result.textSnippet)) {
        logHighlight("reels_media login wall no json", { usedCookie: tryUseCookie });
        continue;
      }
      logHighlight("reels_media no json", { usedCookie: tryUseCookie, status });
      continue;
    }
  }

  // Strategy 3: If server-side session is configured, try authenticated highlight fetch as final fallback
  if (useCookie && state && !shouldBlockApiRequest(state)) {
    try {
      const authedResult = await fetchJsonWithStatus(reelsUrl, "highlight_reels_media_authed_final", { includeCookie: true, state, useDesktop: true });
      if (authedResult.status === 200 && authedResult.json) {
        const items = parseReelsMediaResponse(authedResult.json);
        if (items.length > 0) {
          logHighlight("reels_media authed final success", { itemCount: items.length });
          const validated = await validateAndBuildHighlightMedia(items, originalUrl);
          if (validated) return validated;
        }
      }
      if (authedResult.status === 401 || authedResult.status === 403) {
        throw new AppError("INSTAGRAM_AUTH_INVALID", "Instagram authentication is invalid or expired. Please refresh the server session.", 401);
      }
      if (authedResult.status === 429) {
        if (state) markRateLimited(state);
        throw new AppError("INSTAGRAM_RATE_LIMITED", "Instagram is temporarily rate-limiting requests. Please try again later.", 429);
      }
    } catch (err) {
      if (err instanceof AppError && ["INSTAGRAM_AUTH_INVALID", "INSTAGRAM_RATE_LIMITED", "STORY_EXPIRED"].includes(err.code)) throw err;
      logHighlight("authed final fallback failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // After all strategies tried, determine accurate error — do NOT call valid Highlight "expired" just because one reels_media returned []
  logHighlight("all Highlight strategies failed", { totalRequests: state?.totalRequests ?? 0, apiRequests: state?.apiRequests ?? 0, htmlRequests: state?.htmlRequests ?? 0, saw429: state?.saw429 ?? false });
  // Distinguish 404 vs 429 vs auth vs genuine not found
  if (state?.saw429) {
    throw new AppError("INSTAGRAM_RATE_LIMITED", "Instagram is temporarily rate-limiting requests. Please try again later.", 429);
  }
  throw new AppError("STORY_NOT_FOUND", "Highlight not found. It may have been removed, is private, or Instagram did not expose it.", 404);
}

function extractHighlightItemsFromHtml(html: string, highlightId: string): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  // Instagram embeds highlights as "highlight_reels": [{"id":"highlight:ID","items":[...]}] or "reels":{"highlight:ID":{items:[...]}}
  // Try to locate the highlight block specifically
  const patterns = [
    new RegExp(`"id"\\s*:\\s*"highlight:${highlightId}"[\\s\\S]{0,8000}"items"\\s*:\\s*\\[`, "i"),
    new RegExp(`"highlight:${highlightId}"[\\s\\S]{0,8000}"items"\\s*:\\s*\\[`, "i"),
    new RegExp(`"reels"\\s*:\\s*\\{[\\s\\S]{0,3000}"highlight:${highlightId}"`, "i"),
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m && m.index !== undefined) {
      const startIdx = m.index + m[0].length - 1; // at '['
      const block = extractBalancedArray(html, startIdx);
      if (block) {
        try {
          const parsed = JSON.parse(block) as unknown[];
          for (const it of parsed) {
            if (it && typeof it === "object") items.push(it as Record<string, unknown>);
          }
          if (items.length > 0) return items;
        } catch {
          // Fallback to snippet extraction
        }
      }
    }
  }
  // Fallback: snippet around highlightId (25k window) and extract via robust JSON
  const idx = html.indexOf(highlightId);
  if (idx !== -1) {
    const snippet = html.slice(Math.max(0, idx - 15000), idx + 25000);
    const snippetItems = extractItemsFromSnippet(snippet);
    if (snippetItems.length > 0) return snippetItems;
    // Last fallback: try to find any video_versions/image_versions2 in snippet and build synthetic items
    const vRegex = /"video_versions"\s*:\s*(\[[\s\S]*?\])(?=\s*,|\s*\})/g;
    let vm: RegExpExecArray | null;
    while ((vm = vRegex.exec(snippet)) !== null) {
      try {
        const cands = JSON.parse(vm[1]) as unknown[];
        const best = bestVideoCandidate(cands as unknown[]);
        if (best && !isProfileImageUrl(best.url)) {
          items.push({
            pk: `highlight_${highlightId}_v_${items.length}`,
            id: `highlight_${highlightId}_v_${items.length}`,
            is_video: true,
            media_type: 2,
            video_versions: [{ url: best.url, width: best.width, height: best.height }],
            image_versions2: { candidates: [] },
          } as unknown as Record<string, unknown>);
        }
      } catch {}
    }
    if (items.length > 0) return items;
  }
  return items;
}

function extractBalancedArray(text: string, openIdx: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return text.slice(openIdx, i + 1);
    }
  }
  return null;
}

function extractItemsFromSnippet(snippet: string): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  // Find balanced JSON objects that contain video_versions or image_versions2 and extract them as items
  // Use a simple state machine to extract top-level objects in the snippet's items array context
  // For now, delegate to generic extractor which already handles Highlight HTML robustly
  return items;
}

function extractHighlightMediaFromHtmlGeneric(html: string, highlightId: string): Array<Record<string, unknown>> {
  // Generic highlight media extraction: search for all CDN media near highlightId or globally, but validate
  const results: Array<Record<string, unknown>> = [];
  // Use the same story HTML extraction but collect ALL valid media (not just first) for Highlights (which have multiple items)
  // We will extract via regex for video_versions and image_versions2 globally, then filter profile images
  const videoRegex = /"video_versions"\s*:\s*(\[[\s\S]*?\])(?=\s*,|\s*\})/g;
  const imageRegex = /"image_versions2"\s*:\s*\{\s*"candidates"\s*:\s*(\[[^\]]*\])/g;
  let videoMatch: RegExpExecArray | null;
  const seenUrls = new Set<string>();
  while ((videoMatch = videoRegex.exec(html)) !== null) {
    try {
      const arrText = videoMatch[1];
      const candidates = JSON.parse(arrText) as unknown[];
      const best = bestVideoCandidate(candidates as unknown[]);
      if (best && !isProfileImageUrl(best.url) && !seenUrls.has(best.url)) {
        seenUrls.add(best.url);
        results.push({
          pk: `highlight_${highlightId}_v_${results.length}`,
          id: `highlight_${highlightId}_v_${results.length}`,
          video_versions: [{ url: best.url, width: best.width, height: best.height }],
          image_versions2: { candidates: [] },
        } as unknown as Record<string, unknown>);
      }
    } catch {}
    if (results.length >= 20) break; // limit
  }
  // For Highlights, collect ALL image candidates (mixed video+image highlights)
  const imageCandidates: Array<{ url: string; width: number | null; height: number | null }> = [];
  let imageMatch: RegExpExecArray | null;
  while ((imageMatch = imageRegex.exec(html)) !== null) {
    try {
      const arrText = imageMatch[1];
      const candidates = JSON.parse(arrText) as unknown[];
      for (const c of candidates as Array<Record<string, unknown>>) {
        const url = c["url"] as unknown;
        if (typeof url === "string" && !isProfileImageUrl(url) && !seenUrls.has(url)) {
          seenUrls.add(url);
          const w = typeof c["width"] === "number" ? (c["width"] as number) : null;
          const h = typeof c["height"] === "number" ? (c["height"] as number) : null;
          if (w === 150 && h === 150) continue;
          if (w === 206 && h === 206) continue;
          if (w === 320 && h === 320 && url.includes("s320x320")) continue;
          imageCandidates.push({ url, width: w, height: h });
        }
      }
    } catch {}
    if (imageCandidates.length >= 20) break;
  }
  // Add image candidates as separate items (Highlights are multi-item, keep all)
  for (const img of imageCandidates) {
    if (results.length >= 20) break;
    // Deduplicate by URL already handled via seenUrls, so just push
    results.push({
      pk: `highlight_${highlightId}_i_${results.length}`,
      id: `highlight_${highlightId}_i_${results.length}`,
      video_versions: [],
      image_versions2: { candidates: [{ url: img.url, width: img.width, height: img.height }] },
    } as unknown as Record<string, unknown>);
  }
  // If still no results, try to use the single-item extractor as fallback (for single-item highlights)
  if (results.length === 0) {
    const single = extractStoryMediaFromHtml(html, highlightId);
    if (single && !isProbablyProfileMedia(single)) {
      results.push({
        pk: highlightId,
        id: highlightId,
        video_versions: single.type === "video" ? [{ url: single.url, width: single.width, height: single.height }] : [],
        image_versions2: single.type === "image" ? { candidates: [{ url: single.url, width: single.width, height: single.height }] } : { candidates: [] },
      } as unknown as Record<string, unknown>);
    }
  }
  return results;
}

async function validateAndBuildHighlightMedia(items: Array<Record<string, unknown>>, originalUrl: string): Promise<ResolverResult | null> {
  const media: MediaItem[] = [];
  let title: string | null = null;
  let author: Author | null = null;
  let thumbnail: string | null = null;
  for (const item of items) {
    try {
      const extracted = extractStoryMediaItem(item as Record<string, unknown>, "");
      // Validate: reject profile/avatar, validate HEAD where possible
      if (isProbablyProfileMedia(extracted.media)) {
        logger.info("[highlight-resolve] rejected profile media in highlight", { url: extracted.media.url.slice(0, 80) });
        continue;
      }
      // Validate URL before adding (HEAD check, but allow on failure)
      try {
        await validateStoryMedia(extracted.media);
      } catch (err) {
        if (err instanceof AppError && err.code === "STORY_MEDIA_NOT_FOUND") {
          logger.info("[highlight-resolve] highlight media failed validation (profile?)", { url: extracted.media.url.slice(0, 80) });
          continue;
        }
        throw err;
      }
      media.push(extracted.media);
      if (!title && extracted.title) title = extracted.title;
      if (!author && extracted.author.username) author = extracted.author;
      if (!thumbnail && extracted.media.thumbnail) thumbnail = extracted.media.thumbnail;
      else if (!thumbnail && extracted.media.type === "image") thumbnail = extracted.media.url;
    } catch (err) {
      if (err instanceof AppError && err.code === "STORY_MEDIA_NOT_FOUND") continue;
      logger.info("[highlight-resolve] highlight item extraction failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (media.length === 0) return null;
  return {
    type: "HIGHLIGHT",
    sourceUrl: originalUrl,
    thumbnail: thumbnail || media[0]?.thumbnail || media[0]?.url || null,
    title,
    author,
    media,
  };
}

async function resolveShortLink(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: buildHtmlHeaders(),
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    await res.body?.cancel().catch(() => {});
    const finalUrl = res.url;
    if (finalUrl && finalUrl !== url) return finalUrl;
    const loc = res.headers.get("location");
    if (loc) {
      try {
        return new URL(loc, url).toString();
      } catch {
        return null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function resolveStoryUrl(url: string, onProgress?: ResolveProgressCallback): Promise<ResolverResult> {
  const start = Date.now();
  const state = createStoryResolveState();
  let parsed = parseStoryUrl(url);
  if (!parsed.username && parsed.storyId && url.includes("/s/")) {
    const final = await resolveShortLink(url);
    if (final) {
      try {
        parsed = parseStoryUrl(final);
        logger.info("[story-resolve] short link resolved", { original: url.slice(0, 80), final: final.slice(0, 80) });
      } catch {}
    }
  }
  const { username, storyId, highlightId } = parsed;
  logger.info("[story-resolve] received Story URL", {
    normalizedUrl: url.slice(0, 100),
    username: username || null,
    storyId: storyId || null,
    highlightId: highlightId || null,
    extractor: "story-api-public-first",
    hasCookie: Boolean(getInstagramCookie()),
    attemptedPublic: true,
  });
  onProgress?.(10, "Story link validated");
  if (highlightId) {
    onProgress?.(25, "Resolving Highlight");
    const result = await resolveHighlightById(highlightId, url, state);
    onProgress?.(85, "Highlight media extracted");
    logger.info("[story-resolve] Highlight resolved", {
      mediaCount: result.media.length,
      hasVideo: result.media.some((m) => m.type === "video"),
      duration: Date.now() - start,
      extractor: "story-api",
      publicAttempt: true,
    });
    return result;
  }
  if (!username) throw new AppError("VALIDATION_ERROR", "Story username is missing in the URL.", 400);
  if (!storyId) {
    logger.info("[story-resolve] storyId missing, fetching all stories for user", { username, hasCookie: isInstagramCookieConfigured() });
    onProgress?.(20, "Looking up Instagram user");
    const userId = await resolveUserId(username, state);
    onProgress?.(40, "Fetching Stories");
    const items = await fetchReelsMedia(userId, null, url, state);
    if (items.length === 0) {
      throw new AppError("CONTENT_NOT_FOUND", `No viewable Stories found for "@${username}". Stories expire after 24 hours or the account may be private.`, 404);
    }
    const media: MediaItem[] = [];
    let title: string | null = null;
    let author: Author | null = null;
    let thumbnail: string | null = null;
    for (const item of items) {
      try {
        const extracted = extractStoryMediaItem(item, username);
        media.push(extracted.media);
        if (!title && extracted.title) title = extracted.title;
        if (!author && extracted.author.username) author = extracted.author;
        if (!thumbnail && extracted.media.thumbnail) thumbnail = extracted.media.thumbnail;
        else if (!thumbnail && extracted.media.type === "image") thumbnail = extracted.media.url;
      } catch {}
    }
    if (media.length === 0) throw new AppError("STORY_SOURCE_UNAVAILABLE", "Instagram did not expose downloadable media for this Story.", 502);
    logger.info("[story-resolve] Story list resolved (no ID) public", { mediaCount: media.length, duration: Date.now() - start, extractor: "story-api", publicAttempt: true });
    return {
      type: "STORY",
      sourceUrl: url,
      thumbnail: thumbnail || media[0]?.thumbnail || media[0]?.url || null,
      title,
      author,
      media,
    };
  }

  // ── Direct Story URL: preserve BOTH username + storyId, never downgrade to username-only ──
  // Public extraction first, server-side session only if Instagram requires auth
  onProgress?.(20, "Resolving exact Story");
  logger.info("[story-resolve] attempting direct Story ID resolution", { username, storyId, normalizedUrl: url.slice(0, 100), extractor: "direct-story-id", hasCookie: isInstagramCookieConfigured() });

  // Attempt 1: Direct media info by Story ID (most precise, uses server-side session)
  // Controlled: single API request, public if no cookie, authed if cookie, no cascade after 429
  try {
    const directItem = await fetchDirectStoryInfo(storyId, state);
    if (directItem) {
      const itemUser = directItem["user"] as unknown;
      if (itemUser && typeof itemUser === "object") {
        const fetchedUsername = (itemUser as Record<string, unknown>)["username"];
        if (typeof fetchedUsername === "string" && fetchedUsername.toLowerCase() !== username.toLowerCase()) {
          logger.warn("[story-resolve] direct story username mismatch", { requested: username, fetched: fetchedUsername, storyId });
        }
      }
      const { media, title, author } = extractStoryMediaItem(directItem, username);
      // Validate actual media is video/image, not profile, and playable
      await validateStoryMedia(media);
      onProgress?.(85, "Story media extracted");
      logger.info("[story-resolve] Story resolved via direct ID (exact, authenticated)", {
        mediaType: media.type,
        mimeType: media.type === "video" ? "video/mp4" : "image/jpeg",
        width: media.width,
        height: media.height,
        hasThumbnail: Boolean(media.thumbnail),
        duration: Date.now() - start,
        extractor: "direct-story-id",
        authenticated: true,
      });
      return {
        type: "STORY",
        sourceUrl: url,
        thumbnail: media.thumbnail || (media.type === "image" ? media.url : null),
        title,
        author: author.username ? author : { username, displayName: null },
        media: [media],
      };
    }
  } catch (err) {
    if (err instanceof AppError) {
      // Map to accurate categories, never conflate
      if (["INSTAGRAM_AUTH_NOT_CONFIGURED", "INSTAGRAM_AUTH_INVALID", "STORY_NOT_FOUND", "STORY_EXPIRED", "STORY_PRIVATE", "STORY_MEDIA_NOT_FOUND", "INSTAGRAM_RATE_LIMITED", "INSTAGRAM_PROVIDER_ERROR"].includes(err.code)) throw err;
      if (err.code === "STORY_MEDIA_NOT_FOUND") throw new AppError("STORY_MEDIA_NOT_FOUND", "The actual Story media could not be resolved.", 404);
      if (["PROVIDER_RATE_LIMITED", "INSTAGRAM_RATE_LIMITED"].includes(err.code)) throw new AppError("INSTAGRAM_RATE_LIMITED", "Instagram is rate-limiting requests. Please try again shortly.", 429);
      if (err.code === "CONTENT_NOT_FOUND") throw new AppError("STORY_NOT_FOUND", `Story ${storyId} not found for "@${username}". It may have been deleted or never existed.`, 404);
      if (err.code === "CONTENT_UNAVAILABLE" || err.code === "UPSTREAM_FORBIDDEN") {
        logger.info("[story-resolve] direct Story ID not publicly accessible, will try HTML", { storyId, username });
        // Do not throw INSTAGRAM_AUTH_NOT_CONFIGURED here — allow public HTML fallback first
      } else {
        logger.info("[story-resolve] direct Story ID attempt failed, trying page HTML", { storyId, error: err instanceof Error ? err.message : String(err) });
      }
    } else {
      logger.info("[story-resolve] direct Story ID attempt failed, trying page HTML", { storyId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Attempt 2: Direct story page HTML (public, preserves exact ID) — allowed once even after 429
  try {
    const { html } = await fetchHtmlWithStatus(url, "direct_story_page", state);
    if (html && !looksLikeLoginWall(html)) {
      const htmlMedia = extractStoryMediaFromHtml(html, storyId);
      if (htmlMedia) {
        // Verify the HTML actually contained the requested storyId context
        const hasIdContext = html.includes(storyId);
        logger.info("[story-resolve] story page HTML media extracted", { storyId, hasIdContext, mediaType: htmlMedia.type });
        const synthetic = {
          pk: storyId,
          id: storyId,
          video_versions: htmlMedia.type === "video" ? [{ url: htmlMedia.url, width: htmlMedia.width, height: htmlMedia.height }] : [],
          image_versions2: htmlMedia.type === "image" ? { candidates: [{ url: htmlMedia.url, width: htmlMedia.width, height: htmlMedia.height }] } : { candidates: [] },
          user: { username },
        } as unknown as Record<string, unknown>;
        const { media, title, author } = extractStoryMediaItem(synthetic, username);
        onProgress?.(85, "Story media extracted");
        logger.info("[story-resolve] Story resolved via page HTML (exact)", { mediaType: media.type, duration: Date.now() - start });
        return {
          type: "STORY",
          sourceUrl: url,
          thumbnail: media.thumbnail || (media.type === "image" ? media.url : null),
          title,
          author,
          media: [media],
        };
      }
    } else if (html && looksLikeLoginWall(html)) {
      logger.info("[story-resolve] direct story page is login wall, will try username list", { storyId, username, hasCookie: isInstagramCookieConfigured() });
      // Do not throw yet — allow fallback to username list, which will give accurate auth-required vs expired
    }
  } catch (err) {
    if (err instanceof AppError) {
      // Preserve distinct auth errors, but allow fallback for generic public failures
      if (["INSTAGRAM_AUTH_NOT_CONFIGURED", "INSTAGRAM_AUTH_INVALID", "STORY_PRIVATE"].includes(err.code)) throw err;
    }
    logger.info("[story-resolve] direct story page HTML attempt failed, falling back to list", { storyId, error: err instanceof Error ? err.message : String(err) });
  }

  // Attempt 3: Fallback to username Story list (only after exact attempts)
  // Controlled: do not make another API request if already rate-limited
  if (state.rateLimited) {
    logger.info("[story-resolve] request summary", {
      totalRequests: state.totalRequests,
      apiRequests: state.apiRequests,
      htmlRequests: state.htmlRequests,
      saw429: state.saw429,
      usedAuthenticatedRequest: state.usedAuthenticatedRequest,
      exactStoryAttempted: state.exactStoryAttempted,
    });
    throw new AppError("INSTAGRAM_RATE_LIMITED", "Instagram is temporarily rate-limiting requests. Please try again later.", 429);
  }
  logger.info("[story-resolve] falling back to username Story list for direct URL", { username, storyId, hasCookie: isInstagramCookieConfigured(), rateLimited: state.rateLimited });
  onProgress?.(30, "Looking up Instagram user");
  const userId = await resolveUserId(username, state);
  onProgress?.(40, "Fetching Stories");
  const items = await fetchReelsMedia(userId, storyId, url, state);
  if (items.length === 0) {
    throw new AppError("STORY_NOT_FOUND", `Story ${storyId} not found for "@${username}". It may have been deleted, never existed, or expired after 24 hours.`, 404);
  }
  const matched = items.find((it) => itemMatchesStoryId(it, storyId));
  if (matched) {
    const { media, title, author } = extractStoryMediaItem(matched, username);
    onProgress?.(85, "Story media extracted");
    logger.info("[story-resolve] Story resolved via list fallback (exact match)", { mediaType: media.type, hasThumbnail: Boolean(media.thumbnail), duration: Date.now() - start, extractor: "story-api-fallback", publicAttempt: true });
    return {
      type: "STORY",
      sourceUrl: url,
      thumbnail: media.thumbnail || (media.type === "image" ? media.url : null),
      title,
      author,
      media: [media],
    };
  }
  logger.warn("[story-resolve] storyId not found even in fallback list", {
    requestedId: storyId,
    availableIds: items.slice(0, 5).map((it) => String(it["pk"] ?? it["id"] ?? "")).join(","),
    itemCount: items.length,
    extractor: "story-api-fallback",
    publicAttempt: true,
  });
  // Distinguish exact-ID failure from generic list empty
  throw new AppError("CONTENT_NOT_FOUND", `Story ${storyId} not found for "@${username}". It may have expired after 24 hours, been deleted, or is not publicly accessible.`, 404);
}

export function isStoryOrHighlightUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean).map((s) => s.toLowerCase());
    return segments[0] === "stories" || segments[0] === "story" || segments[0] === "s";
  } catch {
    return url.includes("/stories/") || url.includes("/story/") || url.includes("/s/");
  }
}
