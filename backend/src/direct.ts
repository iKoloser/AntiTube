/**
 * Motor de streaming propio, sin yt-dlp. YouTube se resuelve dentro del propio
 * motor con YouTube.js (la misma API interna que usan sus apps, con su sesión y
 * el descifrado de firmas), y SoundCloud con su API pública. Ningún programa
 * aparte que arrancar: una petición y suena.
 */

import vm from "node:vm";
import { Constants, Innertube, Platform, YTNodes } from "youtubei.js";
import type { Types } from "youtubei.js";
type InnerTubeClient = Types.InnerTubeClient;
import { soundcloudClientId } from "./soundcloud.js";

export type DirectAudio = { url: string; headers: Record<string, string>; duration: number | null; title: string | null; hls: boolean; mime: string | null; bitrate: number | null; via: string };

// El reproductor de YouTube trae una función que hay que ejecutar para descifrar
// algunas URLs (solo los clientes de respaldo; visionOS no la necesita). Se
// ejecuta en un contexto aislado de Node, sin acceso a nada del sistema.
Platform.shim.eval = (data, env) => vm.runInNewContext(`${data.output}\nprocess(n, sp, sig);`, {
  n: env.n ?? "", sp: env.sp ?? "", sig: env.sig ?? "", URL, URLSearchParams, TextEncoder, TextDecoder
}, { timeout: 3000 }) as Record<string, unknown>;

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

// Sesiones de YouTube abiertas para toda la app. La ligera (menos de 100 ms)
// basta para los clientes que dan URLs listas; la completa descarga además el
// reproductor de YouTube (1-2 s) para los clientes que hay que descifrar. Se
// preparan al arrancar y se renuevan cada pocas horas.
type Session = { client: Promise<Innertube>; created: number };
const sessions: { lite: Session | null; full: Session | null } = { lite: null, full: null };
const sessionLifetime = 6 * 60 * 60 * 1000;

function youtube(kind: "lite" | "full" = "lite"): Promise<Innertube> {
  const current = sessions[kind];
  if (!current || Date.now() - current.created > sessionLifetime) {
    const started = Date.now();
    const client = Innertube.create({ retrieve_player: kind === "full", lang: "es", location: "ES" });
    client.then(() => console.log(`[youtube] sesión ${kind === "full" ? "completa" : "ligera"} lista en ${Date.now() - started} ms`), (error) => {
      console.error(`[youtube] no se pudo abrir la sesión: ${error instanceof Error ? error.message : String(error)}`);
      sessions[kind] = null;
    });
    sessions[kind] = { client, created: Date.now() };
  }
  return (sessions[kind] as Session).client;
}

// Clientes cuyas URLs hay que descifrar con el reproductor de YouTube.
const needsPlayer = new Set<string>(["TV", "TV_SIMPLY", "TV_EMBEDDED", "WEB", "MWEB", "WEB_EMBEDDED", "ANDROID"]);

/** Abre la sesión de YouTube en segundo plano para que la primera canción no espere. */
export function warmupStreaming(): void {
  void youtube("lite").catch(() => undefined);
  void youtube("full").catch(() => undefined);
  void soundcloudClientId().catch(() => undefined);
}

// Clientes de YouTube por orden. Medido en el PC de Jordi (26/11/2026, 8 vídeos):
// VISIONOS dio el audio Opus 251 en 8 de 8 (info ~115 ms, canción entera en
// <400 ms); TV_SIMPLY e IOS solo en 1 de 8; ANDROID_VR en 0 de 8 (403). yt-dlp
// tardaba 4-5 s y sus URLs también daban 403 fuera de yt-dlp.
// Si un cliente falla al descargar, pasa al final de la fila.
const clientOrder: InnerTubeClient[] = (process.env.ANTITUBE_YT_CLIENTS?.split(",").map((value) => value.trim()).filter(Boolean) as InnerTubeClient[] | undefined) ?? ["VISIONOS", "TV_SIMPLY", "IOS", "ANDROID_VR"];

/** Un cliente cuyo audio YouTube rechazó al descargar pasa al final de la fila. */
export function demoteYouTubeClient(client: string): void {
  const position = clientOrder.indexOf(client as InnerTubeClient);
  if (position >= 0 && position < clientOrder.length - 1) { clientOrder.splice(position, 1); clientOrder.push(client as InnerTubeClient); }
}

