import { execFile, spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

/**
 * Gestión de herramientas externas para la versión de escritorio.
 *
 * En el primer arranque la app comprueba si yt-dlp, FFmpeg y (opcionalmente)
 * Python con ShazamIO están disponibles. Si faltan, los descarga en la carpeta
 * de datos de la aplicación y expone el progreso paso a paso a la interfaz.
 */

const execFileAsync = promisify(execFile);

export type SetupStepId = "engine" | "ytdlp" | "ffmpeg" | "shazam";
export type SetupStepStatus = "pending" | "checking" | "running" | "done" | "error" | "skipped";

export type SetupStep = {
  id: SetupStepId;
  title: string;
  description: string;
  optional: boolean;
  status: SetupStepStatus;
  detail: string;
  version: string | null;
  source: "bundled" | "managed" | "system" | null;
  percent: number | null;
};

const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const exe = (name: string) => (isWindows ? `${name}.exe` : name);

function dataDirectory(): string {
  return path.resolve(process.env.ANTITUBE_DATA_DIR ?? path.join(process.cwd(), "..", ".antitube"));
}

export function toolsDirectory(): string {
  return path.join(dataDirectory(), "tools");
}

const steps: Record<SetupStepId, SetupStep> = {
  engine: {
    id: "engine",
    title: "Motor de AntiTube",
    description: "Servidor local que coordina análisis, descargas y conversiones.",
    optional: false,
    status: "done",
    detail: "En marcha",
    version: process.versions.node ? `Node ${process.versions.node}` : null,
    source: "bundled",
    percent: null
  },
  ytdlp: {
    id: "ytdlp",
    title: "yt-dlp",
    description: "Extrae metadatos y descarga el contenido de cada plataforma.",
    optional: false,
    status: "pending",
    detail: "Sin comprobar",
    version: null,
    source: null,
    percent: null
  },
  ffmpeg: {
    id: "ffmpeg",
    title: "FFmpeg",
    description: "Une vídeo y audio y convierte a MP3 con la calidad elegida.",
    optional: false,
    status: "pending",
    detail: "Sin comprobar",
    version: null,
    source: null,
    percent: null
  },
  shazam: {
    id: "shazam",
    title: "Reconocimiento SHAZAM",
    description: "Opcional. Necesita Python 3.10 o posterior instalado en el equipo.",
    optional: true,
    status: "pending",
    detail: "Sin comprobar",
    version: null,
    source: null,
    percent: null
  }
};

let running = false;
let lastError: string | null = null;

function update(id: SetupStepId, patch: Partial<SetupStep>): void {
  Object.assign(steps[id], patch);
}

async function versionOf(binary: string, args: string[], pattern?: RegExp): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(binary, args, { timeout: 20_000, windowsHide: true });
    const text = `${stdout}\n${stderr}`.trim();
    const firstLine = text.split(/\r?\n/)[0]?.trim() ?? "";
    if (!pattern) return firstLine || "instalado";
    return pattern.exec(text)?.[1] ?? (firstLine || "instalado");
  } catch {
    return null;
  }
}

// ---------- yt-dlp ----------

function managedYtDlp(): string {
  return path.join(toolsDirectory(), exe("yt-dlp"));
}

function ytDlpDownloadUrl(): string | null {
  const base = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
  if (isWindows) return `${base}yt-dlp.exe`;
  if (isMac) return `${base}yt-dlp_macos`;
  if (process.platform === "linux" && process.arch === "x64") return `${base}yt-dlp_linux`;
  if (process.platform === "linux" && process.arch === "arm64") return `${base}yt-dlp_linux_aarch64`;
  return null;
}

async function detectYtDlp(): Promise<boolean> {
  update("ytdlp", { status: "checking", detail: "Buscando yt-dlp…", percent: null });
  const candidates: Array<{ binary: string; source: SetupStep["source"] }> = [];
  if (existsSync(managedYtDlp())) candidates.push({ binary: managedYtDlp(), source: "managed" });
  candidates.push({ binary: exe("yt-dlp"), source: "system" });
  for (const candidate of candidates) {
    const version = await versionOf(candidate.binary, ["--version"]);
    if (version) {
      process.env.YTDLP_BIN = candidate.binary;
      update("ytdlp", { status: "done", version, source: candidate.source, detail: candidate.source === "managed" ? "Instalado por AntiTube" : "Encontrado en el sistema" });
      return true;
    }
  }
  update("ytdlp", { status: "pending", version: null, source: null, detail: "No instalado. Se descargará (unos 18 MB)." });
  return false;
}

