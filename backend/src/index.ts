import cors from "cors";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import { execFile, spawn } from "node:child_process";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ExtractorLookupError, ExtractorUnavailableError, getMediaMetadata } from "./extractor.js";
import { createAppUpdateRouter } from "./appUpdate.js";
import { createJobsRouter, rebalanceQueue } from "./jobs.js";
import { createLibraryRouter } from "./library.js";
import { createMediaRouter } from "./media.js";
import { warmupStreaming } from "./direct.js";
import { defaultDownloadDirectory, downloadDirectory, loadSettings, maxConcurrentDownloads, setDownloadDirectory, setMaxConcurrentDownloads } from "./settings.js";
import { addToHistory, listHistory, removeFromHistory } from "./shazamHistory.js";
import { autoUpdateTools, checkUpdates, detectTools, runSetup, runUpdate, setupStatus, type SetupStepId } from "./setup.js";

// En la versión de escritorio la configuración llega por variables de entorno
// desde la app Tauri; no se leen archivos .env.
const desktopMode = process.env.ANTITUBE_DESKTOP === "1";
if (!desktopMode) {
  dotenv.config({ path: "../.env" });
  dotenv.config();
} else if (!process.env.YTDLP_JS_RUNTIME) {
  // yt-dlp necesita un runtime JavaScript para YouTube: reutilizamos el Node incluido en la app.
  process.env.YTDLP_JS_RUNTIME = `node:${process.execPath}`;
}

const app = express();
const execFileAsync = promisify(execFile);
const port = Number(process.env.BACKEND_PORT ?? 4000);
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";
// Orígenes del WebView de Tauri (Windows usa http(s)://tauri.localhost; macOS/Linux, tauri://localhost).
const desktopOrigins = ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost", "http://localhost:3000"];
const resourceDirectory = path.resolve(process.env.ANTITUBE_RESOURCE_DIR ?? process.cwd());
const metadataTimeoutMs = Number(process.env.METADATA_TIMEOUT_MS ?? 60_000);
const playlistMetadataTimeoutMs = Number(process.env.PLAYLIST_METADATA_TIMEOUT_MS ?? 180_000);
const maxPlaylistItems = Number(process.env.MAX_PLAYLIST_ITEMS ?? 50);
const shazamTimeoutMs = Number(process.env.SHAZAM_TIMEOUT_MS ?? 60_000);
const ffmpegTimeoutMs = Number(process.env.FFMPEG_TIMEOUT_MS ?? 30_000);
const accessKey = process.env.ANTITUBE_ACCESS_KEY?.trim() ?? "";
const sessionCookieName = "antitube_session";
const authRateLimitMax = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10);
const authRateLimitWindowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000);
const authAttempts = new Map<string, { count: number; resetAt: number }>();
app.use(cors({ origin: desktopMode ? desktopOrigins : corsOrigin, credentials: true }));
app.use(express.json({ limit: "20mb" }));
app.set("trust proxy", process.env.NODE_ENV === "production");

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
  // La app de escritorio solo escucha en 127.0.0.1 y no necesita clave.
  if (desktopMode) {
    next();
    return;
  }
  const publicRoute = (request.method === "POST" && request.path === "/auth/login")
    || (request.method === "GET" && request.path === "/auth/session")
    || (request.method === "GET" && request.path === "/health");
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
  const address = request.ip || request.socket.remoteAddress || "unknown";
  const now = Date.now();
  const previous = authAttempts.get(address);
  const attempt = previous && previous.resetAt > now ? previous : { count: 0, resetAt: now + authRateLimitWindowMs };
  if (attempt.count >= authRateLimitMax) {
    response.setHeader("Retry-After", Math.ceil((attempt.resetAt - now) / 1000));
    response.status(429).json({ error: "Demasiados intentos", message: "Espera unos minutos antes de volver a intentarlo." });
    return;
  }
  const submittedKey = typeof request.body?.key === "string" ? request.body.key : "";
  const expected = Buffer.from(accessKey);
  const received = Buffer.from(submittedKey);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    attempt.count += 1;
    authAttempts.set(address, attempt);
    response.status(401).json({ error: "Clave incorrecta", message: "La clave no es válida." });
    return;
  }
  authAttempts.delete(address);
  setSessionCookie(response, sessionToken(), 60 * 60 * 24 * 7);
  response.json({ authenticated: true });
});

app.get("/api/auth/session", (request: Request, response: Response) => {
  response.json({ authenticated: desktopMode || hasValidSession(request) });
});

app.post("/api/auth/logout", (_request: Request, response: Response) => {
  setSessionCookie(response, "", 0);
  response.json({ authenticated: false });
});

app.get("/api/health", (_request: Request, response: Response) => {
  response.json({ status: "ok", service: "antitube-backend", desktop: desktopMode });
});

