import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";

/**
 * mp4: vídeo. mp3: audio convertido a MP3.
 * m4a / opus: el audio original tal y como lo entrega la plataforma (sin recomprimir).
 * flac: solo si la fuente ofrece audio sin pérdida (FLAC, ALAC, WAV/PCM); nunca se fabrica a partir de audio con pérdida.
 */
export type DownloadFormat = "mp4" | "mp3" | "m4a" | "opus" | "flac";
export const audioFormats: DownloadFormat[] = ["mp3", "m4a", "opus", "flac"];
export const downloadFormats: DownloadFormat[] = ["mp4", ...audioFormats];
export type VideoQuality = "best" | "360" | "480" | "720" | "1080";
export type AudioQuality = "128" | "192" | "256" | "320";
export type DownloadQuality = VideoQuality | AudioQuality | "best";

/** Fragmento a descargar, en segundos. */
export type DownloadSection = { start: number; end: number };

export type DownloadResult = {
  files: Array<{ filename: string; format: DownloadFormat }>;
  format: DownloadFormat;
  isPlaylist: boolean;
  /** Elementos omitidos porque ya se habían descargado antes. */
  skipped: number;
  /** Elementos de una playlist que no ofrecían el formato pedido. */
  unavailable: number;
};

export type DownloadItemProgress = { index: number; title: string | null; percent: number; status: "downloading" | "done" | "skipped" };

export type Id3Overrides = { artist?: string; album?: string; year?: string; genre?: string };

export type DownloadOptions = {
  url: string;
  format: DownloadFormat;
  quality: DownloadQuality;
  playlist: boolean;
  playlistTotal?: number | null;
  /** Índices (desde 1) de la playlist que se quieren descargar. */
  playlistItems?: number[] | null;
  filenameTemplate?: string | null;
  skipDuplicates?: boolean;
  id3?: Id3Overrides | null;
  section?: DownloadSection | null;
  /** Carpeta de trabajo propia de la tarea: permite varias descargas a la vez sin mezclar archivos. */
  workDirectory: string;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
  onLog?: DownloadLog;
  onItem?: (item: DownloadItemProgress) => void;
};

export type DownloadProgress = {
  percent: number;
  speed: string | null;
  eta: string | null;
  current: number | null;
  total: number | null;
  message: string;
};

export type DownloadLog = (line: string) => void;

export class DownloadToolUnavailableError extends Error {}
export class DownloadFailedError extends Error {}
export class DownloadLimitError extends Error {}
export class DownloadAbortedError extends Error {}
export class TemplateError extends Error {}
export class FormatUnavailableError extends Error {}

const defaultMaxBytes = 500 * 1024 * 1024;

function maxDownloadBytes(): number {
  const configured = Number(process.env.MAX_DOWNLOAD_BYTES ?? defaultMaxBytes);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : defaultMaxBytes;
}

function downloadDirectory(): string {
  return path.resolve(process.cwd(), process.env.DOWNLOAD_DIR ?? "../downloads");
}

function maxPlaylistItems(): number {
  const configured = Number(process.env.MAX_PLAYLIST_ITEMS ?? 50);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 50;
}

// Campos admitidos en las plantillas de nombre, con su equivalente de yt-dlp.
const templateFields: Record<string, string> = {
  title: "%(title)s",
  uploader: "%(uploader,channel|Desconocido)s",
  channel: "%(channel,uploader|Desconocido)s",
  artist: "%(artist,creator,uploader|Desconocido)s",
  album: "%(album,playlist_title|Sin álbum)s",
  playlist: "%(playlist_title,playlist|Sin playlist)s",
  index: "%(playlist_index|0)02d",
  playlist_index: "%(playlist_index|0)02d",
  year: "%(release_year,upload_date>%Y|0000)s",
  date: "%(upload_date>%Y-%m-%d|0000-00-00)s",
  id: "%(id)s",
  ext: "%(ext)s"
};

export const templateFieldNames = Object.keys(templateFields);

