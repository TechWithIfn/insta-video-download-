export function getApiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001").replace(/\/+$/, "");
}

export interface MediaItem {
  url: string;
  type: "image" | "video" | "audio";
  width: number | null;
  height: number | null;
  duration: number | null;
  size?: number | null;
  thumbnail: string | null;
  format: string | null;
}

export interface Author {
  username: string | null;
  displayName: string | null;
}

export interface ResolveData {
  type: string;
  sourceUrl: string;
  thumbnail: string | null;
  title: string | null;
  author: Author | null;
  media: MediaItem[];
  mediaId?: string;
  /** 0-based carousel start slide from `?img_index=` (null when absent). */
  startIndex?: number | null;
}

export interface ResolveSuccess {
  success: true;
  data: ResolveData;
}

export interface ResolveError {
  success: false;
  error: { code: string; message: string };
}

export type ResolveResponse = ResolveSuccess | ResolveError;

export async function resolveInstagramUrl(url: string, signal?: AbortSignal): Promise<ResolveResponse> {
  const response = await fetch(`${getApiBase()}/api/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (body && !body.success && body.error) {
      return body as ResolveError;
    }
    return { success: false, error: { code: "TEMPORARY_ERROR", message: "The server returned an unexpected response." } };
  }
  return response.json();
}

export interface ResolveStreamHandlers {
  onProgress: (progress: number, stage: string) => void;
  onComplete: (data: ResolveData) => void;
  onError: (error: { code: string; message: string }) => void;
  /**
   * Transport-level failure: the stream dropped without any server payload
   * (network cut, proxy timeout, blocked EventSource). When provided, the
   * caller owns recovery (e.g. one plain POST fallback) and this function
   * reports nothing itself. Otherwise a generic connection error is sent
   * to onError.
   */
  onTransportError?: () => void;
}

export interface ResolveStreamHandle {
  close: () => void;
}

/**
 * Opens the SSE resolve stream. Every `progress` event corresponds to a
 * backend stage that has actually completed — the client never synthesizes
 * percentages. Returns a handle whose `close()` stops the stream (used for
 * superseded requests and unmount cleanup). Each stream is single-use:
 * `complete`/`error` close it automatically.
 */
export function startResolveStream(url: string, handlers: ResolveStreamHandlers): ResolveStreamHandle {
  const es = new EventSource(`${getApiBase()}/api/resolve/stream?url=${encodeURIComponent(url)}`);
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      es.close();
    }
  };
  const transportError = () => {
    close();
    if (handlers.onTransportError) {
      handlers.onTransportError();
      return;
    }
    handlers.onError({ code: "TEMPORARY_ERROR", message: "Connection to the server was lost." });
  };

  es.addEventListener("progress", (e) => {
    try {
      const data = JSON.parse((e as MessageEvent).data) as { progress?: unknown; stage?: unknown };
      if (typeof data.progress === "number") {
        handlers.onProgress(data.progress, typeof data.stage === "string" ? data.stage : "");
      }
    } catch {
      /* ignore malformed tick */
    }
  });

  es.addEventListener("complete", (e) => {
    try {
      const data = JSON.parse((e as MessageEvent).data) as { data?: ResolveData };
      if (data && data.data && Array.isArray(data.data.media)) {
        handlers.onComplete(data.data);
      } else {
        handlers.onError({ code: "TEMPORARY_ERROR", message: "The server returned an unexpected response." });
      }
    } catch {
      handlers.onError({ code: "TEMPORARY_ERROR", message: "The server returned an unexpected response." });
    }
    close();
  });

  es.addEventListener("error", (e) => {
    const raw = (e as MessageEvent).data;
    if (typeof raw === "string" && raw) {
      try {
        const data = JSON.parse(raw) as { code?: unknown; message?: unknown };
        if (data && typeof data.code === "string") {
          handlers.onError({
            code: data.code,
            message: typeof data.message === "string" && data.message ? data.message : "Something went wrong.",
          });
          close();
          return;
        }
      } catch {
        /* fall through to transport error */
      }
    }
    // No payload means the transport itself failed (EventSource network error).
    transportError();
  });

  return { close };
}

export function getStreamUrl(mediaUrl: string, sourceUrl?: string): string {
  const base = `${getApiBase()}/api/stream?url=${encodeURIComponent(mediaUrl)}`;
  return sourceUrl ? `${base}&source=${encodeURIComponent(sourceUrl)}` : base;
}

export function getDownloadUrl(mediaUrl: string, filename: string, sourceUrl?: string): string {
  const base = `${getApiBase()}/api/download?url=${encodeURIComponent(mediaUrl)}&filename=${encodeURIComponent(filename)}`;
  return sourceUrl ? `${base}&source=${encodeURIComponent(sourceUrl)}` : base;
}
