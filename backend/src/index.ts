import cors from "cors";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import { execFile } from "node:child_process";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createPlaylistArchive } from "./archive.js";
import { DownloadLimitError, DownloadToolUnavailableError, downloadMedia, type AudioQuality, type DownloadFormat, type DownloadProgress, type VideoQuality } from "./downloader.js";
import { ExtractorLookupError, ExtractorUnavailableError, getMediaMetadata } from "./extractor.js";

dotenv.config({ path: "../.env" });
dotenv.config();

const app = express();
const execFileAsync = promisify(execFile);
const port = Number(process.env.BACKEND_PORT ?? 4000);
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";
const metadataTimeoutMs = Number(process.env.METADATA_TIMEOUT_MS ?? 60_000);
const playlistMetadataTimeoutMs = Number(process.env.PLAYLIST_METADATA_TIMEOUT_MS ?? 180_000);
const maxPlaylistItems = Number(process.env.MAX_PLAYLIST_ITEMS ?? 50);
const shazamTimeoutMs = Number(process.env.SHAZAM_TIMEOUT_MS ?? 60_000);
const ffmpegTimeoutMs = Number(process.env.FFMPEG_TIMEOUT_MS ?? 30_000);
const accessKey = process.env.ANTITUBE_ACCESS_KEY?.trim() ?? "";
const sessionCookieName = "antitube_session";
const downloadDirectory = path.resolve(process.cwd(), process.env.DOWNLOAD_DIR ?? "../downloads");
let activeDownloads = 0;

type DownloadJob = {
  status: "queued" | "downloading" | "completed" | "failed";
  progress: DownloadProgress;
  logs: string[];
  result?: { message: string; files: Array<{ filename: string; format: DownloadFormat; downloadUrl: string }>; archive?: { filename: string; downloadUrl: string; count: number }; format: DownloadFormat; isPlaylist: boolean; maxPlaylistItems: number };
  error?: { error: string; message: string };
};

const downloadJobs = new Map<string, DownloadJob>();

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: "20mb" }));

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.cookie ?? "";
  return Object.fromEntries(header.split(";").map((part) => part.trim().split("=")).filter(([name, value]) => name && value).map(([name, ...value]) => [name, decodeURIComponent(value.join("="))]));
}

function sessionToken(): string {
  return createHmac("sha256", accessKey).update("antitube-session-v1").digest("hex");
}

