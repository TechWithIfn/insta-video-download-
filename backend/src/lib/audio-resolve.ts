import type { ResolverResult, ResolveProgressCallback, Author, MediaItem } from "./types.js";
import { AppError } from "./errors.js";
import { logger } from "./logger.js";
import { extractAudioId } from "./validators/instagram-url.js";
import { fetchMetadata, fetchPageHtml } from "./providers/puppeteer.js";
import { resolveAudioViaProvider, isAudioProviderConfigured } from "./audio-provider.js";
import { decodeHtmlEntities } from "./text.js";

const MAX_CLIP_CANDIDATES = 3;

/** True only for dedicated audio-page URLs (`/reels/audio/<id>/`). */
export function isAudioPageUrl(url: string): boolean {
  return extractAudioId(url) !== null;
}

function extractClipCodes(html: string, limit: number): string[] {
  const codes: string[] = [];
  const seen = new Set<string>();
  try {
    const re = /\/(?:reel|reels|p)\/([A-Za-z0-9_-]{5,30})\/?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && codes.length < limit) {
      const code = m[1];
      if (!seen.has(code) && code !== "audio") {
        seen.add(code);
        codes.push(code);
      }
    }
  } catch {
    /* malformed HTML scan — no candidates */
  }
  return codes;
}

function extractSongName(html: string): string | null {
  try {
    const m =
      html.match(/"song_name"\s*:\s*"([^"]{1,200})"/) ||
      html.match(/"audio_title"\s*:\s*"([^"]{1,200})"/);
    return m ? decodeHtmlEntities(m[1]) : null;
  } catch {
    return null;
  }
}

function toAuthor(author: Author | null): Author | null {
  if (!author) return null;
  return {
    username: author.username,
    displayName: author.displayName ? decodeHtmlEntities(author.displayName) : null,
  };
}

function audioResult(
  url: string,
  videoUrl: string,
  meta: { ogImage: string | null; title: string | null; description: string | null; author: Author | null }
): ResolverResult {
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
  return {
    type: "AUDIO",
    sourceUrl: url,
    thumbnail: meta.ogImage,
    title: rawTitle ? decodeHtmlEntities(rawTitle) : null,
    author: toAuthor(meta.author),
    media,
  };
}

/**
 * Dedicated direct-audio lookup for `/reels/audio/<id>/` pages.
 *
 * This NEVER goes through the post/reel resolver: audio pages carry no
 * playable media of their own, so the flow is (1) read the page's own audio
 * metadata + direct video source when exposed, else (2) resolve up to N
 * linked clips via cheap plain-HTTP metadata fetches and use the first clip
 * with a trusted playable source as the extraction source. When Instagram
 * exposes nothing usable, a precise AUDIO_NO_SOURCE error names the actual
 * reason (login wall vs. no clips vs. clips blocked) instead of a generic
 * extraction failure. Never throws anything else.
 */
export async function resolveAudioPage(
  url: string,
  onProgress?: ResolveProgressCallback
): Promise<ResolverResult> {
  const audioId = extractAudioId(url);
  logger.info("[audio-resolve] start", { detectedType: "AUDIO", audioId });

  onProgress?.(25, "Starting resolution");

  // Configured audio API first: it receives the audioId and returns a
  // legitimate source when it supports the page. Precise provider errors
  // propagate untouched — never swallowed into page scraping.
  if (isAudioProviderConfigured()) {
    const via = await resolveAudioViaProvider(audioId ?? url, url);
    if (via) {
      onProgress?.(85, "Audio source found");
      return via;
    }
  } else {
    logger.info("[audio-resolve] audio provider not configured", { audioId });
  }

  const meta = await fetchMetadata(url);
  onProgress?.(45, "Audio page opened");

  // Direct source exposed on the page itself — fastest path, no more work.
  if (meta.ogVideo && !meta.loginWall) {
    logger.info("[audio-resolve] direct source", {
      audioId,
      audioSourceFound: true,
      videoSourceFound: true,
      mediaCount: 1,
      finalResult: "AUDIO",
    });
    onProgress?.(85, "Audio source found");
    return audioResult(url, meta.ogVideo, meta);
  }

  if (meta.loginWall) {
    logger.warn("[audio-resolve] login wall", { audioId, audioSourceFound: false });
    throw new AppError(
      "AUDIO_NO_SOURCE",
      "This Instagram audio page requires login and does not expose a downloadable audio source to anonymous requests.",
      502
    );
  }

  const html = await fetchPageHtml(url);
  const codes = html ? extractClipCodes(html, MAX_CLIP_CANDIDATES) : [];
  const songName = html ? extractSongName(html) : null;
  logger.info("[audio-resolve] clip candidates", {
    audioId,
    count: codes.length,
    songName: songName?.slice(0, 80) ?? null,
  });
  onProgress?.(60, codes.length > 0 ? "Checking linked clips" : "Audio page scanned");

  let failedItems = 0;
  for (const code of codes) {
    try {
      const clip = await fetchMetadata(`https://www.instagram.com/reel/${code}/`);
      if (clip.ogVideo && !clip.loginWall) {
        const title = meta.title || meta.description || songName || clip.title || clip.description;
        logger.info("[audio-resolve] clip source", {
          audioId,
          clip: code.slice(0, 16),
          audioSourceFound: true,
          videoSourceFound: true,
          failedItems,
          mediaCount: 1,
          finalResult: "AUDIO",
        });
        onProgress?.(85, "Audio source found");
        return audioResult(
          url,
          clip.ogVideo,
          {
            ogImage: clip.ogImage || meta.ogImage,
            title,
            description: null,
            author: meta.author || clip.author,
          }
        );
      }
      failedItems++;
    } catch {
      failedItems++;
    }
  }

  logger.warn("[audio-resolve] no source", { audioId, audioSourceFound: false, failedItems });
  if (codes.length === 0) {
    throw new AppError(
      "AUDIO_NO_SOURCE",
      "This Instagram audio page lists no accessible clips to anonymous requests, so there is no downloadable audio source. Instagram restricts direct audio access — try pasting a public Reel that uses this sound instead.",
      502
    );
  }
  throw new AppError(
    "AUDIO_NO_SOURCE",
    `This audio page links ${codes.length} clip(s), but none exposes a playable source to anonymous requests (${failedItems} unavailable). Instagram restricts direct audio access — try pasting one of those public Reels directly instead.`,
    502
  );
}
