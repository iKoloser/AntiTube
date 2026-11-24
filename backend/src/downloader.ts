import { spawn } from "node:child_process";
import { mkdir, readdir, rename, stat } from "node:fs/promises";
import path from "node:path";

export type DownloadFormat = "mp4" | "mp3";
export type VideoQuality = "best" | "360" | "480" | "720" | "1080";
export type AudioQuality = "128" | "192" | "256" | "320";
export type DownloadQuality = VideoQuality | AudioQuality;

export type DownloadResult = {
  files: Array<{ filename: string; format: DownloadFormat }>;
  format: DownloadFormat;
  isPlaylist: boolean;
  /** Elementos omitidos porque ya se habían descargado antes. */
  skipped: number;
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

async function applyId3(filePath: string, overrides: Id3Overrides): Promise<void> {
  const tags = Object.entries({ artist: overrides.artist, album: overrides.album, date: overrides.year, genre: overrides.genre })
    .map(([key, value]) => [key, value?.trim()] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]));
  if (tags.length === 0) return;
  const temporary = `${filePath}.id3.mp3`;
  const ffmpeg = process.env.FFMPEG_BIN ?? "ffmpeg";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", filePath, "-map", "0", "-c", "copy", "-id3v2_version", "3", ...tags.flatMap(([key, value]) => ["-metadata", `${key}=${value}`]), temporary], { windowsHide: true });
    let errorOutput = "";
    child.stderr.on("data", (chunk: Buffer) => { errorOutput += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(errorOutput.trim() || "FFmpeg no pudo escribir las etiquetas."))));
  });
  await rename(temporary, filePath);
}

function finalPathsFromOutput(stdout: string, format: DownloadFormat): string[] {
  const extension = `.${format}`;
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return [...new Set(lines.filter((line) => line.toLowerCase().endsWith(extension)).map((line) => path.resolve(line)))];
}

function comparableFilename(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\.[^.]+$/u, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

async function findEquivalentFile(directory: string, candidate: string, format: DownloadFormat): Promise<string | null> {
  const candidateKey = comparableFilename(candidate);
  if (!candidateKey) return null;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(`.${format}`)) continue;
    if (comparableFilename(entry.name) === candidateKey) return path.join(directory, entry.name);
  }
  return null;
}

type FileSnapshot = Map<string, number>;

async function snapshotFiles(directory: string, format: DownloadFormat): Promise<FileSnapshot> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(`.${format}`))
      .map(async (entry) => ({ path: path.join(directory, entry.name), modified: (await stat(path.join(directory, entry.name))).mtimeMs }))
  );
  return new Map(files.map((file) => [file.path, file.modified]));
}

async function filesChangedSince(directory: string, format: DownloadFormat, since: number, before: FileSnapshot): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(`.${format}`))
      .map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        const fileInfo = await stat(filePath);
        return { path: filePath, modified: fileInfo.mtimeMs };
      })
  );
  return files
    .filter((file) => file.modified >= since - 500 && (!before.has(file.path) || file.modified > (before.get(file.path) ?? 0) + 1))
    .sort((left, right) => left.modified - right.modified)
    .map((file) => file.path);
}

