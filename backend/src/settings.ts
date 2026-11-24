import { existsSync } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

/**
 * Ajustes persistentes del usuario (de momento, la carpeta de descargas).
 * Se guardan en settings.json dentro de la carpeta de datos de la app.
 */

type Settings = { downloadDirectory?: string };

const defaultDirectory = path.resolve(process.cwd(), process.env.DOWNLOAD_DIR ?? "../downloads");
let currentDirectory = defaultDirectory;

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
  try {
    const settings = JSON.parse(await readFile(settingsPath(), "utf8")) as Settings;
    if (settings.downloadDirectory && existsSync(settings.downloadDirectory)) apply(settings.downloadDirectory);
  } catch {
    // Sin ajustes guardados: se usa la carpeta por defecto.
  }
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
  await mkdir(path.dirname(settingsPath()), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify({ downloadDirectory: value ? directory : undefined } satisfies Settings, null, 2));
  return directory;
}