function hasValidSession(request: Request): boolean {
  if (!accessKey) return false;
  const received = parseCookies(request)[sessionCookieName] ?? "";
  const expected = sessionToken();
  if (received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

function setSessionCookie(response: Response, token: string, maxAgeSeconds: number): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`);
}

app.use("/api", (request: Request, response: Response, next) => {
  const publicRoute = (request.method === "POST" && request.path === "/auth/login")
    || (request.method === "GET" && request.path === "/auth/session");
  if (publicRoute) {
    next();
    return;
  }
  if (!hasValidSession(request)) {
    response.status(accessKey ? 401 : 503).json({ error: "Acceso protegido", message: accessKey ? "Introduce la clave de AntiTube para continuar." : "ANTITUBE_ACCESS_KEY no está configurada en el backend." });
    return;
  }
  next();
});

type Analysis = {
  url: string;
  domain: string;
  platform: string;
  videoOnly: boolean;
};

function platformFromDomain(hostname: string, pathname: string): string {
  const normalized = hostname.toLowerCase().replace(/^www\./, "");

  if (normalized === "youtube.com" || normalized === "youtu.be") return "YouTube";
  if (normalized === "twitter.com" || normalized.endsWith(".twitter.com") || normalized === "x.com") return "Twitter/X";
  if (normalized === "vimeo.com") return "Vimeo";
  if (normalized === "tiktok.com" || normalized.endsWith(".tiktok.com")) return "TikTok";
  if (normalized === "clips.twitch.tv" || (normalized === "twitch.tv" && /\/clip\//i.test(pathname))) return "Twitch Clips";
  if (normalized === "twitch.tv") return "Twitch";
  if (normalized === "instagram.com") return "Instagram";
  if (normalized === "facebook.com" || normalized.endsWith(".facebook.com")) return "Facebook";
  if (normalized === "reddit.com" || normalized.endsWith(".reddit.com")) return "Reddit";
  if (normalized === "soundcloud.com" || normalized.endsWith(".soundcloud.com")) return "SoundCloud";
  if (normalized === "bandcamp.com" || normalized.endsWith(".bandcamp.com")) return "Bandcamp";
  if (normalized === "dailymotion.com" || normalized.endsWith(".dailymotion.com")) return "Dailymotion";
  if (normalized === "bilibili.com" || normalized.endsWith(".bilibili.com")) return "Bilibili";
  if (normalized === "rumble.com" || normalized.endsWith(".rumble.com")) return "Rumble";
  if (normalized === "kick.com" || normalized.endsWith(".kick.com")) return "Kick";
  if (normalized === "vk.com" || normalized.endsWith(".vk.com")) return "VK";
  if (normalized === "streamable.com" || normalized.endsWith(".streamable.com")) return "Streamable";
  return "Sitio web no identificado";
}

function isVideoOnlyPlatform(platform: string): boolean {
  return ["TikTok", "Twitch Clips", "Twitch", "Facebook", "Reddit", "Dailymotion", "Bilibili", "Rumble", "Kick", "VK", "Streamable"].includes(platform);
}

function analyzeUrl(value: unknown): Analysis | null {
  if (typeof value !== "string" || value.trim() === "") return null;

  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

    const domain = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const platform = platformFromDomain(domain, parsed.pathname);
    return { url: parsed.toString(), domain, platform, videoOnly: isVideoOnlyPlatform(platform) };
  } catch {
    return null;
  }
}

function analyzeDownloadSource(value: unknown): Analysis | null {
  if (typeof value === "string") {
    const source = value.trim();
    const searchMatch = /^(ytsearch|scsearch)\d*:(.+)$/i.exec(source);
    if (searchMatch) {
      const platform = searchMatch[1].toLowerCase().startsWith("scsearch") ? "SoundCloud" : "YouTube";
      return { url: source, domain: searchMatch[1].toLowerCase(), platform, videoOnly: false };
    }
  }
  return analyzeUrl(value);
}

app.post("/api/auth/login", (request: Request, response: Response) => {
  if (!accessKey) {
    response.status(503).json({ error: "Autenticación no configurada", message: "Define ANTITUBE_ACCESS_KEY en el archivo .env del backend." });
    return;
  }
  const submittedKey = typeof request.body?.key === "string" ? request.body.key : "";
  const expected = Buffer.from(accessKey);
  const received = Buffer.from(submittedKey);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    response.status(401).json({ error: "Clave incorrecta", message: "La clave no es válida." });
    return;
  }
  setSessionCookie(response, sessionToken(), 60 * 60 * 24 * 7);
  response.json({ authenticated: true });
});

app.get("/api/auth/session", (request: Request, response: Response) => {
  response.json({ authenticated: hasValidSession(request) });
});

app.post("/api/auth/logout", (_request: Request, response: Response) => {
  setSessionCookie(response, "", 0);
  response.json({ authenticated: false });
});

app.get("/api/health", (_request: Request, response: Response) => {
  response.json({ status: "ok", service: "antitube-backend" });
});

function audioExtension(mimeType: unknown): string {
  if (typeof mimeType !== "string") return ".webm";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return ".mp3";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return ".m4a";
  if (mimeType.includes("ogg")) return ".ogg";
  if (mimeType.includes("wav")) return ".wav";
  return ".webm";
}

app.post("/api/shazam/recognize", async (request: Request, response: Response) => {
  const encodedAudio = request.body?.audioBase64;
  if (typeof encodedAudio !== "string" || encodedAudio.trim() === "") {
    response.status(400).json({ error: "Audio no válido", message: "Envía un fragmento de audio grabado desde el navegador." });
    return;
  }

  const base64 = encodedAudio.includes(",") ? encodedAudio.slice(encodedAudio.indexOf(",") + 1) : encodedAudio;
  if (base64.length > 18 * 1024 * 1024) {
    response.status(413).json({ error: "Audio demasiado grande", message: "El fragmento de audio supera el límite permitido." });
    return;
  }

  const temporaryDirectory = path.resolve(process.cwd(), "../downloads/.shazam-temp");
  const temporaryPath = path.join(temporaryDirectory, `${randomUUID()}${audioExtension(request.body?.mimeType)}`);
  let normalizedPath: string | null = null;
  const pythonBinary = process.env.PYTHON_BIN ?? "python";
  const ffmpegBinary = process.env.FFMPEG_BIN ?? "ffmpeg";
  try {
    await mkdir(temporaryDirectory, { recursive: true });
    await writeFile(temporaryPath, Buffer.from(base64, "base64"));
    normalizedPath = path.join(temporaryDirectory, `${randomUUID()}.wav`);
    await execFileAsync(ffmpegBinary, [
      "-nostdin",
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", temporaryPath,
      "-vn",
      "-ac", "1",
      "-ar", "44100",
      "-c:a", "pcm_s16le",
      normalizedPath
    ], { timeout: ffmpegTimeoutMs, maxBuffer: 2 * 1024 * 1024 });
    const scriptPath = path.resolve(process.cwd(), "shazam_recognize.py");
    const { stdout } = await execFileAsync(pythonBinary, [scriptPath, normalizedPath], {
      timeout: shazamTimeoutMs,
      maxBuffer: 2 * 1024 * 1024
    });
    const jsonLine = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
    const recognition = JSON.parse(jsonLine ?? "{}") as { error?: string; matched?: boolean };
    if (recognition.error) throw new Error(recognition.error);
    response.json({ message: recognition.matched ? "Canción reconocida correctamente." : "No se ha encontrado una coincidencia clara.", recognition });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "No se pudo ejecutar ShazamIO.";
    const errorCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    console.error(`[shazam] ${detail}`);
    if (errorCode === "ENOENT" && detail.includes(ffmpegBinary)) {
      response.status(503).json({ error: "FFmpeg no disponible", message: `No se ha encontrado FFmpeg (${detail}). Instálalo o configura FFMPEG_BIN.` });
    } else if (detail.includes("No module named") || (errorCode === "ENOENT" && detail.includes(pythonBinary))) {
      response.status(503).json({ error: "ShazamIO no disponible", message: `Instala la dependencia con: python -m pip install -r backend/requirements.txt (${detail})` });
    } else {
      response.status(422).json({ error: "No se pudo reconocer el audio", message: detail });
    }
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    if (normalizedPath) await rm(normalizedPath, { force: true }).catch(() => undefined);
  }
});

app.post("/api/metadata", async (request: Request, response: Response) => {
  const analysis = analyzeUrl(request.body?.url);

  if (!analysis) {
    response.status(400).json({
      error: "URL inválida",
      message: "Envía una URL completa que empiece por http:// o https://."
    });
    return;
  }

  try {
    const includePlaylist = request.body?.playlist === true;
    const timeoutMs = includePlaylist ? playlistMetadataTimeoutMs : metadataTimeoutMs;
    const metadata = await getMediaMetadata(analysis.url, timeoutMs, includePlaylist, maxPlaylistItems);
    response.json({
      message: "Metadatos consultados correctamente. No se ha descargado ningún archivo.",
      analysis,
      metadata
    });
  } catch (error) {
    if (error instanceof ExtractorUnavailableError) {
      response.status(503).json({ error: "Extractor no disponible", message: error.message });
      return;
    }

    const message = error instanceof ExtractorLookupError ? error.message : "Error inesperado al consultar metadatos.";
    response.status(422).json({ error: "No se pudieron consultar los metadatos", message });
  }
});

app.post("/api/analyze", (request: Request, response: Response) => {
  const analysis = analyzeUrl(request.body?.url);

  if (!analysis) {
    response.status(400).json({
      error: "URL inválida",
      message: "Envía una URL completa que empiece por http:// o https://."
    });
    return;
  }

  response.json({
    message: "URL analizada correctamente.",
    analysis
  });
});

app.post("/api/download", (request: Request, response: Response) => {
  const analysis = analyzeDownloadSource(request.body?.url);
  const format = request.body?.format;
  const quality = request.body?.quality;
  const playlist = request.body?.playlist === true;
  const playlistTitle = typeof request.body?.playlistTitle === "string" ? request.body.playlistTitle : null;
  const requestedPlaylistTotal = Number(request.body?.playlistTotal);
  const playlistTotal = playlist && Number.isInteger(requestedPlaylistTotal) && requestedPlaylistTotal > 0
    ? Math.min(requestedPlaylistTotal, maxPlaylistItems)
    : null;
  const validVideoQualities = ["best", "360", "480", "720", "1080"] as const;
  const validAudioQualities = ["128", "192", "256", "320"] as const;
  const validQuality = format === "mp4"
    ? validVideoQualities.includes(quality)
    : format === "mp3" && validAudioQualities.includes(quality);

  if (!analysis || (format !== "mp4" && format !== "mp3") || !validQuality) {
    response.status(400).json({
      error: "Solicitud inválida",
      message: "Envía una URL http(s), un formato mp4/mp3 y una calidad compatible."
    });
    return;
  }

  if (analysis.videoOnly && format !== "mp4") {
    response.status(400).json({
      error: "Formato no compatible",
      message: `${analysis.platform} solo permite descargas de vídeo en formato MP4.`
    });
    return;
  }

  if (activeDownloads >= 1) {
    response.status(429).json({ error: "Descarga ocupada", message: "Solo se permite una descarga simultánea." });
    return;
  }

  const jobId = randomUUID();
  const initialMessage = playlist
    ? playlistTotal ? `Preparando playlist de ${playlistTotal} elementos…` : "Preparando playlist…"
    : "Preparando descarga…";
  const job: DownloadJob = { status: "queued", progress: { percent: 0, speed: null, eta: null, current: null, total: playlistTotal, message: initialMessage }, logs: [initialMessage] };
  downloadJobs.set(jobId, job);
  activeDownloads += 1;
  void (async () => {
    job.status = "downloading";
    try {
      const result = await downloadMedia(
        analysis.url,
        format as DownloadFormat,
        quality as VideoQuality | AudioQuality,
        playlist,
        playlistTotal,
        (progress) => { job.progress = progress; },
        (line) => {
          job.logs.push(line);
          if (job.logs.length > 100) job.logs.shift();
        }
      );
      job.progress = {
        percent: result.isPlaylist ? 99 : 100,
        speed: null,
        eta: null,
        current: null,
        total: null,
        message: result.isPlaylist ? "Preparando archivo ZIP…" : "Finalizando descarga…"
      };
      const archiveFilename = playlist
        ? await createPlaylistArchive(downloadDirectory, result.files.map((file) => file.filename), playlistTitle)
        : null;
      if (archiveFilename) job.logs.push(`ZIP preparado: ${archiveFilename}`);
      job.result = {
        message: archiveFilename
          ? `Playlist ${result.format.toUpperCase()} preparada: ${result.files.length} canciones.`
          : `Descarga ${result.format.toUpperCase()} completada: ${result.files.length} archivo(s).`,
        files: archiveFilename ? [] : result.files.map((file) => ({ ...file, downloadUrl: `/api/downloads/${encodeURIComponent(file.filename)}` })),
        ...(archiveFilename ? { archive: { filename: archiveFilename, downloadUrl: `/api/downloads/${encodeURIComponent(archiveFilename)}`, count: result.files.length } } : {}),
        format: result.format,
        isPlaylist: result.isPlaylist,
        maxPlaylistItems
      };
      job.status = "completed";
      job.progress = {
        percent: 100,
        speed: null,
        eta: null,
        current: result.isPlaylist ? result.files.length : null,
        total: result.isPlaylist ? result.files.length : null,
        message: "Descarga completada"
      };
    } catch (error) {
      job.status = "failed";
      if (error instanceof DownloadToolUnavailableError) job.error = { error: "Herramienta no disponible", message: error.message };
      else if (error instanceof DownloadLimitError) job.error = { error: "Archivo demasiado grande", message: error.message };
      else {
        const message = error instanceof Error ? error.message : "Error inesperado durante la descarga.";
        job.error = { error: "Descarga fallida", message };
        job.logs.push(`ERROR: ${message}`);
      }
    } finally {
      activeDownloads -= 1;
    }
  })();
  response.status(202).json({ jobId, status: job.status, progress: job.progress, logs: job.logs });
});

app.get("/api/download/:jobId", (request: Request, response: Response) => {
  const jobId = typeof request.params.jobId === "string" ? request.params.jobId : "";
  const job = downloadJobs.get(jobId);
  if (!job) {
    response.status(404).json({ error: "Tarea no encontrada", message: "La tarea de descarga ya no existe." });
    return;
  }
  response.json({ ...job, jobId });
});

app.get("/api/downloads/:filename", (request: Request, response: Response) => {
  const rawFilename = request.params.filename;
  const filename = typeof rawFilename === "string" ? path.basename(rawFilename) : "";
  if (!filename || filename !== rawFilename || !/\.(mp3|mp4|zip)$/i.test(filename)) {
    response.status(400).json({ error: "Archivo inválido", message: "El archivo solicitado no es válido." });
    return;
  }

  response.download(path.join(downloadDirectory, filename), filename, (error) => {
    if (error && !response.headersSent) response.status(404).json({ error: "Archivo no encontrado", message: "El archivo ya no está disponible." });
  });
});

app.listen(port, () => {
  console.log(`AntiTube backend disponible en http://localhost:${port}`);
});
