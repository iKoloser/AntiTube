"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePersistentState, useScrollMemory } from "./persist";
import AdvancedOptions, { useDownloadPrefs } from "./DownloadPrefs";
import BatchPanel from "./BatchPanel";
import FormatPicker, { type AudioAvailability, type DownloadFormat } from "./FormatPicker";
import { previewTrack, streamTrack, usePlayer, warmStream } from "./player/PlayerContext";
import { formatTime } from "./player/types";
import { apiUrl, isDesktop, revealDownload } from "./runtime";
import SearchResults, { providers, type SearchProvider } from "./SearchResults";
import { pendingOmniboxKey } from "./shell/omnibox";
import { IconDownload, IconHeadphones, IconLink, IconPlay, IconScissors, IconSearch } from "./shell/icons";
import { useToast } from "./shell/Toasts";
import Trimmer, { type Section } from "./Trimmer";

type AnalysisResponse = { message: string; analysis: { url: string; domain: string; platform: string; videoOnly: boolean } };
type PlaylistEntry = { index: number; id: string | null; title: string; uploader?: string | null; sourceUrl: string | null; durationSeconds: number | null; thumbnailUrl: string | null };
type MetadataResponse = AnalysisResponse & { metadata: { title: string | null; uploader: string | null; durationSeconds: number | null; extractor: string | null; thumbnailUrl: string | null; sourceUrl: string; isPlaylist: boolean; playlistTitle: string | null; playlistCount: number | null; playlistEntries: PlaylistEntry[]; audio: AudioAvailability } };
type DownloadResponse = { message: string; format: DownloadFormat; isPlaylist: boolean; files: Array<{ filename: string; format: DownloadFormat; downloadUrl: string }>; archive?: { filename: string; downloadUrl: string; count: number } };
type DownloadJobResponse = { jobId: string; queuePosition?: number | null; status: "queued" | "downloading" | "completed" | "failed" | "paused" | "cancelled"; progress: { percent: number; speed: string | null; eta: string | null; current: number | null; total: number | null; message: string }; logs: string[]; result?: DownloadResponse; error?: { message: string } };
type VideoQuality = "best" | "360" | "480" | "720" | "1080";
type AudioQuality = "128" | "192" | "256" | "320";

const quickKey = "antitube-quick-download";
const providersKey = "antitube-search-providers-v2";

const supportedPlatforms = [
  { name: "YouTube", mark: "YT", detail: "vídeo, audio y playlists" },
  { name: "YouTube Music", mark: "YM", detail: "canciones y álbumes" },
  { name: "SoundCloud", mark: "SC", detail: "audio y listas" },
  { name: "Bandcamp", mark: "BC", detail: "audio" },
  { name: "TikTok", mark: "TT", detail: "vídeo" },
  { name: "Twitch Clips", mark: "TW", detail: "vídeo" },
  { name: "Twitter / X", mark: "X", detail: "vídeo" },
  { name: "Vimeo", mark: "VM", detail: "vídeo y audio" },
  { name: "Instagram", mark: "IG", detail: "vídeo" },
  { name: "Facebook", mark: "FB", detail: "vídeo" },
  { name: "Reddit", mark: "RD", detail: "vídeo" },
  { name: "Dailymotion", mark: "DM", detail: "vídeo" },
  { name: "Bilibili", mark: "BI", detail: "vídeo" },
  { name: "Rumble", mark: "RM", detail: "vídeo" },
  { name: "Kick", mark: "K", detail: "clips y vídeo" },
  { name: "Otros sitios", mark: "+", detail: "compatibles con yt-dlp" }
];

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim()) || /^(www\.|youtu\.be\/|[a-z0-9-]+\.(com|be|tv|net|org|io)\/)\S*$/i.test(value.trim());
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function looksLikePlaylist(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.searchParams.has("list") || parsed.pathname.includes("/playlist") || /\/sets\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

const extensionOf: Record<DownloadFormat, string> = { mp4: "mp4", mp3: "mp3", m4a: "m4a", opus: "opus", flac: "flac" };

function useTypewriter(lines: string[], active: boolean): string {
  const [text, setText] = useState(lines[0]);
  const linesRef = useRef(lines);
  useEffect(() => {
    if (!active || document.documentElement.dataset.motion === "off") return;
    let line = 0;
    let position = linesRef.current[0].length;
    let deleting = true;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const current = linesRef.current[line];
      if (deleting) {
        position -= 2;
        if (position <= 0) { deleting = false; line = (line + 1) % linesRef.current.length; position = 0; }
      } else {
        position += 1;
        if (position >= linesRef.current[line].length) { deleting = true; setText(linesRef.current[line]); timer = setTimeout(step, 2600); return; }
      }
      setText(`${(deleting ? current : linesRef.current[line]).slice(0, Math.max(0, position))}▌`);
      timer = setTimeout(step, deleting ? 18 : 55);
    };
    timer = setTimeout(step, 2600);
    return () => clearTimeout(timer);
  }, [active]);
  return text;
}

