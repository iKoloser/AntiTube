import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import { parseFile } from "music-metadata";
import { downloadDirectory } from "./settings.js";

/**
 * Biblioteca del reproductor: lee la carpeta de descargas y las carpetas o
 * archivos que el usuario añade (por ejemplo, arrastrándolos a la ventana),
 * extrae las etiquetas y portadas, guarda las listas de reproducción y sirve
 * el audio con soporte de rangos. Los formatos que el motor del navegador no
 * sabe reproducir (ALAC, AIFF, WMA, APE, WavPack, AC3…) se descodifican una vez
 * con FFmpeg a FLAC, que es sin pérdida, y se guardan en una caché.
 */

const audioExtensions = ["mp3", "m4a", "m4b", "aac", "opus", "ogg", "oga", "flac", "wav", "weba", "aiff", "aif", "aifc", "wma", "ape", "wv", "mka", "ac3", "eac3", "dts", "amr", "mp2", "mpc", "tta", "caf", "dsf", "dff", "spx", "au", "mid", "midi"];
const videoExtensions = ["mp4", "m4v", "mkv", "webm", "mov", "avi", "wmv", "flv", "ts"];
const browserExtensions = new Set(["mp3", "m4a", "m4b", "aac", "opus", "ogg", "oga", "flac", "wav", "weba", "webm", "mp4", "m4v"]);
const browserCodecs = /^(mpeg|mp3|mp2|aac|mpeg-4 aac|opus|vorbis|flac|pcm|lpcm|alaw|ulaw)/i;
const maxFiles = 20_000;
const maxDepth = 6;

export type Track = {
  id: string;
  path: string;
  filename: string;
  folder: string;
  extension: string;
  kind: "audio" | "video";
  size: number;
  modified: number;
  title: string;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  year: number | null;
  genre: string | null;
  trackNumber: number | null;
  durationSeconds: number | null;
  codec: string | null;
  bitrateKbps: number | null;
  sampleRate: number | null;
  bitsPerSample: number | null;
  lossless: boolean;
  hasCover: boolean;
  /** El WebView no lo reproduce tal cual: se descodifica a FLAC la primera vez. */
  needsTranscode: boolean;
  source: "downloads" | "folder" | "file";
};

type CachedTrack = Omit<Track, "id" | "source">;
type LibraryState = { folders: string[]; files: string[]; tracks: Record<string, CachedTrack> };
type Playlist = { id: string; name: string; tracks: string[]; createdAt: number; updatedAt: number };

function dataDirectory(): string {
  return path.resolve(process.env.ANTITUBE_DATA_DIR ?? path.join(downloadDirectory(), ".antitube"));
}

const libraryFile = () => path.join(dataDirectory(), "library.json");
const playlistsFile = () => path.join(dataDirectory(), "playlists.json");
const cacheDirectory = () => path.join(dataDirectory(), "player-cache");

