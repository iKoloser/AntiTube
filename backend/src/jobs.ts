import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { createPlaylistArchive } from "./archive.js";
import {
  buildOutputTemplate,
  DownloadAbortedError,
  DownloadLimitError,
  DownloadToolUnavailableError,
  downloadMedia,
  TemplateError,
  type AudioQuality,
  type DownloadFormat,
  type DownloadItemProgress,
  type DownloadProgress,
  type Id3Overrides,
  type VideoQuality
} from "./downloader.js";
import { downloadDirectory } from "./settings.js";

/**
 * Cola de descargas: se procesan de una en una (la detección de archivos
 * generados se basa en los cambios de la carpeta), se pueden encolar sin
 * límite y cada una se puede pausar, reanudar o cancelar.
 */

export type Analysis = { url: string; domain: string; platform: string; videoOnly: boolean };

type JobStatus = "queued" | "downloading" | "paused" | "completed" | "failed" | "cancelled";

type JobOptions = {
  url: string;
  format: DownloadFormat;
  quality: VideoQuality | AudioQuality;
  playlist: boolean;
  playlistTotal: number | null;
  playlistTitle: string | null;
  playlistItems: number[] | null;
  filenameTemplate: string | null;
  skipDuplicates: boolean;
  id3: Id3Overrides | null;
};

type DownloadJob = {
  id: string;
  title: string;
  url: string;
  platform: string;
  format: DownloadFormat;
  quality: string;
  isPlaylist: boolean;
  createdAt: number;
  finishedAt: number | null;
  status: JobStatus;
  progress: DownloadProgress;
  items: DownloadItemProgress[];
  skipped: number;
  logs: string[];
  result?: { message: string; files: Array<{ filename: string; format: DownloadFormat; downloadUrl: string }>; archive?: { filename: string; downloadUrl: string; count: number }; format: DownloadFormat; isPlaylist: boolean; maxPlaylistItems: number };
  error?: { error: string; message: string };
  options: JobOptions;
  controller: AbortController | null;
  stopReason: "pause" | "cancel" | null;
  titleFromSource: boolean;
};

const validVideoQualities = ["best", "360", "480", "720", "1080"];
const validAudioQualities = ["128", "192", "256", "320"];
const maxFinishedJobs = 80;

const jobs = new Map<string, DownloadJob>();
const queue: DownloadJob[] = [];
let active: DownloadJob | null = null;

function isFinished(job: DownloadJob): boolean {
  return job.status === "completed" || job.status === "failed" || job.status === "cancelled";
}

function refreshQueueMessages(): void {
  queue.forEach((job, index) => {
    job.progress = { ...job.progress, speed: null, eta: null, message: index === 0 && active ? "En cola: empieza en cuanto termine la descarga actual" : index === 0 ? "Empezando…" : `En cola: posición ${index + 1}` };
  });
}

function pruneFinished(): void {
  const finished = [...jobs.values()].filter(isFinished).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  for (const job of finished.slice(maxFinishedJobs)) jobs.delete(job.id);
}

function pump(): void {
  if (active) return;
  const next = queue.shift();
  refreshQueueMessages();
  if (!next) return;
  active = next;
  void runJob(next).finally(() => {
    active = null;
    pruneFinished();
    pump();
  });
}

function log(job: DownloadJob, line: string): void {
  job.logs.push(line);
  if (job.logs.length > 150) job.logs.shift();
}

