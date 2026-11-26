/**
 * Motor de streaming propio, sin yt-dlp. YouTube se resuelve dentro del propio
 * motor con YouTube.js (la misma API interna que usan sus apps, con su sesión y
 * el descifrado de firmas), y SoundCloud con su API pública. Ningún programa
 * aparte que arrancar: una petición y suena.
 */

import { Innertube, Platform } from "youtubei.js";
import type { Types } from "youtubei.js";
type InnerTubeClient = Types.InnerTubeClient;
import { soundcloudClientId } from "./soundcloud.js";

export type DirectAudio = { url: string; headers: Record<string, string>; duration: number | null; title: string | null; hls: boolean; mime: string | null; bitrate: number | null; via: string };

// El reproductor de YouTube trae una función que hay que ejecutar para descifrar
// las URLs: se ejecuta aquí, aislada en su propia función.
Platform.shim.eval = (data, env) => new Function("n", "sp", "sig", `${data.output}\nreturn process(n, sp, sig);`)(env.n ?? "", env.sp ?? "", env.sig ?? "");

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

// Una sesión de YouTube abierta para toda la app: se prepara al arrancar y se
// renueva cada pocas horas (el reproductor de YouTube cambia a menudo).
let session: { client: Promise<Innertube>; created: number } | null = null;
const sessionLifetime = 6 * 60 * 60 * 1000;

function youtube(): Promise<Innertube> {
  if (!session || Date.now() - session.created > sessionLifetime) {
    const started = Date.now();
    const client = Innertube.create({ retrieve_player: true, lang: "es", location: "ES" });
    client.then(() => console.log(`[youtube] sesión lista en ${Date.now() - started} ms`), (error) => {
      console.error(`[youtube] no se pudo abrir la sesión: ${error instanceof Error ? error.message : String(error)}`);
      session = null;
    });
    session = { client, created: Date.now() };
  }
  return session.client;
}

/** Abre la sesión de YouTube en segundo plano para que la primera canción no espere. */
export function warmupStreaming(): void {
  void youtube().catch(() => undefined);
  void soundcloudClientId().catch(() => undefined);
}

// Clientes de YouTube por orden; el que funcione pasa a ser el primero.
const clientOrder: InnerTubeClient[] = (process.env.ANTITUBE_YT_CLIENTS?.split(",").map((value) => value.trim()).filter(Boolean) as InnerTubeClient[] | undefined) ?? ["ANDROID_VR", "TV", "WEB_EMBEDDED", "MWEB"];

export async function youtubeDirect(url: string): Promise<DirectAudio | null> {
  const videoId = youtubeVideoId(url);
  if (!videoId) return null;
  const yt = await youtube();
  const errors: string[] = [];
  for (const client of [...clientOrder]) {
    const started = Date.now();
    try {
      const info = await yt.getBasicInfo(videoId, { client });
      const status = info.playability_status?.status;
      if (status !== "OK" || info.basic_info.is_live) { errors.push(`${client}: ${status ?? "?"} ${info.playability_status?.reason ?? ""}`.trim()); continue; }
      // Máxima calidad: el audio de más bitrate (normalmente Opus 251, ~160 kbps),
      // sin las versiones «DRC» de volumen comprimido.
      const audio = (info.streaming_data?.adaptive_formats ?? []).filter((format) => format.has_audio && !format.has_video && !format.is_drc);
      const best = audio.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
      if (!best) { errors.push(`${client}: sin audio`); continue; }
      const direct = await best.decipher(yt.session.player);
      if (!direct) { errors.push(`${client}: sin URL`); continue; }
      if (clientOrder[0] !== client) { clientOrder.splice(clientOrder.indexOf(client), 1); clientOrder.unshift(client); }
      console.log(`[youtube] ${videoId} con ${client} en ${Date.now() - started} ms (itag ${best.itag}, ${Math.round((best.bitrate ?? 0) / 1000)} kbps)`);
      return { url: direct, headers: {}, duration: info.basic_info.duration ?? null, title: info.basic_info.title ?? null, hls: false, mime: best.mime_type ?? null, bitrate: best.bitrate ?? null, via: client };
    } catch (error) {
      errors.push(`${client}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 160));
    }
  }
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
