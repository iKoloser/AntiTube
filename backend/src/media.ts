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

export type SearchProvider = "youtube" | "ytmusic" | "soundcloud";
export const searchProviders: Record<SearchProvider, { label: string; source: (query: string, limit: number) => string }> = {
  youtube: { label: "YouTube", source: (query, limit) => `ytsearch${limit}:${query}` },
  ytmusic: { label: "YouTube Music", source: (query) => `https://music.youtube.com/search?q=${encodeURIComponent(query)}#songs` },
  soundcloud: { label: "SoundCloud", source: (query, limit) => `scsearch${limit}:${query}` }
};

export type SearchResult = {
  provider: SearchProvider;
  id: string | null;
  title: string;
  uploader: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  url: string;
};

function youtubeThumbnail(id: string | null): string | null {
  return id && /^[\w-]{11}$/.test(id) ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
}

export async function searchMedia(provider: SearchProvider, query: string, limit: number, timeoutMs: number): Promise<SearchResult[]> {
  const metadata = await getMediaMetadata(searchProviders[provider].source(query, limit), timeoutMs, true, limit);
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
}

type PreviewSource = { url: string; headers: Record<string, string>; expires: number };
const previews = new Map<string, PreviewSource>();

function prunePreviews(): void {
  const now = Date.now();
  for (const [token, source] of previews) if (source.expires < now) previews.delete(token);
}

type YtDlpFormat = { url?: string; protocol?: string; http_headers?: Record<string, string>; vcodec?: string; acodec?: string; ext?: string };

/**
 * Pide a yt-dlp la URL directa de una versión ligera del contenido. El
 * reproductor de la app la recibe a través del backend (que añade las
 * cabeceras que exige cada plataforma y permite saltar a cualquier punto).
 */
async function resolvePreview(url: string, kind: "audio" | "video", timeoutMs: number) {
  const selector = kind === "video"
    ? "best[vcodec!=none][acodec!=none][height<=720][protocol^=http][ext=mp4]/best[vcodec!=none][acodec!=none][protocol^=http]/bestaudio[protocol^=http]"
    : "bestaudio[ext=m4a][protocol^=http]/bestaudio[acodec=opus][protocol^=http]/bestaudio[protocol^=http]/best[protocol^=http]";
  const { stdout } = await execFileAsync(process.env.YTDLP_BIN ?? "yt-dlp", [
    "--no-playlist", "--skip-download", "--dump-single-json", "--no-warnings",
    "--js-runtimes", process.env.YTDLP_JS_RUNTIME?.trim() || "node",
    "-f", selector, "--", url
  ], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  const info = JSON.parse(stdout) as YtDlpFormat & { duration?: number; requested_formats?: YtDlpFormat[]; title?: string; thumbnail?: string };
  const chosen = info.requested_formats?.[0] ?? info;
  if (!chosen.url || (chosen.protocol && !chosen.protocol.startsWith("http"))) return null;
  return {
    source: { url: chosen.url, headers: chosen.http_headers ?? info.http_headers ?? {} },
    hasVideo: Boolean(chosen.vcodec && chosen.vcodec !== "none"),
    duration: typeof info.duration === "number" ? info.duration : null,
    title: info.title ?? null,
    thumbnailUrl: info.thumbnail ?? null
  };
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
        ? result.reason instanceof ExtractorUnavailableError ? result.reason.message : result.reason instanceof ExtractorLookupError ? "No se pudo buscar en esta plataforma ahora mismo." : "Búsqueda fallida."
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
    const kind = request.body?.kind === "audio" ? "audio" : "video";
    try {
      const resolved = await resolvePreview(analysis.url, kind, deps.metadataTimeoutMs);
      if (!resolved) {
        response.status(422).json({ error: "Sin vista previa", message: "Esta plataforma solo emite por streaming segmentado y no se puede previsualizar. Puedes escribir los tiempos a mano." });
        return;
      }
      prunePreviews();
      const token = randomUUID();
      previews.set(token, { ...resolved.source, expires: Date.now() + 3 * 60 * 60 * 1000 });
      response.json({ streamUrl: `/api/preview/stream/${token}`, hasVideo: resolved.hasVideo, durationSeconds: resolved.duration, title: resolved.title, thumbnailUrl: resolved.thumbnailUrl });
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
