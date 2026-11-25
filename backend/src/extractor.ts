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
  /** Pistas de audio originales que ofrece la fuente (null en playlists: se comprueba canción a canción). */
  audio: AudioAvailability | null;
};

export type AudioAvailability = {
  m4a: { kbps: number | null } | null;
  opus: { kbps: number | null } | null;
  lossless: { codec: string } | null;
  /** Mejor pista con pérdida (para avisar de que convertir a FLAC no mejoraría nada). */
  best: { codec: string; kbps: number | null } | null;
};

export type MediaMetadataEntry = {
  index: number;
  id: string | null;
  title: string;
  uploader: string | null;
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
  formats?: unknown;
};

const losslessCodecs = /^(flac|alac|pcm|wav|aiff)/i;

function audioAvailability(value: unknown): AudioAvailability | null {
  if (!Array.isArray(value)) return null;
  const audio = value
    .map((format) => (typeof format === "object" && format !== null ? format as Record<string, unknown> : {}))
    .filter((format) => typeof format.acodec === "string" && format.acodec !== "none" && (format.vcodec === "none" || format.vcodec === undefined || format.vcodec === null));
  // Enlaces directos sin información de códecs: no se sabe qué hay (se comprueba al descargar).
  const described = value.some((format) => typeof format === "object" && format !== null && typeof (format as Record<string, unknown>).acodec === "string");
  if (!described) return null;
  const kbps = (format: Record<string, unknown>) => {
    const rate = nullableNumber(format.abr) ?? nullableNumber(format.tbr);
    return rate ? Math.round(rate) : null;
  };
  const bestOf = (list: Array<Record<string, unknown>>) => list.sort((a, b) => (kbps(b) ?? 0) - (kbps(a) ?? 0))[0];
  const m4a = bestOf(audio.filter((format) => format.ext === "m4a" || String(format.acodec).startsWith("mp4a") || format.acodec === "aac"));
  const opus = bestOf(audio.filter((format) => String(format.acodec).startsWith("opus")));
  const lossless = audio.find((format) => losslessCodecs.test(String(format.acodec)) || ["flac", "wav", "aiff", "aif"].includes(String(format.ext)));
  const best = bestOf(audio.filter((format) => !losslessCodecs.test(String(format.acodec))));
  return {
    m4a: m4a ? { kbps: kbps(m4a) } : null,
    opus: opus ? { kbps: kbps(opus) } : null,
    lossless: lossless ? { codec: String(lossless.acodec).split(".")[0].toUpperCase() } : null,
    best: best ? { codec: String(best.acodec).split(".")[0], kbps: kbps(best) } : null
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bestThumbnail(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const urls = value
    .map((thumbnail) => (typeof thumbnail === "object" && thumbnail !== null ? thumbnail as Record<string, unknown> : {}))
    .filter((thumbnail) => typeof thumbnail.url === "string");
  // Las miniaturas vienen de menor a mayor: una intermedia carga rápido y se ve bien.
  const pick = urls.find((thumbnail) => (nullableNumber(thumbnail.width) ?? 0) >= 320) ?? urls.at(-1);
  return pick ? String(pick.url) : null;
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
      uploader: nullableString(item.uploader) ?? nullableString(item.channel),
      sourceUrl: nullableString(item.webpage_url) ?? nullableString(item.url),
      durationSeconds: nullableNumber(item.duration),
      thumbnailUrl: nullableString(item.thumbnail) ?? bestThumbnail(item.thumbnails)
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
      playlistEntries: entries,
      audio: isPlaylist ? null : audioAvailability(parsed.formats)
    };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new ExtractorUnavailableError("yt-dlp no está instalado en este entorno.");
    }

    throw new ExtractorLookupError(extractorErrorMessage(error));
  }
}
