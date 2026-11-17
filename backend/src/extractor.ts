import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type MediaMetadata = {
  id: string | null;
  title: string | null;
  sourceUrl: string;
  uploader: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  extractor: string | null;
  isPlaylist: boolean;
  playlistTitle: string | null;
  playlistCount: number | null;
  playlistEntries: MediaMetadataEntry[];
};

export type MediaMetadataEntry = {
  index: number;
  id: string | null;
  title: string;
  sourceUrl: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
};

export class ExtractorUnavailableError extends Error {}
export class ExtractorLookupError extends Error {}

type YtDlpResult = {
  id?: unknown;
  title?: unknown;
  webpage_url?: unknown;
  uploader?: unknown;
  duration?: unknown;
  thumbnail?: unknown;
  extractor_key?: unknown;
  playlist?: unknown;
  playlist_count?: unknown;
  entries?: unknown;
};

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function playlistEntries(value: unknown): MediaMetadataEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    const item = typeof entry === "object" && entry !== null ? entry as Record<string, unknown> : {};
    const id = nullableString(item.id);
    return {
      index: index + 1,
      id,
      title: nullableString(item.title) ?? `Elemento ${index + 1}`,
      sourceUrl: nullableString(item.webpage_url) ?? nullableString(item.url),
      durationSeconds: nullableNumber(item.duration),
      thumbnailUrl: nullableString(item.thumbnail)
    };
  });
}

function extractorErrorDetails(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "";
  }

  const candidate = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
  const values = [candidate.stderr, candidate.stdout, candidate.message]
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && line.toLowerCase() !== "null");

  return values.slice(-5).join(" | ");
}

function extractorErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown; killed?: unknown; signal?: unknown };
    if (candidate.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return "La respuesta de yt-dlp es demasiado grande. Prueba la URL sin activar Playlist completa o reduce el número de elementos.";
    }
    if (candidate.killed === true || candidate.signal === "SIGTERM") {
      return "yt-dlp tardó demasiado en responder. Comprueba la URL y vuelve a intentarlo.";
    }
  }

  const details = extractorErrorDetails(error);
  return details
    ? `No se pudieron obtener metadatos para esta URL: ${details}`
    : "No se pudieron obtener metadatos para esta URL.";
}

/**
 * Consulta metadatos con yt-dlp. --skip-download garantiza que no se escriben
 * archivos multimedia ni se inicia una descarga.
 */
export async function getMediaMetadata(url: string, timeoutMs: number, includePlaylist = false, maxPlaylistItems = 50): Promise<MediaMetadata> {
  const playlistArgs = includePlaylist
    ? ["--flat-playlist", "--playlist-end", String(Math.max(1, maxPlaylistItems))]
    : ["--no-playlist"];
  const ytdlpBinary = process.env.YTDLP_BIN ?? "yt-dlp";
  const jsRuntime = process.env.YTDLP_JS_RUNTIME?.trim() || "node";

  try {
    const { stdout } = await execFileAsync(
      ytdlpBinary,
      [...playlistArgs, "--js-runtimes", jsRuntime, "--skip-download", "--dump-single-json", "--no-warnings", "--", url],
      // Las playlists pueden devolver bastante JSON aunque no se descargue ningún archivo.
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }
    );

    const parsed = JSON.parse(stdout) as YtDlpResult;
    const entries = playlistEntries(parsed.entries);
    const isPlaylist = Array.isArray(parsed.entries);
    return {
      id: nullableString(parsed.id),
      title: nullableString(parsed.title),
      sourceUrl: nullableString(parsed.webpage_url) ?? url,
      uploader: nullableString(parsed.uploader),
      durationSeconds: nullableNumber(parsed.duration),
      thumbnailUrl: nullableString(parsed.thumbnail) ?? entries[0]?.thumbnailUrl ?? null,
      extractor: nullableString(parsed.extractor_key),
      isPlaylist,
      // En algunas pestañas de YouTube el título de la playlist llega como
      // `title` y no como `playlist`; usamos ambos para conservar un nombre útil.
      playlistTitle: isPlaylist ? nullableString(parsed.playlist) ?? nullableString(parsed.title) : null,
      playlistCount: entries.length > 0
        ? entries.length
        : nullableNumber(parsed.playlist_count),
      playlistEntries: entries
    };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new ExtractorUnavailableError("yt-dlp no está instalado en este entorno.");
    }

    throw new ExtractorLookupError(extractorErrorMessage(error));
  }
}
