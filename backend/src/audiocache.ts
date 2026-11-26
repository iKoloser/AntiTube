/**
 * Caché de audio en memoria para escuchar en streaming.
 *
 * YouTube rechaza (403) muchas peticiones que empiezan lejos del principio del
 * archivo, que es justo lo que hace un reproductor al saltar o al pedir por
 * trozos. Lo que sí acepta es una sola descarga desde el principio. Así que
 * cada canción se baja entera de una vez a memoria (unos 4 MB, menos de un
 * segundo) y el reproductor la lee de aquí mientras llega: empieza a sonar con
 * los primeros bytes, salta sin pedir nada fuera y la siguiente canción de la
 * cola ya está entera antes de pasar a ella.
 */

import { spawn } from "node:child_process";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import type { Request, Response } from "express";

export type AudioSource = { url: string; headers: Record<string, string>; hls?: { duration: number | null } | null; label: string };

type Entry = {
  key: string;
  data: Buffer | null;
  parts: Buffer[];
  size: number;
  total: number | null;
  type: string | null;
  done: boolean;
  error: string | null;
  ready: Promise<void>;
  waiters: Set<() => void>;
  readers: number;
  used: number;
  stop: (() => void) | null;
};

const entries = new Map<string, Entry>();
const memoryLimit = 400 * 1024 * 1024;
const maxCached = 250 * 1024 * 1024;
const keepAlive = { http: new http.Agent({ keepAlive: true }), https: new https.Agent({ keepAlive: true }) };
const mp3BytesPerSecond = 40_000; // MP3 a 320 kbps constantes

function notify(entry: Entry): void {
  for (const waiter of [...entry.waiters]) waiter();
}

function append(entry: Entry, chunk: Buffer): void {
  if (entry.data && entry.total !== null) {
    const room = entry.total - entry.size;
    if (room <= 0) return;
    const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
    piece.copy(entry.data, entry.size);
    entry.size += piece.length;
  } else {
    entry.parts.push(chunk);
    entry.size += chunk.length;
  }
  notify(entry);
}

function read(entry: Entry, from: number, to: number): Buffer {
  if (entry.data) return entry.data.subarray(from, to);
  if (entry.parts.length > 1) entry.parts = [Buffer.concat(entry.parts)];
  return (entry.parts[0] ?? Buffer.alloc(0)).subarray(from, to);
}

function evict(): void {
  let used = 0;
  for (const entry of entries.values()) used += entry.total ?? entry.size;
  if (used <= memoryLimit) return;
  const idle = [...entries.values()].filter((entry) => entry.readers === 0).sort((a, b) => a.used - b.used);
  for (const entry of idle) {
    if (used <= memoryLimit) break;
    entry.stop?.();
    entries.delete(entry.key);
    used -= entry.total ?? entry.size;
  }
}

function open(url: string, headers: Record<string, string>, range: string, redirects = 0): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const secure = url.startsWith("https:");
    const request = (secure ? https : http).get(url, { headers: { ...headers, Range: range }, agent: secure ? keepAlive.https : keepAlive.http }, (upstream) => {
      const location = upstream.headers.location;
      const status = upstream.statusCode ?? 0;
      if (location && status >= 300 && status < 400 && redirects < 5) { upstream.resume(); resolve(open(new URL(location, url).toString(), headers, range, redirects + 1)); return; }
      resolve(upstream);
    });
    request.setTimeout(20_000, () => request.destroy(new Error("La plataforma tardó demasiado")));
    request.on("error", reject);
  });
}

/** Descarga directa entera. Se resuelve en cuanto la plataforma acepta la petición. */
function download(entry: Entry, source: AudioSource): Promise<void> {
  return new Promise((resolve, reject) => {
    let started = false;
    let retries = 0;
    let current: IncomingMessage | null = null;
    let stopped = false;
    entry.stop = () => { stopped = true; current?.destroy(); };
    const fail = (message: string) => {
      if (!started) { reject(new Error(message)); return; }
      entry.error = message; notify(entry);
    };
    const go = async () => {
      let upstream: IncomingMessage;
      try {
        upstream = await open(source.url, source.headers, `bytes=${entry.size}-`);
      } catch (error) {
        if (started && retries++ < 3 && !stopped) { void go(); return; }
        fail(error instanceof Error ? error.message : String(error));
        return;
      }
      current = upstream;
      const status = upstream.statusCode ?? 0;
      if (status !== 200 && status !== 206) {
        upstream.resume();
        fail(`la plataforma respondió ${status}`);
        return;
      }
      if (!started) {
        started = true;
        const fromRange = /\/(\d+)$/.exec(String(upstream.headers["content-range"] ?? ""))?.[1];
        const total = Number(fromRange ?? upstream.headers["content-length"]) || null;
        entry.total = total;
        entry.type = upstream.headers["content-type"] ?? null;
        if (total !== null && total <= maxCached) entry.data = Buffer.allocUnsafe(total);
        else entry.total = null;
        evict();
        resolve();
      } else if (status === 200 && entry.size > 0) {
        // Al reanudar, la plataforma ignoró el rango: se descarta lo repetido.
        let skip = entry.size;
        upstream.on("data", (chunk: Buffer) => {
          if (skip >= chunk.length) { skip -= chunk.length; return; }
          append(entry, chunk.subarray(skip)); skip = 0;
        });
      }
      if (!(status === 200 && entry.size > 0)) upstream.on("data", (chunk: Buffer) => append(entry, chunk));
      upstream.on("error", () => undefined);
      upstream.on("close", () => {
        if (stopped) return;
        if (entry.total === null || entry.size >= entry.total) { entry.done = true; notify(entry); return; }
        // Corte a mitad: se reanuda desde donde se quedó.
        if (retries++ < 3) { void go(); return; }
        fail("la descarga se cortó");
      });
    };
    void go();
  });
}

