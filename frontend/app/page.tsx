"use client";

import { FormEvent, useState } from "react";
import AntiTubeLogo from "./AntiTubeLogo";
import { apiUrl, isDesktop, revealDownload } from "./runtime";
import LogoutButton from "./LogoutButton";

type AnalysisResponse = { message: string; analysis: { url: string; domain: string; platform: string; videoOnly: boolean } };
type PlaylistEntry = { index: number; id: string | null; title: string; sourceUrl: string | null; durationSeconds: number | null; thumbnailUrl: string | null };
type MetadataResponse = AnalysisResponse & { metadata: { title: string | null; uploader: string | null; durationSeconds: number | null; extractor: string | null; thumbnailUrl: string | null; sourceUrl: string; isPlaylist: boolean; playlistTitle: string | null; playlistCount: number | null; playlistEntries: PlaylistEntry[] } };
type DownloadResponse = { message: string; format: "mp4" | "mp3"; isPlaylist: boolean; files: Array<{ filename: string; format: "mp4" | "mp3"; downloadUrl: string }>; archive?: { filename: string; downloadUrl: string; count: number } };
type DownloadJobResponse = { jobId: string; status: "queued" | "downloading" | "completed" | "failed"; progress: { percent: number; speed: string | null; eta: string | null; current: number | null; total: number | null; message: string }; logs: string[]; result?: DownloadResponse; error?: { message: string } };
type VideoQuality = "best" | "360" | "480" | "720" | "1080";
type AudioQuality = "128" | "192" | "256" | "320";


const supportedPlatforms = [
  { name: "YouTube", mark: "YT", detail: "vídeo, audio y playlists" },
  { name: "TikTok", mark: "TT", detail: "vídeo" },
  { name: "Twitch Clips", mark: "TW", detail: "vídeo" },
  { name: "Twitter / X", mark: "X", detail: "vídeo" },
  { name: "Vimeo", mark: "VM", detail: "vídeo y audio" },
  { name: "Instagram", mark: "IG", detail: "vídeo" },
  { name: "Facebook", mark: "FB", detail: "vídeo" },
  { name: "Reddit", mark: "RD", detail: "vídeo" },
  { name: "SoundCloud", mark: "SC", detail: "audio" },
  { name: "Bandcamp", mark: "BC", detail: "audio" },
  { name: "Dailymotion", mark: "DM", detail: "vídeo" },
  { name: "Bilibili", mark: "BI", detail: "vídeo" },
  { name: "Rumble", mark: "RM", detail: "vídeo" },
  { name: "Kick", mark: "K", detail: "clips y vídeo" },
  { name: "VK", mark: "VK", detail: "vídeo" },
  { name: "Streamable", mark: "ST", detail: "vídeo" },
  { name: "Otros sitios", mark: "+", detail: "compatibles con yt-dlp" }
];

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "Duración no disponible";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

