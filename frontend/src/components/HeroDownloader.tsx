"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Download as DownloadIcon,
  Clipboard,
  Link as LinkIcon,
  AlertCircle,
  Play,
  Pause,
  Image as ImageIcon,
  Sparkles,
  X,
  Film,
  Clock,
  Star,
  Music,
} from "lucide-react";
import {
  startResolveStream,
  getStreamUrl,
  getDownloadUrl,
  getApiBase,
  type ResolveData,
  type ResolveStreamHandle,
} from "@/services/api";
import { useLanguage } from "@/i18n";
import type { Strings } from "@/i18n/types";

type UIState = "IDLE" | "PREPARING" | "SUCCESS" | "ERROR";

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
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
  let decoded = text;
  for (const [entity, char] of Object.entries(entities)) {
    decoded = decoded.split(entity).join(char);
  }
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16))
  );
  decoded = decoded.replace(/&#(\d+);/g, (_, dec) =>
    String.fromCodePoint(parseInt(dec, 10))
  );
  return decoded;
}

function getContentTypeLabel(type: string, badges: Strings["typeBadges"]): string {
  const labels: Record<string, string> = {
    REEL: badges.reel,
    POST: badges.post,
    CAROUSEL: badges.carousel,
    STORY: badges.story,
    HIGHLIGHT: badges.highlight,
    VIDEO: badges.video,
    PHOTO: badges.photo,
    UNKNOWN: badges.content,
  };
  return labels[type] || badges.content;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function sanitizeHandle(username: string | null | undefined): string {
  if (!username) return "snapsave";
  return username.replace(/[^a-zA-Z0-9._-]/g, "").replace(/^\.+|\.+$/g, "").slice(0, 60) || "snapsave";
}

const TABS = [
  { id: "reels", icon: Play },
  { id: "videos", icon: Film },
  { id: "photos", icon: ImageIcon },
  { id: "stories", icon: Clock },
  { id: "highlights", icon: Star },
  { id: "audio", icon: Music },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ─── Circular progress (REAL backend stages only) ────────────
// The value shown here comes exclusively from `progress` SSE events sent
// by the backend after each resolution stage actually completes. This
// component never advances itself on a timer.
const PROGRESS_RING_ID = "snapsave-progress-ring";

function CircularProgress({ value, label }: { value: number; label: string }) {
  const { t } = useLanguage();
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const R = 52;
  const C = 2 * Math.PI * R;
  const offset = C - (C * clamped) / 100;
  return (
    <div className="animate-fade-in-up mx-auto mt-10 max-w-[380px] px-4 sm:px-5">
      <div
        className="flex flex-col items-center rounded-[28px] px-6 py-8 text-center"
        style={{ background: "var(--card)", boxShadow: "0 20px 60px rgba(60,40,120,0.12)", border: "1px solid var(--border)" }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        aria-label={t.hero.analyzing}
      >
        <div className="relative h-[132px] w-[132px]">
          <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden="true">
            <defs>
              <linearGradient id={PROGRESS_RING_ID} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#7c4df5" />
                <stop offset="55%" stopColor="#ec5fa8" />
                <stop offset="100%" stopColor="#f58e5b" />
              </linearGradient>
            </defs>
            <circle cx="66" cy="66" r={R} fill="none" strokeWidth="11" style={{ stroke: "var(--border)" }} />
            <circle
              cx="66"
              cy="66"
              r={R}
              fill="none"
              stroke={`url(#${PROGRESS_RING_ID})`}
              strokeWidth="11"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={offset}
              transform="rotate(-90 66 66)"
              style={{ transition: "stroke-dashoffset 0.35s ease" }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[26px] font-extrabold tabular-nums text-fg">{clamped}%</span>
          </div>
        </div>
        <p className="mt-4 text-[14px] font-semibold text-fg">{label}</p>
      </div>
    </div>
  );
}

// ─── Video Player ─────────────────────────────────────────

function VideoPlayer({ src, poster, mediaType }: { src: string; poster?: string; mediaType?: string }) {
  const { t } = useLanguage();
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [mediaError, setMediaError] = useState(false);
  const retryCountRef = useRef(0);
  const [currentSrc, setCurrentSrc] = useState(src);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setCurrent(v.currentTime);
    const onMeta = () => setDuration(v.duration);
    const onEnd = () => { setPlaying(false); setCurrent(0); };
    const onError = () => {
      if (process.env.NODE_ENV === "development") {
        try {
          console.debug("[SnapSave Preview]", {
            mediaType: mediaType ?? "unknown",
            streamHost: new URL(currentSrc).hostname,
          });
        } catch {
          /* ignore logging failures */
        }
      }
      if (retryCountRef.current < 1) {
        retryCountRef.current++;
        const bust = currentSrc.includes("?") ? "&" : "?";
        setCurrentSrc(`${currentSrc}${bust}_retry=${Date.now()}`);
      } else {
        setMediaError(true);
      }
    };
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("ended", onEnd);
    v.addEventListener("error", onError);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("ended", onEnd);
      v.removeEventListener("error", onError);
    };
  }, [currentSrc, mediaType]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const handleSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const bar = progressRef.current;
      const v = videoRef.current;
      if (!bar || !v || !duration) return;
      const rect = bar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      v.currentTime = pct * duration;
    },
    [duration]
  );

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (mediaError) {
    return (
      <div className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-2 rounded-[20px] bg-black/5">
        <ImageIcon className="h-10 w-10" style={{ color: "var(--fg-subtle)", opacity: 0.4 }} />
        <p className="text-xs" style={{ color: "var(--fg-subtle)" }}>{t.result.previewUnavailable}</p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-[20px]" style={{ background: "#0a0a14" }}>
      <div className="relative w-full media-frame" style={{ aspectRatio: "9/16" }}>
        <video
          ref={videoRef}
          src={currentSrc}
          poster={poster || undefined}
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-contain"
        />

        {/* Play / Pause button */}
        <button
          type="button"
          onClick={togglePlay}
          className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full backdrop-blur-md transition-transform hover:scale-105 active:scale-95"
          style={{ background: "rgba(255,255,255,0.18)", border: "1.5px solid rgba(255,255,255,0.25)" }}
          aria-label={playing ? t.result.pauseVideo : t.result.playVideo}
        >
          {playing ? (
            <Pause className="h-6 w-6 text-white" fill="white" strokeWidth={0} />
          ) : (
            <Play className="ml-1 h-6 w-6 text-white" fill="white" strokeWidth={0} />
          )}
        </button>
      </div>

      {/* Progress bar */}
      <div className="px-4 pt-2 pb-3">
        <div
          ref={progressRef}
          onClick={handleSeek}
          className="group relative h-1.5 w-full cursor-pointer rounded-full"
          style={{ background: "rgba(255,255,255,0.15)" }}
          role="slider"
          aria-label={t.result.videoProgress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${progress}%`, background: "var(--brand-gradient)" }}
          />
          <div
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white opacity-0 transition-opacity group-hover:opacity-100"
            style={{ left: `${progress}%`, background: "var(--primary)" }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] font-medium tabular-nums text-white/60">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Audio Player ─────────────────────────────────────────

function AudioPlayer({ src }: { src: string }) {
  const { t } = useLanguage();
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setCurrent(a.currentTime);
    const onMeta = () => setDuration(a.duration);
    const onEnd = () => { setPlaying(false); setCurrent(0); };
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("ended", onEnd);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }, []);

  const handleSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const bar = progressRef.current;
      const a = audioRef.current;
      if (!bar || !a || !duration) return;
      const rect = bar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      a.currentTime = pct * duration;
    },
    [duration]
  );

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="overflow-hidden rounded-[20px]" style={{ background: "linear-gradient(145deg, #1a1028 0%, #0f0c1b 100%)" }}>
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />

      {/* Waveform + Play */}
      <div className="flex flex-col items-center justify-center gap-5 px-6 pt-8 pb-4">
        {/* Waveform bars */}
        <div className="flex items-end gap-[3px] h-16" aria-hidden="true">
          {Array.from({ length: 28 }).map((_, i) => {
            const baseHeight = 8 + Math.sin(i * 0.7) * 12 + Math.cos(i * 1.3) * 8;
            return (
              <div
                key={i}
                className="w-[3px] rounded-full waveform-bar"
                style={{
                  height: `${Math.max(4, baseHeight)}px`,
                  background: "var(--brand-gradient)",
                  opacity: 0.3,
                  animation: playing ? `wave-bounce 0.6s ease-in-out ${i * 0.04}s infinite alternate` : "none",
                }}
              />
            );
          })}
        </div>

        <button
          type="button"
          onClick={togglePlay}
          className="flex h-16 w-16 items-center justify-center rounded-full backdrop-blur-md transition-transform hover:scale-105 active:scale-95"
          style={{ background: "rgba(255,255,255,0.12)", border: "1.5px solid rgba(255,255,255,0.2)" }}
          aria-label={playing ? t.result.pauseAudio : t.result.playAudio}
        >
          {playing ? (
            <Pause className="h-6 w-6 text-white" fill="white" strokeWidth={0} />
          ) : (
            <Play className="ml-1 h-6 w-6 text-white" fill="white" strokeWidth={0} />
          )}
        </button>
      </div>

      {/* Progress */}
      <div className="px-4 pb-4">
        <div
          ref={progressRef}
          onClick={handleSeek}
          className="group relative h-1.5 w-full cursor-pointer rounded-full"
          style={{ background: "rgba(255,255,255,0.12)" }}
          role="slider"
          aria-label={t.result.audioProgress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${progress}%`, background: "var(--brand-gradient)" }}
          />
          <div
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white opacity-0 transition-opacity group-hover:opacity-100"
            style={{ left: `${progress}%`, background: "var(--primary)" }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] font-medium tabular-nums text-white/60">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Media Result ─────────────────────────────────────────

interface MediaResultProps {
  result: ResolveData;
  mode: "video" | "audio";
  onReset: () => void;
}

function MediaResult({ result, mode, onReset }: MediaResultProps) {
  const { t } = useLanguage();
  const [downloading, setDownloading] = useState<"idle" | "preparing" | "error">("idle");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(true);
  const [audioError, setAudioError] = useState<string | null>(null);
  // Image-preview retry state (video uses VideoPlayer's own retry).
  // MediaResult remounts per result (parent key), so these reset naturally.
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const imgRetriedRef = useRef(false);
  // Stable fallback message for the audio fetch below: reading it from a ref
  // keeps the fetch effect from re-running on language switches.
  const audioFallbackRef = useRef(t.result.audioErrorFallback);
  useEffect(() => {
    audioFallbackRef.current = t.result.audioErrorFallback;
  });

  const firstMedia = result.media[0];
  const isAudio = mode === "audio";

  // For audio mode: fetch the MP3 from the backend
  useEffect(() => {
    if (!isAudio) return;
    if (audioUrl || audioError) return;

    const controller = new AbortController();
    const API_BASE = getApiBase();
    const fallback = audioFallbackRef.current;

    fetch(`${API_BASE}/api/audio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: result.sourceUrl }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message || fallback);
        }
        const blob = await res.blob();
        setAudioUrl(URL.createObjectURL(blob));
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setAudioError(err.message || fallback);
        }
      })
      .finally(() => setAudioLoading(false));

    return () => controller.abort();
  }, [isAudio, result.sourceUrl, audioUrl, audioError]);

  const handleDownloadVideo = useCallback(() => {
    if (!firstMedia || downloading === "preparing") return;
    setDownloading("preparing");
    try {
      const safeHandle = sanitizeHandle(result.author?.username);
      const filename = `${safeHandle}-${firstMedia.type === "video" ? "video" : "photo"}.mp4`;
      const downloadUrl = getDownloadUrl(firstMedia.url, filename, result.sourceUrl);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.rel = "noopener";
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      setDownloading("error");
      return;
    }
    window.setTimeout(() => {
      setDownloading((s) => (s === "preparing" ? "idle" : s));
    }, 4000);
  }, [firstMedia, result.author, result.sourceUrl, downloading]);

  const handleDownloadAudio = useCallback(() => {
    if (!audioUrl) return;
    const safeHandle = sanitizeHandle(result.author?.username);
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = `${safeHandle}-audio.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [audioUrl, result.author?.username]);

  // Media stream URL through our proxy (source allows stale-URL recovery)
  const streamSrc = firstMedia ? getStreamUrl(firstMedia.url, result.sourceUrl) : "";

  const logPreviewDiag = useCallback(
    (mediaType: string | undefined) => {
      if (process.env.NODE_ENV !== "development") return;
      try {
        console.debug("[SnapSave Preview]", {
          mediaType: mediaType ?? "unknown",
          streamHost: new URL(streamSrc).hostname,
          hasSource: Boolean(result.sourceUrl),
        });
      } catch {
        /* ignore logging failures */
      }
    },
    [streamSrc, result.sourceUrl]
  );

  // Image preview: retry once with a cache-buster, then show the error state.
  // (The backend already retried with a freshly resolved URL when possible.)
  const handleImgError = useCallback(() => {
    logPreviewDiag(firstMedia?.type);
    if (!imgRetriedRef.current) {
      imgRetriedRef.current = true;
      const bust = streamSrc.includes("?") ? "&" : "?";
      setImgSrc(`${streamSrc}${bust}_retry=${Date.now()}`);
    } else {
      setImgFailed(true);
    }
  }, [firstMedia, streamSrc, logPreviewDiag]);

  return (
    <div className="animate-fade-in-up mx-auto mt-10 px-4 sm:px-5" style={{ width: "min(100%, 440px)", maxWidth: "calc(100vw - 24px)" }}>
      <div
        className="overflow-hidden rounded-[28px] p-4"
        style={{ background: "var(--card)", boxShadow: "0 20px 60px rgba(60,40,120,0.12)", border: "1px solid var(--border)" }}
      >
        {/* Top Row */}
        <div className="flex items-center justify-between px-1 pb-3">
          <span
            className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold text-white"
            style={{ background: isAudio ? "linear-gradient(135deg, #7c4df5, #ec5fa8)" : "var(--brand-gradient)" }}
          >
            {isAudio ? t.result.audio : getContentTypeLabel(result.type, t.typeBadges)}
          </span>
          {result.author && (
            <div className="flex items-center gap-2">
              <div className="h-[22px] w-[22px] rounded-full" style={{ background: "var(--brand-gradient)" }} />
              <span className="text-[14px] font-semibold text-fg">
                @{result.author.username}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={onReset}
            className="text-[13px] font-semibold text-fg-subtle transition-colors hover:text-fg"
          >
            <X className="inline h-3.5 w-3.5 mr-0.5" />
            {t.result.newBtn}
          </button>
        </div>

        {/* Caption (one block, max 2 lines) */}
        {result.title && (
          <div className="px-1 pb-3">
            <p className="text-[13px] leading-[1.5] text-fg-muted line-clamp-2">
              {decodeHtmlEntities(result.title)}
            </p>
          </div>
        )}

        {/* Media Player */}
        {isAudio ? (
          <>
            {audioLoading && (
              <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-[20px]" style={{ background: "linear-gradient(145deg, #1a1028 0%, #0f0c1b 100%)" }}>
                <svg className="h-8 w-8 animate-spin text-white/40" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" className="opacity-75" />
                </svg>
                <p className="text-xs text-white/50">{t.result.extractingAudio}</p>
              </div>
            )}
            {audioError && (
              <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-[20px] bg-danger-light">
                <AlertCircle className="h-8 w-8 text-danger" />
                <p className="text-xs text-danger text-center px-4">{audioError}</p>
              </div>
            )}
            {audioUrl && <AudioPlayer src={audioUrl} />}
          </>
        ) : !firstMedia ? null : firstMedia.type === "video" ? (
          <VideoPlayer
            key={firstMedia.url}
            src={streamSrc}
            poster={firstMedia.thumbnail || undefined}
            mediaType={firstMedia.type}
          />
        ) : imgFailed ? (
          <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-[20px] bg-black/5">
            <ImageIcon className="h-10 w-10" style={{ color: "var(--fg-subtle)", opacity: 0.4 }} />
            <p className="text-xs" style={{ color: "var(--fg-subtle)" }}>{t.result.previewUnavailable}</p>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- next/image cannot serve our dynamic backend /api/stream proxy URLs; plain img streams from our own backend exactly like <video> does
          <img
            key={firstMedia.url}
            src={imgSrc ?? streamSrc}
            alt={result.title ? decodeHtmlEntities(result.title).slice(0, 120) : t.typeBadges.photo}
            className="media-frame w-full rounded-[20px] object-contain"
            style={{ background: "#0a0a14" }}
            onError={handleImgError}
          />
        )}

        {/* Footer */}
        <div className="mt-3 flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-fg-muted"
            style={{ background: "var(--bg)" }}
          >
            {isAudio ? (
              <>
                <Music className="h-3.5 w-3.5 text-primary" />
                {t.result.metaAudio}
              </>
            ) : firstMedia?.type === "image" ? (
              <>
                <ImageIcon className="h-3.5 w-3.5 text-primary" />
                {t.typeBadges.photo}
              </>
            ) : (
              <>
                <Film className="h-3.5 w-3.5 text-primary" />
                {t.result.metaVideo}
              </>
            )}
          </span>

          <button
            type="button"
            onClick={isAudio ? handleDownloadAudio : handleDownloadVideo}
            disabled={(isAudio && !audioUrl) || downloading === "preparing" || (isAudio && audioLoading)}
            aria-label={isAudio ? t.result.downloadAudioLabel : t.result.downloadVideoLabel}
            className="gradient-btn h-12 min-h-[48px] flex-1 text-[14px] sm:h-11 sm:min-h-[44px]"
          >
            {downloading === "preparing" ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" className="opacity-75" />
                </svg>
                {t.result.downloading}
              </>
            ) : downloading === "error" ? (
              <>
                <DownloadIcon className="h-4 w-4" />
                {t.result.tryAgain}
              </>
            ) : (
              <>
                <DownloadIcon className="h-4 w-4" />
                {isAudio ? t.result.downloadAudio : t.result.download}
              </>
            )}
          </button>
        </div>
        {downloading === "error" && !isAudio && (
          <p className="mt-2 px-1 text-center text-[12.5px] font-medium text-danger" role="alert">
            {t.result.downloadFailed}
          </p>
        )}
      </div>

      <p className="mt-4 text-center text-[12.5px] text-fg-subtle">
        {t.result.tempNote}
      </p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────

export default function HeroDownloader() {
  const { t } = useLanguage();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [state, setState] = useState<UIState>("IDLE");
  const [result, setResult] = useState<ResolveData | null>(null);
  // Default to the primary mode (Reels). The tab is ONLY ever changed by an
  // explicit user click — resolve results, validation and errors never touch it.
  const [activeTab, setActiveTab] = useState<TabId>("reels");
  // Real processing progress: updated exclusively from backend SSE stage
  // events. Never advanced by timers.
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState("");
  const streamRef = useRef<ResolveStreamHandle | null>(null);
  const requestSeqRef = useRef(0);
  const watchdogRef = useRef<number | null>(null);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const closeStream = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
  }, []);

  const invalidateRequest = useCallback(() => {
    // Supersede any in-flight stream so a late event can never paint a
    // stale result over the current request.
    requestSeqRef.current++;
    closeStream();
    clearWatchdog();
  }, [closeStream, clearWatchdog]);

  // Cleanup on unmount: supersede any in-flight stream and stop the watchdog.
  useEffect(() => {
    return () => {
      invalidateRequest();
    };
  }, [invalidateRequest]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      setError("");
    } catch {
      /* clipboard denied */
    }
  }, []);

  const handleClear = useCallback(() => {
    invalidateRequest();
    setUrl("");
    setError("");
    setState("IDLE");
    setResult(null);
    setProgress(0);
    setProgressStage("");
  }, [invalidateRequest]);

  const handleRetry = useCallback(() => {
    invalidateRequest();
    setError("");
    setState("IDLE");
    setProgress(0);
    setProgressStage("");
  }, [invalidateRequest]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = url.trim();
      if (!trimmed) {
        setError(t.errors.empty);
        setState("ERROR");
        return;
      }
      if (!isValidInstagramUrl(trimmed)) {
        setError(t.errors.invalid);
        setState("ERROR");
        return;
      }
      // Single active request: supersede anything still in flight so rapid
      // clicks can never spawn parallel resolutions.
      invalidateRequest();
      const seq = ++requestSeqRef.current;
      setResult(null);
      setError("");
      setProgress(0);
      setProgressStage(t.hero.analyzing);
      setState("PREPARING");
      // Watchdog only: fires if the backend goes completely silent. It never
      // touches the progress value itself.
      watchdogRef.current = window.setTimeout(() => {
        if (requestSeqRef.current !== seq) return;
        closeStream();
        setError(t.errors.unreachable);
        setState("ERROR");
      }, 25000);
      const handle = startResolveStream(trimmed, {
        onProgress: (p, stage) => {
          if (requestSeqRef.current !== seq) return;
          setProgress(p);
          if (stage) setProgressStage(stage);
        },
        onComplete: (data) => {
          if (requestSeqRef.current !== seq) return;
          clearWatchdog();
          closeStream();
          setProgress(100);
          setProgressStage("");
          setResult(data);
          setState("SUCCESS");
        },
        onError: (err) => {
          if (requestSeqRef.current !== seq) return;
          clearWatchdog();
          closeStream();
          setError(err.message || t.errors.failed);
          setState("ERROR");
        },
      });
      streamRef.current = handle;
    },
    [url, t, invalidateRequest, clearWatchdog, closeStream]
  );

  const isAudioMode = activeTab === "audio";

  return (
    <section
      id="hero"
      className="relative overflow-hidden pb-12 pt-28 sm:pb-20 sm:pt-36 lg:pb-24"
    >
      <div className="absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-0 h-[700px] w-[1000px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/[0.03] blur-[160px]" />
      </div>

      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-12">
        <div className="mx-auto max-w-[680px] text-center">
          <div
            className="animate-fade-in-up mb-6 inline-flex items-center gap-2 rounded-full px-5 py-1.5 text-xs font-semibold tracking-wide text-fg-muted"
            style={{ background: "var(--card)", boxShadow: "var(--shadow-card)", border: "1px solid var(--border)" }}
          >
            <span className="inline-block h-2 w-2 rounded-full bg-accent" />
            <Sparkles size={14} color="var(--accent)" strokeWidth={2} />
            {t.hero.badge}
          </div>

          <h1 className="animate-fade-in-up delay-100" style={{ lineHeight: 1.1 }}>
            <span
              className="block"
              style={{ fontFamily: "var(--font-sans)", fontWeight: 800, fontSize: "clamp(32px, 6vw, 68px)", color: "var(--fg)" }}
            >
              {t.hero.titleA}
            </span>
            <span
              className="block"
              style={{ fontFamily: "var(--font-accent)", fontWeight: 600, fontStyle: "italic", fontSize: "clamp(32px, 6vw, 68px)", background: "var(--brand-gradient-text)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}
            >
              {t.hero.titleB}
            </span>
          </h1>

          <p className="animate-fade-in-up delay-200 mx-auto mt-5 max-w-xl text-[15px] sm:text-[18px] leading-[1.7] text-fg-muted">
            {t.hero.subtitle}
          </p>
        </div>

        {/* Tab Bar */}
        <div className="animate-fade-in-up delay-300 mx-auto mt-10 max-w-[720px]">
          <div
            className="flex items-center gap-1.5 overflow-x-auto rounded-full px-1.5 py-1.5 scrollbar-hide"
            style={{ background: "var(--card)", boxShadow: "var(--shadow-card)", border: "1px solid var(--border)" }}
          >
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2.5 text-[15px] font-semibold transition-all"
                  style={{
                    background: active ? "var(--brand-gradient)" : "transparent",
                    color: active ? "#fff" : "var(--fg-muted)",
                    boxShadow: active ? "var(--shadow-brand)" : "none",
                  }}
                >
                  <Icon size={16} strokeWidth={2} />
                  <span>{t.tabs[tab.id]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Input Bar */}
        <div className="animate-fade-in-up delay-300 mx-auto mt-6 max-w-[760px]">
          <form onSubmit={handleSubmit} className="relative" noValidate>
            <div
              className="rounded-[20px] p-2.5 transition-shadow"
              style={{
                background: "var(--card)",
                boxShadow: "var(--shadow-card), 0 0 40px rgba(124,77,245,0.06)",
                border: "1px solid var(--border)",
              }}
            >
              {/* Desktop: horizontal */}
              <div className="hidden sm:flex sm:flex-row sm:gap-2">
                <div className="relative min-w-0 flex-1">
                  <LinkIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-fg-subtle" />
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      if (error) setError("");
                    }}
                    placeholder={isAudioMode ? t.hero.audioPlaceholder : t.hero.placeholder}
                    className="h-13 w-full rounded-xl border-0 bg-transparent pl-12 pr-4 text-[16px] text-fg placeholder:text-fg-subtle focus:outline-none"
                    style={{ fontFamily: "var(--font-sans)", fontWeight: 500 }}
                    aria-label={t.hero.inputLabel}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={state === "PREPARING"}
                  />
                </div>

                {url && state !== "PREPARING" && (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="flex h-13 shrink-0 items-center gap-1 rounded-xl border border-border px-3 text-xs font-medium text-fg-muted transition-colors hover:bg-primary-light hover:text-primary"
                        style={{ background: "var(--bg)" }}
                        aria-label={t.common.clear}
                      >
                        <X className="h-3.5 w-3.5" />
                        {t.common.clear}
                      </button>
                )}

                <button
                  type="button"
                  onClick={handlePaste}
                  disabled={state === "PREPARING"}
                  className="flex h-13 shrink-0 items-center gap-1 rounded-xl border border-border px-3 text-xs font-medium text-fg-muted transition-colors hover:bg-primary-light hover:text-primary disabled:opacity-50"
                  style={{ background: "var(--bg)" }}
                  aria-label={t.common.paste}
                >
                  <Clipboard className="h-3.5 w-3.5" />
                  {t.common.paste}
                </button>

                <button
                  type="submit"
                  disabled={state === "PREPARING"}
                  className="gradient-btn h-13 shrink-0 px-7 text-[15px]"
                >
                  {state === "PREPARING" ? (
                    <>
                      <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                        <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" className="opacity-75" />
                      </svg>
                      {t.common.resolving}
                    </>
                  ) : (
                    <>
                      <DownloadIcon className="h-5 w-5" />
                      {t.common.getMedia}
                    </>
                  )}
                </button>
              </div>

              {/* Mobile: stacked */}
              <div className="flex flex-col gap-2 sm:hidden">
                <div className="relative">
                  <LinkIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-fg-subtle" />
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      if (error) setError("");
                    }}
                    placeholder={isAudioMode ? t.hero.audioPlaceholder : t.hero.placeholder}
                    className="h-13 w-full rounded-xl border-0 bg-transparent pl-12 pr-20 text-[16px] text-fg placeholder:text-fg-subtle focus:outline-none"
                    style={{ fontFamily: "var(--font-sans)", fontWeight: 500 }}
                    aria-label={t.hero.inputLabel}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={state === "PREPARING"}
                  />
                  {url && state !== "PREPARING" && (
                    <button
                      type="button"
                      onClick={handleClear}
                      className="absolute right-3 top-1/2 flex h-8 -translate-y-1/2 items-center gap-1 rounded-xl border border-border px-2.5 text-xs font-medium text-fg-muted"
                      style={{ background: "var(--bg)" }}
                      aria-label={t.common.clear}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handlePaste}
                    disabled={state === "PREPARING"}
                    className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border text-[14px] font-medium text-fg-muted transition-colors hover:bg-primary-light hover:text-primary disabled:opacity-50"
                    style={{ background: "var(--bg)" }}
                    aria-label={t.common.paste}
                  >
                    <Clipboard className="h-4 w-4" />
                    {t.common.paste}
                  </button>
                  <button
                    type="submit"
                    disabled={state === "PREPARING"}
                    className="gradient-btn h-12 flex-1 text-[15px]"
                  >
                    {state === "PREPARING" ? (
                      <>
                        <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                      <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" className="opacity-75" />
                      </svg>
                      {t.common.resolving}
                    </>
                  ) : (
                    <>
                      <DownloadIcon className="h-5 w-5" />
                      {t.common.getMedia}
                    </>
                  )}
                  </button>
                </div>
              </div>
            </div>
          </form>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[14px] text-fg-subtle">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1 w-1 rounded-full bg-success" />
              {t.hero.foot1}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1 w-1 rounded-full bg-success" />
              {t.hero.foot2}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1 w-1 rounded-full bg-success" />
              {t.hero.foot3}
            </span>
          </div>
        </div>

        {/* Result / Error Area */}
        <div aria-live="polite" aria-atomic="true">
          {state === "PREPARING" && (
            <CircularProgress value={progress} label={progressStage || t.hero.analyzing} />
          )}

          {state === "SUCCESS" && result && (
            <MediaResult
              key={result.mediaId || result.sourceUrl}
              result={result}
              mode={isAudioMode ? "audio" : "video"}
              onReset={handleClear}
            />
          )}

          {state === "ERROR" && error && (
            <div className="animate-fade-in-up mx-auto mt-10 max-w-[720px] px-4 sm:px-5">
              <div
                className="rounded-[20px] p-6 text-center sm:p-8"
                style={{ border: "1px solid rgba(220,38,38,0.15)", background: "var(--danger-light)" }}
                role="alert"
              >
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "rgba(220,38,38,0.1)" }}>
                  <AlertCircle className="h-6 w-6 text-danger" />
                </div>
                <p className="text-sm font-medium text-danger">{error}</p>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-danger/20 bg-white px-5 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger-light"
                >
                  {t.common.tryAgain}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function isValidInstagramUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname === "www.instagram.com" ||
        parsed.hostname === "instagram.com" ||
        parsed.hostname === "m.instagram.com") &&
      (parsed.pathname.includes("/p/") ||
        parsed.pathname.includes("/reel/") ||
        parsed.pathname.includes("/reels/") ||
        parsed.pathname.includes("/tv/") ||
        parsed.pathname.includes("/stories/"))
    );
  } catch {
    return false;
  }
}
