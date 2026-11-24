/**
 * Autoactualización de la app de escritorio.
 *
 * Consulta las releases `desktop-v<versión>` de GitHub, descarga el instalador
 * NSIS a una carpeta temporal y devuelve su ruta. La app Tauri lo ejecuta en
 * modo pasivo y se cierra; el instalador vuelve a abrir AntiTube al terminar.
 */
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Router } from "express";

const repository = "iKoloser/AntiTube";
const tagPrefix = "desktop-v";

type Release = { version: string; tag: string; notes: string; publishedAt: string | null; assetUrl: string; assetName: string; size: number; pageUrl: string };

type State = {
  checking: boolean;
  checkedAt: number | null;
  latest: Release | null;
  error: string | null;
  download: { status: "idle" | "downloading" | "ready" | "error"; percent: number | null; received: number; total: number | null; path: string | null; error: string | null };
};

const state: State = { checking: false, checkedAt: null, latest: null, error: null, download: { status: "idle", percent: null, received: 0, total: null, path: null, error: null } };

export function currentVersion(): string {
  return process.env.ANTITUBE_APP_VERSION ?? "0.0.0";
}

function parse(version: string): number[] {
  return version.replace(/^v/, "").split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
}

export function isNewer(candidate: string, current: string): boolean {
  const a = parse(candidate);
  const b = parse(current);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return false;
}

export function updateDirectory(): string {
  return path.join(os.tmpdir(), "AntiTube-update");
}

type GitHubRelease = { tag_name: string; draft: boolean; body: string | null; published_at: string | null; html_url: string; assets: Array<{ name: string; browser_download_url: string; size: number }> };

function decodeEntities(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

/** Convierte el HTML de las notas del feed Atom en texto con encabezados `##` y viñetas. */
function htmlToText(html: string): string {
  return decodeEntities(html
    .replace(/<h[1-3][^>]*>/gi, "\n## ").replace(/<\/h[1-3]>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")).replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Alternativa sin límite de consultas: el feed Atom público de releases.
 * El instalador sigue la convención de nombres del workflow.
 */
async function fetchLatestFromFeed(): Promise<Release | null> {
  const response = await fetch(`https://github.com/${repository}/releases.atom`, { headers: { "User-Agent": "AntiTube-desktop" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`GitHub respondió ${response.status}.`);
  const xml = await response.text();
  let best: Release | null = null;
  for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const tag = /\/releases\/tag\/([^"]+)"/.exec(entry)?.[1];
    if (!tag?.startsWith(tagPrefix)) continue;
    const version = decodeURIComponent(tag).slice(tagPrefix.length);
    if (best && !isNewer(version, best.version)) continue;
    const content = /<content[^>]*>([\s\S]*?)<\/content>/.exec(entry)?.[1] ?? "";
    const assetName = `AntiTube_${version}_x64-setup.exe`;
    best = {
      version, tag, notes: htmlToText(decodeEntities(content)), publishedAt: /<updated>([^<]+)<\/updated>/.exec(entry)?.[1] ?? null,
      assetUrl: `https://github.com/${repository}/releases/download/${tag}/${assetName}`, assetName, size: 0,
      pageUrl: `https://github.com/${repository}/releases/tag/${tag}`
    };
  }
  return best;
}

async function fetchLatest(): Promise<Release | null> {
  try {
    return await fetchLatestFromApi();
  } catch (apiError) {
    try { return await fetchLatestFromFeed(); } catch { throw apiError; }
  }
}

async function fetchLatestFromApi(): Promise<Release | null> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "AntiTube-desktop" };
  if (process.env.ANTITUBE_GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.ANTITUBE_GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=30`, { headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(response.status === 403 ? "GitHub ha limitado las consultas. Prueba dentro de un rato." : `GitHub respondió ${response.status}.`);
  const releases = await response.json() as GitHubRelease[];
  let best: Release | null = null;
  for (const release of releases) {
    if (release.draft || !release.tag_name.startsWith(tagPrefix)) continue;
    const asset = release.assets.find((item) => /_x64-setup\.exe$/i.test(item.name));
    if (!asset) continue;
    const version = release.tag_name.slice(tagPrefix.length);
    if (best && !isNewer(version, best.version)) continue;
    best = { version, tag: release.tag_name, notes: (release.body ?? "").trim(), publishedAt: release.published_at, assetUrl: asset.browser_download_url, assetName: asset.name, size: asset.size, pageUrl: release.html_url };
  }
  return best;
}

function summary() {
  const current = currentVersion();
  const latest = state.latest;
  return {
    current,
    checking: state.checking,
    checkedAt: state.checkedAt,
    error: state.error,
    available: Boolean(latest && isNewer(latest.version, current)),
    latest: latest ? { version: latest.version, notes: latest.notes, publishedAt: latest.publishedAt, size: latest.size, pageUrl: latest.pageUrl } : null,
    download: state.download,
    supported: process.platform === "win32" && process.env.ANTITUBE_DESKTOP === "1"
  };
}

export async function checkAppUpdate() {
  if (state.checking) return summary();
  state.checking = true;
  state.error = null;
  try {
    state.latest = await fetchLatest();
    state.checkedAt = Date.now();
  } catch (error) {
    state.error = error instanceof Error && error.name !== "TimeoutError" ? error.message : "No se pudo contactar con GitHub.";
  } finally {
    state.checking = false;
  }
  return summary();
}

async function downloadInstaller(release: Release) {
  const directory = updateDirectory();
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, path.basename(release.assetName));
  state.download = { status: "downloading", percent: 0, received: 0, total: release.size || null, path: null, error: null };
  try {
    const response = await fetch(release.assetUrl, { headers: { "User-Agent": "AntiTube-desktop" } });
    if (!response.ok || !response.body) throw new Error(`La descarga respondió ${response.status}.`);
    const total = Number(response.headers.get("content-length")) || release.size || null;
    state.download.total = total;
    const source = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
    source.on("data", (chunk: Buffer) => {
      state.download.received += chunk.length;
      state.download.percent = total ? Math.min(100, Math.round((state.download.received / total) * 100)) : null;
    });
    await pipeline(source, createWriteStream(target));
    const info = await stat(target);
    if (release.size && info.size !== release.size) throw new Error("El instalador descargado está incompleto.");
    state.download = { ...state.download, status: "ready", percent: 100, path: target };
  } catch (error) {
    await rm(target, { force: true });
    state.download = { ...state.download, status: "error", path: null, error: error instanceof Error ? error.message : "No se pudo descargar el instalador." };
  }
}

export function createAppUpdateRouter(): Router {
  const router = Router();

  router.get("/api/app/update", (_request, response) => {
    response.json(summary());
  });

  router.post("/api/app/update/check", async (_request, response) => {
    response.json(await checkAppUpdate());
  });

  router.post("/api/app/update/download", async (_request, response) => {
    if (state.download.status === "downloading") return response.json(summary());
    if (!state.latest) await checkAppUpdate();
    const latest = state.latest;
    if (!latest || !isNewer(latest.version, currentVersion())) return response.status(409).json({ ...summary(), message: "No hay ninguna versión más reciente." });
    void downloadInstaller(latest);
    response.json(summary());
  });

  return router;
}
