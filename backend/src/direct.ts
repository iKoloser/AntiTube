/**
 * Vía directa para escuchar al instante: en vez de arrancar yt-dlp (un programa
 * aparte que tarda segundos en abrir, cargar la página y resolverla), el motor
 * pide el audio a YouTube o SoundCloud con una sola petición, como hacen sus
 * propias apps. Si algo no cuadra, se devuelve null y se usa yt-dlp como siempre.
 */

import { soundcloudClientId } from "./soundcloud.js";

export type DirectAudio = { url: string; headers: Record<string, string>; duration: number | null; title: string | null; hls: boolean };

// Mismo cliente que usa yt-dlp para YouTube sin reproductor web (Android VR):
// URLs directas, sin firmas que descifrar ni retos de JavaScript.
const vrVersion = "1.65.10";
const vrAgent = `com.google.android.apps.youtube.vr.oculus/${vrVersion} (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip`;

export function youtubeVideoId(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\.|^m\.|^music\./, "");
    if (host === "youtu.be") return /^[\w-]{11}$/.test(url.pathname.slice(1)) ? url.pathname.slice(1) : null;
    if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return null;
    const fromQuery = url.searchParams.get("v");
    if (fromQuery && /^[\w-]{11}$/.test(fromQuery)) return fromQuery;
    const fromPath = /^\/(?:shorts|embed|live|v)\/([\w-]{11})/.exec(url.pathname);
    return fromPath ? fromPath[1] : null;
  } catch {
    return null;
  }
}

type YouTubeFormat = { itag?: number; url?: string; mimeType?: string; bitrate?: number; approxDurationMs?: string; audioQuality?: string };

export async function youtubeDirect(url: string): Promise<DirectAudio | null> {
  const videoId = youtubeVideoId(url);
  if (!videoId) return null;
  const response = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    signal: AbortSignal.timeout(4000),
    headers: { "Content-Type": "application/json", "User-Agent": vrAgent, "X-YouTube-Client-Name": "28", "X-YouTube-Client-Version": vrVersion, Origin: "https://www.youtube.com" },
    body: JSON.stringify({
      context: { client: { clientName: "ANDROID_VR", clientVersion: vrVersion, deviceMake: "Oculus", deviceModel: "Quest 3", androidSdkVersion: 32, osName: "Android", osVersion: "12L", userAgent: vrAgent, hl: "es", gl: "ES" } },
      videoId, contentCheckOk: true, racyCheckOk: true
    })
  });
  if (!response.ok) return null;
  const data = await response.json() as { playabilityStatus?: { status?: string }; videoDetails?: { title?: string; lengthSeconds?: string; isLive?: boolean }; streamingData?: { adaptiveFormats?: YouTubeFormat[] } };
  if (data.playabilityStatus?.status !== "OK" || data.videoDetails?.isLive) return null;
  const audio = (data.streamingData?.adaptiveFormats ?? []).filter((format) => format.url && format.mimeType?.startsWith("audio/"));
  // M4A (AAC, itag 140) es lo más compatible; si no, Opus; si no, lo de más calidad.
  const chosen = audio.find((format) => format.itag === 140) ?? audio.find((format) => format.itag === 251) ?? audio.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
  if (!chosen?.url) return null;
  const seconds = Number(data.videoDetails?.lengthSeconds);
  return { url: chosen.url, headers: { "User-Agent": vrAgent }, duration: Number.isFinite(seconds) && seconds > 0 ? seconds : null, title: data.videoDetails?.title ?? null, hls: false };
}

type Transcoding = { url?: string; snipped?: boolean; format?: { protocol?: string; mime_type?: string } };

export async function soundcloudDirect(url: string): Promise<DirectAudio | null> {
  let host = "";
  try { host = new URL(url).hostname; } catch { return null; }
  if (!/(^|\.)soundcloud\.com$/.test(host)) return null;
  const clientId = await soundcloudClientId();
  const resolveUrl = /api(-v2)?\.soundcloud\.com\/tracks\/\d+/.test(url)
    ? `${url.split("?")[0].replace("api.soundcloud.com", "api-v2.soundcloud.com")}?client_id=${clientId}`
    : `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${clientId}`;
  const trackResponse = await fetch(resolveUrl, { signal: AbortSignal.timeout(4000) });
  if (!trackResponse.ok) return null;
  const track = await trackResponse.json() as { kind?: string; title?: string; duration?: number; full_duration?: number; track_authorization?: string; media?: { transcodings?: Transcoding[] } };
  if (track.kind !== "track") return null;
  const options = (track.media?.transcodings ?? []).filter((item) => item.url && !item.snipped);
  // Progresivo (MP3 entero) si lo hay: se reenvía tal cual. Si no, HLS (AAC u Opus).
  const chosen = options.find((item) => item.format?.protocol === "progressive")
    ?? options.find((item) => item.format?.protocol === "hls" && /mp4|aac/.test(item.format?.mime_type ?? ""))
    ?? options.find((item) => item.format?.protocol === "hls" && /mpeg/.test(item.format?.mime_type ?? ""))
    ?? options.find((item) => item.format?.protocol === "hls");
  if (!chosen?.url) return null;
  const streamResponse = await fetch(`${chosen.url}?client_id=${clientId}${track.track_authorization ? `&track_authorization=${track.track_authorization}` : ""}`, { signal: AbortSignal.timeout(4000) });
  if (!streamResponse.ok) return null;
  const stream = await streamResponse.json() as { url?: string };
  if (!stream.url) return null;
  const milliseconds = track.full_duration ?? track.duration;
  return { url: stream.url, headers: {}, duration: typeof milliseconds === "number" ? milliseconds / 1000 : null, title: track.title ?? null, hls: chosen.format?.protocol === "hls" };
}
