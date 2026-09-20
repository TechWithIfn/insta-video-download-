const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export interface MediaItem {
  url: string;
  type: "image" | "video";
  width: number | null;
  height: number | null;
  duration: number | null;
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
  const response = await fetch(`${API_BASE}/api/resolve`, {
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

export function getStreamUrl(mediaUrl: string, sourceUrl?: string): string {
  const base = `${API_BASE}/api/stream?url=${encodeURIComponent(mediaUrl)}`;
  return sourceUrl ? `${base}&source=${encodeURIComponent(sourceUrl)}` : base;
}

export function getDownloadUrl(mediaUrl: string, filename: string, sourceUrl?: string): string {
  const base = `${API_BASE}/api/download?url=${encodeURIComponent(mediaUrl)}&filename=${encodeURIComponent(filename)}`;
  return sourceUrl ? `${base}&source=${encodeURIComponent(sourceUrl)}` : base;
}
