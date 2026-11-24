"use client";

import { useEffect, useRef, useState } from "react";
import { apiUrl, isDesktop, revealDownload } from "../runtime";

type Provider = "youtube" | "soundcloud";
type VideoQuality = "best" | "1080" | "720" | "480" | "360";
type AudioQuality = "320" | "256" | "192" | "128";

type Preview = {
  provider: Provider;
  metadata: { id: string | null; title: string | null; uploader: string | null; durationSeconds: number | null; thumbnailUrl: string | null; sourceUrl: string };
};

type JobResponse = {
  jobId: string;
  status: "queued" | "downloading" | "completed" | "failed";
  queuePosition?: number | null;
  progress: { percent: number; speed: string | null; eta: string | null; message: string };
  result?: { files: Array<{ filename: string; downloadUrl: string }> };
  error?: { message: string };
  message?: string;
};

const providerName: Record<Provider, string> = { youtube: "YouTube", soundcloud: "SoundCloud" };

function duration(seconds: number | null): string {
  if (!seconds) return "";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function embedUrl(preview: Preview): string | null {
  if (preview.provider === "youtube" && preview.metadata.id) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(preview.metadata.id)}?rel=0`;
  if (preview.provider === "soundcloud") return `https://w.soundcloud.com/player/?url=${encodeURIComponent(preview.metadata.sourceUrl)}&color=%2339a7ff&visual=true&show_comments=false`;
  return null;
}

/**
 * Tras reconocer una canción: busca el primer resultado en YouTube o SoundCloud,
 * muestra la vista previa y permite elegir formato y calidad antes de descargar.
 */