export default function Home() {
  const [input, setInput] = usePersistentState("descargar:input", "");
  const [url, setUrl] = usePersistentState("descargar:url", "");
  const [searchQuery, setSearchQuery] = usePersistentState<string | null>("descargar:searchQuery", null);
  const [searchProviders, setSearchProviders] = usePersistentState<SearchProvider[]>("descargar:providers", ["youtube", "ytmusic", "bandcamp", "audius"]);
  const [result, setResult] = usePersistentState<AnalysisResponse | null>("descargar:result", null);
  const [metadata, setMetadata] = usePersistentState<MetadataResponse | null>("descargar:metadata", null);
  const [error, setError] = usePersistentState<string | null>("descargar:error", null);
  const [format, setFormat] = usePersistentState<DownloadFormat>("descargar:format", "mp4");
  const [videoQuality, setVideoQuality] = usePersistentState<VideoQuality>("descargar:videoQuality", "720");
  const [audioQuality, setAudioQuality] = usePersistentState<AudioQuality>("descargar:audioQuality", "320");
  const [quick, setQuick] = useState<{ format: DownloadFormat; quality: string }>({ format: "mp3", quality: "320" });
  const [playlist, setPlaylist] = usePersistentState("descargar:playlist", false);
  const [isLoading, setIsLoading] = usePersistentState("descargar:isLoading", false);
  const [isMetadataLoading, setIsMetadataLoading] = usePersistentState("descargar:isMetadataLoading", false);
  const [isDownloadLoading, setIsDownloadLoading] = useState(false);
  const [download, setDownload] = useState<DownloadResponse | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadJobResponse["progress"] | null>(null);
  const [downloadLogs, setDownloadLogs] = useState<string[]>([]);
  const [trimOpen, setTrimOpen] = usePersistentState("descargar:trimOpen", false);
  const [section, setSection] = usePersistentState<Section | null>("descargar:section", null);
  const [mediaDuration, setMediaDuration] = usePersistentState<number | null>("descargar:mediaDuration", null);
  const trackingRef = useRef(0);
  const cardRef = useRef<HTMLElement | null>(null);
  const { prefs, update: updatePrefs, requestFields } = useDownloadPrefs();
  const [selectedItems, setSelectedItems] = usePersistentState<Set<number> | null>("descargar:selectedItems", null);
  const [batchMode, setBatchMode] = usePersistentState("descargar:batchMode", false);
  const player = usePlayer();
  const toast = useToast();
  const isUrl = looksLikeUrl(input);
  useScrollMemory("descargar");

  useEffect(() => {
    try {
      const savedQuick = JSON.parse(localStorage.getItem(quickKey) ?? "null") as typeof quick | null;
      if (savedQuick) setQuick(savedQuick);
      const savedProviders = JSON.parse(localStorage.getItem(providersKey) ?? "null") as SearchProvider[] | null;
      if (savedProviders?.length) setSearchProviders((current) => current.join() === savedProviders.join() ? current : savedProviders);
    } catch { /* sin preferencias */ }
  }, []);

  const stableProviders = useMemo(() => searchProviders, [searchProviders]);

  // La paleta de comandos (Ctrl+K) puede mandar aquí una búsqueda o un enlace.
  const runRef = useRef(runOmnibox);
  runRef.current = runOmnibox;
  useEffect(() => {
    const pending = sessionStorage.getItem(pendingOmniboxKey);
    if (pending) { sessionStorage.removeItem(pendingOmniboxKey); void runRef.current(pending); }
    const onCommand = (event: Event) => { sessionStorage.removeItem(pendingOmniboxKey); void runRef.current(String((event as CustomEvent).detail ?? "")); };
    window.addEventListener("antitube-omnibox", onCommand);
    return () => window.removeEventListener("antitube-omnibox", onCommand);
  }, []);

  // Sugerencias que se van escribiendo solas en la caja, como en una terminal.
  const typed = useTypewriter(["Busca una canción, artista o vídeo…", "Pega un enlace de YouTube, TikTok, Bandcamp…", "daft punk around the world", "lofi hip hop para estudiar", "https://youtu.be/…"], input.length === 0);

  function toggleProvider(id: SearchProvider) {
    setSearchProviders((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      const value = next.length ? providers.map((item) => item.id).filter((item) => next.includes(item)) : current;
      localStorage.setItem(providersKey, JSON.stringify(value));
      return value;
    });
  }

  function updateQuick(value: typeof quick) {
    setQuick(value);
    localStorage.setItem(quickKey, JSON.stringify(value));
  }

  async function loadMetadata(target: string, playlistOverride: boolean) {
    setError(null);
    setIsMetadataLoading(true);
    try {
      const response = await fetch(`${apiUrl()}/api/metadata`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: target, playlist: playlistOverride }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "No se pudieron consultar los metadatos.");
      const next = data as MetadataResponse;
      setMetadata(next);
      setSelectedItems(null);
      // Si el formato elegido no existe en esta fuente, se vuelve a uno que sí.
      const audio = next.metadata.audio;
      if (audio && !next.metadata.isPlaylist) {
        setFormat((current) => (current === "flac" && !audio.lossless) || (current === "m4a" && !audio.m4a) || (current === "opus" && !audio.opus) ? "mp3" : current);
      }
    } catch (caughtError) { setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar la vista previa."); }
    finally { setIsMetadataLoading(false); }
  }

  const analyze = useCallback(async (target: string) => {
    trackingRef.current += 1;
    setUrl(target); setIsDownloadLoading(false); setDownloadProgress(null); setIsLoading(true); setError(null); setResult(null); setMetadata(null); setDownload(null); setDownloadLogs([]); setTrimOpen(false); setSection(null); setMediaDuration(null);
    try {
      const playlistDetected = looksLikePlaylist(target);
      const response = await fetch(`${apiUrl()}/api/analyze`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: target }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "No se pudo analizar la URL.");
      const nextResult = data as AnalysisResponse;
      if (nextResult.analysis.videoOnly) setFormat("mp4");
      setPlaylist(playlistDetected);
      setResult(nextResult);
      setTimeout(() => cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      await loadMetadata(target, playlistDetected);
    } catch (caughtError) { setError(caughtError instanceof Error ? caughtError.message : "Se produjo un error inesperado."); }
    finally { setIsLoading(false); }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runOmnibox(input);
  }

  async function runOmnibox(raw: string) {
    const value = raw.trim();
    if (!value) return;
    setInput(value);
    if (looksLikeUrl(value)) {
      setSearchQuery(null);
      await analyze(normalizeUrl(value));
    } else {
      setResult(null); setMetadata(null); setError(null);
      setSearchQuery(value);
    }
  }

  /** Escucha la playlist pegada en streaming (las elegidas, o todas). */
  function listenPlaylist() {
    if (!metadata) return;
    const tracks = metadata.metadata.playlistEntries
      .filter((entry) => entry.sourceUrl && (!selectedItems || selectedItems.has(entry.index)))
      .map((entry) => streamTrack(entry.sourceUrl as string, { title: entry.title, artist: entry.uploader ?? metadata.metadata.uploader, cover: entry.thumbnailUrl ?? metadata.metadata.thumbnailUrl, durationSeconds: entry.durationSeconds }));
    if (tracks.length) player.playTracks(tracks);
  }

  async function quickDownload(item: { url: string; title: string }) {
    try {
      const response = await fetch(`${apiUrl()}/api/download`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: item.url, format: quick.format, quality: quick.format === "mp3" || quick.format === "mp4" ? quick.quality : "best", title: item.title, ...requestFields(quick.format) }) });
      const data = await response.json() as { message?: string };
      if (!response.ok) throw new Error(data.message ?? "No se pudo añadir.");
      toast({ title: "Añadida a la cola", body: `${item.title} · ${quick.format.toUpperCase()}`, tone: "ok" });
    } catch (caught) {
      toast({ title: "No se pudo descargar", body: caught instanceof Error ? caught.message : undefined, tone: "error" });
    }
  }

  async function handleDownload() {
    const tracking = ++trackingRef.current;
    setIsDownloadLoading(true); setError(null); setDownload(null); setDownloadProgress(null); setDownloadLogs([]);
    const fullDuration = metadata?.metadata.durationSeconds ?? mediaDuration;
    const trimmed = trimOpen && section && metadata && !metadata.metadata.isPlaylist && (section.start > 0.05 || (fullDuration ? section.end < fullDuration - 0.15 : section.end > 0)) ? section : null;
    try {
      const response = await fetch(`${apiUrl()}/api/download`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, format, quality: format === "mp4" ? videoQuality : format === "mp3" ? audioQuality : "best", playlist, playlistTotal: metadata?.metadata.isPlaylist ? metadata.metadata.playlistCount : null, playlistTitle: metadata?.metadata.isPlaylist ? metadata.metadata.playlistTitle : null, title: metadata?.metadata.playlistTitle ?? metadata?.metadata.title ?? null, playlistItems: playlist && selectedItems ? [...selectedItems].sort((a, b) => a - b) : null, section: trimmed, ...requestFields(format) }) });
      const data = await response.json() as DownloadJobResponse;
      if (!response.ok) throw new Error((data as unknown as { message?: string }).message ?? "No se pudo iniciar la descarga.");
      let job = data; setDownloadProgress(job.progress); setDownloadLogs(job.logs ?? []);
      while (job.status !== "completed" && job.status !== "failed" && job.status !== "cancelled") {
        await new Promise((resolve) => setTimeout(resolve, 700));
        if (tracking !== trackingRef.current) return;
        const progressResponse = await fetch(`${apiUrl()}/api/download/${job.jobId}`, { credentials: "include" });
        job = await progressResponse.json() as DownloadJobResponse;
        if (!progressResponse.ok) throw new Error(job.error?.message ?? "No se pudo consultar el progreso.");
        setDownloadProgress(job.progress); setDownloadLogs(job.logs ?? []);
      }
      if (tracking !== trackingRef.current) return;
      if (job.status !== "completed" || !job.result) throw new Error(job.error?.message ?? "La descarga no se ha completado.");
      setDownload({
        ...job.result,
        files: job.result.files.map((file) => ({ ...file, downloadUrl: `${apiUrl()}${file.downloadUrl}` })),
        archive: job.result.archive ? { ...job.result.archive, downloadUrl: `${apiUrl()}${job.result.archive.downloadUrl}` } : undefined
      });
    } catch (caughtError) { if (tracking === trackingRef.current) setError(caughtError instanceof Error ? caughtError.message : "Se produjo un error inesperado."); }
    finally { if (tracking === trackingRef.current) setIsDownloadLoading(false); }
  }

  async function playDownloaded(filenames: string[]) {
    const tracks = await player.refreshLibrary(true);
    const found = filenames.map((name) => tracks.find((track) => track.filename === name)).filter((track) => track !== undefined);
    if (found.length) {
      const { toPlayerTrack } = await import("./player/types");
      player.playTracks(found.map(toPlayerTrack));
    }
  }

  async function listenSource() {
    if (!metadata) return;
    try {
      const track = await previewTrack(metadata.metadata.sourceUrl, { title: metadata.metadata.title ?? "Vista previa", artist: metadata.metadata.uploader, cover: metadata.metadata.thumbnailUrl, durationSeconds: metadata.metadata.durationSeconds });
      player.playTracks([track]);
    } catch (caught) {
      toast({ title: "No se puede escuchar", body: caught instanceof Error ? caught.message : undefined, tone: "error" });
    }
  }

  const onSection = useCallback((value: Section | null) => setSection(value), []);
  const title = metadata?.metadata.playlistTitle ?? metadata?.metadata.title ?? "Contenido multimedia";
  const videoOnly = result?.analysis.videoOnly === true;
  const progress = downloadProgress ?? { percent: 0, speed: null, eta: null, current: null, total: metadata?.metadata.isPlaylist ? metadata.metadata.playlistCount : null, message: playlist ? "Preparando playlist…" : "Preparando descarga…" };
  const playlistCount = metadata?.metadata.isPlaylist ? metadata.metadata.playlistCount : null;
  const playlistEntries = metadata?.metadata.isPlaylist ? metadata.metadata.playlistEntries : [];
  const isPlaylistReady = playlist && metadata?.metadata.isPlaylist === true;
  const firstPlaylistUrls = playlistEntries.slice(0, 3).map((entry) => entry.sourceUrl).filter(Boolean).join("\n");
  // Las primeras canciones de una playlist pegada se preparan para que «Escuchar playlist» suene al momento.
  useEffect(() => { if (firstPlaylistUrls) firstPlaylistUrls.split("\n").forEach((url) => warmStream(url)); }, [firstPlaylistUrls]);
  const completedPlaylistItems = isPlaylistReady ? (download?.archive?.count ?? (isDownloadLoading ? Math.max(0, (downloadProgress?.current ?? 1) - 1) : (downloadProgress?.current ?? 0))) : 0;
  const canTrim = Boolean(metadata && !metadata.metadata.isPlaylist);
  const qualityLabel = format === "mp4" ? (videoQuality === "best" ? "Mejor disponible" : `Hasta ${videoQuality}p`) : format === "mp3" ? `${audioQuality} kbps` : format === "flac" ? "Sin pérdida" : "Original, sin conversión";

  return <main className="page page-download">
    <section className="hero">
      <p className="kicker">// buscar · pegar enlace · descargar</p>
      <h1>¿Qué quieres <span className="glitch" data-text="escuchar">escuchar</span> hoy?</h1>
      <form className={`omnibox${isUrl ? " is-url" : ""}`} onSubmit={handleSubmit}>
        <span className="omnibox-icon" aria-hidden="true">{isUrl ? <IconLink size={20} /> : <IconSearch size={20} />}</span>
        <label className="sr-only" htmlFor="omnibox">Busca una canción o pega un enlace</label>
        <input id="omnibox" type="text" value={input} onChange={(event) => setInput(event.target.value)} placeholder={typed} autoComplete="off" spellCheck={false} />
        <button type="submit" disabled={isLoading || !input.trim()}>{isLoading ? "Analizando…" : isUrl ? "Analizar enlace" : "Buscar"}</button>
      </form>
      <div className="omnibox-options">
        {!isUrl && <div className="provider-toggles" role="group" aria-label="Dónde buscar">
          <span>Buscar en</span>
          {providers.map((provider) => <button key={provider.id} type="button" className={`provider-toggle${searchProviders.includes(provider.id) ? " active" : ""}`} onClick={() => toggleProvider(provider.id)} aria-pressed={searchProviders.includes(provider.id)}><span className={`provider-mark is-${provider.id}`}>{provider.mark}</span>{provider.label}</button>)}
        </div>}
        {isUrl && <span className="omnibox-hint">Enlace detectado. Se analiza en local; no se descarga nada todavía.</span>}
        <label className="quick-select"><span>Descarga rápida</span>
          <select value={`${quick.format}:${quick.quality}`} onChange={(event) => { const [nextFormat, quality] = event.target.value.split(":"); updateQuick({ format: nextFormat as DownloadFormat, quality }); }}>
            <option value="mp3:320">MP3 320 kbps</option>
            <option value="mp3:192">MP3 192 kbps</option>
            <option value="m4a:best">M4A original</option>
            <option value="opus:best">Opus original</option>
            <option value="flac:best">FLAC (si es sin pérdida)</option>
            <option value="mp4:1080">MP4 1080p</option>
            <option value="mp4:720">MP4 720p</option>
          </select>
        </label>
      </div>
      <div className="form-note"><button type="button" className="batch-toggle" onClick={() => setBatchMode((value) => !value)}>{batchMode ? "Cerrar varias URLs" : "¿Muchas URLs? Pégalas de una vez"}</button></div>
    </section>

    {batchMode && <BatchPanel prefs={prefs} update={updatePrefs} requestFields={requestFields} />}
    {error && <div className="notice error">ⓘ <span>{error}</span></div>}
    {searchQuery && !result && <SearchResults query={searchQuery} selected={stableProviders} onOpen={(target) => { setInput(target); void analyze(target); }} onQuickDownload={quickDownload} />}

    {result && <section ref={cardRef} className="download-card" aria-label="Vista previa y opciones de descarga">
      <div className="media-panel">
        <div className={`cover${metadata?.metadata.isPlaylist ? " playlist-cover" : ""}`} style={!metadata?.metadata.isPlaylist && metadata?.metadata.thumbnailUrl ? { backgroundImage: `url("${metadata.metadata.thumbnailUrl}")` } : undefined}>
          <div className="cover-shade" />
          <span className="cover-tag">{metadata?.analysis.platform ?? result.analysis.platform}</span>
          {isMetadataLoading && <div className="cover-loading"><span className="spinner" /> Leyendo metadatos…</div>}
          {metadata && !metadata.metadata.isPlaylist && <button type="button" className="cover-play" onClick={() => void listenSource()} aria-label="Escuchar ahora"><IconPlay size={26} /></button>}
          {metadata?.metadata.isPlaylist && <div className="playlist-cover-placeholder"><span className="playlist-cover-glyph">▤</span><strong>Playlist detectada</strong><span>{playlistCount ?? "Varios"} elementos listos para revisar.</span></div>}
        </div>
        <div className="media-copy">
          <div className="author"><span className="avatar">{(metadata?.metadata.uploader ?? "A").slice(0, 1).toUpperCase()}</span>{metadata?.metadata.uploader ?? "Autor desconocido"}</div>
          <h2>{title}</h2>
          <div className="meta-row"><span>{metadata?.metadata.durationSeconds ? formatTime(metadata.metadata.durationSeconds) : "Duración no disponible"}</span><span>{format === "mp4" ? "Vídeo con audio" : "Solo audio"}</span>{metadata?.metadata.audio?.lossless && <span className="meta-highlight">Fuente sin pérdida</span>}</div>
          <a className="source-link" href={metadata?.metadata.sourceUrl ?? result.analysis.url} target="_blank" rel="noreferrer">Abrir contenido original ↗</a>
        </div>
        {metadata?.metadata.isPlaylist && <section className="playlist-browser" aria-label="Canciones de la playlist"><div className="playlist-browser-heading"><h3>Contenido de la playlist</h3><span>{selectedItems ? `${selectedItems.size} de ${playlistEntries.length} elegidas` : `${playlistCount ?? playlistEntries.length} elementos`}</span>{playlistEntries.some((entry) => entry.sourceUrl) && <button type="button" className="chip-button" onClick={listenPlaylist} title="Escuchar en streaming, solo audio y sin descargar"><IconHeadphones size={15} /> Escuchar playlist</button>}</div>{playlistEntries.length > 0 && <div className="playlist-select-bar"><span>Elige qué descargar:</span><button type="button" onClick={() => setSelectedItems(null)}>Todas</button><button type="button" onClick={() => setSelectedItems(new Set())}>Ninguna</button></div>}{playlistEntries.length > 0 ? <div className="playlist-list">{playlistEntries.map((entry) => { const itemDownloaded = entry.index <= completedPlaylistItems; const itemSelected = !selectedItems || selectedItems.has(entry.index); return <div className={`playlist-item${itemDownloaded ? " is-downloaded" : ""}${itemSelected ? "" : " is-unselected"}`} key={`${entry.index}-${entry.id ?? entry.title}`}><input type="checkbox" className="playlist-item-check" aria-label={`Descargar ${entry.title}`} checked={itemSelected} disabled={isDownloadLoading} onChange={(event) => { const next = new Set(selectedItems ?? playlistEntries.map((item) => item.index)); if (event.target.checked) next.add(entry.index); else next.delete(entry.index); setSelectedItems(next.size === playlistEntries.length ? null : next); }} /><span className="playlist-item-index">{String(entry.index).padStart(2, "0")}</span><div className="playlist-item-copy"><strong>{entry.title}</strong><span>{formatTime(entry.durationSeconds)}</span></div>{entry.sourceUrl && <a href={entry.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Abrir ${entry.title}`}>↗</a>}<span className="playlist-item-status" aria-label={itemDownloaded ? "Descargada" : "Pendiente"}>{itemDownloaded ? "✓" : ""}</span></div>; })}</div> : <p className="playlist-empty">La plataforma ha indicado el número de elementos, pero no ha devuelto sus títulos.</p>}</section>}
      </div>

      <div className="options-panel">
        <div className="options-heading"><h3>Salida</h3><span>02 / formato</span></div>
        <FormatPicker format={format} onChange={(value) => { setFormat(value); setDownload(null); }} audio={metadata?.metadata.audio ?? null} platform={result.analysis.platform} videoOnly={videoOnly} isPlaylist={isPlaylistReady} />
        {videoOnly && <p className="format-note">{result.analysis.platform} se descarga solo como vídeo MP4.</p>}
        {(format === "mp4" || format === "mp3") && <><div className="format-label"><label htmlFor="quality">Calidad</label></div><div className="select-wrap"><select id="quality" value={format === "mp4" ? videoQuality : audioQuality} onChange={(event) => format === "mp4" ? setVideoQuality(event.target.value as VideoQuality) : setAudioQuality(event.target.value as AudioQuality)}>{format === "mp4" ? <><option value="best">MP4: Mejor disponible</option><option value="1080">MP4: Hasta 1080p</option><option value="720">MP4: Hasta 720p</option><option value="480">MP4: Hasta 480p</option><option value="360">MP4: Hasta 360p</option></> : <><option value="320">MP3: 320 kbps</option><option value="256">MP3: 256 kbps</option><option value="192">MP3: 192 kbps</option><option value="128">MP3: 128 kbps</option></>}</select></div></>}
        <div className="playlist-toggle"><input id="playlist" type="checkbox" checked={playlist} onChange={(event) => { const nextPlaylist = event.target.checked; setPlaylist(nextPlaylist); setTrimOpen(false); if (result) void loadMetadata(url, nextPlaylist); }} /><label htmlFor="playlist">Playlist completa <small>(máximo 50 elementos)</small></label></div>
        {canTrim && <button type="button" className={`trim-toggle${trimOpen ? " active" : ""}`} onClick={() => setTrimOpen((value) => !value)}><IconScissors size={16} /> {trimOpen ? "Descargar el contenido completo" : "Recortar: descargar solo una parte"}</button>}
        <AdvancedOptions prefs={prefs} update={updatePrefs} format={format} isPlaylist={isPlaylistReady} />
        <div className="file-summary"><span className="file-icon">{isPlaylistReady ? "▤" : format === "mp4" ? "▣" : "♫"}<small>{isPlaylistReady ? "ZIP" : format.toUpperCase()}</small></span><div><strong>{isPlaylistReady ? `${title}.zip` : `${title}.${extensionOf[format]}`}</strong><span>{isPlaylistReady ? `Playlist de ${playlistCount ?? "varios"} elementos` : `${qualityLabel}${trimOpen && section ? ` · recorte de ${formatTime(section.end - section.start)}` : ""}`}</span></div></div>
        <button className="download-button" type="button" disabled={isDownloadLoading || isMetadataLoading || (playlist && !isPlaylistReady) || (isPlaylistReady && selectedItems?.size === 0)} onClick={handleDownload}><IconDownload size={18} /> {isDownloadLoading ? "Preparando…" : isPlaylistReady ? selectedItems ? `Descargar ${selectedItems.size} elementos` : "Descargar playlist" : trimOpen ? `Descargar recorte ${format.toUpperCase()}` : `Descargar ${format.toUpperCase()}`}</button>
        {isDownloadLoading && <div className="progress-box"><div className="progress-top"><strong>{progress.message}</strong><b>{Math.round(progress.percent)}%</b></div><div className="progress-track"><div style={{ width: `${progress.percent}%` }} /></div><p>{progress.current && progress.total ? `Elemento ${progress.current} de ${progress.total}` : progress.speed ? `Velocidad: ${progress.speed}` : "Preparando archivos…"}{progress.eta ? ` / ETA: ${progress.eta}` : ""}</p><p className="progress-hint">Puedes buscar otra cosa mientras tanto: esta descarga sigue en <Link href="/descargas/">Descargas</Link>.</p></div>}
        {downloadLogs.length > 0 && (isDownloadLoading || error || download) && <details className="backend-log" open={Boolean(error)}><summary>Actividad del motor</summary><div>{downloadLogs.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</div></details>}
        {download && <div className="download-result"><strong>{download.message}</strong>
          {format !== "mp4" && !download.archive && download.files.length > 0 && <button type="button" className="download-all-link" onClick={() => void playDownloaded(download.files.map((file) => file.filename))}>▶ Escuchar ahora</button>}
          {isDesktop ? <>{download.archive ? <button type="button" onClick={() => void revealDownload(download.archive?.filename)}>Mostrar {download.archive.filename} en la carpeta</button> : download.files.map((file) => <button type="button" key={file.downloadUrl} onClick={() => void revealDownload(file.filename)}>Mostrar {file.filename} en la carpeta</button>)}</> : download.archive ? <a className="download-all-link" href={download.archive.downloadUrl} download>↓ Descargar {download.archive.count} archivos</a> : download.files.map((file) => <a key={file.downloadUrl} href={file.downloadUrl} download>Guardar {file.filename} ↓</a>)}
        </div>}
      </div>
      {canTrim && trimOpen && metadata && <div className="trim-wrap"><Trimmer url={metadata.metadata.sourceUrl} preferVideo={format === "mp4"} knownDuration={metadata.metadata.durationSeconds} thumbnailUrl={metadata.metadata.thumbnailUrl} value={section} onChange={onSection} onDuration={setMediaDuration} /></div>}
    </section>}

    {!result && !searchQuery && <section className="landing">
      <div className="landing-grid">
        <div className="landing-card"><span className="landing-index">01</span><strong>Busca sin salir</strong><p>YouTube, YouTube Music, Bandcamp, Audius y SoundCloud a la vez. Escucha o mira antes de bajar.</p></div>
        <div className="landing-card"><span className="landing-index">02</span><strong>Audio real</strong><p>M4A y Opus originales sin recomprimir. FLAC solo cuando la fuente es sin pérdida.</p></div>
        <div className="landing-card"><span className="landing-index">03</span><strong>Recorta</strong><p>Elige el trozo exacto con vista previa y baja solo eso.</p></div>
        <div className="landing-card"><span className="landing-index">04</span><strong>Escucha y mira</strong><p>Música y vídeo con listas, ecualizador y modo inmersivo en el <Link href="/reproductor/">reproductor</Link>.</p></div>
      </div>
      <details className="platform-strip"><summary className="platform-strip-heading"><span className="platform-summary-title"><span className="platform-summary-mark" aria-hidden="true">+</span><strong>Plataformas compatibles</strong></span><span className="platform-summary-hint">Ver sitios admitidos</span></summary><div className="platform-list">{supportedPlatforms.map((platform) => <div className="platform-item" key={platform.name}><span className="platform-mark" aria-hidden="true">{platform.mark}</span><span className="platform-copy"><strong>{platform.name}</strong><small>{platform.detail}</small></span></div>)}</div></details>
    </section>}
  </main>;
}