async function installYtDlp(): Promise<void> {
  const url = ytDlpDownloadUrl();
  if (!url) throw new Error("No hay una versión de yt-dlp para este sistema. Instálalo manualmente.");
  update("ytdlp", { status: "running", detail: "Descargando yt-dlp…", percent: 0 });
  await downloadFile(url, managedYtDlp(), (percent, label) => update("ytdlp", { percent, detail: `Descargando yt-dlp… ${label}` }));
  if (!isWindows) await chmod(managedYtDlp(), 0o755);
  update("ytdlp", { detail: "Verificando…", percent: 100 });
  if (!(await detectYtDlp())) throw new Error("yt-dlp se descargó pero no se pudo ejecutar.");
}

export async function updateYtDlp(): Promise<string> {
  const binary = process.env.YTDLP_BIN ?? exe("yt-dlp");
  if (steps.ytdlp.source !== "managed") return "yt-dlp lo gestiona el sistema; actualízalo con tu gestor de paquetes.";
  const { stdout } = await execFileAsync(binary, ["-U"], { timeout: 120_000, windowsHide: true });
  await detectYtDlp();
  return stdout.trim().split(/\r?\n/).at(-1) ?? "yt-dlp actualizado.";
}

// ---------- FFmpeg ----------

function managedFfmpeg(): string {
  return path.join(toolsDirectory(), "ffmpeg", exe("ffmpeg"));
}

function ffmpegDownload(): { url: string; archive: "zip" | "tar.xz" } | null {
  const base = "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/";
  if (isWindows && process.arch === "arm64") return { url: `${base}ffmpeg-master-latest-winarm64-gpl.zip`, archive: "zip" };
  if (isWindows) return { url: `${base}ffmpeg-master-latest-win64-gpl.zip`, archive: "zip" };
  if (process.platform === "linux" && process.arch === "x64") return { url: `${base}ffmpeg-master-latest-linux64-gpl.tar.xz`, archive: "tar.xz" };
  if (process.platform === "linux" && process.arch === "arm64") return { url: `${base}ffmpeg-master-latest-linuxarm64-gpl.tar.xz`, archive: "tar.xz" };
  return null;
}

async function detectFfmpeg(): Promise<boolean> {
  update("ffmpeg", { status: "checking", detail: "Buscando FFmpeg…", percent: null });
  const candidates: Array<{ binary: string; source: SetupStep["source"] }> = [];
  if (existsSync(managedFfmpeg())) candidates.push({ binary: managedFfmpeg(), source: "managed" });
  candidates.push({ binary: exe("ffmpeg"), source: "system" });
  for (const candidate of candidates) {
    const version = await versionOf(candidate.binary, ["-version"], /ffmpeg version (\S+)/);
    if (version) {
      // yt-dlp acepta la ruta del ejecutable en --ffmpeg-location y encuentra ffprobe al lado.
      if (candidate.source === "managed") process.env.FFMPEG_BIN = candidate.binary;
      else delete process.env.FFMPEG_BIN;
      update("ffmpeg", { status: "done", version: version.length > 24 ? `${version.slice(0, 24)}…` : version, source: candidate.source, detail: candidate.source === "managed" ? "Instalado por AntiTube" : "Encontrado en el sistema" });
      return true;
    }
  }
  update("ffmpeg", { status: "pending", version: null, source: null, detail: isMac ? "No instalado. Instálalo con: brew install ffmpeg" : "No instalado. Se descargará (unos 140 MB)." });
  return false;
}

async function findFile(directory: string, filename: string): Promise<string | null> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return fullPath;
    if (entry.isDirectory()) {
      const nested = await findFile(fullPath, filename);
      if (nested) return nested;
    }
  }
  return null;
}