/** Convierte `{uploader} - {title}.{ext}` en una plantilla de yt-dlp segura. */
export function buildOutputTemplate(template?: string | null): string {
  const source = (template ?? "").trim() || "{title}.{ext}";
  if (source.length > 200) throw new TemplateError("La plantilla es demasiado larga.");
  if (/[\\/]|\.\./.test(source)) throw new TemplateError("La plantilla no puede contener carpetas (/ o \\).");
  if (/%/.test(source)) throw new TemplateError("Usa campos entre llaves, por ejemplo {title}.");
  let output = source.replace(/\{([a-z_]+)\}/gi, (_match, name: string) => {
    const field = templateFields[name.toLowerCase()];
    if (!field) throw new TemplateError(`Campo desconocido: {${name}}. Disponibles: ${templateFieldNames.map((item) => `{${item}}`).join(", ")}`);
    return field;
  });
  if (/[{}]/.test(output)) throw new TemplateError("Hay una llave sin cerrar en la plantilla.");
  if (!output.endsWith("%(ext)s")) output = `${output.replace(/\.$/, "")}.%(ext)s`;
  return output;
}

function dataDirectory(): string {
  return path.resolve(process.env.ANTITUBE_DATA_DIR ?? path.join(downloadDirectory(), ".antitube"));
}

/** Mata yt-dlp y sus procesos hijos (FFmpeg). En Windows hace falta taskkill /T. */
function killTree(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => child.kill());
  } else {
    child.kill("SIGTERM");
  }
}

function mediaExtensions(format: DownloadFormat): string[] {
  if (format === "mp4") return [".mp4", ".mkv", ".webm"];
  if (format === "m4a") return [".m4a"];
  if (format === "opus") return [".opus"];
  if (format === "flac") return [".flac"];
  return [".mp3"];
}

async function applyId3(filePath: string, format: DownloadFormat, overrides: Id3Overrides): Promise<void> {
  const tags = Object.entries({ artist: overrides.artist, album: overrides.album, date: overrides.year, genre: overrides.genre })
    .map(([key, value]) => [key, value?.trim()] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]));
  if (tags.length === 0) return;
  const extension = path.extname(filePath);
  const temporary = `${filePath}.tags${extension}`;
  const ffmpeg = process.env.FFMPEG_BIN ?? "ffmpeg";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", filePath, "-map", "0", "-c", "copy", ...(format === "mp3" ? ["-id3v2_version", "3"] : []), ...tags.flatMap(([key, value]) => ["-metadata", `${key}=${value}`]), temporary], { windowsHide: true });
    let errorOutput = "";
    child.stderr.on("data", (chunk: Buffer) => { errorOutput += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(errorOutput.trim() || "FFmpeg no pudo escribir las etiquetas."))));
  });
  await rename(temporary, filePath);
}

async function rewriteFlac(filePath: string): Promise<void> {
  const temporary = `${filePath}.fixed.flac`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_BIN ?? "ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", filePath, "-map", "0", "-c:a", "flac", "-c:v", "copy", temporary], { windowsHide: true });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error("FFmpeg no pudo ajustar el FLAC recortado."))));
  });
  await rename(temporary, filePath);
}

/** Mueve un archivo terminado a la carpeta de descargas sin pisar otro con el mismo nombre. */
async function moveIntoDownloads(source: string, directory: string): Promise<string> {
  const extension = path.extname(source);
  const stem = path.basename(source, extension);
  let target = path.join(directory, `${stem}${extension}`);
  for (let attempt = 2; ; attempt += 1) {
    try {
      await stat(target);
      target = path.join(directory, `${stem} (${attempt})${extension}`);
    } catch {
      break;
    }
  }
  try {
    await rename(source, target);
  } catch {
    // Carpeta de descargas en otra unidad: copiar y borrar.
    await copyFile(source, target);
    await unlink(source).catch(() => undefined);
  }
  return target;
}