export async function youtubeDirect(url: string, skip: string[] = []): Promise<DirectAudio | null> {
  const videoId = youtubeVideoId(url);
  if (!videoId) return null;
  const errors: string[] = [];
  for (const client of clientOrder.filter((name) => !skip.includes(name))) {
    const started = Date.now();
    try {
      const yt = await youtube(needsPlayer.has(client) ? "full" : "lite");
      const info = await yt.getBasicInfo(videoId, { client });
      const status = info.playability_status?.status;
      if (status !== "OK" || info.basic_info.is_live) { errors.push(`${client}: ${status ?? "?"} ${info.playability_status?.reason ?? ""}`.trim()); continue; }
      // Máxima calidad: el audio de más bitrate (normalmente Opus 251, ~160 kbps),
      // sin las versiones «DRC» de volumen comprimido.
      const audio = (info.streaming_data?.adaptive_formats ?? []).filter((format) => format.has_audio && !format.has_video && !format.is_drc);
      const best = audio.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
      if (!best) { errors.push(`${client}: sin audio`); continue; }
      const direct = await best.decipher(needsPlayer.has(client) ? yt.session.player : undefined);
      if (!direct) { errors.push(`${client}: sin URL`); continue; }
      if (clientOrder[0] !== client) { clientOrder.splice(clientOrder.indexOf(client), 1); clientOrder.unshift(client); }
      console.log(`[youtube] ${videoId} con ${client} en ${Date.now() - started} ms (itag ${best.itag}, ${Math.round((best.bitrate ?? 0) / 1000)} kbps)`);
      const agent = (Constants.CLIENTS as Record<string, { USER_AGENT?: string }>)[client]?.USER_AGENT;
      return { url: direct, headers: agent ? { "User-Agent": agent } : {}, duration: info.basic_info.duration ?? null, title: info.basic_info.title ?? null, hls: false, mime: best.mime_type ?? null, bitrate: best.bitrate ?? null, via: client };
    } catch (error) {
      errors.push(`${client}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 160));
    }
  }
  if (skip.length > 0 && errors.length === 0) return null;
  throw new Error(`YouTube no dio audio (${errors.join(" | ")})`);
}

type Transcoding = { url?: string; snipped?: boolean; preset?: string; quality?: string; format?: { protocol?: string; mime_type?: string } };

// Calidad aproximada de cada versión que ofrece SoundCloud, para quedarse con la mejor.
function soundcloudRank(item: Transcoding): number {
  const preset = item.preset ?? "";
  const mime = item.format?.mime_type ?? "";
  const kbps = Number(/(\d+)k/.exec(preset)?.[1]) || (/aac|mp4/.test(mime) ? (item.quality === "hq" ? 256 : 160) : /mpeg/.test(mime) ? 128 : /opus|ogg/.test(mime) ? 64 : 0);
  // A igual calidad, mejor progresivo (se reenvía tal cual y se puede saltar sin FFmpeg).
  return kbps * 10 + (item.format?.protocol === "progressive" ? 5 : 0);
}

export async function soundcloudDirect(url: string): Promise<DirectAudio | null> {
  let host = "";
  try { host = new URL(url).hostname; } catch { return null; }
  if (!/(^|\.)soundcloud\.com$/.test(host)) return null;
  const started = Date.now();
  const fetchJson = async (target: string, retry = true): Promise<Record<string, unknown>> => {
    const clientId = await soundcloudClientId(!retry);
    const response = await fetch(`${target}${target.includes("?") ? "&" : "?"}client_id=${clientId}`, { signal: AbortSignal.timeout(5000) });
    if ((response.status === 401 || response.status === 403) && retry) return fetchJson(target, false);
    if (!response.ok) throw new Error(`SoundCloud respondió ${response.status}`);
    return response.json() as Promise<Record<string, unknown>>;
  };
  const resolveUrl = /api(-v2)?\.soundcloud\.com\/tracks\/\d+/.test(url)
    ? url.split("?")[0].replace("api.soundcloud.com", "api-v2.soundcloud.com")
    : `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}`;
  const track = await fetchJson(resolveUrl) as { kind?: string; title?: string; duration?: number; full_duration?: number; track_authorization?: string; media?: { transcodings?: Transcoding[] } };
  if (track.kind !== "track") return null;
  const options = (track.media?.transcodings ?? []).filter((item) => item.url && !item.snipped).sort((a, b) => soundcloudRank(b) - soundcloudRank(a));
  for (const chosen of options) {
    try {
      const stream = await fetchJson(`${chosen.url}${track.track_authorization ? `?track_authorization=${track.track_authorization}` : ""}`) as { url?: string };
      if (!stream.url) continue;
      const milliseconds = track.full_duration ?? track.duration;
      console.log(`[soundcloud] ${chosen.preset ?? chosen.format?.mime_type} (${chosen.format?.protocol}) en ${Date.now() - started} ms`);
      return { url: stream.url, headers: {}, duration: typeof milliseconds === "number" ? milliseconds / 1000 : null, title: track.title ?? null, hls: chosen.format?.protocol === "hls", mime: chosen.format?.mime_type ?? null, bitrate: null, via: `soundcloud ${chosen.preset ?? ""}`.trim() };
    } catch { /* se prueba la siguiente versión */ }
  }
  throw new Error("SoundCloud no dio ninguna versión reproducible");
}

export type NativeSearchResult = { id: string; title: string; uploader: string | null; durationSeconds: number | null; thumbnailUrl: string | null; url: string };

/** Búsqueda en YouTube con la sesión abierta: unos cientos de ms en vez de los 4-5 s de yt-dlp. */
export async function youtubeSearch(query: string, limit: number): Promise<NativeSearchResult[]> {
  const yt = await youtube("lite");
  const search = await yt.search(query, { type: "video" });
  const found: NativeSearchResult[] = [];
  for (const node of search.results) {
    if (!node.is(YTNodes.Video)) continue;
    const video = node.as(YTNodes.Video);
    if (!video.video_id || video.is_live) continue;
    found.push({ id: video.video_id, title: video.title.toString(), uploader: video.author?.name ?? null, durationSeconds: video.duration?.seconds || null, thumbnailUrl: `https://i.ytimg.com/vi/${video.video_id}/mqdefault.jpg`, url: `https://www.youtube.com/watch?v=${video.video_id}` });
    if (found.length >= limit) break;
  }
  return found;
}

/** Canciones de YouTube Music (con artista y duración de la canción). */
export async function youtubeMusicSearch(query: string, limit: number): Promise<NativeSearchResult[]> {
  const yt = await youtube("lite");
  const search = await yt.music.search(query, { type: "song" });
  const found: NativeSearchResult[] = [];
  for (const node of search.songs?.contents ?? []) {
    if (!node.is(YTNodes.MusicResponsiveListItem)) continue;
    const song = node.as(YTNodes.MusicResponsiveListItem);
    if (!song.id || !/^[\w-]{11}$/.test(song.id)) continue;
    const thumbnail = song.thumbnail?.contents?.at(-1)?.url ?? `https://i.ytimg.com/vi/${song.id}/mqdefault.jpg`;
    found.push({ id: song.id, title: song.title ?? "", uploader: song.artists?.map((artist) => artist.name).join(", ") || null, durationSeconds: song.duration?.seconds || null, thumbnailUrl: thumbnail, url: `https://www.youtube.com/watch?v=${song.id}` });
    if (found.length >= limit) break;
  }
  return found;
}

/** Búsqueda en SoundCloud con su API pública (la misma que usa su web). */
export async function soundcloudSearch(query: string, limit: number): Promise<NativeSearchResult[]> {
  const request = async (retry: boolean): Promise<Response> => {
    const clientId = await soundcloudClientId(!retry);
    const response = await fetch(`https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&limit=${limit}&client_id=${clientId}`, { signal: AbortSignal.timeout(8000) });
    if ((response.status === 401 || response.status === 403) && retry) return request(false);
    if (!response.ok) throw new Error(`SoundCloud respondió ${response.status}`);
    return response;
  };
  const data = await (await request(true)).json() as { collection?: Array<{ id?: number; title?: string; duration?: number; full_duration?: number; artwork_url?: string | null; permalink_url?: string; user?: { username?: string; avatar_url?: string } }> };
  return (data.collection ?? []).filter((track) => track.permalink_url && track.title).slice(0, limit).map((track) => ({
    id: String(track.id ?? ""),
    title: track.title as string,
    uploader: track.user?.username ?? null,
    durationSeconds: typeof (track.full_duration ?? track.duration) === "number" ? Math.round((track.full_duration ?? track.duration as number) / 1000) : null,
    thumbnailUrl: (track.artwork_url ?? track.user?.avatar_url ?? null)?.replace("-large.", "-t500x500.") ?? null,
    url: track.permalink_url as string
  }));
}