export default function ShazamDownload({ artist, title }: Readonly<{ artist: string; title: string }>) {
  const [provider, setProvider] = useState<Provider>("youtube");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<"mp4" | "mp3">("mp3");
  const [videoQuality, setVideoQuality] = useState<VideoQuality>("720");
  const [audioQuality, setAudioQuality] = useState<AudioQuality>("320");
  const [job, setJob] = useState<JobResponse | null>(null);
  const [showPlayer, setShowPlayer] = useState(false);
  const searchRef = useRef(0);

  useEffect(() => {
    const token = ++searchRef.current;
    setPreview(null);
    setError(null);
    setShowPlayer(false);
    setIsSearching(true);
    if (provider === "soundcloud") setFormat("mp3");
    void (async () => {
      try {
        const response = await fetch(`${apiUrl()}/api/shazam/preview`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, query: `${artist} - ${title}` }) });
        const data = await response.json() as Preview & { message?: string };
        if (token !== searchRef.current) return;
        if (!response.ok) throw new Error(data.message ?? "No se pudo buscar la canción.");
        setPreview(data);
      } catch (caughtError) {
        if (token === searchRef.current) setError(caughtError instanceof Error ? caughtError.message : "No se pudo buscar la canción.");
      } finally {
        if (token === searchRef.current) setIsSearching(false);
      }
    })();
  }, [provider, artist, title]);

  async function startDownload() {
    if (!preview) return;
    setError(null);
    try {
      const response = await fetch(`${apiUrl()}/api/download`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: preview.metadata.sourceUrl, format, quality: format === "mp4" ? videoQuality : audioQuality, playlist: false, title: `${artist} - ${title}` })
      });
      let current = await response.json() as JobResponse;
      if (!response.ok) throw new Error(current.message ?? "No se pudo iniciar la descarga.");
      setJob(current);
      while (current.status !== "completed" && current.status !== "failed") {
        await new Promise((resolve) => setTimeout(resolve, 800));
        const progressResponse = await fetch(`${apiUrl()}/api/download/${current.jobId}`, { credentials: "include" });
        if (!progressResponse.ok) break;
        current = await progressResponse.json() as JobResponse;
        setJob(current);
      }
      if (current.status === "failed") setError(current.error?.message ?? "La descarga ha fallado.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo descargar la canción.");
    }
  }

  const running = job !== null && (job.status === "queued" || job.status === "downloading");
  const file = job?.status === "completed" ? job.result?.files[0] : undefined;
  const embed = preview ? embedUrl(preview) : null;
  const videoAllowed = provider === "youtube";

  return <div className="shazam-get">
    <div className="shazam-get-head">
      <span className="shazam-get-label">Descargar desde</span>
      <div className="tabs shazam-provider-tabs">{(["youtube", "soundcloud"] as const).map((item) => <button key={item} type="button" className={provider === item ? "active" : ""} disabled={running} onClick={() => setProvider(item)}>{providerName[item]}</button>)}</div>
    </div>

    <div className="shazam-preview">
      {isSearching && <div className="shazam-preview-loading"><span className="setup-spinner" />Buscando «{title}» en {providerName[provider]}…</div>}
      {!isSearching && preview && <>
        <div className={`shazam-preview-media${showPlayer && embed ? " is-playing" : ""}`}>
          {showPlayer && embed
            ? <iframe src={embed} title={`Vista previa de ${preview.metadata.title ?? title}`} allow="autoplay; encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
            : <button type="button" className="shazam-preview-thumb" style={preview.metadata.thumbnailUrl ? { backgroundImage: `url("${preview.metadata.thumbnailUrl}")` } : undefined} onClick={() => setShowPlayer(true)} aria-label="Reproducir vista previa"><span className="shazam-preview-play">▶</span>{preview.metadata.durationSeconds ? <span className="shazam-preview-duration">{duration(preview.metadata.durationSeconds)}</span> : null}</button>}
        </div>
        <div className="shazam-preview-copy">
          <strong>{preview.metadata.title ?? title}</strong>
          <span>{preview.metadata.uploader ?? providerName[provider]}</span>
          <a href={preview.metadata.sourceUrl} target="_blank" rel="noreferrer">Abrir en {providerName[provider]} ↗</a>
        </div>
      </>}
      {!isSearching && !preview && error && <p className="shazam-preview-error">{error}</p>}
    </div>

    {preview && <div className="shazam-get-options">
      <div className="tabs">
        <button type="button" className={format === "mp3" ? "active" : ""} disabled={running} onClick={() => setFormat("mp3")}>♫ MP3</button>
        {videoAllowed && <button type="button" className={format === "mp4" ? "active" : ""} disabled={running} onClick={() => setFormat("mp4")}>▣ MP4</button>}
      </div>
      <div className="select-wrap">
        <select aria-label="Calidad" value={format === "mp4" ? videoQuality : audioQuality} disabled={running} onChange={(event) => format === "mp4" ? setVideoQuality(event.target.value as VideoQuality) : setAudioQuality(event.target.value as AudioQuality)}>
          {format === "mp4"
            ? <><option value="best">MP4: Mejor disponible</option><option value="1080">MP4: Hasta 1080p</option><option value="720">MP4: Hasta 720p</option><option value="480">MP4: Hasta 480p</option><option value="360">MP4: Hasta 360p</option></>
            : <><option value="320">MP3: 320 kbps</option><option value="256">MP3: 256 kbps</option><option value="192">MP3: 192 kbps</option><option value="128">MP3: 128 kbps</option></>}
        </select>
      </div>
      <button type="button" className="download-button shazam-get-button" disabled={running} onClick={() => void startDownload()}>{running ? "Descargando…" : `↓ Descargar ${format.toUpperCase()}`}</button>
    </div>}

    {job && running && <div className="progress-box"><div className="progress-top"><strong>{job.progress.message}</strong><b>{Math.round(job.progress.percent)}%</b></div><div className="progress-track"><div style={{ width: `${job.progress.percent}%` }} /></div><p>{job.progress.speed ? `Velocidad: ${job.progress.speed}` : "Preparando…"}{job.progress.eta ? ` / ETA: ${job.progress.eta}` : ""}</p><p className="progress-hint">También puedes seguirla en <a href="/descargas/">Descargas</a>.</p></div>}
    {file && <div className="shazam-download-result"><strong>Descarga preparada</strong>{isDesktop ? <button type="button" onClick={() => void revealDownload(file.filename)}>Mostrar {file.filename} en la carpeta</button> : <a href={`${apiUrl()}${file.downloadUrl}`} download>Guardar {file.filename} ↓</a>}</div>}
    {preview && error && <div className="notice error" role="alert">ⓘ <span>{error}</span></div>}
  </div>;
}