/** Selector de formato y argumentos de yt-dlp para cada salida. */
function formatArguments(format: DownloadFormat, quality: DownloadQuality): string[] {
  switch (format) {
    case "mp3":
      return ["-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", `${quality}K`];
    case "m4a":
      // Solo pistas AAC originales: yt-dlp copia el audio sin recomprimirlo.
      return ["-f", "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio[acodec=aac]", "-x", "--audio-format", "m4a"];
    case "opus":
      return ["-f", "bestaudio[acodec=opus]/bestaudio[acodec^=opus]", "-x", "--audio-format", "opus"];
    case "flac":
      // Solo fuentes sin pérdida. PCM/WAV/AIFF se empaquetan en FLAC, que también es sin pérdida.
      return ["-f", "bestaudio[acodec^=flac]/bestaudio[acodec=alac]/bestaudio[acodec^=pcm]/bestaudio[ext=flac]/bestaudio[ext=wav]/bestaudio[ext=aiff]/bestaudio[ext=aif]", "-x", "--audio-format", "flac"];
    default: {
      const videoFormat = quality === "best"
        ? "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
        : `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${quality}][ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best`;
      return ["-f", videoFormat, "--merge-output-format", "mp4"];
    }
  }
}

function formatUnavailableMessage(format: DownloadFormat): string {
  if (format === "flac") return "Esta fuente no ofrece audio sin pérdida, así que no hay FLAC real que descargar. Elige M4A u Opus para conseguir el audio original sin conversión.";
  if (format === "m4a") return "Esta fuente no ofrece una pista M4A (AAC) original. Prueba con Opus o MP3.";
  if (format === "opus") return "Esta fuente no ofrece una pista Opus original. Prueba con M4A o MP3.";
  return "El formato pedido no está disponible en esta fuente.";
}