app.get("/api/setup/status", (_request: Request, response: Response) => {
  response.json(setupStatus());
});

app.post("/api/setup/check", async (_request: Request, response: Response) => {
  await detectTools();
  response.json(setupStatus());
});

app.post("/api/setup/install", (request: Request, response: Response) => {
  const started = runSetup({ includeShazam: request.body?.includeShazam === true });
  response.status(started ? 202 : 409).json(setupStatus());
});

app.post("/api/setup/check-updates", async (_request: Request, response: Response) => {
  await checkUpdates();
  response.json(setupStatus());
});

app.post("/api/setup/update", (request: Request, response: Response) => {
  const started = runUpdate(request.body?.id as SetupStepId);
  response.status(started ? 202 : 409).json(setupStatus());
});

app.get("/api/desktop/info", (_request: Request, response: Response) => {
  response.json({ desktop: desktopMode, downloadDirectory: downloadDirectory() });
});

/** Abre el explorador del sistema mostrando un archivo (o una carpeta). */
function revealInExplorer(target: string, select: boolean): void {
  if (process.platform === "win32") {
    // explorer.exe necesita `/select,"ruta"` literal: el entrecomillado automático de Node
    // envuelve el argumento entero y Explorer lo ignora cuando el nombre tiene espacios.
    const explorerArgument = select ? `/select,"${target}"` : `"${target}"`;
    spawn("explorer.exe", [explorerArgument], { windowsVerbatimArguments: true, detached: true, stdio: "ignore" }).on("error", (error) => console.error(`[open] ${error.message}`)).unref();
    return;
  }
  if (process.platform === "darwin") execFile("open", select ? ["-R", target] : [target], () => undefined);
  else execFile("xdg-open", [select ? path.dirname(target) : target], () => undefined);
}

