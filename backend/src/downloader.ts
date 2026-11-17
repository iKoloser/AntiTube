import { spawn } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

export type DownloadFormat = "mp4" | "mp3";
export type VideoQuality = "best" | "360" | "480" | "720" | "1080";
export type AudioQuality = "128" | "192" | "256" | "320";
export type DownloadQuality = VideoQuality | AudioQuality;

export type DownloadResult = {
  files: Array<{ filename: string; format: DownloadFormat }>;
  format: DownloadFormat;
  isPlaylist: boolean;
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

function outputTemplate(): string {
  return "%(title)s.%(ext)s";
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

export async function downloadMedia(
  url: string,
  format: DownloadFormat,
  quality: DownloadQuality,
  playlist: boolean,
  playlistTotal?: number | null,
  onProgress?: (progress: DownloadProgress) => void,
  onLog?: DownloadLog
): Promise<DownloadResult> {
  const directory = downloadDirectory();
  await mkdir(directory, { recursive: true });
  const jsRuntime = process.env.YTDLP_JS_RUNTIME?.trim() || "node";

  const args = [
    playlist ? "--yes-playlist" : "--no-playlist",
    ...(playlist ? ["--playlist-end", String(maxPlaylistItems()), "--lazy-playlist"] : []),
    "--windows-filenames",
    "--max-filesize", `${Math.max(1, Math.floor(maxDownloadBytes() / (1024 * 1024)))}M`,
    "--newline",
    "--js-runtimes", jsRuntime,
    "--progress-template", "download:PROGRESS:%(playlist_index)s|%(n_entries)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta)s",
    "--print", "after_move:filepath",
    "-P", directory,
    "-o", outputTemplate()
  ];

  if (format === "mp3") {
    args.push("-x", "--audio-format", "mp3", "--audio-quality", `${quality}K`);
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

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(ytdlpBinary, [...args, "--", url], { windowsHide: true });
      let output = "";
      let errorOutput = "";
      let settled = false;
      const timeout = setTimeout(() => child.kill(), Number(process.env.DOWNLOAD_TIMEOUT_MS ?? 30 * 60 * 1000));
      const consume = (chunk: Buffer, isError = false) => {
        const text = chunk.toString();
        if (isError) errorOutput += text;
        else output += text;
        for (const line of text.split(/\r?\n/)) {
          const cleanLine = line.trim();
          if (cleanLine) onLog?.(cleanLine);
          const markerIndex = line.indexOf("PROGRESS:");
          if (markerIndex < 0) continue;
          const [rawCurrent, rawTotal, rawPercent, rawSpeed, rawEta] = line.slice(markerIndex + "PROGRESS:".length).split("|");
          const current = Number.parseInt(rawCurrent?.trim() ?? "", 10);
          const parsedTotal = Number.parseInt(rawTotal?.trim() ?? "", 10);
          const total = Number.isFinite(parsedTotal) && parsedTotal > 0
            ? parsedTotal
            : (playlistTotal ?? Number.NaN);
          const percent = Number.parseFloat(rawPercent?.replace("%", "").trim());
          if (Number.isFinite(percent)) {
            const itemPercent = Math.min(100, Math.max(0, percent));
            const overallPercent = Number.isFinite(current) && Number.isFinite(total) && total > 0
              ? ((Math.max(1, current) - 1) * 100 + itemPercent) / total
              : itemPercent;
            onProgress?.({
              percent: Math.min(100, Math.max(0, overallPercent)),
              speed: rawSpeed?.trim() || null,
              eta: rawEta?.trim() || null,
              current: Number.isFinite(current) ? current : null,
              total: Number.isFinite(total) ? total : null,
              message: Number.isFinite(current) && Number.isFinite(total) ? `Elemento ${current} de ${total}` : "Descargando…"
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
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
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
      files.push({ filename: path.basename(resolvedFile), format });
    }

    return { files, format, isPlaylist: playlist };
  } catch (error) {
    if (error instanceof DownloadFailedError || error instanceof DownloadLimitError) throw error;
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT" && error instanceof Error && error.message.includes(ytdlpBinary)) {
      throw new DownloadToolUnavailableError("yt-dlp no está instalado o no está disponible en PATH.");
    }
    const detail = error instanceof Error ? error.message.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ") : "";
    throw new DownloadFailedError(detail || "No se pudo completar la descarga. Comprueba la URL y los formatos disponibles.");
  }
}