async function runJob(job: DownloadJob): Promise<void> {
  const { options } = job;
  job.status = "downloading";
  job.stopReason = null;
  job.error = undefined;
  job.controller = new AbortController();
  job.progress = { ...job.progress, message: options.playlist ? "Preparando playlist…" : "Preparando descarga…" };
  log(job, job.progress.message);
  try {
    const result = await downloadMedia({
      url: options.url,
      format: options.format,
      quality: options.quality,
      playlist: options.playlist,
      playlistTotal: options.playlistItems?.length ?? options.playlistTotal,
      playlistItems: options.playlistItems,
      filenameTemplate: options.filenameTemplate,
      skipDuplicates: options.skipDuplicates,
      id3: options.id3,
      signal: job.controller.signal,
      onProgress: (progress) => { job.progress = progress; },
      onLog: (line) => log(job, line),
      onItem: (item) => {
        const index = job.items.findIndex((entry) => entry.index === item.index);
        if (index >= 0) job.items[index] = item;
        else job.items.push(item);
        job.items.sort((a, b) => a.index - b.index);
        // En descargas sueltas pegadas como URL, el título real llega con el progreso.
        if (!options.playlist && !job.titleFromSource && item.title) {
          job.title = item.title;
          job.titleFromSource = true;
        }
      }
    });
    job.skipped = result.skipped;
    if (result.files.length === 0) {
      job.result = { message: result.skipped === 1 ? "Ya lo habías descargado: se ha omitido el duplicado." : `Ya los habías descargado: se han omitido ${result.skipped} duplicados.`, files: [], format: result.format, isPlaylist: result.isPlaylist, maxPlaylistItems: 0 };
      job.status = "completed";
      job.progress = { percent: 100, speed: null, eta: null, current: null, total: null, message: "Duplicado omitido" };
      return;
    }
    job.progress = { percent: result.isPlaylist ? 99 : 100, speed: null, eta: null, current: null, total: null, message: result.isPlaylist ? "Preparando archivo ZIP…" : "Finalizando descarga…" };
    const archiveFilename = options.playlist && result.files.length > 1
      ? await createPlaylistArchive(downloadDirectory(), result.files.map((file) => file.filename), options.playlistTitle)
      : null;
    if (archiveFilename) log(job, `ZIP preparado: ${archiveFilename}`);
    const skippedNote = result.skipped > 0 ? ` (${result.skipped} omitidas por estar ya descargadas)` : "";
    job.result = {
      message: archiveFilename
        ? `Playlist ${result.format.toUpperCase()} preparada: ${result.files.length} canciones${skippedNote}.`
        : `Descarga ${result.format.toUpperCase()} completada: ${result.files.length} archivo(s)${skippedNote}.`,
      files: result.files.map((file) => ({ ...file, downloadUrl: `/api/downloads/${encodeURIComponent(file.filename)}` })),
      ...(archiveFilename ? { archive: { filename: archiveFilename, downloadUrl: `/api/downloads/${encodeURIComponent(archiveFilename)}`, count: result.files.length } } : {}),
      format: result.format,
      isPlaylist: result.isPlaylist,
      maxPlaylistItems: 0
    };
    job.status = "completed";
    job.progress = { percent: 100, speed: null, eta: null, current: result.isPlaylist ? result.files.length : null, total: result.isPlaylist ? result.files.length : null, message: "Descarga completada" };
  } catch (error) {
    if (error instanceof DownloadAbortedError) {
      const paused = job.stopReason === "pause";
      job.status = paused ? "paused" : "cancelled";
      job.progress = { ...job.progress, speed: null, eta: null, message: paused ? "En pausa: al reanudar continúa donde se quedó" : "Cancelada" };
      log(job, paused ? "Descarga en pausa." : "Descarga cancelada.");
      return;
    }
    job.status = "failed";
    if (error instanceof DownloadToolUnavailableError) job.error = { error: "Herramienta no disponible", message: error.message };
    else if (error instanceof DownloadLimitError) job.error = { error: "Archivo demasiado grande", message: error.message };
    else {
      const message = error instanceof Error ? error.message : "Error inesperado durante la descarga.";
      job.error = { error: "Descarga fallida", message };
      log(job, `ERROR: ${message}`);
    }
  } finally {
    job.controller = null;
    if (job.status !== "paused") job.finishedAt = Date.now();
  }
}

function publicJob(job: DownloadJob) {
  const { controller: _controller, options, stopReason: _stopReason, titleFromSource: _titleFromSource, ...rest } = job;
  const queuePosition = queue.indexOf(job);
  return { ...rest, jobId: job.id, queuePosition: queuePosition >= 0 ? queuePosition + 1 : null, playlistItems: options.playlistItems, filenameTemplate: options.filenameTemplate };
}

function cleanId3(value: unknown): Id3Overrides | null {
  if (typeof value !== "object" || value === null) return null;
  const source = value as Record<string, unknown>;
  const pick = (key: string) => (typeof source[key] === "string" ? (source[key] as string).trim().slice(0, 120) : "");
  const overrides = { artist: pick("artist"), album: pick("album"), year: pick("year"), genre: pick("genre") };
  if (overrides.year && !/^\d{4}$/.test(overrides.year)) throw new TemplateError("El año debe tener cuatro cifras, por ejemplo 2024.");
  return Object.values(overrides).some(Boolean) ? overrides : null;
}

type ParsedRequest = { options: Omit<JobOptions, "url" | "playlist" | "playlistTotal" | "playlistTitle" | "playlistItems">; error?: string };