// Abre la carpeta de descargas (y selecciona el archivo si se indica) en el explorador del sistema.
app.post("/api/desktop/open", (request: Request, response: Response) => {
  if (!desktopMode) {
    response.status(404).json({ error: "No disponible", message: "Solo disponible en la versión de escritorio." });
    return;
  }
  const rawFilename = request.body?.filename;
  const filename = typeof rawFilename === "string" ? path.basename(rawFilename) : "";
  const filePath = filename ? path.join(downloadDirectory(), filename) : null;
  // Si el archivo ya no existe (o se renombró), abrimos al menos la carpeta.
  const reveal = Boolean(filePath && existsSync(filePath));
  const target = reveal && filePath ? filePath : downloadDirectory();
  void mkdir(downloadDirectory(), { recursive: true }).then(() => revealInExplorer(target, reveal));
  response.json({ opened: target });
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

  const temporaryDirectory = desktopMode ? path.join(process.env.ANTITUBE_DATA_DIR ?? downloadDirectory(), ".shazam-temp") : path.resolve(process.cwd(), "../downloads/.shazam-temp");
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
    const scriptPath = path.join(resourceDirectory, "shazam_recognize.py");
    const { stdout } = await execFileAsync(pythonBinary, [scriptPath, normalizedPath], {
      timeout: shazamTimeoutMs,
      maxBuffer: 2 * 1024 * 1024
    });
    const jsonLine = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
    const recognition = JSON.parse(jsonLine ?? "{}") as { error?: string; matched?: boolean };
    if (recognition.error) throw new Error(recognition.error);
    if (recognition.matched) await addToHistory(recognition as Record<string, unknown>).catch(() => undefined);
    response.json({ message: recognition.matched ? "Canción reconocida correctamente." : "No se ha encontrado una coincidencia clara.", recognition });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "No se pudo ejecutar ShazamIO.";
    const errorCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    console.error(`[shazam] ${detail}`);
    if (errorCode === "ENOENT" && detail.includes(ffmpegBinary)) {
      response.status(503).json({ error: "FFmpeg no disponible", message: `No se ha encontrado FFmpeg (${detail}). Instálalo o configura FFMPEG_BIN.` });
    } else if (detail.includes("No module named") || (errorCode === "ENOENT" && detail.includes(pythonBinary))) {
      response.status(503).json({ error: "ShazamIO no disponible", message: desktopMode ? "SHAZAM no está instalado. Ve a Herramientas, marca «Instalar también SHAZAM» y pulsa «Instalar SHAZAM»." : `Instala la dependencia con: python -m pip install -r backend/requirements.txt (${detail})` });
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

// Busca la canción reconocida en YouTube o SoundCloud y devuelve la vista previa del primer resultado.
app.post("/api/shazam/preview", async (request: Request, response: Response) => {
  const provider = request.body?.provider === "soundcloud" ? "soundcloud" : "youtube";
  const query = typeof request.body?.query === "string" ? request.body.query.trim().slice(0, 200) : "";
  if (!query) {
    response.status(400).json({ error: "Búsqueda vacía", message: "Falta el título de la canción." });
    return;
  }
  try {
    const search = await getMediaMetadata(`${provider === "soundcloud" ? "scsearch1" : "ytsearch1"}:${query}`, metadataTimeoutMs, true, 1);
    const first = search.playlistEntries[0];
    if (!first?.sourceUrl) {
      response.status(404).json({ error: "Sin resultados", message: `No se ha encontrado la canción en ${provider === "soundcloud" ? "SoundCloud" : "YouTube"}.` });
      return;
    }
    const metadata = await getMediaMetadata(first.sourceUrl, metadataTimeoutMs, false, 1);
    const analysis = analyzeUrl(metadata.sourceUrl) ?? analyzeUrl(first.sourceUrl);
    response.json({ provider, metadata, analysis });
  } catch (error) {
    if (error instanceof ExtractorUnavailableError) {
      response.status(503).json({ error: "Extractor no disponible", message: error.message });
      return;
    }
    const message = error instanceof ExtractorLookupError ? error.message : "No se pudo buscar la canción.";
    response.status(422).json({ error: "Búsqueda fallida", message });
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

app.use(createJobsRouter({ analyzeDownloadSource, maxPlaylistItems }));
app.use(createMediaRouter({ metadataTimeoutMs, analyzeUrl }));
app.use(createLibraryRouter({ reveal: (filePath) => revealInExplorer(filePath, true) }));
app.use(createAppUpdateRouter());

app.get("/api/settings", (_request: Request, response: Response) => {
  response.json({ downloadDirectory: downloadDirectory(), defaultDownloadDirectory: defaultDownloadDirectory(), maxConcurrent: maxConcurrentDownloads() });
});

app.post("/api/settings/concurrency", async (request: Request, response: Response) => {
  const value = await setMaxConcurrentDownloads(Number(request.body?.maxConcurrent));
  rebalanceQueue();
  response.json({ maxConcurrent: value });
});

app.post("/api/settings", async (request: Request, response: Response) => {
  const value = request.body?.downloadDirectory;
  try {
    const directory = await setDownloadDirectory(typeof value === "string" && value.trim() ? value : null);
    response.json({ downloadDirectory: directory, defaultDownloadDirectory: defaultDownloadDirectory(), maxConcurrent: maxConcurrentDownloads() });
  } catch (error) {
    response.status(400).json({ error: "Carpeta no válida", message: error instanceof Error ? error.message : "No se pudo usar esa carpeta." });
  }
});

app.get("/api/shazam/history", async (_request: Request, response: Response) => {
  response.json({ entries: await listHistory() });
});

app.delete("/api/shazam/history/:id", async (request: Request, response: Response) => {
  await removeFromHistory(String(request.params.id));
  response.json({ entries: await listHistory() });
});

app.delete("/api/shazam/history", async (_request: Request, response: Response) => {
  await removeFromHistory(null);
  response.json({ entries: [] });
});

app.get("/api/downloads/:filename", (request: Request, response: Response) => {
  const rawFilename = request.params.filename;
  const filename = typeof rawFilename === "string" ? path.basename(rawFilename) : "";
  if (!filename || filename !== rawFilename || !/\.(mp3|mp4|m4a|opus|flac|zip)$/i.test(filename)) {
    response.status(400).json({ error: "Archivo inválido", message: "El archivo solicitado no es válido." });
    return;
  }

  response.download(path.join(downloadDirectory(), filename), filename, (error) => {
    if (error && !response.headersSent) response.status(404).json({ error: "Archivo no encontrado", message: "El archivo ya no está disponible." });
  });
});

if (desktopMode) {
  // La app Tauri mantiene abierta la entrada estándar; si se cierra, la app ha terminado.
  process.stdin.on("end", () => process.exit(0));
  process.stdin.on("error", () => process.exit(0));
  process.stdin.resume();
  void detectTools().then(() => autoUpdateTools());
  // Sesión de YouTube y SoundCloud abierta desde el principio: la primera canción no espera.
  warmupStreaming();
  void loadSettings().finally(() => {
    // Restos de descargas interrumpidas al cerrar la app.
    void rm(path.join(downloadDirectory(), ".antitube-temp"), { recursive: true, force: true }).catch(() => undefined);
    app.listen(port, "127.0.0.1", () => {
      console.log(`ANTITUBE_READY http://127.0.0.1:${port}`);
    });
  });
} else {
  void loadSettings().finally(() => {
    app.listen(port, () => {
      console.log(`AntiTube backend disponible en http://localhost:${port}`);
    });
  });
}
