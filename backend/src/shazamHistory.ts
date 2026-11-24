import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Historial de canciones reconocidas con SHAZAM, guardado en la carpeta de datos. */

export type ShazamEntry = {
  id: string;
  recognizedAt: number;
  title: string;
  artist: string;
  artworkUrl: string | null;
  shazamUrl: string | null;
  youtubeUrl: string | null;
  soundcloudUrl: string | null;
  spotifyUrl: string | null;
};

const maxEntries = 200;
let cache: ShazamEntry[] | null = null;

function historyPath(): string {
  const base = process.env.ANTITUBE_DATA_DIR ?? path.resolve(process.cwd(), process.env.DOWNLOAD_DIR ?? "../downloads", ".antitube");
  return path.join(path.resolve(base), "shazam-historial.json");
}

async function load(): Promise<ShazamEntry[]> {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await readFile(historyPath(), "utf8")) as unknown;
    cache = Array.isArray(parsed) ? parsed as ShazamEntry[] : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function save(entries: ShazamEntry[]): Promise<void> {
  cache = entries;
  await mkdir(path.dirname(historyPath()), { recursive: true });
  await writeFile(historyPath(), JSON.stringify(entries, null, 2));
}

export async function listHistory(): Promise<ShazamEntry[]> {
  return [...await load()];
}

export async function addToHistory(recognition: Record<string, unknown>): Promise<ShazamEntry | null> {
  const title = typeof recognition.title === "string" ? recognition.title : "";
  const artist = typeof recognition.artist === "string" ? recognition.artist : "";
  if (!title) return null;
  const text = (key: string) => (typeof recognition[key] === "string" ? recognition[key] as string : null);
  const entries = await load();
  // Si se reconoce otra vez la misma canción, se sube al principio en vez de duplicarla.
  const rest = entries.filter((entry) => !(entry.title === title && entry.artist === artist));
  const entry: ShazamEntry = { id: randomUUID(), recognizedAt: Date.now(), title, artist, artworkUrl: text("artworkUrl"), shazamUrl: text("shazamUrl"), youtubeUrl: text("youtubeUrl"), soundcloudUrl: text("soundcloudUrl"), spotifyUrl: text("spotifyUrl") };
  await save([entry, ...rest].slice(0, maxEntries));
  return entry;
}

export async function removeFromHistory(id: string | null): Promise<void> {
  const entries = await load();
  await save(id ? entries.filter((entry) => entry.id !== id) : []);
}
