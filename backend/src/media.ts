import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { Router, type Request, type Response } from "express";
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

type PreviewSource = { url: string; headers: Record<string, string>; expires: number };
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
async function resolvePreview(url: string, kind: PreviewKind, timeoutMs: number) {
  const args = [
    "--no-playlist", "--skip-download", "--dump-single-json", "--no-warnings",
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
  if (!usable(chosen)) return null;
  return { ...common, source: { url: chosen.url, headers: headersOf(chosen) }, audio: null, hasVideo: kind !== "audio" && hasVideoTrack(chosen) };
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

  // Reenvía el contenido con soporte de rangos para poder saltar a cualquier segundo.
  router.get("/api/preview/stream/:token", async (request: Request, response: Response) => {
    const source = previews.get(String(request.params.token));
    if (!source || source.expires < Date.now()) {
      response.status(404).json({ error: "Vista previa caducada", message: "Vuelve a cargar la vista previa." });
      return;
    }
    const controller = new AbortController();
    request.on("close", () => controller.abort());
    try {
      const headers: Record<string, string> = { ...source.headers };
      if (request.headers.range) headers.Range = request.headers.range;
      const upstream = await fetch(source.url, { headers, signal: controller.signal, redirect: "follow" });
      response.status(upstream.status);
      for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const value = upstream.headers.get(name);
        if (value) response.setHeader(name, value);
      }
      if (!upstream.headers.get("accept-ranges")) response.setHeader("accept-ranges", "bytes");
      if (!upstream.body) {
        response.end();
        return;
      }
      Readable.fromWeb(upstream.body as never).on("error", () => response.end()).pipe(response);
    } catch {
      if (!response.headersSent) response.status(502).json({ error: "Vista previa no disponible", message: "La plataforma no ha respondido." });
      else response.end();
    }
  });

  return router;
}