/** Audio troceado (HLS de SoundCloud): FFmpeg lo junta y lo convierte en MP3 320k de una vez. */
function transcode(entry: Entry, source: AudioSource): Promise<void> {
  return new Promise((resolve, reject) => {
    const duration = source.hls?.duration ?? null;
    const headers = Object.entries(source.headers).map(([name, value]) => `${name}: ${value}\r\n`).join("");
    const ffmpeg = spawn(process.env.FFMPEG_BIN ?? "ffmpeg", [
      "-nostdin", "-hide_banner", "-loglevel", "error",
      ...(headers ? ["-headers", headers] : []),
      "-i", source.url, "-vn", "-c:a", "libmp3lame", "-b:a", "320k", "-write_xing", "0", "-f", "mp3", "pipe:1"
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let started = false;
    let errors = "";
    entry.stop = () => ffmpeg.kill();
    entry.type = "audio/mpeg";
    entry.total = duration ? Math.ceil(duration * mp3BytesPerSecond) : null;
    if (entry.total !== null && entry.total <= maxCached) entry.data = Buffer.alloc(entry.total);
    else entry.total = null;
    ffmpeg.stderr.on("data", (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-600); });
    ffmpeg.on("error", (error) => { if (!started) reject(error); });
    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      if (!started) { started = true; evict(); resolve(); }
      append(entry, chunk);
    });
    ffmpeg.on("close", (code) => {
      if (!started) { reject(new Error(errors.trim().split("\n").at(-1) || `FFmpeg terminó con ${code}`)); return; }
      // Si sale algo más corto de lo calculado, el resto ya es silencio (ceros).
      if (entry.total !== null) entry.size = entry.total;
      entry.done = true;
      notify(entry);
    });
  });
}

/**
 * Deja una canción descargándose (o la devuelve si ya está). `sources` da, por
 * orden, cada forma de conseguirla; si una no arranca, se prueba la siguiente.
 */
export function ensureAudio(key: string, sources: () => AsyncGenerator<AudioSource>): Entry {
  const existing = entries.get(key);
  if (existing && !existing.error) { existing.used = Date.now(); return existing; }
  const entry: Entry = { key, data: null, parts: [], size: 0, total: null, type: null, done: false, error: null, ready: Promise.resolve(), waiters: new Set(), readers: 0, used: Date.now(), stop: null };
  entry.ready = (async () => {
    const problems: string[] = [];
    for await (const source of sources()) {
      const started = Date.now();
      try {
        await (source.hls ? transcode(entry, source) : download(entry, source));
        console.log(`[audio] ${source.label}: primeros bytes en ${Date.now() - started} ms`);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[audio] ${source.label} no arrancó: ${message}`);
        problems.push(`${source.label}: ${message}`);
        Object.assign(entry, { data: null, parts: [], size: 0, total: null, type: null });
      }
    }
    throw new Error(problems.join(" | ") || "Sin fuentes de audio");
  })();
  entry.ready.catch((error: unknown) => {
    entry.error = error instanceof Error ? error.message : String(error);
    entries.delete(key);
    notify(entry);
  });
  entries.set(key, entry);
  return entry;
}

export function forgetAudio(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  if (entry.readers === 0) entry.stop?.();
  entries.delete(key);
}

/** Envía la canción al reproductor desde memoria, con saltos, según va llegando. */
export async function serveAudio(entry: Entry, request: Request, response: Response): Promise<void> {
  await entry.ready;
  entry.readers += 1;
  entry.used = Date.now();
  let closed = false;
  let wake: (() => void) | null = null;
  const waiter = () => wake?.();
  entry.waiters.add(waiter);
  request.on("close", () => { closed = true; wake?.(); });
  try {
    const asked = /^bytes=(\d+)-(\d*)$/.exec(String(request.headers.range ?? ""));
    const total = entry.total;
    response.setHeader("Content-Type", entry.type ?? "audio/mpeg");
    response.setHeader("Cache-Control", "no-store");
    let position = 0;
    let end = Number.MAX_SAFE_INTEGER;
    if (total !== null) {
      position = asked ? Number(asked[1]) : 0;
      if (position >= total) {
        response.status(416).setHeader("Content-Range", `bytes */${total}`);
        response.end();
        return;
      }
      end = Math.min(asked?.[2] ? Number(asked[2]) : total - 1, total - 1);
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader("Content-Length", String(end - position + 1));
      if (asked) {
        response.status(206);
        response.setHeader("Content-Range", `bytes ${position}-${end}/${total}`);
      }
    }
    while (!closed && position <= end) {
      const available = Math.min(entry.size, end + 1);
      if (available > position) {
        const piece = read(entry, position, Math.min(available, position + 1024 * 1024));
        position += piece.length;
        if (!response.write(piece)) await new Promise<void>((resolve) => { wake = resolve; response.once("drain", resolve); });
        wake = null;
        continue;
      }
      if (entry.done) break;
      if (entry.error) { response.destroy(); return; }
      await new Promise<void>((resolve) => { wake = resolve; });
      wake = null;
    }
    response.end();
  } finally {
    entry.waiters.delete(waiter);
    entry.readers -= 1;
  }
}