let state: LibraryState | null = null;
let scan: { running: boolean; done: number; total: number; startedAt: number } = { running: false, done: 0, total: 0, startedAt: 0 };
let lastScanAt = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function loadState(): Promise<LibraryState> {
  if (state) return state;
  try {
    const saved = JSON.parse(await readFile(libraryFile(), "utf8")) as Partial<LibraryState>;
    state = { folders: saved.folders ?? [], files: saved.files ?? [], tracks: saved.tracks ?? {} };
  } catch {
    state = { folders: [], files: [], tracks: {} };
  }
  return state;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID().slice(0, 6)}.tmp`;
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, file);
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (state) void writeJson(libraryFile(), state).catch(() => undefined);
  }, 1500);
}

export function trackId(filePath: string): string {
  return Buffer.from(filePath, "utf8").toString("base64url");
}

function pathFromId(id: string): string {
  return Buffer.from(id, "base64url").toString("utf8");
}

function extensionOf(filePath: string): string {
  return path.extname(filePath).slice(1).toLowerCase();
}

function isMedia(filePath: string): boolean {
  const extension = extensionOf(filePath);
  return audioExtensions.includes(extension) || videoExtensions.includes(extension);
}

function roots(current: LibraryState): string[] {
  return [downloadDirectory(), ...current.folders.filter((folder) => path.resolve(folder) !== path.resolve(downloadDirectory()))];
}

async function walk(directory: string, depth: number, found: string[]): Promise<void> {
  if (found.length >= maxFiles || depth > maxDepth) return;
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (found.length >= maxFiles) return;
    if (entry.name.startsWith(".") || entry.name === "$RECYCLE.BIN" || entry.name === "System Volume Information") continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, depth + 1, found);
    else if (entry.isFile() && isMedia(full)) found.push(full);
  }
}

function text(value: unknown): string | null {
  if (Array.isArray(value)) return text(value[0]);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function readTrack(filePath: string, size: number, modified: number): Promise<CachedTrack> {
  const extension = extensionOf(filePath);
  const kind = videoExtensions.includes(extension) ? "video" : "audio";
  const base: CachedTrack = {
    path: filePath,
    filename: path.basename(filePath),
    folder: path.dirname(filePath),
    extension,
    kind,
    size,
    modified,
    title: path.basename(filePath, path.extname(filePath)),
    artist: null,
    album: null,
    albumArtist: null,
    year: null,
    genre: null,
    trackNumber: null,
    durationSeconds: null,
    codec: null,
    bitrateKbps: null,
    sampleRate: null,
    bitsPerSample: null,
    lossless: ["flac", "wav", "aiff", "aif", "ape", "wv", "tta"].includes(extension),
    hasCover: false,
    needsTranscode: !browserExtensions.has(extension)
  };
  try {
    const metadata = await parseFile(filePath, { duration: false, skipCovers: false, skipPostHeaders: true });
    const { common, format } = metadata;
    const codec = text(format.codec);
    return {
      ...base,
      title: text(common.title) ?? base.title,
      artist: text(common.artist) ?? text(common.artists),
      album: text(common.album),
      albumArtist: text(common.albumartist),
      year: typeof common.year === "number" ? common.year : null,
      genre: text(common.genre),
      trackNumber: typeof common.track?.no === "number" ? common.track.no : null,
      durationSeconds: typeof format.duration === "number" && Number.isFinite(format.duration) ? Math.round(format.duration * 10) / 10 : null,
      codec,
      bitrateKbps: typeof format.bitrate === "number" ? Math.round(format.bitrate / 1000) : null,
      sampleRate: typeof format.sampleRate === "number" ? format.sampleRate : null,
      bitsPerSample: typeof format.bitsPerSample === "number" ? format.bitsPerSample : null,
      lossless: format.lossless === true || base.lossless,
      hasCover: Boolean(common.picture?.length),
      // Un .m4a puede llevar ALAC: el WebView no lo reproduce aunque la extensión sí sea compatible.
      needsTranscode: base.needsTranscode || (kind === "audio" && codec !== null && !browserCodecs.test(codec))
    };
  } catch {
    return base;
  }
}

/** Revisa las carpetas y lee solo los archivos nuevos o modificados. */
async function rescan(): Promise<void> {
  if (scan.running) return;
  const current = await loadState();
  scan = { running: true, done: 0, total: 0, startedAt: Date.now() };
  try {
    const found: string[] = [];
    for (const root of roots(current)) await walk(root, 0, found);
    for (const file of current.files) if (existsSync(file) && !found.includes(file)) found.push(file);
    scan.total = found.length;
    const seen = new Set<string>();
    for (const filePath of found) {
      seen.add(filePath);
      try {
        const info = await stat(filePath);
        const cached = current.tracks[filePath];
        if (!cached || cached.modified !== info.mtimeMs || cached.size !== info.size) {
          current.tracks[filePath] = await readTrack(filePath, info.size, info.mtimeMs);
          scheduleSave();
        }
      } catch {
        // El archivo ha desaparecido mientras se leía.
      }
      scan.done += 1;
    }
    for (const filePath of Object.keys(current.tracks)) {
      if (!seen.has(filePath)) {
        delete current.tracks[filePath];
        scheduleSave();
      }
    }
  } finally {
    scan.running = false;
    lastScanAt = Date.now();
  }
}

function sourceOf(current: LibraryState, filePath: string): Track["source"] {
  const inside = (root: string) => filePath.startsWith(`${path.resolve(root)}${path.sep}`);
  if (inside(downloadDirectory())) return "downloads";
  if (current.folders.some(inside)) return "folder";
  return "file";
}

/** Solo se sirven archivos que forman parte de la biblioteca. */
async function allowedTrack(id: string): Promise<CachedTrack | null> {
  const current = await loadState();
  const filePath = pathFromId(id);
  const track = current.tracks[filePath];
  if (!track || !existsSync(filePath)) return null;
  return track;
}

const transcoding = new Map<string, Promise<string>>();

/** Descodifica a FLAC (sin pérdida) los formatos que el WebView no reproduce. */
async function playableCopy(track: CachedTrack): Promise<string> {
  const key = createHash("sha1").update(`${track.path}|${track.modified}|${track.size}`).digest("hex");
  const target = path.join(cacheDirectory(), `${key}.flac`);
  if (existsSync(target)) return target;
  const pending = transcoding.get(key);
  if (pending) return pending;
  const job = (async () => {
    await mkdir(cacheDirectory(), { recursive: true });
    const temporary = `${target}.part.flac`;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.env.FFMPEG_BIN ?? "ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", track.path, "-map", "0:a:0", "-vn", "-c:a", "flac", temporary], { windowsHide: true });
      let errorOutput = "";
      child.stderr.on("data", (chunk: Buffer) => { errorOutput += chunk.toString(); });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(errorOutput.trim() || "FFmpeg no pudo preparar el archivo."))));
    });
    await rename(temporary, target);
    return target;
  })().finally(() => transcoding.delete(key));
  transcoding.set(key, job);
  return job;
}

async function loadPlaylists(): Promise<Playlist[]> {
  try {
    return JSON.parse(await readFile(playlistsFile(), "utf8")) as Playlist[];
  } catch {
    return [];
  }
}

function cleanTracks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => (item.includes(path.sep) || item.includes("/") ? item : pathFromId(item))).slice(0, 10_000);
}

function publicPlaylist(playlist: Playlist) {
  return { ...playlist, trackIds: playlist.tracks.map(trackId) };
}

export function createLibraryRouter(deps: { reveal: (filePath: string) => void }): Router {
  const router = Router();

  router.get("/api/library", async (request: Request, response: Response) => {
    const current = await loadState();
    // Se vuelve a revisar como mucho cada 20 s (o al pedirlo).
    if (request.query.refresh === "1" || Date.now() - lastScanAt > 20_000) void rescan();
    const tracks = Object.values(current.tracks)
      .filter((track) => existsSync(track.path))
      .map((track) => ({ ...track, id: trackId(track.path), source: sourceOf(current, track.path) }));
    response.json({ tracks, folders: roots(current), extraFolders: current.folders, scan });
  });

  router.post("/api/library/import", async (request: Request, response: Response) => {
    const current = await loadState();
    const paths = Array.isArray(request.body?.paths) ? request.body.paths.filter((item: unknown): item is string => typeof item === "string") : [];
    const added: string[] = [];
    for (const raw of paths.slice(0, 500)) {
      const target = path.resolve(raw);
      try {
        const info = await stat(target);
        if (info.isDirectory()) {
          if (!current.folders.includes(target)) current.folders.push(target);
          added.push(target);
        } else if (info.isFile() && isMedia(target)) {
          if (!current.files.includes(target)) current.files.push(target);
          current.tracks[target] = await readTrack(target, info.size, info.mtimeMs);
          added.push(target);
        }
      } catch {
        // Ruta que ya no existe.
      }
    }
    await writeJson(libraryFile(), current);
    void rescan();
    response.json({ added, ids: added.map(trackId) });
  });

  router.delete("/api/library/folders", async (request: Request, response: Response) => {
    const current = await loadState();
    const folder = typeof request.body?.folder === "string" ? path.resolve(request.body.folder) : "";
    current.folders = current.folders.filter((item) => path.resolve(item) !== folder);
    for (const filePath of Object.keys(current.tracks)) if (filePath.startsWith(`${folder}${path.sep}`)) delete current.tracks[filePath];
    await writeJson(libraryFile(), current);
    void rescan();
    response.json({ extraFolders: current.folders });
  });

  // Quita de la biblioteca archivos sueltos añadidos a mano (no borra nada del disco).
  router.post("/api/library/forget", async (request: Request, response: Response) => {
    const current = await loadState();
    const targets = cleanTracks(request.body?.ids);
    current.files = current.files.filter((file) => !targets.includes(file));
    for (const target of targets) if (sourceOf(current, target) === "file") delete current.tracks[target];
    await writeJson(libraryFile(), current);
    response.json({ removed: targets.length });
  });

  router.post("/api/library/reveal", async (request: Request, response: Response) => {
    const track = await allowedTrack(String(request.body?.id ?? ""));
    if (!track) {
      response.status(404).json({ error: "No encontrado", message: "El archivo ya no está en la biblioteca." });
      return;
    }
    deps.reveal(track.path);
    response.json({ opened: track.path });
  });

  router.get("/api/library/stream/:id", async (request: Request, response: Response) => {
    const track = await allowedTrack(String(request.params.id));
    if (!track) {
      response.status(404).json({ error: "No encontrado", message: "El archivo ya no está en la biblioteca." });
      return;
    }
    try {
      const file = track.needsTranscode ? await playableCopy(track) : track.path;
      response.sendFile(file, { headers: { "Cache-Control": "no-store" }, dotfiles: "allow" });
    } catch (error) {
      response.status(422).json({ error: "No se puede reproducir", message: error instanceof Error ? error.message : "Formato no compatible." });
    }
  });

  router.get("/api/library/cover/:id", async (request: Request, response: Response) => {
    const track = await allowedTrack(String(request.params.id));
    if (!track?.hasCover) {
      response.status(404).end();
      return;
    }
    try {
      const metadata = await parseFile(track.path, { duration: false, skipPostHeaders: true });
      const picture = metadata.common.picture?.find((item) => /front|cover/i.test(item.type ?? "")) ?? metadata.common.picture?.[0];
      if (!picture) {
        response.status(404).end();
        return;
      }
      response.setHeader("Content-Type", picture.format.includes("/") ? picture.format : `image/${picture.format}`);
      response.setHeader("Cache-Control", "max-age=86400");
      response.end(Buffer.from(picture.data));
    } catch {
      response.status(404).end();
    }
  });

  router.get("/api/playlists", async (_request: Request, response: Response) => {
    response.json({ playlists: (await loadPlaylists()).map(publicPlaylist) });
  });

  router.post("/api/playlists", async (request: Request, response: Response) => {
    const name = typeof request.body?.name === "string" && request.body.name.trim() ? request.body.name.trim().slice(0, 80) : "Nueva lista";
    const playlists = await loadPlaylists();
    const playlist: Playlist = { id: randomUUID(), name, tracks: cleanTracks(request.body?.tracks), createdAt: Date.now(), updatedAt: Date.now() };
    playlists.push(playlist);
    await writeJson(playlistsFile(), playlists);
    response.status(201).json({ playlist: publicPlaylist(playlist), playlists: playlists.map(publicPlaylist) });
  });

  router.put("/api/playlists/:id", async (request: Request, response: Response) => {
    const playlists = await loadPlaylists();
    const playlist = playlists.find((item) => item.id === request.params.id);
    if (!playlist) {
      response.status(404).json({ error: "Lista no encontrada", message: "La lista ya no existe." });
      return;
    }
    if (typeof request.body?.name === "string" && request.body.name.trim()) playlist.name = request.body.name.trim().slice(0, 80);
    if (Array.isArray(request.body?.tracks)) playlist.tracks = cleanTracks(request.body.tracks);
    // Añadir canciones en una posición (arrastrar y soltar).
    if (Array.isArray(request.body?.add)) {
      const additions = cleanTracks(request.body.add);
      const position = Number.isInteger(request.body?.position) ? Math.max(0, Math.min(playlist.tracks.length, request.body.position)) : playlist.tracks.length;
      playlist.tracks.splice(position, 0, ...additions);
    }
    playlist.updatedAt = Date.now();
    await writeJson(playlistsFile(), playlists);
    response.json({ playlist: publicPlaylist(playlist), playlists: playlists.map(publicPlaylist) });
  });

  router.delete("/api/playlists/:id", async (request: Request, response: Response) => {
    const playlists = (await loadPlaylists()).filter((item) => item.id !== request.params.id);
    await writeJson(playlistsFile(), playlists);
    response.json({ playlists: playlists.map(publicPlaylist) });
  });

  return router;
}

export async function clearPlayerCache(): Promise<void> {
  await rm(cacheDirectory(), { recursive: true, force: true });
}