async function installFfmpeg(): Promise<void> {
  const download = ffmpegDownload();
  if (!download) throw new Error(isMac ? "En macOS instala FFmpeg con Homebrew: brew install ffmpeg" : "No hay una versión de FFmpeg para este sistema.");
  const workDirectory = path.join(toolsDirectory(), ".ffmpeg-download");
  const archivePath = path.join(workDirectory, `ffmpeg.${download.archive}`);
  const extractDirectory = path.join(workDirectory, "extract");
  const targetDirectory = path.dirname(managedFfmpeg());
  await rm(workDirectory, { recursive: true, force: true });
  await mkdir(extractDirectory, { recursive: true });
  try {
    update("ffmpeg", { status: "running", detail: "Descargando FFmpeg…", percent: 0 });
    await downloadFile(download.url, archivePath, (percent, label) => update("ffmpeg", { percent, detail: `Descargando FFmpeg… ${label}` }));
    update("ffmpeg", { detail: "Descomprimiendo…", percent: null });
    // Windows 10+ incluye tar (bsdtar), que también abre archivos .zip.
    await execFileAsync("tar", ["-xf", archivePath, "-C", extractDirectory], { timeout: 300_000, windowsHide: true });
    await rm(targetDirectory, { recursive: true, force: true });
    await mkdir(targetDirectory, { recursive: true });
    for (const name of [exe("ffmpeg"), exe("ffprobe")]) {
      const found = await findFile(extractDirectory, name);
      if (!found) throw new Error(`El archivo descargado no contiene ${name}.`);
      await rename(found, path.join(targetDirectory, name));
      if (!isWindows) await chmod(path.join(targetDirectory, name), 0o755);
    }
  } finally {
    await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
  update("ffmpeg", { detail: "Verificando…", percent: 100 });
  if (!(await detectFfmpeg())) throw new Error("FFmpeg se descargó pero no se pudo ejecutar.");
}

// ---------- Python + ShazamIO ----------

async function pythonCandidates(): Promise<string[]> {
  const configured = process.env.PYTHON_BIN?.trim();
  const list = configured ? [configured] : [];
  list.push(...(isWindows ? ["python", "py"] : ["python3", "python"]));
  return [...new Set(list)];
}

async function detectShazam(): Promise<boolean> {
  update("shazam", { status: "checking", detail: "Buscando Python…", percent: null });
  for (const python of await pythonCandidates()) {
    const version = await versionOf(python, ["--version"], /Python (\S+)/);
    if (!version) continue;
    process.env.PYTHON_BIN = python;
    const hasShazam = await versionOf(python, ["-c", "import shazamio; print('ok')"]);
    if (hasShazam === "ok") {
      update("shazam", { status: "done", version: `Python ${version}`, source: "system", detail: "Listo para reconocer canciones" });
      return true;
    }
    update("shazam", { status: "pending", version: `Python ${version}`, source: "system", detail: "Python encontrado. Falta instalar ShazamIO." });
    return false;
  }
  update("shazam", { status: "skipped", version: null, source: null, detail: "Python no está instalado. SHAZAM quedará desactivado; el resto funciona igual." });
  return false;
}

async function installShazam(): Promise<void> {
  const python = process.env.PYTHON_BIN;
  if (!python || steps.shazam.status === "skipped") throw new Error("Instala Python 3.10 o posterior desde python.org y vuelve a comprobar.");
  update("shazam", { status: "running", detail: "Instalando ShazamIO con pip…", percent: null });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(python, ["-m", "pip", "install", "--user", "--disable-pip-version-check", "shazamio==0.9.0"], { windowsHide: true });
    let tail = "";
    const consume = (chunk: Buffer) => {
      const lines = chunk.toString().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length > 0) {
        tail = lines.at(-1) ?? tail;
        update("shazam", { detail: tail.length > 90 ? `${tail.slice(0, 90)}…` : tail });
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`pip terminó con error: ${tail}`))));
  });
  if (!(await detectShazam())) throw new Error("ShazamIO se instaló pero Python no lo encuentra.");
}

// ---------- descarga con progreso ----------

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function downloadFile(url: string, destination: string, onProgress: (percent: number | null, label: string) => void): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`No se pudo descargar ${url} (HTTP ${response.status}).`);
  const total = Number(response.headers.get("content-length") ?? 0);
  let received = 0;
  let lastReport = 0;
  const source = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
  source.on("data", (chunk: Buffer) => {
    received += chunk.length;
    const now = Date.now();
    if (now - lastReport < 250) return;
    lastReport = now;
    onProgress(total > 0 ? Math.min(99, (received / total) * 100) : null, total > 0 ? `${formatBytes(received)} de ${formatBytes(total)}` : formatBytes(received));
  });
  const temporary = `${destination}.part`;
  await pipeline(source, createWriteStream(temporary));
  await rm(destination, { force: true });
  await rename(temporary, destination);
  onProgress(100, formatBytes(received));
}

// ---------- API pública ----------

export function setupStatus() {
  const list = [steps.engine, steps.ytdlp, steps.ffmpeg, steps.shazam];
  const ready = steps.ytdlp.status === "done" && steps.ffmpeg.status === "done";
  return { ready, running, error: lastError, platform: process.platform, toolsDirectory: toolsDirectory(), steps: list };
}

export async function detectTools(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await detectYtDlp();
    await detectFfmpeg();
    await detectShazam();
  } finally {
    running = false;
  }
}

/** Instala lo que falte. Devuelve inmediatamente; el progreso se consulta con setupStatus(). */
export function runSetup(options: { includeShazam: boolean }): boolean {
  if (running) return false;
  running = true;
  lastError = null;
  void (async () => {
    const tasks: Array<[SetupStepId, () => Promise<void>]> = [];
    if (steps.ytdlp.status !== "done") tasks.push(["ytdlp", installYtDlp]);
    if (steps.ffmpeg.status !== "done") tasks.push(["ffmpeg", installFfmpeg]);
    if (options.includeShazam && steps.shazam.status === "pending") tasks.push(["shazam", installShazam]);
    for (const [id, task] of tasks) {
      try {
        await task();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Error inesperado.";
        update(id, { status: "error", detail: message, percent: null });
        if (!steps[id].optional) {
          lastError = message;
          break;
        }
      }
    }
    running = false;
  })();
  return true;
}