function looksLikePlaylist(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.searchParams.has("list") || parsed.pathname.includes("/playlist");
  } catch {
    return false;
  }
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<"mp4" | "mp3">("mp4");
  const [videoQuality, setVideoQuality] = useState<VideoQuality>("720");
  const [audioQuality, setAudioQuality] = useState<AudioQuality>("192");
  const [playlist, setPlaylist] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isMetadataLoading, setIsMetadataLoading] = useState(false);
  const [isDownloadLoading, setIsDownloadLoading] = useState(false);
  const [download, setDownload] = useState<DownloadResponse | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadJobResponse["progress"] | null>(null);
  const [downloadLogs, setDownloadLogs] = useState<string[]>([]);

  async function loadMetadata(playlistOverride = playlist) {
    setError(null);
    setIsMetadataLoading(true);
    try {
      const response = await fetch(`${apiUrl()}/api/metadata`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, playlist: playlistOverride }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "No se pudieron consultar los metadatos.");
      setMetadata(data as MetadataResponse);
    } catch (caughtError) { setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar la preview."); }
    finally { setIsMetadataLoading(false); }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setIsLoading(true); setError(null); setResult(null); setMetadata(null); setDownload(null); setDownloadLogs([]);
    try {
      const playlistDetected = looksLikePlaylist(url);
      const response = await fetch(`${apiUrl()}/api/analyze`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "No se pudo analizar la URL.");
      const nextResult = data as AnalysisResponse;
      if (nextResult.analysis.videoOnly) setFormat("mp4");
      setPlaylist(playlistDetected);
      setResult(nextResult); await loadMetadata(playlistDetected);
    } catch (caughtError) { setError(caughtError instanceof Error ? caughtError.message : "Se produjo un error inesperado."); }
    finally { setIsLoading(false); }
  }

  async function handleDownload() {
    setIsDownloadLoading(true); setError(null); setDownload(null); setDownloadProgress(null); setDownloadLogs([]);
    try {
      const response = await fetch(`${apiUrl()}/api/download`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, format, quality: format === "mp4" ? videoQuality : audioQuality, playlist, playlistTotal: metadata?.metadata.isPlaylist ? metadata.metadata.playlistCount : null, playlistTitle: metadata?.metadata.isPlaylist ? metadata.metadata.playlistTitle : null }) });
      const data = await response.json() as DownloadJobResponse;
      if (!response.ok) throw new Error((data as unknown as { message?: string }).message ?? "No se pudo iniciar la descarga.");
      let job = data; setDownloadProgress(job.progress); setDownloadLogs(job.logs ?? []);
      while (job.status !== "completed" && job.status !== "failed") {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const progressResponse = await fetch(`${apiUrl()}/api/download/${job.jobId}`, { credentials: "include" });
        job = await progressResponse.json() as DownloadJobResponse;
        if (!progressResponse.ok) throw new Error(job.error?.message ?? "No se pudo consultar el progreso.");
        setDownloadProgress(job.progress); setDownloadLogs(job.logs ?? []);
      }
      if (job.status === "failed" || !job.result) throw new Error(job.error?.message ?? "La descarga ha fallado.");
      setDownload({
        ...job.result,
        files: job.result.files.map((file) => ({ ...file, downloadUrl: `${apiUrl()}${file.downloadUrl}` })),
        archive: job.result.archive
          ? { ...job.result.archive, downloadUrl: `${apiUrl()}${job.result.archive.downloadUrl}` }
          : undefined
      });
    } catch (caughtError) { setError(caughtError instanceof Error ? caughtError.message : "Se produjo un error inesperado."); }
    finally { setIsDownloadLoading(false); }
  }

  const title = metadata?.metadata.playlistTitle ?? metadata?.metadata.title ?? "Contenido multimedia";
  const videoOnly = result?.analysis.videoOnly === true;
  const progress = downloadProgress ?? { percent: 0, speed: null, eta: null, current: null, total: metadata?.metadata.isPlaylist ? metadata.metadata.playlistCount : null, message: playlist ? "Preparando playlist…" : "Preparando descarga…" };
  const playlistCount = metadata?.metadata.isPlaylist ? metadata.metadata.playlistCount : null;
  const playlistEntries = metadata?.metadata.isPlaylist ? metadata.metadata.playlistEntries : [];
  const isPlaylistReady = playlist && metadata?.metadata.isPlaylist === true;
  const completedPlaylistItems = isPlaylistReady
    ? (download?.archive?.count ?? (isDownloadLoading ? Math.max(0, (downloadProgress?.current ?? 1) - 1) : (downloadProgress?.current ?? 0)))
    : 0;

  return <>
    <header className="site-header"><a className="brand" href="/" aria-label="AntiTube, inicio"><AntiTubeLogo /></a><nav className="site-nav" aria-label="Navegación principal"><a className="site-nav-link active" href="/">Descargar</a><a className="site-nav-link" href="/shazam/">SHAZAM</a><LogoutButton /></nav></header>
    <main className="shell">
      <form className="link-form" onSubmit={handleSubmit}><span className="link-symbol">↗</span><label className="sr-only" htmlFor="media-url">Enlace del vídeo o audio</label><input id="media-url" type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Pega aquí el enlace de tu vídeo o audio…" /><button disabled={isLoading}>{isLoading ? "Analizando…" : "Analizar enlace"}</button></form>
      <div className="form-note"><span>Conexión local. No se descarga nada al analizar.</span></div>
      <details className="platform-strip"><summary className="platform-strip-heading"><span className="platform-summary-title"><span className="platform-summary-mark" aria-hidden="true">+</span><strong>Plataformas compatibles</strong></span><span className="platform-summary-hint">Ver sitios admitidos</span></summary><div className="platform-list">{supportedPlatforms.map((platform) => <div className="platform-item" key={platform.name}><span className="platform-mark" aria-hidden="true">{platform.mark}</span><span className="platform-copy"><strong>{platform.name}</strong><small>{platform.detail}</small></span></div>)}</div></details>
      {error && <div className="notice error">ⓘ <span>{error}</span></div>}
      {result && <section className="download-card" aria-label="Vista previa y opciones de descarga">
        <div className="media-panel">
          <div className={`cover${metadata?.metadata.isPlaylist ? " playlist-cover" : ""}`} style={!metadata?.metadata.isPlaylist && metadata?.metadata.thumbnailUrl ? { backgroundImage: `url("${metadata.metadata.thumbnailUrl}")` } : undefined}><div className="cover-shade" /><span className="cover-tag">{metadata?.analysis.platform ?? result.analysis.platform}</span>{metadata?.metadata.isPlaylist && <div className="playlist-cover-placeholder"><span className="playlist-cover-glyph">▤</span><strong>Playlist detectada</strong><span>{playlistCount ?? "Varios"} canciones listas para revisar.</span></div>}</div>
          <div className="media-copy"><div className="author"><span className="avatar">{(metadata?.metadata.uploader ?? "A").slice(0, 1).toUpperCase()}</span>{metadata?.metadata.uploader ?? "Autor desconocido"}<span>/</span> Contenido original</div><h2>{title}</h2><p>{metadata?.metadata.isPlaylist ? `${metadata.metadata.playlistCount ?? "Varios"} elementos listos para descargar.` : "Comprueba la información antes de elegir el formato de salida."}</p>{metadata?.metadata.isPlaylist && <p className="playlist-count">Playlist detectada: <strong>{playlistCount ?? "calculando"}</strong> elementos.</p>}<div className="meta-row"><span>{metadata?.metadata.durationSeconds ? `${metadata.metadata.durationSeconds} segundos` : "Duración no disponible"}</span><span>{format === "mp4" ? "Vídeo con audio" : "Solo audio"}</span></div><a className="source-link" href={metadata?.metadata.sourceUrl ?? result.analysis.url} target="_blank" rel="noreferrer">Abrir contenido original</a></div>
          {metadata?.metadata.isPlaylist && <section className="playlist-browser" aria-label="Canciones de la playlist"><div className="playlist-browser-heading"><h3>Contenido de la playlist</h3><span>{playlistCount ?? playlistEntries.length} elementos</span></div>{playlistEntries.length > 0 ? <div className="playlist-list">{playlistEntries.map((entry) => { const itemDownloaded = entry.index <= completedPlaylistItems; return <div className={`playlist-item${itemDownloaded ? " is-downloaded" : ""}`} key={`${entry.index}-${entry.id ?? entry.title}`}><span className="playlist-item-index">{String(entry.index).padStart(2, "0")}</span><div className="playlist-item-copy"><strong>{entry.title}</strong><span>{formatDuration(entry.durationSeconds)}</span></div>{entry.sourceUrl && <a href={entry.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Abrir ${entry.title}`}>↗</a>}<span className="playlist-item-status" aria-label={itemDownloaded ? "Descargada" : "Pendiente"}>{itemDownloaded ? "✓" : ""}</span></div>; })}</div> : <p className="playlist-empty">La plataforma ha indicado el número de elementos, pero no ha devuelto sus títulos.</p>}</section>}
        </div>
        <div className="options-panel"><div className="options-heading"><h3>Opciones de salida</h3><span>02 / Configuración</span></div><p className="options-sub">Selecciona formato, calidad y alcance.</p><div className="tabs"><button type="button" className={format === "mp4" ? "active" : ""} onClick={() => { setFormat("mp4"); setDownload(null); }}>▣ Vídeo</button>{!videoOnly && <button type="button" className={format === "mp3" ? "active" : ""} onClick={() => { setFormat("mp3"); setDownload(null); }}>♫ Solo audio</button>}</div>{videoOnly && <p className="format-note">{result.analysis.platform} se descarga solo como vídeo MP4.</p>}<div className="format-label"><label htmlFor="quality">Formato y calidad</label><span>Seleccionar</span></div><div className="select-wrap"><select id="quality" value={format === "mp4" ? videoQuality : audioQuality} onChange={(event) => format === "mp4" ? setVideoQuality(event.target.value as VideoQuality) : setAudioQuality(event.target.value as AudioQuality)}>{format === "mp4" ? <><option value="best">MP4: Mejor disponible</option><option value="1080">MP4: Hasta 1080p</option><option value="720">MP4: Hasta 720p</option><option value="480">MP4: Hasta 480p</option><option value="360">MP4: Hasta 360p</option></> : <><option value="320">MP3: 320 kbps</option><option value="256">MP3: 256 kbps</option><option value="192">MP3: 192 kbps</option><option value="128">MP3: 128 kbps</option></>}</select></div><div className="playlist-toggle"><input id="playlist" type="checkbox" checked={playlist} onChange={(event) => { const nextPlaylist = event.target.checked; setPlaylist(nextPlaylist); if (result) void loadMetadata(nextPlaylist); }} /><label htmlFor="playlist">Playlist completa <small>(máximo 50 elementos)</small></label></div><div className="file-summary"><span className="file-icon">{isPlaylistReady ? "▤" : format === "mp4" ? "▣" : "♫"}<small>{isPlaylistReady ? "ZIP" : format.toUpperCase()}</small></span><div><strong>{isPlaylistReady ? `${title}.zip` : `${title}.${format}`}</strong><span>{isPlaylistReady ? `Playlist de ${playlistCount ?? "varios"} canciones` : `${format === "mp4" ? videoQuality === "best" ? "Mejor disponible" : `Hasta ${videoQuality}p` : `${audioQuality} kbps`} / 1 archivo`}</span></div></div><button className="download-button" type="button" disabled={isDownloadLoading || isMetadataLoading || (playlist && !isPlaylistReady)} onClick={handleDownload}>↓ {isDownloadLoading ? "Preparando…" : isPlaylistReady ? "Descargar playlist ZIP" : `Descargar ${format.toUpperCase()}`}<span>{isPlaylistReady ? `${playlistCount ?? 50} elementos` : ""}</span></button>
          {isDownloadLoading && <div className="progress-box"><div className="progress-top"><strong>{progress.message}</strong><b>{Math.round(progress.percent)}%</b></div><div className="progress-track"><div style={{ width: `${progress.percent}%` }} /></div><p>{progress.current && progress.total ? `Elemento ${progress.current} de ${progress.total}` : progress.total ? `Playlist de ${progress.total} elementos` : progress.speed ? `Velocidad: ${progress.speed}` : "Preparando archivos…"}{progress.eta ? ` / ETA: ${progress.eta}` : ""}</p></div>}
          {downloadLogs.length > 0 && (isDownloadLoading || error || download) && <details className="backend-log" open={Boolean(error)}><summary>Actividad del backend</summary><div>{downloadLogs.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</div></details>}
          {download && <div className="download-result"><strong>{download.message}</strong>{isDesktop ? <>{download.archive ? <button type="button" className="download-all-link" onClick={() => void revealDownload(download.archive?.filename)}>Mostrar {download.archive.filename} en la carpeta</button> : download.files.map((file) => <button type="button" key={file.downloadUrl} onClick={() => void revealDownload(file.filename)}>Mostrar {file.filename} en la carpeta</button>)}</> : download.archive ? <a className="download-all-link" href={download.archive.downloadUrl} download>↓ Descargar {download.archive.count} canciones</a> : download.files.map((file) => <a key={file.downloadUrl} href={file.downloadUrl} download>Guardar {file.filename} ↓</a>)}</div>}
        </div>
      </section>}
      {!result && <div className="empty-state">Pega un enlace arriba para ver su preview, elegir calidad y preparar la descarga.</div>}
    </main>
  </>;
}