export async function downloadMedia(options: DownloadOptions): Promise<DownloadResult> {
  const { url, format, quality, playlist, playlistTotal, onProgress, onLog, onItem, signal } = options;
  const directory = downloadDirectory();
  await mkdir(directory, { recursive: true });
  const jsRuntime = process.env.YTDLP_JS_RUNTIME?.trim() || "node";
  const selectedItems = playlist && options.playlistItems?.length ? [...new Set(options.playlistItems)].filter((item) => Number.isInteger(item) && item > 0).sort((a, b) => a - b) : null;

  const args = [
    playlist ? "--yes-playlist" : "--no-playlist",
    ...(playlist ? (selectedItems ? ["--playlist-items", selectedItems.join(",")] : ["--playlist-end", String(maxPlaylistItems()), "--lazy-playlist"]) : []),
    "--windows-filenames",
    "--no-overwrites",
    "--continue",
    "--max-filesize", `${Math.max(1, Math.floor(maxDownloadBytes() / (1024 * 1024)))}M`,
    "--newline",
    "--js-runtimes", jsRuntime,
    "--progress-template", "download:PROGRESS:%(info.playlist_index)s|%(info.n_entries)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta)s|%(info.title)s",
    "--print", "after_move:filepath",
    "--embed-metadata",
    "-P", directory,
    "-o", buildOutputTemplate(options.filenameTemplate)
  ];

  if (options.skipDuplicates !== false) {
    await mkdir(dataDirectory(), { recursive: true });
    // Un registro por formato: tener el MP3 de un vídeo no impide descargar su MP4.
    args.push("--download-archive", path.join(dataDirectory(), `archivo-${format}.txt`));
  }

  if (format === "mp3") {
    args.push(
      "-x", "--audio-format", "mp3", "--audio-quality", `${quality}K`,
      "--embed-thumbnail", "--convert-thumbnails", "jpg",
      // Si la plataforma no da artista, usamos el autor del vídeo.
      "--parse-metadata", "%(artist,creator,uploader|)s:%(meta_artist)s"
    );
  } else {
    const videoFormat = quality === "best"
      ? "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
      : `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${quality}][ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best`;
    args.push("-f", videoFormat, "--merge-output-format", "mp4");
  }

  if (process.env.FFMPEG_BIN) args.push("--ffmpeg-location", process.env.FFMPEG_BIN);

  const ytdlpBinary = process.env.YTDLP_BIN ?? "yt-dlp";
  const startedAt = Date.now();
  const beforeFiles = await snapshotFiles(directory, format);
  let skipped = 0;
  const items = new Map<number, DownloadItemProgress>();

  try {
    if (signal?.aborted) throw new DownloadAbortedError("Descarga detenida.");
    const stdout = await new Promise<string>((resolve, reject) => {
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
              message: playlist && Number.isFinite(total) ? `Elemento ${position} de ${total}${item.title ? `: ${item.title}` : ""}` : item.title ? `Descargando: ${item.title}` : "Descargando…"
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
        if (code === 0) resolve(output);
        else reject(Object.assign(new Error(errorOutput || "yt-dlp terminó con error"), { code }));
      });
    });

    const filePaths = finalPathsFromOutput(stdout, format);
    const changedPaths = await filesChangedSince(directory, format, startedAt, beforeFiles);
    const validPaths: string[] = [];
    for (const filePath of [...filePaths, ...changedPaths]) {
      try {
        await stat(filePath);
        if (!validPaths.includes(filePath)) validPaths.push(filePath);
      } catch {
        // La salida de Windows puede sustituir emojis del nombre por �.
        // Primero intentamos localizar el mismo nombre real en disco.
        const equivalentPath = await findEquivalentFile(directory, path.basename(filePath), format);
        if (equivalentPath && !validPaths.includes(equivalentPath)) validPaths.push(equivalentPath);
      }
    }
    if (validPaths.length === 0 && skipped > 0) return { files: [], format, isPlaylist: playlist, skipped };
    if (validPaths.length === 0) throw new DownloadFailedError("yt-dlp no devolvió ningún archivo generado.");

    const resolvedDirectory = path.resolve(directory);
    const files = [];
    for (const filePath of validPaths) {
      const resolvedFile = path.resolve(filePath);
      if (!resolvedFile.startsWith(`${resolvedDirectory}${path.sep}`)) {
        throw new DownloadFailedError("La ruta generada está fuera del directorio de descargas.");
      }
      const fileInfo = await stat(resolvedFile);
      if (fileInfo.size > maxDownloadBytes()) {
        throw new DownloadLimitError("Uno de los archivos supera el límite configurado de tamaño.");
      }
      if (format === "mp3" && options.id3) {
        try {
          await applyId3(resolvedFile, options.id3);
        } catch (error) {
          onLog?.(`AVISO: no se pudieron escribir las etiquetas ID3 (${error instanceof Error ? error.message : "error"})`);
        }
      }
      files.push({ filename: path.basename(resolvedFile), format });
    }

    return { files, format, isPlaylist: playlist, skipped };
  } catch (error) {
    if (error instanceof DownloadFailedError || error instanceof DownloadLimitError || error instanceof DownloadAbortedError) throw error;
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT" && error instanceof Error && error.message.includes(ytdlpBinary)) {
      throw new DownloadToolUnavailableError("yt-dlp no está instalado o no está disponible en PATH.");
    }
    const detail = error instanceof Error ? error.message.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ") : "";
    throw new DownloadFailedError(detail || "No se pudo completar la descarga. Comprueba la URL y los formatos disponibles.");
  }
}
