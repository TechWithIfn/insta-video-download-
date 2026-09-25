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
  Video,
  Clock,
  Music,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Heart,
  MessageCircle,
  Send,
  Bookmark,
  Volume2,
} from "lucide-react";
import {
  resolveInstagramUrl,
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
    VIDEO: badges.video,
    PHOTO: badges.photo,
    AUDIO: badges.content,
    UNKNOWN: badges.content,
  };
  return labels[type] || badges.content;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (hours > 0) return `${hours}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function sanitizeHandle(username: string | null | undefined): string {
  if (!username) return "downloadit";
  return username.replace(/[^a-zA-Z0-9._-]/g, "").replace(/^\.+|\.+$/g, "").slice(0, 60) || "downloadit";
}

export type DownloaderTab = "reels" | "videos" | "photos" | "carousel" | "stories" | "audio";

const HERO_CATEGORIES = [
  {
    id: "reels" as const,
    title: "Reels",
    subtitle: "Download Reels",
    icon: Film,
    iconBg: "rgba(236, 95, 168, 0.12)",
    iconColor: "#ec5fa8",
  },
  {
    id: "videos" as const,
    title: "Videos",
    subtitle: "Save Videos",
    icon: Video,
    iconBg: "rgba(124, 77, 245, 0.12)",
    iconColor: "#7c4df5",
  },
  {
    id: "photos" as const,
    title: "Photos",
    subtitle: "Get Photos",
    icon: ImageIcon,
    iconBg: "rgba(245, 142, 91, 0.14)",
    iconColor: "#f58e5b",
  },
  {
    id: "stories" as const,
    title: "Stories",
    subtitle: "Save Stories",
    icon: Clock,
    iconBg: "rgba(14, 165, 233, 0.12)",
    iconColor: "#0ea5e9",
  },
  {
    id: "audio" as const,
    title: "Audio",
    subtitle: "Extract Audio",
    icon: Music,
    iconBg: "rgba(16, 185, 129, 0.12)",
    iconColor: "#10b981",
  },
];

function resolveTabFromResultType(type: string): DownloaderTab | null {
  switch (type) {
    case "REEL":
      return "reels";
    case "VIDEO":
      return "videos";
    case "CAROUSEL":
      return "carousel";
    case "POST":
    case "PHOTO":
      return "photos";
    case "STORY":
      return "stories";
    case "AUDIO":
      return "audio";
    default:
      return null;
  }
}

// ─── Circular progress (REAL backend stages only) ────────────
// The value shown here comes exclusively from `progress` SSE events sent
// by the backend after each resolution stage actually completes. This
// component never advances itself on a timer.
const PROGRESS_RING_ID = "downloadit-progress-ring";

function CircularProgress({ value, label }: { value: number; label: string }) {
  const { t } = useLanguage();
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const R = 52;
  const C = 2 * Math.PI * R;
  const offset = C - (C * clamped) / 100;
  return (
    <div className="animate-fade-in-up mx-auto mt-6 w-full sm:mt-10" style={{ maxWidth: "380px" }}>
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

function aspectRatioStyle(width?: number | null, height?: number | null, fallback = "9/16"): React.CSSProperties {
  if (width && height && width > 0 && height > 0) {
    return { aspectRatio: `${width} / ${height}` };
  }
  return { aspectRatio: fallback };
}

function VideoPlayer({ src, poster, mediaType, width, height, onDurationChange, onResolution }: { src: string; poster?: string; mediaType?: string; width?: number | null; height?: number | null; onDurationChange?: (duration: number) => void; onResolution?: (w: number, h: number) => void }) {
  const { t } = useLanguage();
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const retryCountRef = useRef(0);
  const [currentSrc, setCurrentSrc] = useState(src);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setCurrent(v.currentTime);
    const onMeta = () => {
      const nextDuration = Number.isFinite(v.duration) && v.duration >= 0 ? v.duration : 0;
      setDuration(nextDuration);
      onDurationChange?.(nextDuration);
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        onResolution?.(v.videoWidth, v.videoHeight);
      }
    };
    const onEnd = () => {
      v.pause();
      setPlaying(false);
      setCurrent(0);
    };
    const onError = () => {
      if (process.env.NODE_ENV === "development") {
        try {
          console.debug("[Downloadit Preview]", {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSrc, mediaType]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setFullscreen(document.fullscreenElement === playerRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const togglePlay = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      if (v.ended) v.currentTime = 0;
      try {
        await v.play();
      } catch {
        // Playback can be rejected by the browser; media events remain the
        // only source of truth for the React playing state.
      }
    } else {
      v.pause();
    }
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

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!playerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      playerRef.current.requestFullscreen?.().catch(() => {});
    }
  }, []);

  if (mediaError) {
    return (
      <div className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-2 rounded-[20px] bg-black/5">
        <ImageIcon className="h-10 w-10" style={{ color: "var(--fg-subtle)", opacity: 0.4 }} />
        <p className="text-xs" style={{ color: "var(--fg-subtle)" }}>{t.result.previewUnavailable}</p>
      </div>
    );
  }

  return (
    <div ref={playerRef} className="media-mount relative overflow-hidden rounded-[20px]" style={{ background: "#0a0a14" }}>
      <div className="relative w-full media-frame" style={aspectRatioStyle(width, height, "9/16")}>
        <video
          ref={videoRef}
          src={currentSrc}
          poster={poster || undefined}
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-contain"
          onClick={togglePlay}
        />

        {!playing && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              togglePlay();
            }}
            className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full backdrop-blur-md transition-transform hover:scale-105 active:scale-95 sm:h-16 sm:w-16"
            style={{ background: "rgba(255,255,255,0.18)", border: "1.5px solid rgba(255,255,255,0.25)" }}
            aria-label={t.result.playVideo}
          >
            <Play className="ml-1 h-6 w-6 text-white" fill="white" strokeWidth={0} />
          </button>
        )}
      </div>

      {/* Progress bar + time + mute */}
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
          <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleMute}
              className="flex min-h-[32px] min-w-[44px] items-center justify-center rounded-lg px-2 text-[11px] font-semibold text-white/70 transition-colors hover:text-white"
              aria-label={muted ? "Unmute video" : "Mute video"}
              aria-pressed={muted}
            >
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition-colors hover:text-white"
              aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              aria-pressed={fullscreen}
            >
              {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Audio Player ─────────────────────────────────────────

function AudioPlayer({ src, onDurationChange }: { src: string; onDurationChange?: (duration: number) => void }) {
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
    const onMeta = () => {
      const nextDuration = Number.isFinite(a.duration) && a.duration >= 0 ? a.duration : 0;
      setDuration(nextDuration);
      onDurationChange?.(nextDuration);
    };
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
    // onDurationChange is a stable parent setter; re-subscribing on each
    // render would churn listeners for no benefit (same as VideoPlayer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div className="media-mount overflow-hidden rounded-[20px]" style={{ background: "linear-gradient(145deg, #1a1028 0%, #0f0c1b 100%)" }}>
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

function formatBytes(size: number | null | undefined): string {
  if (typeof size !== "number" || !isFinite(size) || size <= 0) return "Unknown";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let v = size / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

function formatResolution(w: number | null | undefined, h: number | null | undefined): string {
  if (typeof w === "number" && w > 0 && typeof h === "number" && h > 0) return `${w}×${h}`;
  return "Unknown";
}

function formatMetaDuration(d: number | null | undefined, fallback: number | null): string {
  const v = typeof d === "number" && isFinite(d) && d > 0 ? d : (typeof fallback === "number" && isFinite(fallback) && fallback > 0 ? fallback : null);
  if (v === null) return "Unknown";
  return formatTime(v);
}

function extForMedia(m: { type: string; format?: string | null; url: string }): string {
  const f = (m.format || "").toLowerCase();
  if (m.type === "audio") return f === "m4a" ? "m4a" : "mp3";
  if (m.type === "video") return "mp4";
  if (f.includes("png")) return "png";
  if (f.includes("webp")) return "webp";
  if (f.includes("jpg") || f.includes("jpeg")) return "jpg";
  if (m.url.includes(".png")) return "png";
  if (m.url.includes(".webp")) return "webp";
  return "jpg";
}

function labelForMedia(m: { type: string; format?: string | null }): string {
  if (m.type === "audio") {
    const f = (m.format || "").toUpperCase();
    return f === "M4A" ? "M4A" : "MP3";
  }
  if (m.type === "video") return "MP4";
  const f = (m.format || "").toUpperCase();
  if (f === "JPG" || f === "JPEG") return "JPG";
  if (f === "PNG" || f === "WEBP" || f === "MP4") return f;
  return m.type === "image" ? "JPG" : "—";
}

function MediaResult({ result, mode, onReset }: MediaResultProps) {
  const { t } = useLanguage();
  const [downloading, setDownloading] = useState<"idle" | "preparing" | "error">("idle");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(true);
  const [audioError, setAudioError] = useState<string | null>(null);
  // Real MP3 metadata: byte size from the downloaded blob, duration from the
  // audio element. Shown in the details tiles — never hardcoded.
  const [audioSize, setAudioSize] = useState<number | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  // Carousel navigation: one item visible at a time. When the
  // pasted URL carried `?img_index=N`, open the carousel on that slide
  // (clamped to the resolved items). MediaResult remounts per result, so the
  // initializer runs fresh for every new resolve.
  const [currentIndex, setCurrentIndex] = useState(() => {
    const s = result.startIndex;
    if (typeof s === "number" && Number.isFinite(s) && s > 0) {
      return Math.min(s, Math.max(0, result.media.length - 1));
    }
    return 0;
  });
  // Long captions are clamped with a Show more/less toggle.
  const [captionExpanded, setCaptionExpanded] = useState(false);
  // Real duration/resolution observed from the <video> element (never faked).
  const [realDuration, setRealDuration] = useState<number | null>(null);
  const [realResolution, setRealResolution] = useState<{ w: number; h: number } | null>(null);
  // Image-preview retry state (video uses VideoPlayer's own retry).
  // MediaResult remounts per result (parent key), so these reset naturally.
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  // Tracks the current slide's decode so the reserved-space loading state
  // shows until the bitmap is ready, then fades in (opacity only, no layout).
  const [imgLoaded, setImgLoaded] = useState(false);
  const imgRetriedRef = useRef(false);
  // Stable fallback message for the audio fetch below: reading it from a ref
  // keeps the fetch effect from re-running on language switches.
  const audioFallbackRef = useRef(t.result.audioErrorFallback);
  useEffect(() => {
    audioFallbackRef.current = t.result.audioErrorFallback;
  });

  const items = result.media;
  const safeIndex = items.length === 0 ? 0 : Math.min(currentIndex, items.length - 1);
  const currentMedia = items[safeIndex] ?? null;
  const isAudio = mode === "audio";

  // Frontend safety: NEVER display profile/avatar as Story media
  const isProfileImageUrlFrontend = (u: string) => {
    try {
      const url = new URL(u);
      const p = url.pathname.toLowerCase();
      const s = (url.search + url.hash).toLowerCase();
      if (p.includes("s150x150") || p.includes("s320x320") || p.includes("profile_pic") || p.includes("avatar")) return true;
      if (/\/t51\.[^/]+-19\//.test(p)) return true;
      if (s.includes("150x150") || s.includes("320x320")) return true;
      return false;
    } catch {
      return false;
    }
  };
  const isProfileMediaFrontend = Boolean(
    currentMedia &&
      (isProfileImageUrlFrontend(currentMedia.url) ||
        (currentMedia.width === 206 && currentMedia.height === 206) ||
        (currentMedia.type === "image" && currentMedia.width === 150 && currentMedia.height === 150))
  );
  const isStoryProfileFallback = result.type === "STORY" && isProfileMediaFrontend;
  // Carousel controls ONLY for real carousel posts. Reels, single videos,
  // single photos, stories and audio never show a counter/arrows —
  // even if the backend returned more than one media item for them.
  const isCarouselPost = !isAudio && (result.type === "CAROUSEL" || (result.type === "POST" && items.length > 1));
  const showCarouselNav = isCarouselPost && items.length > 1;

  const resetPerItemState = useCallback(() => {
    setImgSrc(null);
    setImgFailed(false);
    imgRetriedRef.current = false;
    setRealDuration(null);
    setRealResolution(null);
  }, []);

  // ── Carousel flicker fix: keep current image visible until next is preloaded ──
  // Stable container + Image() preload prevents white/black flash and layout shift.
  // Only `currentIndex` (hence currentMedia) is changed, and only after the
  // target src has loaded. Rapid clicks are de-duplicated via version counter.
  const carouselVersionRef = useRef(0);
  const carouselTargetRef = useRef<number | null>(null);

  const preloadAndSwitch = useCallback(
    (targetIndex: number) => {
      if (targetIndex < 0 || targetIndex >= items.length) return;
      const safe = Math.min(currentIndex, items.length - 1);
      if (targetIndex === safe && carouselTargetRef.current === null) return;
      const version = ++carouselVersionRef.current;
      carouselTargetRef.current = targetIndex;
      const targetMedia = items[targetIndex];
      if (!targetMedia || targetMedia.type === "video") {
        // Video slides are handled by VideoPlayer (remount is cheap and video
        // has its own poster); switch immediately without preload.
        setCurrentIndex(targetIndex);
        resetPerItemState();
        carouselTargetRef.current = null;
        return;
      }
      const targetSrc = getStreamUrl(targetMedia.url, result.sourceUrl);
      const img = new Image();
      img.onload = () => {
        if (carouselVersionRef.current !== version) return;
        // Switch only when target is decoded and cached → no flash
        setCurrentIndex(targetIndex);
        setImgSrc(null);
        setImgFailed(false);
        imgRetriedRef.current = false;
        // Do not reset video-only states abruptly for images
        carouselTargetRef.current = null;
      };
      img.onerror = () => {
        if (carouselVersionRef.current !== version) return;
        // Still switch to let retry/error UI appear, avoiding blank
        setCurrentIndex(targetIndex);
        setImgSrc(null);
        setImgFailed(false);
        imgRetriedRef.current = false;
        carouselTargetRef.current = null;
      };
      img.src = targetSrc;
    },
    [items, result.sourceUrl, currentIndex, resetPerItemState]
  );

  // Preload neighbours after a slide is displayed (instant next navigation)
  useEffect(() => {
    if (!isCarouselPost || items.length <= 1) return;
    const preload = (idx: number) => {
      if (idx < 0 || idx >= items.length) return;
      const m = items[idx];
      if (!m || m.type === "video") return;
      const src = getStreamUrl(m.url, result.sourceUrl);
      const img = new Image();
      img.src = src;
    };
    preload(safeIndex + 1);
    preload(safeIndex - 1);
  }, [safeIndex, isCarouselPost, items, result.sourceUrl]);

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
        if (Number.isFinite(blob.size) && blob.size > 0) setAudioSize(blob.size);
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

  // Revoke blob object URLs when superseded or unmounted — otherwise every
  // audio resolve leaks the full MP3 blob for the lifetime of the tab.
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const handleDownloadVideo = useCallback(() => {
    if (!currentMedia || downloading === "preparing") return;
    setDownloading("preparing");
    try {
      const safeHandle = sanitizeHandle(result.author?.username);
      const ext = extForMedia(currentMedia);
      const filename = items.length > 1
        ? `${safeHandle}-${safeIndex + 1}.${ext}`
        : `${safeHandle}-${currentMedia.type === "video" ? "video" : "photo"}.${ext}`;
      const downloadUrl = getDownloadUrl(currentMedia.url, filename, result.sourceUrl);
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
  }, [currentMedia, result.author, result.sourceUrl, downloading, items.length, safeIndex]);

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
  const streamSrc = currentMedia ? getStreamUrl(currentMedia.url, result.sourceUrl) : "";

  // Reserve the image's own ratio before the bytes arrive (CLS fix): with
  // width 100% + aspect-ratio, the box has its final height pre-load, so
  // neither the first paint nor slide switches move surrounding layout.
  const imgAspect =
    currentMedia &&
    currentMedia.type !== "video" &&
    currentMedia.width &&
    currentMedia.height &&
    currentMedia.width > 0 &&
    currentMedia.height > 0
      ? `${currentMedia.width} / ${currentMedia.height}`
      : undefined;

  // Reset the loaded flag per media item during render (React "adjust state
  // on change" pattern — synchronous, so the fresh slide never inherits the
  // previous slide's loaded flag for even one frame). The slide was
  // preloaded + cached before the switch, so the fade is instant.
  const [loadedSrc, setLoadedSrc] = useState(streamSrc);
  if (loadedSrc !== streamSrc) {
    setLoadedSrc(streamSrc);
    setImgLoaded(false);
  }

  const logPreviewDiag = useCallback(
    (mediaType: string | undefined) => {
      if (process.env.NODE_ENV !== "development") return;
      try {
        console.debug("[Downloadit Preview]", {
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
    logPreviewDiag(currentMedia?.type);
    if (!imgRetriedRef.current) {
      imgRetriedRef.current = true;
      const bust = streamSrc.includes("?") ? "&" : "?";
      setImgSrc(`${streamSrc}${bust}_retry=${Date.now()}`);
    } else {
      setImgFailed(true);
    }
  }, [currentMedia, streamSrc, logPreviewDiag]);

  const goPrev = useCallback(() => {
    const target = Math.max(0, (carouselTargetRef.current ?? safeIndex) - 1);
    preloadAndSwitch(target);
  }, [safeIndex, preloadAndSwitch]);
  const goNext = useCallback(() => {
    const target = Math.min(items.length - 1, (carouselTargetRef.current ?? safeIndex) + 1);
    preloadAndSwitch(target);
  }, [safeIndex, items.length, preloadAndSwitch]);

  const effW = realResolution?.w ?? currentMedia?.width ?? null;
  const effH = realResolution?.h ?? currentMedia?.height ?? null;

  // Derived metadata for the new two-column card
  const previewRef = useRef<HTMLDivElement>(null);
  const handlePreview = useCallback(() => {
    const v = previewRef.current?.querySelector<HTMLVideoElement>("video");
    if (v) {
      if (v.paused) v.play().catch(() => {});
      else v.pause();
      v.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const a = previewRef.current?.querySelector<HTMLAudioElement>("audio");
    if (a) {
      if (a.paused) a.play().catch(() => {});
      else a.pause();
    }
    previewRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // Strict validation: for Story, never show profile/avatar as success
  if (isStoryProfileFallback) {
    return (
      <div className="result-card animate-fade-in-up mx-auto mt-6 w-[calc(100%-32px)] max-w-[900px] sm:mt-10 sm:w-full sm:px-5">
        <div
          className="overflow-hidden rounded-[28px] p-4 sm:p-5 text-center"
          style={{ background: "var(--card)", boxShadow: "0 20px 60px rgba(60,40,120,0.12)", border: "1px solid var(--border)" }}
        >
          <div className="flex flex-col items-center gap-3 py-6">
            <AlertCircle className="h-10 w-10 text-danger" />
            <p className="text-[15px] font-semibold text-danger">The actual Story media could not be resolved.</p>
            <p className="max-w-[420px] text-[13.5px] leading-[1.6] text-fg-muted">
              Instagram did not expose the requested Story media. The Story may have expired, been removed, or is not publicly accessible. Please try a different Story link or verify the Story is still viewable publicly.
            </p>
            <button
              type="button"
              onClick={onReset}
              className="mt-2 inline-flex min-h-[44px] items-center justify-center rounded-xl px-5 text-[14px] font-semibold text-white"
              style={{ background: "var(--brand-gradient)" }}
            >
              Try another link
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="result-card animate-fade-in-up mx-auto mt-6 w-[calc(100%-32px)] max-w-[900px] sm:mt-10 sm:w-full sm:px-5">
      <div
        className="overflow-hidden rounded-[28px] p-3 sm:p-4 md:p-5"
        style={{ background: "var(--card)", boxShadow: "0 20px 60px rgba(60,40,120,0.12)", border: "1px solid var(--border)" }}
      >
        {/* Card header: badge + handle + New */}
        <div className="result-top-row mb-3 flex items-center justify-between gap-2 px-1">
          <span
            className="inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-bold text-white"
            style={{ background: isAudio ? "linear-gradient(135deg, #7c4df5, #ec5fa8)" : "var(--brand-gradient)" }}
          >
            {isAudio ? t.result.audio : getContentTypeLabel(result.type, t.typeBadges)}
          </span>
          {result.author && (
            <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 sm:justify-start">
              <div className="h-[22px] w-[22px] shrink-0 rounded-full" style={{ background: "var(--brand-gradient)" }} />
              <span className="truncate text-[13px] font-semibold text-fg sm:text-[14px]">@{result.author.username}</span>
            </div>
          )}
          <button
            type="button"
            onClick={onReset}
            className="flex min-h-[44px] shrink-0 items-center gap-1 px-1 text-[13px] font-semibold text-fg-subtle transition-colors hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
            {t.result.newBtn}
          </button>
        </div>

        {result.title && (() => {
          const caption = decodeHtmlEntities(result.title);
          const isLong = caption.length > 160;
          return (
            <div className="result-title px-1 pb-3">
              <p className={`text-[13px] leading-[1.5] text-fg-muted break-words ${!captionExpanded && isLong ? "line-clamp-3" : ""}`}>
                {caption}
              </p>
              {isLong && (
                <button
                  type="button"
                  onClick={() => setCaptionExpanded((v) => !v)}
                  className="mt-1 min-h-[32px] text-[12.5px] font-semibold text-primary transition-colors hover:text-primary-hover"
                  aria-expanded={captionExpanded}
                >
                  {captionExpanded ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          );
        })()}

        {/* ── Two-column body: LEFT preview / RIGHT info ── */}
        <div className="result-grid grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,1fr)] lg:gap-6">
          {/* LEFT: large preview */}
          <div ref={previewRef} className="result-video-wrap min-w-0">
            <div className="relative">
            {isAudio ? (
              <>
                {audioLoading && (
                  <div
                    className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-[20px] md:aspect-[4/3]"
                    style={{ background: "linear-gradient(145deg, #1a1028 0%, #0f0c1b 100%)" }}
                  >
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
                    <p className="break-words px-4 text-center text-xs text-danger">{audioError}</p>
                  </div>
                )}
                {audioUrl && <AudioPlayer src={audioUrl} onDurationChange={(d) => setAudioDuration(d)} />}
              </>
            ) : !currentMedia ? null : currentMedia.type === "video" ? (
              // NOTE: keying by URL intentionally remounts per source. That
              // resets playing/time/mute state for the new video AND unmounts
              // the old <video> element, which stops its decode — so the
              // previous video can never keep playing (or play simultaneously)
              // after a slide switch, a new search, or leaving the preview.
              <VideoPlayer
                key={currentMedia.url}
                src={streamSrc}
                poster={currentMedia.thumbnail || undefined}
                mediaType={currentMedia.type}
                width={currentMedia.width}
                height={currentMedia.height}
                onDurationChange={(d) => setRealDuration(d)}
                onResolution={(w, h) => setRealResolution({ w, h })}
              />
            ) : imgFailed ? (
              <div className="flex min-h-[180px] w-full flex-col items-center justify-center gap-2 rounded-[20px] bg-black/5">
                <ImageIcon className="h-10 w-10" style={{ color: "var(--fg-subtle)", opacity: 0.4 }} />
                <p className="text-xs" style={{ color: "var(--fg-subtle)" }}>
                  {t.result.previewUnavailable}
                </p>
              </div>
            ) : (
              // Natural-height render: the image keeps its own aspect ratio
              // (portrait / landscape / square) with object-fit contain, so it
              // is never cropped, stretched, or boxed into a fixed ratio.
              // The wrapper reserves that ratio pre-load (no CLS); the bitmap
              // fades in on decode (opacity only, no layout, no flash).
              <div
                className="relative w-full overflow-hidden rounded-[20px]"
                style={{ background: "#0a0a14", aspectRatio: imgAspect ?? "auto" }}
              >
                {!imgLoaded && !imgFailed && (
                  <div aria-hidden="true" className="absolute inset-0 flex min-h-[180px] items-center justify-center">
                    <svg className="h-8 w-8 animate-spin text-white/40" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                      <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" className="opacity-75" />
                    </svg>
                  </div>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element -- next/image cannot serve our dynamic backend /api/stream proxy URLs; plain img streams from our own backend exactly like <video> does */}
                <img
                  key={currentMedia.url}
                  src={imgSrc ?? streamSrc}
                  alt={result.title ? decodeHtmlEntities(result.title).slice(0, 120) : t.typeBadges.photo}
                  onLoad={() => setImgLoaded(true)}
                  onError={handleImgError}
                  className="media-frame media-natural relative w-full rounded-[20px] object-contain"
                  style={{ background: "transparent", aspectRatio: imgAspect ?? "auto", height: "auto", display: "block", opacity: imgLoaded ? 1 : 0, transition: "opacity 180ms ease-out" } as React.CSSProperties}
                />
              </div>
            )}
              {/* Overlay carousel arrows: vertically centered on the media
                  edges, visible without covering important content. */}
              {showCarouselNav && currentMedia && (
                <>
                  <button
                    type="button"
                    onClick={goPrev}
                    disabled={safeIndex === 0}
                    aria-label="Previous image"
                    className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-white backdrop-blur-md transition-all hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
                    style={{ background: "rgba(10,10,20,0.55)", border: "1px solid rgba(255,255,255,0.25)" }}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    disabled={safeIndex === items.length - 1}
                    aria-label="Next image"
                    className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-white backdrop-blur-md transition-all hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
                    style={{ background: "rgba(10,10,20,0.55)", border: "1px solid rgba(255,255,255,0.25)" }}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>
            {showCarouselNav && currentMedia && (
              <p className="mt-1.5 text-center text-[12px] font-bold tabular-nums text-fg-subtle" aria-live="polite">
                {safeIndex + 1} / {items.length}
              </p>
            )}
          </div>

          {/* Actions + metadata */}
          <div className="result-details flex min-w-0 flex-col gap-3 md:gap-4">
            <div className="result-actions flex flex-col gap-2.5 sm:flex-row">
              <button
                type="button"
                onClick={handlePreview}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-[14px] border border-border bg-card px-4 text-[14px] font-semibold text-fg transition-colors hover:bg-primary-light hover:text-primary"
              >
                <Play className="h-4 w-4" />
                Preview
              </button>

              <button
                type="button"
                onClick={isAudio ? handleDownloadAudio : handleDownloadVideo}
                disabled={(isAudio && !audioUrl) || downloading === "preparing" || (isAudio && audioLoading)}
                aria-label={isAudio ? t.result.downloadAudioLabel : t.result.downloadVideoLabel}
                className="gradient-btn min-h-[48px] flex-1 text-[14px] disabled:opacity-60"
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
              <p className="text-center text-[12.5px] font-medium text-danger" role="alert">
                {t.result.downloadFailed}
              </p>
            )}
            <dl className="grid grid-cols-2 gap-2 text-[12.5px]">
              {!isAudio && (
                <div className="rounded-[12px] px-3 py-2" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
                  <dt className="font-medium text-fg-subtle">Resolution</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums text-fg">{formatResolution(effW, effH)}</dd>
                </div>
              )}
              <div className="rounded-[12px] px-3 py-2" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
                <dt className="font-medium text-fg-subtle">File Size</dt>
                <dd className="mt-0.5 font-semibold tabular-nums text-fg">{isAudio ? (audioSize !== null ? formatBytes(audioSize) : "MP3 · 192k") : formatBytes(currentMedia?.size)}</dd>
              </div>
              {(isAudio || currentMedia?.type === "video") && (
                <div className="rounded-[12px] px-3 py-2" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
                  <dt className="font-medium text-fg-subtle">Duration</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums text-fg">{isAudio ? (audioDuration !== null && audioDuration > 0 ? formatTime(audioDuration) : "Audio · MP3") : formatMetaDuration(currentMedia?.duration, realDuration)}</dd>
                </div>
              )}
              <div className="rounded-[12px] px-3 py-2" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
                <dt className="font-medium text-fg-subtle">Format</dt>
                <dd className="mt-0.5 font-semibold text-fg">{isAudio ? "MP3" : (currentMedia ? labelForMedia(currentMedia) : "Unknown")}</dd>
              </div>
            </dl>
          </div>
        </div>

      </div>

      <p className="mt-4 break-words px-2 text-center text-[12px] text-fg-subtle sm:text-[12.5px]">{t.result.tempNote}</p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────

interface HeroDownloaderProps {
  activeTab: DownloaderTab | null;
  onActiveTabChange: (tab: DownloaderTab | null) => void;
}

export default function HeroDownloader({ activeTab, onActiveTabChange }: HeroDownloaderProps) {
  const { t } = useLanguage();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [state, setState] = useState<UIState>("IDLE");
  const [result, setResult] = useState<ResolveData | null>(null);
  // Default to the primary mode (Reels). The tab is ONLY ever changed by an
  // explicit user click — resolve results, validation and errors never touch it.
  // Real processing progress: updated exclusively from backend SSE stage
  // events. Never advanced by timers.
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState("");
  const [audioExtractionRequested, setAudioExtractionRequested] = useState(false);
  const streamRef = useRef<ResolveStreamHandle | null>(null);
  const requestSeqRef = useRef(0);
  const watchdogRef = useRef<number | null>(null);
  const postAbortRef = useRef<AbortController | null>(null);

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
    postAbortRef.current?.abort();
    postAbortRef.current = null;
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
    onActiveTabChange(null);
    setUrl("");
    setError("");
    setState("IDLE");
    setResult(null);
    setAudioExtractionRequested(false);
    setProgress(0);
    setProgressStage("");
  }, [invalidateRequest, onActiveTabChange]);

  const handleRetry = useCallback(() => {
    invalidateRequest();
    onActiveTabChange(null);
    setError("");
    setState("IDLE");
    setAudioExtractionRequested(false);
    setProgress(0);
    setProgressStage("");
  }, [invalidateRequest, onActiveTabChange]);

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
      // Audio is an output preference, not an input type selector. Preserve
      // it for Reel/Video -> MP3 while still updating the detected source tab.
      setAudioExtractionRequested(activeTab === "audio");
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
        requestSeqRef.current++;
        closeStream();
        postAbortRef.current?.abort();
        postAbortRef.current = null;
        setError(t.errors.unreachable);
        setState("ERROR");
      }, 25000);
      const postController = new AbortController();
      postAbortRef.current = postController;
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
          const detectedTab = resolveTabFromResultType(data.type);
          if (detectedTab) onActiveTabChange(detectedTab);
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
        onTransportError: () => {
          if (requestSeqRef.current !== seq) return;
          // The event stream dropped without a server verdict — fall back to
          // one plain POST resolve (same URL coalesces server-side) instead
          // of reporting a false connection failure.
          resolveInstagramUrl(trimmed, postController.signal)
            .then((data) => {
              if (requestSeqRef.current !== seq) return;
              clearWatchdog();
              closeStream();
              if (!data.success) {
                setError(data.error?.message || t.errors.failed);
                setState("ERROR");
                return;
              }
              const detectedTab = resolveTabFromResultType(data.data.type);
              if (detectedTab) onActiveTabChange(detectedTab);
              setProgress(100);
              setProgressStage("");
              setResult(data.data);
              setState("SUCCESS");
            })
            .catch((err) => {
              if (requestSeqRef.current !== seq) return;
              if (err instanceof DOMException && err.name === "AbortError") return;
              clearWatchdog();
              closeStream();
              setError(t.errors.unreachable);
              setState("ERROR");
            });
        },
      });
      streamRef.current = handle;
    },
    [url, t, activeTab, invalidateRequest, clearWatchdog, closeStream, onActiveTabChange]
  );

  const isAudioMode = activeTab === "audio" || (audioExtractionRequested && state === "SUCCESS");

  const tabsRef = useRef<HTMLDivElement>(null);
  const resultAnchorRef = useRef<HTMLDivElement>(null);
  const prevStateRef = useRef<UIState>("IDLE");

  // Keep the active tab fully visible inside the horizontal scroller.
  useEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLElement>("[data-active='true']");
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeTab]);

  // On phones, bring the fresh result into view so Preview / Download are
  // reachable without hunting. Desktop behavior is left untouched.
  useEffect(() => {
    if (state === "SUCCESS" && prevStateRef.current !== "SUCCESS") {
      if (typeof window !== "undefined" && window.innerWidth < 640) {
        requestAnimationFrame(() => {
          resultAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    }
    prevStateRef.current = state;
  }, [state]);

  return (
    <section
      id="hero"
      className="hero-section relative overflow-hidden scroll-mt-24 pt-6 sm:pt-8 lg:pt-10 pb-12 sm:pb-20 lg:pb-24"
    >
      <div className="absolute inset-0 -z-10" aria-hidden="true">
        <div className="absolute left-1/2 top-0 h-[420px] w-full max-w-[1000px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/[0.03] blur-[160px] sm:h-[700px]" />
      </div>

      <div className="mx-auto w-full max-w-[1240px] min-w-0 px-4 sm:px-6 lg:px-8 xl:px-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-8 xl:gap-12 items-center">
          {/* Left Content Column */}
          <div className="lg:col-span-7 min-w-0 flex flex-col text-left">
            <div
              className="animate-fade-in-up mb-4 inline-flex max-w-full items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-semibold tracking-wide text-fg-muted sm:mb-5 sm:gap-2 sm:px-4 sm:text-xs self-start"
              style={{ background: "var(--card)", boxShadow: "var(--shadow-card)", border: "1px solid var(--border)" }}
            >
              <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-accent" />
              <Sparkles size={14} color="var(--accent)" strokeWidth={2} className="shrink-0" />
              <span className="truncate">{t.hero.badge}</span>
            </div>

            <h1 className="animate-fade-in-up delay-100 max-w-full text-balance break-words" style={{ lineHeight: 1.12 }}>
              <span
                className="hero-title-a block text-balance break-words text-[32px] sm:text-[42px] xl:text-[48px] font-extrabold text-fg tracking-tight"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                Instagram Downloader –
              </span>
              <span
                className="hero-title-b block text-balance break-words text-[28px] sm:text-[38px] xl:text-[44px] font-bold italic"
                style={{
                  fontFamily: "var(--font-accent)",
                  background: "var(--brand-gradient-text)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                Reels, Videos, Photos &amp; Audio
              </span>
            </h1>

            <p className="hero-subtitle animate-fade-in-up delay-200 mt-4 text-[15px] sm:text-[16px] leading-[1.65] text-fg-muted max-w-xl">
              Download public Instagram Reels, videos, photos, stories and audio with Downloadit. Preview media and save it to your device quickly — no login required.
            </p>

            {/* Hero Category Row — 5 types: Reels, Videos, Photos, Stories, Audio */}
            <div className="animate-fade-in-up delay-250 mt-6 w-full">
              <div
                role="tablist"
                aria-label="Supported downloaders"
                className="grid grid-cols-2 sm:grid-cols-5 gap-2"
              >
                {HERO_CATEGORIES.map((cat) => {
                  const active = activeTab === cat.id;
                  const Icon = cat.icon;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => onActiveTabChange(cat.id)}
                      className={`group flex flex-col items-start p-2.5 xl:p-3 rounded-xl transition-all duration-200 text-left cursor-pointer border ${
                        active
                          ? "bg-primary-light border-primary/40 shadow-xs"
                          : "bg-card border-border hover:border-primary/30 hover:bg-primary-light/40"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-1.5">
                        <span className={`text-[12.5px] font-bold transition-colors ${active ? "text-primary" : "text-fg group-hover:text-primary"}`}>
                          {cat.title}
                        </span>
                        <span
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                          style={{ background: cat.iconBg, color: cat.iconColor }}
                        >
                          <Icon size={12} strokeWidth={2.2} />
                        </span>
                      </div>
                      <span className="text-[10.5px] leading-tight text-fg-subtle truncate max-w-full">
                        {cat.subtitle}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Input Bar */}
            <div className="animate-fade-in-up delay-300 mt-5 w-full">
              <form onSubmit={handleSubmit} className="relative min-w-0" noValidate>
                <div
                  className="url-card rounded-[20px] p-2.5 transition-shadow"
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
                        placeholder="Paste Instagram link here..."
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
                      className="flex h-13 shrink-0 items-center gap-1.5 rounded-xl border border-border px-3.5 text-xs font-medium text-fg-muted transition-colors hover:bg-primary-light hover:text-primary disabled:opacity-50"
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
                          <span>Download</span>
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
                        placeholder="Paste Instagram link here..."
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
                    <div className="url-actions flex min-w-0 flex-col gap-2">
                      <button
                        type="button"
                        onClick={handlePaste}
                        disabled={state === "PREPARING"}
                        className="flex h-12 min-h-[48px] w-full min-w-0 items-center justify-center gap-1.5 rounded-xl border border-border px-3 text-[14px] font-medium text-fg-muted transition-colors hover:bg-primary-light hover:text-primary disabled:opacity-50"
                        style={{ background: "var(--bg)" }}
                        aria-label={t.common.paste}
                      >
                        <Clipboard className="h-4 w-4 shrink-0" />
                        <span className="btn-label truncate">{t.common.paste}</span>
                      </button>
                      <button
                        type="submit"
                        disabled={state === "PREPARING"}
                        className="gradient-btn h-12 min-h-[48px] w-full min-w-0 px-3 text-[15px]"
                      >
                        {state === "PREPARING" ? (
                          <>
                            <svg className="h-5 w-5 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                              <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" className="opacity-75" />
                            </svg>
                            <span className="btn-label truncate">{t.common.resolving}</span>
                          </>
                        ) : (
                          <>
                            <DownloadIcon className="h-5 w-5 shrink-0" />
                            <span className="btn-label truncate">Download</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </form>

              {/* Trust Badges */}
              <div className="mt-3 flex flex-wrap items-center justify-start gap-x-4 gap-y-1.5 px-1 text-[12.5px] text-fg-subtle sm:mt-4 sm:gap-x-5 sm:text-[13.5px]">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
                  {t.hero.foot1}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
                  {t.hero.foot2}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
                  {t.hero.foot3}
                </span>
              </div>
            </div>
          </div>

          {/* Right Visual Column (Phone + 4 Floating Cards: Reels, Photos, Stories, Audio - NO highlights) */}
          <div className="hidden lg:flex lg:col-span-5 min-w-0 items-center justify-center relative py-6">
            <div className="relative w-full max-w-[320px] xl:max-w-[340px] flex items-center justify-center">
              {/* Phone Mockup Frame */}
              <div
                className="relative w-[275px] xl:w-[290px] h-[510px] xl:h-[530px] rounded-[42px] p-2 shadow-2xl select-none"
                style={{
                  background: "#0b0c16",
                  border: "8px solid #1c1d2e",
                  boxShadow: "0 25px 60px -12px rgba(124, 77, 245, 0.25), 0 12px 30px rgba(0, 0, 0, 0.4)",
                }}
              >
                {/* Dynamic Island */}
                <div className="mx-auto h-4 w-20 rounded-full bg-black mb-2" />

                {/* Mock Phone Screen */}
                <div className="h-[calc(100%-24px)] rounded-[32px] bg-slate-900 overflow-hidden flex flex-col justify-between text-white p-3 border border-white/5">
                  {/* Mock IG Header */}
                  <div className="flex items-center justify-between pb-2 border-b border-white/10">
                    <span className="text-[14px] font-bold italic tracking-wide" style={{ background: "var(--brand-gradient-text)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                      Instagram
                    </span>
                    <div className="flex items-center gap-2 text-white/70">
                      <Heart size={14} />
                      <Send size={14} />
                    </div>
                  </div>

                  {/* Mock Post Account */}
                  <div className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-full p-[1.5px]" style={{ background: "var(--brand-gradient)" }}>
                        <div className="h-full w-full rounded-full bg-slate-950 flex items-center justify-center text-[10px] font-bold text-pink-400">
                          D
                        </div>
                      </div>
                      <span className="text-[12px] font-semibold text-white/90">downloadit.pro</span>
                    </div>
                    <span className="text-white/40 text-[11px]">•••</span>
                  </div>

                  {/* Mock Video / Reel Area */}
                  <div className="relative aspect-[4/5] rounded-2xl overflow-hidden flex flex-col justify-between p-3" style={{ background: "linear-gradient(135deg, #4c1d95 0%, #831843 50%, #9a3412 100%)" }}>
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium backdrop-blur-md">
                        <Film size={10} /> Reels
                      </span>
                      <span className="rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium backdrop-blur-md">
                        0:45
                      </span>
                    </div>

                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/20 backdrop-blur-md shadow-lg border border-white/30">
                      <Play size={20} className="ml-1 text-white fill-white" />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-white/80">
                      <span className="truncate flex items-center gap-1">
                        <Music size={11} /> Original Audio · Viral Hits
                      </span>
                      <Volume2 size={13} />
                    </div>
                  </div>

                  {/* Mock Post Actions */}
                  <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-3 text-white/80 text-[11px]">
                      <span className="flex items-center gap-1"><Heart size={14} className="text-pink-500 fill-pink-500" /> 84.2k</span>
                      <span className="flex items-center gap-1"><MessageCircle size={14} /> 1.4k</span>
                      <Send size={14} />
                    </div>
                    <Bookmark size={14} className="text-white/80" />
                  </div>
                </div>
              </div>

              {/* Floating Card 1: Reels (Top-Left) */}
              <div
                className="animate-float-1 absolute -left-4 xl:-left-8 top-10 flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 backdrop-blur-xl transition-transform hover:scale-105"
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  boxShadow: "0 14px 30px rgba(236, 95, 168, 0.15), var(--shadow-card)",
                }}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: "linear-gradient(135deg, #7c4df5, #ec5fa8)" }}>
                  <Film size={18} strokeWidth={2.2} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold text-fg">Reels</span>
                    <span className="rounded-md px-1.5 py-0.2 text-[9.5px] font-bold text-pink-600 bg-pink-500/10">1080p</span>
                  </div>
                  <span className="block text-[11px] font-medium text-fg-subtle">Download Reels</span>
                </div>
              </div>

              {/* Floating Card 2: Stories (Top-Right) */}
              <div
                className="animate-float-2 absolute -right-4 xl:-right-8 top-20 flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 backdrop-blur-xl transition-transform hover:scale-105"
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  boxShadow: "0 14px 30px rgba(14, 165, 233, 0.15), var(--shadow-card)",
                }}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: "linear-gradient(135deg, #0ea5e9, #38bdf8)" }}>
                  <Clock size={18} strokeWidth={2.2} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold text-fg">Stories</span>
                    <span className="rounded-md px-1.5 py-0.2 text-[9.5px] font-bold text-sky-600 bg-sky-500/10">24h</span>
                  </div>
                  <span className="block text-[11px] font-medium text-fg-subtle">Save Stories</span>
                </div>
              </div>

              {/* Floating Card 3: Audio (Bottom-Left) */}
              <div
                className="animate-float-2 absolute -left-4 xl:-left-8 bottom-16 flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 backdrop-blur-xl transition-transform hover:scale-105"
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  boxShadow: "0 14px 30px rgba(16, 185, 129, 0.15), var(--shadow-card)",
                }}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: "linear-gradient(135deg, #059669, #10b981)" }}>
                  <Music size={18} strokeWidth={2.2} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold text-fg">Audio</span>
                    <span className="rounded-md px-1.5 py-0.2 text-[9.5px] font-bold text-emerald-600 bg-emerald-500/10">MP3</span>
                  </div>
                  <span className="block text-[11px] font-medium text-fg-subtle">Extract Audio</span>
                </div>
              </div>

              {/* Floating Card 4: Photos (Bottom-Right) */}
              <div
                className="animate-float-1 absolute -right-4 xl:-right-8 bottom-8 flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 backdrop-blur-xl transition-transform hover:scale-105"
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  boxShadow: "0 14px 30px rgba(245, 142, 91, 0.15), var(--shadow-card)",
                }}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: "linear-gradient(135deg, #f58e5b, #fb923c)" }}>
                  <ImageIcon size={18} strokeWidth={2.2} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold text-fg">Photos</span>
                    <span className="rounded-md px-1.5 py-0.2 text-[9.5px] font-bold text-amber-600 bg-amber-500/10">Original</span>
                  </div>
                  <span className="block text-[11px] font-medium text-fg-subtle">Get Photos</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Result / Error Area */}
        <div ref={resultAnchorRef} aria-live="polite" aria-atomic="true" className="scroll-mt-20">
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
            <div className="animate-fade-in-up mx-auto mt-6 w-full max-w-[720px] sm:mt-10 sm:px-5">
              <div
                className="rounded-[20px] p-5 text-center sm:p-8"
                style={{ border: "1px solid rgba(220,38,38,0.15)", background: "var(--danger-light)" }}
                role="alert"
              >
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "rgba(220,38,38,0.1)" }}>
                  <AlertCircle className="h-6 w-6 text-danger" />
                </div>
                <p className="text-sm font-medium break-words text-danger">{error}</p>
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
