import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { promisify } from "node:util";
import { Router, type Request, type Response } from "express";
import { soundcloudDirect, youtubeDirect } from "./direct.js";
import { ExtractorLookupError, ExtractorUnavailableError, getMediaMetadata } from "./extractor.js";

/**
 * Búsqueda dentro de la app (YouTube, YouTube Music y SoundCloud) y vista
 * previa de un contenido para elegir el fragmento que se quiere recortar.
 */

const execFileAsync = promisify(execFile);

export type SearchProvider = "youtube" | "ytmusic" | "soundcloud" | "bandcamp" | "audius";

export type SearchResult = {
  provider: SearchProvider;
  id: string | null;
  title: string;
  uploader: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  url: string;
};

type ProviderSearch = (query: string, limit: number, timeoutMs: number) => Promise<SearchResult[]>;

export class SearchUnavailableError extends Error {}

const browserHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
};

function youtubeThumbnail(id: string | null): string | null {
  return id && /^[\w-]{11}$/.test(id) ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
}

/** Búsqueda con los extractores de yt-dlp (YouTube, YouTube Music, SoundCloud). */
function ytdlpSearch(provider: SearchProvider, source: (query: string, limit: number) => string): ProviderSearch {
  return async (query, limit, timeoutMs) => {
    const metadata = await getMediaMetadata(source(query, limit), timeoutMs, true, limit);
    return metadata.playlistEntries
      .filter((entry) => entry.sourceUrl && /^https?:\/\//.test(entry.sourceUrl))
      .slice(0, limit)
      .map((entry) => {
        // YouTube Music devuelve a veces enlaces de music.youtube.com: se descargan igual con el de YouTube.
        const url = provider === "ytmusic" && entry.id && /^[\w-]{11}$/.test(entry.id) ? `https://www.youtube.com/watch?v=${entry.id}` : entry.sourceUrl as string;
        return {
          provider,
          id: entry.id,
          title: entry.title,
          uploader: entry.uploader,
          durationSeconds: entry.durationSeconds,
          thumbnailUrl: provider === "soundcloud" ? entry.thumbnailUrl : youtubeThumbnail(entry.id) ?? entry.thumbnailUrl,
          url
        };
      });
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<globalThis.Response> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(Math.min(timeoutMs, 20_000)) });
  if (!response.ok) throw new SearchUnavailableError(`HTTP ${response.status}`);
  return response;
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function cleanBandcampUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Bandcamp: música de artistas independientes, sin DRM. Usa el mismo buscador
 * que la web de Bandcamp y, si cambia, lee la página de resultados.
 */
const bandcampSearch: ProviderSearch = async (query, limit, timeoutMs) => {
  try {
    const response = await fetchWithTimeout("https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic", {
      method: "POST",
      headers: { ...browserHeaders, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ search_text: query, search_filter: "t", full_page: true, fan_id: null })
    }, timeoutMs);
    const data = await response.json() as { auto?: { results?: Array<{ type?: string; id?: number; name?: string; band_name?: string; img?: string; item_url_path?: string; item_url_root?: string }> } };
    const results = (data.auto?.results ?? [])
      .filter((item) => item.type === "t" && item.name && (item.item_url_path || item.item_url_root))
      .slice(0, limit)
      .map((item): SearchResult => {
        const url = item.item_url_path && /^https?:/.test(item.item_url_path) ? item.item_url_path : `${item.item_url_root ?? ""}${item.item_url_path ?? ""}`;
        return { provider: "bandcamp", id: item.id ? String(item.id) : null, title: item.name as string, uploader: item.band_name ?? null, durationSeconds: null, thumbnailUrl: item.img ?? null, url: cleanBandcampUrl(url) };
      })
      .filter((item) => /^https?:\/\/[^/]+\/track\//.test(item.url));
    if (results.length > 0) return results;
  } catch { /* se intenta con la página de resultados */ }

  const response = await fetchWithTimeout(`https://bandcamp.com/search?q=${encodeURIComponent(query)}&item_type=t`, { headers: { ...browserHeaders, Accept: "text/html" } }, timeoutMs);
  const html = await response.text();
  const results: SearchResult[] = [];
  for (const block of html.split(/<li class="searchresult/).slice(1)) {
    const link = block.match(/<div class="heading">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const url = cleanBandcampUrl(decodeHtml(link[1]));
    if (!/\/track\//.test(url)) continue;
    const subhead = block.match(/<div class="subhead">([\s\S]*?)<\/div>/);
    const artist = subhead ? decodeHtml(subhead[1]).match(/(?:^|\s)by\s+(.+)$/)?.[1] ?? null : null;
    const image = block.match(/<div class="art">\s*<img src="([^"]+)"/);
    const length = block.match(/<div class="length">\s*([\d:]+)/);
    results.push({
      provider: "bandcamp",
      id: null,
      title: decodeHtml(link[2]),
      uploader: artist,
      durationSeconds: length ? length[1].split(":").map(Number).reduce((total: number, part: number) => total * 60 + part, 0) : null,
      thumbnailUrl: image ? image[1] : null,
      url
    });
    if (results.length >= limit) break;
  }
  return results;
};

/** Audius: plataforma abierta de música gratis y sin DRM, con API pública. */
let audiusHost: string | null = null;
const audiusSearch: ProviderSearch = async (query, limit, timeoutMs) => {
  type AudiusTrack = { id?: string; title?: string; duration?: number; permalink?: string; is_streamable?: boolean; is_delete?: boolean; user?: { name?: string; handle?: string }; artwork?: Record<string, string> | null };
  const path = `/v1/tracks/search?query=${encodeURIComponent(query)}&app_name=AntiTube`;
  let data: { data?: AudiusTrack[] } | null = null;
  for (const host of [audiusHost, "https://api.audius.co"].filter(Boolean) as string[]) {
    try {
      data = await (await fetchWithTimeout(`${host}${path}`, { headers: { Accept: "application/json" } }, timeoutMs)).json() as { data?: AudiusTrack[] };
      break;
    } catch { /* siguiente servidor */ }
  }
  if (!data) {
    // La API de Audius reparte el trabajo entre nodos: se pide la lista y se usa el primero.
    const hosts = await (await fetchWithTimeout("https://api.audius.co", { headers: { Accept: "application/json" } }, timeoutMs)).json() as { data?: string[] };
    for (const host of hosts.data ?? []) {
      try {
        data = await (await fetchWithTimeout(`${host}${path}`, { headers: { Accept: "application/json" } }, timeoutMs)).json() as { data?: AudiusTrack[] };
        audiusHost = host;
        break;
      } catch { /* siguiente nodo */ }
    }
  }
  if (!data) throw new SearchUnavailableError("Audius no responde");
  return (data.data ?? [])
    .filter((track) => track.permalink && track.title && track.is_streamable !== false && !track.is_delete)
    .slice(0, limit)
    .map((track) => ({
      provider: "audius" as const,
      id: track.id ?? null,
      title: track.title as string,
      uploader: track.user?.name ?? track.user?.handle ?? null,
      durationSeconds: typeof track.duration === "number" ? track.duration : null,
      thumbnailUrl: track.artwork?.["480x480"] ?? track.artwork?.["150x150"] ?? null,
      url: `https://audius.co${track.permalink}`
    }));
};

export const searchProviders: Record<SearchProvider, { label: string; search: ProviderSearch }> = {
  youtube: { label: "YouTube", search: ytdlpSearch("youtube", (query, limit) => `ytsearch${limit}:${query}`) },
  ytmusic: { label: "YouTube Music", search: ytdlpSearch("ytmusic", (query) => `https://music.youtube.com/search?q=${encodeURIComponent(query)}#songs`) },
  bandcamp: { label: "Bandcamp", search: bandcampSearch },
  audius: { label: "Audius", search: audiusSearch },
  soundcloud: { label: "SoundCloud", search: ytdlpSearch("soundcloud", (query, limit) => `scsearch${limit}:${query}`) }
};

export async function searchMedia(provider: SearchProvider, query: string, limit: number, timeoutMs: number): Promise<SearchResult[]> {
  return searchProviders[provider].search(query, limit, timeoutMs);
}

/** `fallback`: URL original para reintentar por tubería (yt-dlp + FFmpeg) si la directa falla. */
type PreviewSource = { url: string; headers: Record<string, string>; expires: number; fallback?: string; hls?: { duration: number | null }; direct?: boolean };
const previews = new Map<string, PreviewSource>();

function prunePreviews(): void {
  const now = Date.now();
  for (const [token, source] of previews) if (source.expires < now) previews.delete(token);
}

type YtDlpFormat = { url?: string; protocol?: string; http_headers?: Record<string, string>; vcodec?: string; acodec?: string; ext?: string };

export type PreviewKind = "audio" | "video" | "single";

const httpOnly = "[protocol^=http]";
const selectors: Record<PreviewKind, string> = {
  audio: `bestaudio[ext=m4a]${httpOnly}/bestaudio[acodec=opus]${httpOnly}/bestaudio${httpOnly}/best${httpOnly}/best`,
  // Vídeo para recortar: imagen (hasta 720p, en un códec que el WebView reproduce) y audio por separado
  // si la plataforma los sirve así, como YouTube. Si no, un archivo con las dos cosas.
  video: [
    `(bv*[height<=720][vcodec^=avc1]${httpOnly}/bv*[height<=720][vcodec^=vp09]${httpOnly}/bv*[height<=720][vcodec^=vp9]${httpOnly}/bv*[height<=720][vcodec!=none]${httpOnly})+(ba[ext=m4a]${httpOnly}/ba${httpOnly})`,
    `best[vcodec!=none][acodec!=none][height<=720]${httpOnly}`,
    `best[vcodec!=none][acodec!=none]${httpOnly}`,
    `bestaudio${httpOnly}`, `best${httpOnly}`, "best"
  ].join("/"),
  // Para el reproductor: un único archivo con imagen y sonido.
  single: `best[vcodec!=none][acodec!=none][height<=720][ext=mp4]${httpOnly}/best[vcodec!=none][acodec!=none]${httpOnly}/bestaudio${httpOnly}/best${httpOnly}/best`
};

const audioExtensions = /^(m4a|mp3|opus|ogg|oga|flac|wav|aac|weba)$/i;
const hasVideoTrack = (format: YtDlpFormat) => (format.vcodec ? format.vcodec !== "none" : !audioExtensions.test(format.ext ?? ""));
const hasAudioTrack = (format: YtDlpFormat) => (format.acodec ? format.acodec !== "none" : true);
const usable = (format: YtDlpFormat | undefined): format is YtDlpFormat & { url: string } => Boolean(format?.url && (!format.protocol || format.protocol.startsWith("http")));

/**
 * Pide a yt-dlp la URL directa de una versión ligera del contenido. El
 * reproductor de la app la recibe a través del backend (que añade las
 * cabeceras que exige cada plataforma y permite saltar a cualquier punto).
 * Cuando la imagen y el sonido van por separado, devuelve las dos fuentes.
 */
async function resolvePreview(url: string, kind: PreviewKind, timeoutMs: number, extraArgs: string[] = []) {
  const args = [
    "--no-playlist", "--skip-download", "--dump-single-json", "--no-warnings", ...extraArgs,
    "--js-runtimes", process.env.YTDLP_JS_RUNTIME?.trim() || "node",
    ...(process.env.FFMPEG_BIN ? ["--ffmpeg-location", process.env.FFMPEG_BIN] : []),
    "-f", selectors[kind], "--", url
  ];
  const { stdout } = await execFileAsync(process.env.YTDLP_BIN ?? "yt-dlp", args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
  const info = JSON.parse(stdout) as YtDlpFormat & { duration?: number; requested_formats?: YtDlpFormat[]; title?: string; thumbnail?: string };
  const headersOf = (format: YtDlpFormat) => format.http_headers ?? info.http_headers ?? {};
  const requested = info.requested_formats ?? [];
  const video = requested.find((format) => format.vcodec && format.vcodec !== "none");
  const audio = requested.find((format) => format.vcodec === "none" && format.acodec && format.acodec !== "none");
  const common = { duration: typeof info.duration === "number" ? info.duration : null, title: info.title ?? null, thumbnailUrl: info.thumbnail ?? null };
  if (usable(video) && usable(audio) && !hasAudioTrack(video)) {
    return { ...common, source: { url: video.url, headers: headersOf(video) }, audio: { url: audio.url, headers: headersOf(audio) }, hasVideo: true };
  }
  const chosen = requested[0] ?? info;
  // Audio que solo se emite troceado en HLS (SoundCloud, sobre todo): FFmpeg lo
  // junta al vuelo y lo entrega como MP3, y se puede saltar a cualquier punto.
  if (kind === "audio" && !usable(chosen) && chosen.url && chosen.protocol?.startsWith("m3u8")) {
    return { ...common, source: { url: chosen.url, headers: headersOf(chosen), hls: { duration: common.duration } }, audio: null, hasVideo: false };
  }
  if (!usable(chosen)) return null;
  return { ...common, source: { url: chosen.url, headers: headersOf(chosen) }, audio: null, hasVideo: kind !== "audio" && hasVideoTrack(chosen) };
}

// URL original → token de audio ya resuelto (las URLs directas caducan en unas horas).
const listenCache = new Map<string, { token: string; expires: number }>();
const listenPending = new Map<string, Promise<string>>();
const listenLifetimeMs = 2 * 60 * 60 * 1000;

// Las preparaciones por adelantado van de dos en dos para no saturar el equipo;
// lo que el usuario pulsa no espera a esta fila.
let warmRunning = 0;
const warmWaiting: Array<() => void> = [];
async function warmSlot<T>(task: () => Promise<T>): Promise<T> {
  if (warmRunning >= 2) await new Promise<void>((resolve) => warmWaiting.push(resolve));
  warmRunning += 1;
  try { return await task(); } finally { warmRunning -= 1; warmWaiting.shift()?.(); }
}

const pipeUrl = (url: string) => `/api/listen/pipe?url=${encodeURIComponent(url)}`;

function forgetListen(url: string): void {
  listenCache.delete(url);
}

const isYouTube = (url: string) => /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test((() => { try { return new URL(url).hostname; } catch { return ""; } })());

/**
 * Solo audio, lo antes posible. En YouTube se prueba primero el cliente de
 * Android VR: da URLs directas sin descargar ni resolver el reproductor web
 * (el paso lento). Si no vale para ese vídeo (edad, música infantil…), se
 * hace la búsqueda completa de siempre.
 */
// Canciones en las que la vía directa falló: van siempre por yt-dlp.
const directFailed = new Set<string>();

async function resolveListen(url: string, timeoutMs: number) {
  const started = Date.now();
  if (!directFailed.has(url)) {
    try {
      const direct = await youtubeDirect(url) ?? await soundcloudDirect(url);
      if (direct) {
        console.log(`[listen] vía directa en ${Date.now() - started} ms`);
        return { duration: direct.duration, title: direct.title, thumbnailUrl: null, source: { url: direct.url, headers: direct.headers, direct: true, ...(direct.hls ? { hls: { duration: direct.duration } } : {}) }, audio: null, hasVideo: false };
      }
    } catch (error) {
      console.error(`[listen] la vía directa falló: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const viaYtDlp = await resolveWithYtDlp(url, timeoutMs);
  console.log(`[listen] yt-dlp en ${Date.now() - started} ms`);
  return viaYtDlp;
}

async function resolveWithYtDlp(url: string, timeoutMs: number) {
  if (isYouTube(url)) {
    try {
      const quick = await resolvePreview(url, "audio", Math.min(timeoutMs, 15_000), ["--extractor-args", "youtube:player_client=android_vr", "--socket-timeout", "8"]);
      if (quick) return quick;
    } catch { /* se intenta la vía completa */ }
  }
  return resolvePreview(url, "audio", timeoutMs);
}

async function listenToken(url: string, timeoutMs: number): Promise<string> {
  const cached = listenCache.get(url);
  if (cached && cached.expires > Date.now() && previews.has(cached.token)) return cached.token;
  const pending = listenPending.get(url);
  if (pending) return pending;
  const job = (async () => {
    const resolved = await resolveListen(url, timeoutMs);
    if (!resolved) throw new Error("Sin audio directo");
    prunePreviews();
    const token = randomUUID();
    // Los HLS de SoundCloud caducan pronto; los enlaces de YouTube duran horas.
    const expires = Date.now() + (resolved.source.hls ? 15 * 60 * 1000 : listenLifetimeMs);
    previews.set(token, { ...resolved.source, expires: expires + 60 * 60 * 1000, fallback: url });
    listenCache.set(url, { token, expires });
    if (listenCache.size > 500) listenCache.delete(listenCache.keys().next().value as string);
    return token;
  })().finally(() => listenPending.delete(url));
  listenPending.set(url, job);
  return job;
}

// MP3 a 192 kbps constantes: 24.000 bytes por segundo. Así cada byte que pide el
// reproductor corresponde a un instante y se puede saltar dentro de un HLS.
const hlsBytesPerSecond = 24_000;

function streamHls(source: PreviewSource, request: Request, response: Response): void {
  const duration = source.hls?.duration ?? null;
  const total = duration ? Math.ceil(duration * hlsBytesPerSecond) : null;
  const asked = /^bytes=(\d+)-(\d*)$/.exec(String(request.headers.range ?? ""));
  const from = asked && total ? Math.min(Number(asked[1]), total - 1) : 0;
  const until = total ? Math.min(asked?.[2] ? Number(asked[2]) : total - 1, total - 1) : null;
  const headers = Object.entries(source.headers).map(([name, value]) => `${name}: ${value}\r\n`).join("");
  const ffmpeg = spawn(process.env.FFMPEG_BIN ?? "ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error",
    ...(from > 0 ? ["-ss", (from / hlsBytesPerSecond).toFixed(2)] : []),
    ...(headers ? ["-headers", headers] : []),
    "-i", source.url, "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "-write_xing", "0", "-f", "mp3", "pipe:1"
  ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let errors = "";
  ffmpeg.stderr.on("data", (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-1000); });
  request.on("close", () => ffmpeg.kill());
  ffmpeg.on("error", () => { if (!response.headersSent) response.status(503).json({ error: "FFmpeg no disponible", message: "Hace falta FFmpeg para escuchar este contenido." }); });
  response.setHeader("Content-Type", "audio/mpeg");
  response.setHeader("Cache-Control", "no-store");
  if (total !== null && until !== null) {
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Content-Length", String(until - from + 1));
    if (asked) {
      response.status(206);
      response.setHeader("Content-Range", `bytes ${from}-${until}/${total}`);
    }
  }
  let sent = 0;
  const limit = until !== null ? until - from + 1 : Number.MAX_SAFE_INTEGER;
  ffmpeg.stdout.on("data", (chunk: Buffer) => {
    if (sent >= limit) return;
    const piece = chunk.length > limit - sent ? chunk.subarray(0, limit - sent) : chunk;
    sent += piece.length;
    if (!response.write(piece)) { ffmpeg.stdout.pause(); response.once("drain", () => ffmpeg.stdout.resume()); }
    if (sent >= limit) { response.end(); ffmpeg.kill(); }
  });
  ffmpeg.on("close", (code) => {
    if (code && sent === 0) console.error(`[listen] FFmpeg no pudo leer el HLS: ${errors.trim().split("\n").at(-1) ?? code}`);
    if (code && sent === 0 && !response.headersSent && source.fallback) {
      // Enlace caducado o rechazado: se vuelve a pedir, ahora con yt-dlp.
      if (source.direct) directFailed.add(source.fallback);
      forgetListen(source.fallback);
      for (const name of ["Content-Length", "Content-Range", "Content-Type", "Accept-Ranges"]) response.removeHeader(name);
      response.redirect(302, source.direct ? `/api/listen?url=${encodeURIComponent(source.fallback)}` : pipeUrl(source.fallback));
      return;
    }
    if (response.writableEnded) return;
    // Si el MP3 sale algo más corto de lo calculado, se rellena con silencio
    // para que el reproductor no se quede esperando bytes que no llegan.
    if (total !== null && sent > 0 && sent < limit && limit - sent <= hlsBytesPerSecond * 30) response.write(Buffer.alloc(limit - sent));
    response.end();
  });
}

export function createMediaRouter(deps: { metadataTimeoutMs: number; analyzeUrl: (value: unknown) => { url: string } | null }): Router {
  const router = Router();

  router.post("/api/search", async (request: Request, response: Response) => {
    const query = typeof request.body?.query === "string" ? request.body.query.trim().slice(0, 200) : "";
    const requested = Array.isArray(request.body?.providers) ? request.body.providers : [request.body?.provider ?? "youtube"];
    const providers = requested.filter((value: unknown): value is SearchProvider => typeof value === "string" && value in searchProviders);
    const limit = Math.min(30, Math.max(1, Number(request.body?.limit) || 12));
    if (!query || providers.length === 0) {
      response.status(400).json({ error: "Búsqueda vacía", message: "Escribe qué quieres buscar." });
      return;
    }
    // Cada plataforma se busca en paralelo; si una falla, las demás siguen.
    const settled = await Promise.allSettled(providers.map((provider: SearchProvider) => searchMedia(provider, query, limit, deps.metadataTimeoutMs)));
    const groups = settled.map((result, index) => ({
      provider: providers[index] as SearchProvider,
      label: searchProviders[providers[index] as SearchProvider].label,
      results: result.status === "fulfilled" ? result.value : [],
      error: result.status === "rejected"
        ? result.reason instanceof ExtractorUnavailableError ? result.reason.message : result.reason instanceof ExtractorLookupError || result.reason instanceof SearchUnavailableError || result.reason instanceof TypeError ? "No se pudo buscar en esta plataforma ahora mismo." : "Búsqueda fallida."
        : null
    }));
    if (groups.every((group) => group.error) && settled[0]?.status === "rejected" && settled[0].reason instanceof ExtractorUnavailableError) {
      response.status(503).json({ error: "Extractor no disponible", message: (settled[0].reason as Error).message });
      return;
    }
    response.json({ query, groups });
  });

  router.post("/api/preview", async (request: Request, response: Response) => {
    const analysis = deps.analyzeUrl(request.body?.url);
    if (!analysis) {
      response.status(400).json({ error: "URL inválida", message: "Envía una URL completa que empiece por http:// o https://." });
      return;
    }
    const kind: PreviewKind = request.body?.kind === "audio" ? "audio" : request.body?.kind === "single" ? "single" : "video";
    try {
      const resolved = await resolvePreview(analysis.url, kind, deps.metadataTimeoutMs);
      if (!resolved) {
        response.status(422).json({ error: "Sin vista previa", message: "Esta plataforma solo emite por streaming segmentado y no se puede previsualizar. Puedes escribir los tiempos a mano." });
        return;
      }
      prunePreviews();
      const expires = Date.now() + 3 * 60 * 60 * 1000;
      const token = randomUUID();
      previews.set(token, { ...resolved.source, expires });
      let audioUrl: string | null = null;
      if (resolved.audio) {
        const audioToken = randomUUID();
        previews.set(audioToken, { ...resolved.audio, expires });
        audioUrl = `/api/preview/stream/${audioToken}`;
      }
      response.json({ streamUrl: `/api/preview/stream/${token}`, audioUrl, hasVideo: resolved.hasVideo, durationSeconds: resolved.duration, title: resolved.title, thumbnailUrl: resolved.thumbnailUrl });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : null;
      if (code === "ENOENT") {
        response.status(503).json({ error: "Extractor no disponible", message: "yt-dlp no está instalado en este entorno." });
        return;
      }
      response.status(422).json({ error: "Sin vista previa", message: "No se pudo preparar la vista previa de este contenido." });
    }
  });

  // Escuchar en streaming sin descargar: el reproductor usa esta URL fija como
  // fuente. La primera vez resuelve el audio con yt-dlp (y lo recuerda un rato);
  // después redirige al reenvío con rangos de arriba. Con `warm=1` solo lo
  // prepara, para que la siguiente canción de la cola empiece al instante.
  router.get("/api/listen", async (request: Request, response: Response) => {
    const analysis = deps.analyzeUrl(request.query.url);
    if (!analysis) {
      response.status(400).json({ error: "URL inválida", message: "Falta la URL que quieres escuchar." });
      return;
    }
    const warm = request.query.warm === "1";
    try {
      // Lo que se prepara por adelantado espera turno; lo que pulsas, no.
      const token = warm && request.query.now !== "1" ? await warmSlot(() => listenToken(analysis.url, deps.metadataTimeoutMs)) : await listenToken(analysis.url, deps.metadataTimeoutMs);
      if (warm) { response.status(204).end(); return; }
      response.setHeader("Cache-Control", "no-store");
      response.redirect(302, `/api/preview/stream/${token}`);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : null;
      console.error(`[listen] sin audio directo, uso la tubería: ${(error instanceof Error ? error.message : String(error)).split("\n").slice(-2).join(" ")}`);
      if (code === "ENOENT") {
        response.status(503).json({ error: "No se puede escuchar", message: "yt-dlp no está instalado en este entorno." });
        return;
      }
      // Sin URL directa (solo HLS, restricciones, etc.): yt-dlp la saca igualmente por tubería.
      if (warm) { response.status(204).end(); return; }
      response.redirect(302, pipeUrl(analysis.url));
    }
  });

  // Plan B: yt-dlp descarga el audio a su manera y FFmpeg lo entrega como MP3
  // mientras llega. No permite saltar adelante, pero suena casi todo.
  router.get("/api/listen/pipe", (request: Request, response: Response) => {
    const analysis = deps.analyzeUrl(request.query.url);
    if (!analysis) {
      response.status(400).json({ error: "URL inválida", message: "Falta la URL que quieres escuchar." });
      return;
    }
    const ytdlp = spawn(process.env.YTDLP_BIN ?? "yt-dlp", [
      "--no-playlist", "--quiet", "--no-warnings", "--no-part",
      "--js-runtimes", process.env.YTDLP_JS_RUNTIME?.trim() || "node",
      "-f", "bestaudio/best", "-o", "-", "--", analysis.url
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const ffmpeg = spawn(process.env.FFMPEG_BIN ?? "ffmpeg", [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "-f", "mp3", "pipe:1"
    ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let errors = "";
    ytdlp.stderr.on("data", (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-2000); });
    ytdlp.stdout.pipe(ffmpeg.stdin).on("error", () => undefined);
    const stop = () => { ytdlp.kill(); ffmpeg.kill(); };
    request.on("close", stop);
    ytdlp.on("error", stop);
    ffmpeg.on("error", () => { stop(); if (!response.headersSent) response.status(503).json({ error: "FFmpeg no disponible", message: "Hace falta FFmpeg para escuchar este contenido." }); });
    ytdlp.on("close", (code) => { if (code) console.error(`[listen] la tubería también falló: ${errors.trim().split("\n").slice(-1)[0] ?? code}`); });
    let started = false;
    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      if (!started) {
        started = true;
        response.status(200);
        response.setHeader("Content-Type", "audio/mpeg");
        response.setHeader("Cache-Control", "no-store");
      }
      response.write(chunk);
    });
    ffmpeg.on("close", () => {
      if (!started && !response.headersSent) response.status(422).json({ error: "No se puede escuchar", message: errors.trim().split("\n").slice(-1)[0] || "No se pudo sacar el audio." });
      else response.end();
    });
  });

  // Reenvía el contenido con soporte de rangos para poder saltar a cualquier segundo.
  router.get("/api/preview/stream/:token", async (request: Request, response: Response) => {
    const source = previews.get(String(request.params.token));
    if (!source || source.expires < Date.now()) {
      response.status(404).json({ error: "Vista previa caducada", message: "Vuelve a cargar la vista previa." });
      return;
    }
    if (source.hls) {
      streamHls(source, request, response);
      return;
    }
    let closed = false;
    let active: IncomingMessage | null = null;
    request.on("close", () => { closed = true; active?.destroy(); });
    const fail = (reason: string) => {
      console.error(`[preview] ${reason}`);
      if (response.headersSent) { response.destroy(); return; }
      if (source.fallback && !closed) {
        forgetListen(source.fallback);
        previews.delete(String(request.params.token));
        // Si venía de la vía directa, se prueba con yt-dlp; si ya era de yt-dlp,
        // la plataforma rechaza la URL (403, caducada…) y se escucha por tubería.
        if (source.direct) {
          directFailed.add(source.fallback);
          response.redirect(302, `/api/listen?url=${encodeURIComponent(source.fallback)}`);
        } else {
          response.redirect(302, pipeUrl(source.fallback));
        }
        return;
      }
      response.status(502).json({ error: "Vista previa no disponible", message: "La plataforma no ha respondido." });
    };

    // Lo que pide el reproductor (normalmente «bytes=0-», o un salto a otro punto).
    const asked = /^bytes=(\d+)-(\d*)$/.exec(String(request.headers.range ?? ""));
    const from = asked ? Number(asked[1]) : 0;
    const until = asked?.[2] ? Number(asked[2]) : null;

    // Se pide a la plataforma en trozos de 8 MB, como hace yt-dlp: YouTube frena
    // o corta las peticiones abiertas largas. Al reproductor le llega un único
    // flujo continuo que empieza a sonar con el primer trozo.
    const chunk = 8 * 1024 * 1024;
    let position = from;
    let total: number | null = null;

    const open = (url: string, range: string, redirects = 0): Promise<IncomingMessage> => new Promise((resolve, reject) => {
      const client = url.startsWith("https:") ? https : http;
      const upstreamRequest = client.get(url, { headers: { ...source.headers, Range: range } }, (upstream) => {
        const location = upstream.headers.location;
        if (location && upstream.statusCode && upstream.statusCode >= 300 && upstream.statusCode < 400 && redirects < 5) {
          upstream.resume();
          resolve(open(new URL(location, url).toString(), range, redirects + 1));
          return;
        }
        resolve(upstream);
      });
      upstreamRequest.setTimeout(30_000, () => upstreamRequest.destroy(new Error("La plataforma tardó demasiado")));
      upstreamRequest.on("error", reject);
    });

    const pump = async (first: boolean): Promise<void> => {
      if (closed) return;
      const last = Math.min(position + chunk - 1, until ?? Number.MAX_SAFE_INTEGER, total !== null ? total - 1 : Number.MAX_SAFE_INTEGER);
      let upstream: IncomingMessage;
      try {
        upstream = await open(source.url, `bytes=${position}-${last}`);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
        return;
      }
      active = upstream;
      const status = upstream.statusCode ?? 502;
      if (status >= 400) {
        upstream.resume();
        if (first && status === 416) { response.status(416).end(); return; }
        fail(`la URL directa respondió ${status}`);
        return;
      }
      if (first) {
        const contentType = upstream.headers["content-type"];
        if (contentType) response.setHeader("Content-Type", contentType);
        response.setHeader("Accept-Ranges", "bytes");
        const range = /\/(\d+)$/.exec(String(upstream.headers["content-range"] ?? ""));
        if (status === 206 && range) {
          total = Number(range[1]);
          const end = Math.min(until ?? total - 1, total - 1);
          response.setHeader("Content-Length", String(end - from + 1));
          if (asked) {
            response.status(206);
            response.setHeader("Content-Range", `bytes ${from}-${end}/${total}`);
          } else {
            response.status(200);
          }
        } else {
          // La plataforma no admite rangos: se reenvía tal cual, de una vez.
          response.status(status);
          const length = upstream.headers["content-length"];
          if (length) response.setHeader("Content-Length", length);
          upstream.pipe(response);
          return;
        }
      }
      upstream.on("data", (data: Buffer) => {
        position += data.length;
        if (!response.write(data)) { upstream.pause(); response.once("drain", () => upstream.resume()); }
      });
      upstream.on("error", () => response.destroy());
      upstream.on("end", () => {
        const done = total === null || position >= total || (until !== null && position > until);
        if (done || closed) { response.end(); return; }
        void pump(false);
      });
    };
    await pump(true);
  });

  return router;
}