function timestamp(seconds: number): string {
  const whole = Math.max(0, seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = (whole % 60).toFixed(2).padStart(5, "0");
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${rest}`;
}

const ignoredWorkFiles = /\.(part|ytdl|temp|tmp|jpg|jpeg|png|webp|json|vtt|srt|lrc|description)$|\.part-Frag\d+/i;

/** Archivos terminados en la carpeta de trabajo de la tarea. */
async function finishedWorkFiles(workDirectory: string, format: DownloadFormat): Promise<string[]> {
  const extensions = mediaExtensions(format);
  const entries = await readdir(workDirectory, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(entries
    .filter((entry) => entry.isFile() && !ignoredWorkFiles.test(entry.name) && extensions.includes(path.extname(entry.name).toLowerCase()))
    .map(async (entry) => ({ path: path.join(workDirectory, entry.name), modified: (await stat(path.join(workDirectory, entry.name))).mtimeMs })));
  return files.sort((a, b) => a.modified - b.modified).map((file) => file.path);
}

/** Borra la carpeta de trabajo de una tarea (al terminar o cancelar). */
export async function removeWorkDirectory(workDirectory: string): Promise<void> {
  await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
}

export async function downloadMedia(options: DownloadOptions): Promise<DownloadResult> {
  const { url, format, quality, playlist, playlistTotal, onProgress, onLog, onItem, signal, workDirectory } = options;
  const directory = downloadDirectory();
  await mkdir(directory, { recursive: true });
  await mkdir(workDirectory, { recursive: true });
  const jsRuntime = process.env.YTDLP_JS_RUNTIME?.trim() || "node";
  const selectedItems = playlist && options.playlistItems?.length ? [...new Set(options.playlistItems)].filter((item) => Number.isInteger(item) && item > 0).sort((a, b) => a - b) : null;
  const section = !playlist && options.section && options.section.end > options.section.start ? options.section : null;

  const args = [
    playlist ? "--yes-playlist" : "--no-playlist",
    ...(playlist ? (selectedItems ? ["--playlist-items", selectedItems.join(",")] : ["--playlist-end", String(maxPlaylistItems()), "--lazy-playlist"]) : []),
    // En playlists, una canción que no tenga el formato pedido no detiene las demás.
    ...(playlist ? ["--ignore-errors"] : []),
    "--windows-filenames",
    "--no-overwrites",
    "--continue",
    "--concurrent-fragments", "4",
    "--max-filesize", `${Math.max(1, Math.floor(maxDownloadBytes() / (1024 * 1024)))}M`,
    "--newline",
    "--js-runtimes", jsRuntime,
    "--progress-template", "download:PROGRESS:%(info.playlist_index)s|%(info.n_entries)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta)s|%(info.title)s",
    "--embed-metadata",
    "-P", workDirectory,
    "-o", buildOutputTemplate(options.filenameTemplate)
  ];

  if (options.skipDuplicates !== false && !section) {
    await mkdir(dataDirectory(), { recursive: true });
    // Un registro por formato: tener el MP3 de un vídeo no impide descargar su MP4.
    args.push("--download-archive", path.join(dataDirectory(), `archivo-${format}.txt`));
  }

  args.push(...formatArguments(format, quality));
  if (format !== "mp4") {
    args.push("--embed-thumbnail", "--convert-thumbnails", "jpg", "--parse-metadata", "%(artist,creator,uploader|)s:%(meta_artist)s");
  }
  if (section) {
    args.push("--download-sections", `*${timestamp(section.start)}-${timestamp(section.end)}`);
    // En vídeo, cortes exactos (si no, el corte salta al fotograma clave más cercano).
    if (format === "mp4") args.push("--force-keyframes-at-cuts");
  }

  if (process.env.FFMPEG_BIN) args.push("--ffmpeg-location", process.env.FFMPEG_BIN);

  const ytdlpBinary = process.env.YTDLP_BIN ?? "yt-dlp";
  let skipped = 0;
  let unavailable = 0;
  const items = new Map<number, DownloadItemProgress>();

  try {
    if (signal?.aborted) throw new DownloadAbortedError("Descarga detenida.");
    await new Promise<string>((resolve, reject) => {
      const child = spawn(ytdlpBinary, [...args, "--", url], { windowsHide: true });
      let output = "";
      let errorOutput = "";
      let settled = false;
      let currentIndex: number | null = null;
      const finishItem = (index: number | null, status: DownloadItemProgress["status"] = "done") => {
        if (index === null) return;
        const item = items.get(index);
        if (item && item.status === "downloading") {
          item.status = status;
          item.percent = 100;
          onItem?.({ ...item });
        }
      };
      const onAbort = () => {
        killTree(child);
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new DownloadAbortedError("Descarga detenida."));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const timeout = setTimeout(() => killTree(child), Number(process.env.DOWNLOAD_TIMEOUT_MS ?? 30 * 60 * 1000));
      const consume = (chunk: Buffer, isError = false) => {
        const text = chunk.toString();
        if (isError) errorOutput += text;
        else output += text;
        for (const line of text.split(/\r?\n/)) {
          const cleanLine = line.trim();
          if (!cleanLine) continue;
          if (!cleanLine.includes("PROGRESS:")) onLog?.(cleanLine);
          if (/has already been recorded in the archive|has already been downloaded/i.test(cleanLine)) {
            skipped += 1;
            if (currentIndex !== null) finishItem(currentIndex, "skipped");
          }
          if (/Requested format is not available/i.test(cleanLine)) unavailable += 1;
          const markerIndex = line.indexOf("PROGRESS:");
          if (markerIndex < 0) continue;
          const [rawCurrent, rawTotal, rawPercent, rawSpeed, rawEta, ...titleParts] = line.slice(markerIndex + "PROGRESS:".length).split("|");
          const current = Number.parseInt(rawCurrent?.trim() ?? "", 10);
          const parsedTotal = Number.parseInt(rawTotal?.trim() ?? "", 10);
          const total = selectedItems ? selectedItems.length : Number.isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : (playlistTotal ?? Number.NaN);
          const percent = Number.parseFloat(rawPercent?.replace("%", "").trim());
          const title = titleParts.join("|").trim();
          const itemIndex = Number.isFinite(current) ? current : 1;
          if (currentIndex !== null && currentIndex !== itemIndex) finishItem(currentIndex);
          currentIndex = itemIndex;
          if (Number.isFinite(percent)) {
            const itemPercent = Math.min(100, Math.max(0, percent));
            const item = items.get(itemIndex) ?? { index: itemIndex, title: title && title !== "NA" ? title : null, percent: 0, status: "downloading" as const };
            item.percent = itemPercent;
            if (!item.title && title && title !== "NA") item.title = title;
            items.set(itemIndex, item);
            onItem?.({ ...item });
            // Posición del elemento dentro de la selección (si se eligieron canciones sueltas).
            const position = selectedItems ? Math.max(1, selectedItems.indexOf(itemIndex) + 1) : itemIndex;
            const overallPercent = playlist && Number.isFinite(total) && total > 0
              ? ((position - 1) * 100 + itemPercent) / total
              : itemPercent;
            onProgress?.({
              percent: Math.min(100, Math.max(0, overallPercent)),
              speed: rawSpeed?.trim() || null,
              eta: rawEta?.trim() || null,
              current: playlist ? position : null,
              total: playlist && Number.isFinite(total) ? total : null,
              message: playlist && Number.isFinite(total) ? `Elemento ${position} de ${total}${item.title ? `: ${item.title}` : ""}` : item.title ? `${section ? "Recortando" : "Descargando"}: ${item.title}` : "Descargando…"
            });
          }
        }
      };
      child.stdout.on("data", (chunk: Buffer) => consume(chunk));
      child.stderr.on("data", (chunk: Buffer) => consume(chunk, true));
      child.on("error", (error: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code) => {
        signal?.removeEventListener("abort", onAbort);
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        finishItem(currentIndex);
        // Con --ignore-errors yt-dlp termina con código 1 si alguna canción falló: se aceptan las que sí se bajaron.
        if (code === 0 || (playlist && code === 1)) resolve(output);
        else if (/Requested format is not available/i.test(errorOutput)) reject(new FormatUnavailableError(formatUnavailableMessage(format)));
        else reject(Object.assign(new Error(errorOutput || "yt-dlp terminó con error"), { code }));
      });
    });

    const workFiles = await finishedWorkFiles(workDirectory, format);
    if (workFiles.length === 0 && skipped > 0) return { files: [], format, isPlaylist: playlist, skipped, unavailable };
    if (workFiles.length === 0 && unavailable > 0) throw new FormatUnavailableError(formatUnavailableMessage(format));
    if (workFiles.length === 0) throw new DownloadFailedError("yt-dlp no devolvió ningún archivo generado.");

    const files = [];
    for (const workFile of workFiles) {
      const fileInfo = await stat(workFile);
      if (fileInfo.size > maxDownloadBytes()) {
        throw new DownloadLimitError("Uno de los archivos supera el límite configurado de tamaño.");
      }
      if (section && format === "flac") {
        // Al copiar un trozo, FLAC conserva la duración del original en su cabecera:
        // se vuelve a empaquetar (FLAC → FLAC es sin pérdida) para que los reproductores la lean bien.
        await rewriteFlac(workFile).catch((error) => onLog?.(`AVISO: ${error instanceof Error ? error.message : "no se pudo ajustar la duración"}`));
      }
      if (format !== "mp4" && options.id3) {
        try {
          await applyId3(workFile, format, options.id3);
        } catch (error) {
          onLog?.(`AVISO: no se pudieron escribir las etiquetas (${error instanceof Error ? error.message : "error"})`);
        }
      }
      const finalPath = await moveIntoDownloads(workFile, directory);
      files.push({ filename: path.basename(finalPath), format });
    }

    return { files, format, isPlaylist: playlist, skipped, unavailable };
  } catch (error) {
    if (error instanceof DownloadFailedError || error instanceof DownloadLimitError || error instanceof DownloadAbortedError || error instanceof FormatUnavailableError) throw error;
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT" && error instanceof Error && error.message.includes(ytdlpBinary)) {
      throw new DownloadToolUnavailableError("yt-dlp no está instalado o no está disponible en PATH.");
    }
    const detail = error instanceof Error ? error.message.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ") : "";
    throw new DownloadFailedError(detail || "No se pudo completar la descarga. Comprueba la URL y los formatos disponibles.");
  }
}