function parseCommonOptions(body: Record<string, unknown>): ParsedRequest {
  const format = body.format;
  const quality = body.quality;
  const validQuality = format === "mp4" ? validVideoQualities.includes(String(quality)) : format === "mp3" && validAudioQualities.includes(String(quality));
  if ((format !== "mp4" && format !== "mp3") || !validQuality) {
    return { options: null as never, error: "Elige un formato mp4/mp3 y una calidad compatible." };
  }
  const filenameTemplate = typeof body.filenameTemplate === "string" && body.filenameTemplate.trim() ? body.filenameTemplate.trim() : null;
  try {
    buildOutputTemplate(filenameTemplate);
    const id3 = format === "mp3" ? cleanId3(body.id3) : null;
    return { options: { format, quality: quality as VideoQuality | AudioQuality, filenameTemplate, skipDuplicates: body.skipDuplicates !== false, id3 } };
  } catch (error) {
    return { options: null as never, error: error instanceof Error ? error.message : "Opciones no válidas." };
  }
}

function enqueue(analysis: Analysis, options: JobOptions, title: string | null): DownloadJob {
  const job: DownloadJob = {
    id: randomUUID(),
    title: title || options.playlistTitle || analysis.url,
    url: analysis.url,
    platform: analysis.platform,
    format: options.format,
    quality: String(options.quality),
    isPlaylist: options.playlist,
    createdAt: Date.now(),
    finishedAt: null,
    status: "queued",
    progress: { percent: 0, speed: null, eta: null, current: null, total: options.playlistItems?.length ?? options.playlistTotal, message: "En cola" },
    items: [],
    skipped: 0,
    logs: [],
    options,
    controller: null,
    stopReason: null,
    titleFromSource: Boolean(title)
  };
  jobs.set(job.id, job);
  queue.push(job);
  refreshQueueMessages();
  pump();
  return job;
}

