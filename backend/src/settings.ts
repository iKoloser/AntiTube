import { existsSync } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

/**
 * Ajustes persistentes del usuario: carpeta de descargas y descargas simultáneas.
 * Se guardan en settings.json dentro de la carpeta de datos de la app.
 */

type Settings = { downloadDirectory?: string; maxConcurrent?: number };

const defaultDirectory = path.resolve(process.cwd(), process.env.DOWNLOAD_DIR ?? "../downloads");
let currentDirectory = defaultDirectory;
let currentMaxConcurrent = 3;

export function maxConcurrentDownloads(): number {
  return currentMaxConcurrent;
}

async function readSettings(): Promise<Settings> {
  try {
    return JSON.parse(await readFile(settingsPath(), "utf8")) as Settings;
  } catch {
    return {};
  }
}

async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const next = { ...(await readSettings()), ...patch };
  await mkdir(path.dirname(settingsPath()), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(next, null, 2));
}

/** Cuántas descargas se hacen a la vez (1-5). */
export async function setMaxConcurrentDownloads(value: number): Promise<number> {
  currentMaxConcurrent = Math.min(5, Math.max(1, Math.round(value) || 1));
  await saveSettings({ maxConcurrent: currentMaxConcurrent });
  return currentMaxConcurrent;
}

function settingsPath(): string {
  return path.join(path.resolve(process.env.ANTITUBE_DATA_DIR ?? path.join(defaultDirectory, ".antitube")), "settings.json");
}

export function downloadDirectory(): string {
  return currentDirectory;
}

export function defaultDownloadDirectory(): string {
  return defaultDirectory;
}

function apply(directory: string): void {
  currentDirectory = directory;
  // El descargador lee DOWNLOAD_DIR en cada descarga.
  process.env.DOWNLOAD_DIR = directory;
}

export async function loadSettings(): Promise<void> {
  const settings = await readSettings();
  if (settings.downloadDirectory && existsSync(settings.downloadDirectory)) apply(settings.downloadDirectory);
  if (typeof settings.maxConcurrent === "number") currentMaxConcurrent = Math.min(5, Math.max(1, Math.round(settings.maxConcurrent)));
}

/** Cambia la carpeta de descargas comprobando que existe (o se puede crear) y que se puede escribir. */
export async function setDownloadDirectory(value: string | null): Promise<string> {
  const directory = value ? path.resolve(value.trim()) : defaultDirectory;
  if (value && !path.isAbsolute(value.trim())) throw new Error("Indica una ruta completa, por ejemplo C:\\Users\\tu-usuario\\Music.");
  await mkdir(directory, { recursive: true });
  const probe = path.join(directory, `.antitube-${Date.now()}.tmp`);
  try {
    await writeFile(probe, "ok");
    await rm(probe, { force: true });
    await access(directory, constants.W_OK);
  } catch {
    throw new Error("No se puede escribir en esa carpeta. Elige otra.");
  }
  apply(directory);
  await saveSettings({ downloadDirectory: value ? directory : undefined });
  return directory;
}