function looksLikePlaylist(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.searchParams.has("list") && !parsed.searchParams.has("v") || parsed.pathname.includes("/playlist") || /\/sets\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function createJobsRouter(deps: { analyzeDownloadSource: (value: unknown) => Analysis | null; maxPlaylistItems: number }): Router {
  const router = Router();

  router.post("/api/download", (request: Request, response: Response) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const analysis = deps.analyzeDownloadSource(body.url);
    const parsed = parseCommonOptions(body);
    if (!analysis || parsed.error) {
      response.status(400).json({ error: "Solicitud inválida", message: parsed.error ?? "Envía una URL http(s) válida." });
      return;
    }
    if (analysis.videoOnly && parsed.options.format !== "mp4") {
      response.status(400).json({ error: "Formato no compatible", message: `${analysis.platform} solo permite descargas de vídeo en formato MP4.` });
      return;
    }
    const playlist = body.playlist === true;
    const requestedTotal = Number(body.playlistTotal);
    const playlistItems = playlist && Array.isArray(body.playlistItems)
      ? body.playlistItems.map(Number).filter((item) => Number.isInteger(item) && item > 0 && item <= deps.maxPlaylistItems).slice(0, deps.maxPlaylistItems)
      : null;
    const job = enqueue(analysis, {
      ...parsed.options,
      url: analysis.url,
      playlist,
      playlistTotal: playlist && Number.isInteger(requestedTotal) && requestedTotal > 0 ? Math.min(requestedTotal, deps.maxPlaylistItems) : null,
      playlistTitle: typeof body.playlistTitle === "string" ? body.playlistTitle : null,
      playlistItems: playlistItems && playlistItems.length > 0 ? playlistItems : null
    }, typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : null);
    response.status(202).json(publicJob(job));
  });

  // Varias URLs de golpe: una tarea por URL con las mismas opciones.
  router.post("/api/download/batch", (request: Request, response: Response) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const parsed = parseCommonOptions(body);
    if (parsed.error) {
      response.status(400).json({ error: "Solicitud inválida", message: parsed.error });
      return;
    }
    const rawUrls = Array.isArray(body.urls) ? body.urls : typeof body.urls === "string" ? body.urls.split(/\s+/) : [];
    const urls = [...new Set(rawUrls.map((value) => String(value).trim()).filter(Boolean))].slice(0, 200);
    const created: Array<ReturnType<typeof publicJob>> = [];
    const rejected: Array<{ url: string; reason: string }> = [];
    for (const url of urls) {
      const analysis = deps.analyzeDownloadSource(url);
      if (!analysis) { rejected.push({ url, reason: "No es una URL válida" }); continue; }
      if (analysis.videoOnly && parsed.options.format !== "mp4") { rejected.push({ url, reason: `${analysis.platform} solo admite MP4` }); continue; }
      const playlist = body.allowPlaylists === true && looksLikePlaylist(analysis.url);
      created.push(publicJob(enqueue(analysis, { ...parsed.options, url: analysis.url, playlist, playlistTotal: null, playlistTitle: null, playlistItems: null }, null)));
    }
    response.status(created.length > 0 ? 202 : 400).json({ created, rejected, message: created.length > 0 ? `${created.length} descarga(s) añadidas a la cola.` : "Ninguna URL era válida." });
  });

  router.get("/api/download/:jobId", (request: Request, response: Response) => {
    const job = jobs.get(String(request.params.jobId));
    if (!job) {
      response.status(404).json({ error: "Tarea no encontrada", message: "La tarea de descarga ya no existe." });
      return;
    }
    response.json(publicJob(job));
  });

  router.get("/api/jobs", (_request: Request, response: Response) => {
    const rank = (job: DownloadJob) => job.status === "downloading" ? 0 : job.status === "paused" ? 1 : job.status === "queued" ? 2 : 3;
    const list = [...jobs.values()].sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? a.createdAt - b.createdAt : b.createdAt - a.createdAt)).map((job) => {
      const { logs, ...rest } = publicJob(job);
      return { ...rest, lastLog: [...logs].reverse().find((line) => !line.includes("PROGRESS:")) ?? null };
    });
    response.json({ jobs: list, active: list.filter((job) => job.status === "queued" || job.status === "downloading").length });
  });

  router.post("/api/jobs/:jobId/pause", (request: Request, response: Response) => {
    const job = jobs.get(String(request.params.jobId));
    if (!job || (job.status !== "downloading" && job.status !== "queued")) {
      response.status(409).json({ error: "No se puede pausar", message: "Solo se pueden pausar descargas en curso o en cola." });
      return;
    }
    if (job.status === "queued") {
      queue.splice(queue.indexOf(job), 1);
      job.status = "paused";
      job.progress = { ...job.progress, message: "En pausa" };
      refreshQueueMessages();
    } else {
      job.stopReason = "pause";
      job.controller?.abort();
    }
    response.json(publicJob(job));
  });

  router.post("/api/jobs/:jobId/resume", (request: Request, response: Response) => {
    const job = jobs.get(String(request.params.jobId));
    if (!job || !["paused", "failed", "cancelled"].includes(job.status)) {
      response.status(409).json({ error: "No se puede reanudar", message: "Esta descarga no está en pausa." });
      return;
    }
    job.status = "queued";
    job.finishedAt = null;
    job.error = undefined;
    queue.push(job);
    refreshQueueMessages();
    pump();
    response.json(publicJob(job));
  });

  router.post("/api/jobs/:jobId/cancel", (request: Request, response: Response) => {
    const job = jobs.get(String(request.params.jobId));
    if (!job || isFinished(job)) {
      response.status(409).json({ error: "No se puede cancelar", message: "La descarga ya ha terminado." });
      return;
    }
    if (job.status === "downloading") {
      job.stopReason = "cancel";
      job.controller?.abort();
    } else {
      const index = queue.indexOf(job);
      if (index >= 0) queue.splice(index, 1);
      job.status = "cancelled";
      job.finishedAt = Date.now();
      job.progress = { ...job.progress, message: "Cancelada" };
      refreshQueueMessages();
    }
    response.json(publicJob(job));
  });

  router.delete("/api/jobs/:jobId", (request: Request, response: Response) => {
    const job = jobs.get(String(request.params.jobId));
    if (!job) {
      response.status(404).json({ error: "Tarea no encontrada", message: "La tarea de descarga ya no existe." });
      return;
    }
    if (job.status === "downloading") {
      response.status(409).json({ error: "Descarga en curso", message: "Cancélala o pausa antes de quitarla." });
      return;
    }
    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
    jobs.delete(job.id);
    refreshQueueMessages();
    response.json({ removed: job.id });
  });

  router.post("/api/jobs/clear", (_request: Request, response: Response) => {
    for (const job of [...jobs.values()]) if (isFinished(job)) jobs.delete(job.id);
    response.json({ cleared: true });
  });

  return router;
}
