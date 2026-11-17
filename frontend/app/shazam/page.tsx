"use client";

import { useEffect, useRef, useState } from "react";
import AntiTubeLogo from "../AntiTubeLogo";

type Recognition = {
  matched: boolean;
  title?: string;
  artist?: string;
  artworkUrl?: string | null;
  shazamUrl?: string | null;
  youtubeUrl?: string;
  soundcloudUrl?: string;
  spotifyUrl?: string;
};

type RecognitionResponse = { message: string; recognition: Recognition };
type DownloadProvider = "youtube" | "soundcloud";
type DownloadJobResponse = {
  jobId: string;
  status: "queued" | "downloading" | "completed" | "failed";
  progress: { percent: number; message: string };
  logs: string[];
  result?: { files: Array<{ filename: string; downloadUrl: string }> };
  error?: { message: string };
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const captureSeconds = 12;

function blobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo preparar el audio."));
    reader.onloadend = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

async function waitForAudioTracks(stream: MediaStream, timeoutMs = 2_000): Promise<MediaStreamTrack[]> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const tracks = stream.getAudioTracks();
    if (tracks.length > 0) return tracks;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return stream.getAudioTracks();
}

export default function ShazamPage() {
  const [isRecording, setIsRecording] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [recognition, setRecognition] = useState<Recognition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadProvider, setDownloadProvider] = useState<DownloadProvider | null>(null);
  const [downloadedFile, setDownloadedFile] = useState<{ filename: string; downloadUrl: string } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimers() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    timerRef.current = null;
    stopTimerRef.current = null;
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  async function downloadRecognized(provider: DownloadProvider) {
    if (!recognition?.matched || !recognition.title || !recognition.artist || downloadProvider) return;
    setError(null);
    setDownloadedFile(null);
    setDownloadProvider(provider);
    try {
      const prefix = provider === "youtube" ? "ytsearch1" : "scsearch1";
      const source = `${prefix}:${recognition.artist} - ${recognition.title}`;
      const response = await fetch(`${apiUrl}/api/download`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: source, format: "mp3", quality: "192", playlist: false })
      });
      let job = await response.json() as DownloadJobResponse & { message?: string };
      if (!response.ok) throw new Error(job.message ?? "No se pudo iniciar la descarga.");
      while (job.status !== "completed" && job.status !== "failed") {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const progressResponse = await fetch(`${apiUrl}/api/download/${job.jobId}`, { credentials: "include" });
        job = await progressResponse.json() as DownloadJobResponse;
        if (!progressResponse.ok) throw new Error(job.error?.message ?? "No se pudo consultar el progreso.");
      }
      if (job.status === "failed" || !job.result?.files[0]) throw new Error(job.error?.message ?? "La descarga ha fallado.");
      const file = job.result.files[0];
      setDownloadedFile({ ...file, downloadUrl: `${apiUrl}${file.downloadUrl}` });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo descargar la canción.");
    } finally {
      setDownloadProvider(null);
    }
  }

  async function startRecording() {
    setError(null);
    setRecognition(null);
    setDownloadedFile(null);
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Este navegador no permite capturar el audio de una pestaña.");
      // Estas opciones son pistas para Chrome/Edge. No fuerzan al navegador a
      // entregar audio, pero hacen más probable que se muestre la opción de
      // compartir una pestaña con su audio en vez de solo una ventana.
      const displayMediaOptions = {
        video: { displaySurface: "browser" },
        audio: { suppressLocalAudioPlayback: false },
        systemAudio: "include",
        windowAudio: "system",
        preferCurrentTab: false,
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        monitorTypeSurfaces: "include",
      } as unknown as DisplayMediaStreamOptions;
      const displayStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

      // En algunos equipos la pista se añade justo después de resolver la
      // promesa de getDisplayMedia. Esperamos brevemente antes de diagnosticarla.
      const audioTracks = await waitForAudioTracks(displayStream);
      if (audioTracks.length === 0) {
        const displaySurface = displayStream.getVideoTracks()[0]?.getSettings().displaySurface;
        displayStream.getTracks().forEach((track) => track.stop());
        const surfaceHint = displaySurface === "browser" ? "la pestaña" : displaySurface === "window" ? "la ventana" : "la pantalla";
        throw new Error(`El navegador compartió ${surfaceHint}, pero no entregó una pista de audio. Selecciona “Pestaña de Chrome/Edge” (no Ventana ni Pantalla completa), activa “Compartir audio” y pulsa Compartir.`);
      }

      const audioStream = new MediaStream(audioTracks);
      audioTracks.forEach((track) => track.addEventListener("ended", stopRecording));
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        clearTimers();
        audioStream.getTracks().forEach((track) => track.stop());
        setIsRecording(false);
        setIsRecognizing(true);
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
          const audioBase64 = await blobAsBase64(blob);
          const response = await fetch(`${apiUrl}/api/shazam/recognize`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audioBase64, mimeType: blob.type }) });
          const data = await response.json() as RecognitionResponse & { message?: string };
          if (!response.ok) throw new Error(data.message ?? "No se pudo reconocer el audio.");
          setRecognition(data.recognition);
        } catch (caughtError) {
          setError(caughtError instanceof Error ? caughtError.message : "No se pudo reconocer el audio.");
        } finally {
          setIsRecognizing(false);
        }
      };
      recorderRef.current = recorder;
      recorder.start(250);
      // Ya no necesitamos el vídeo de la captura; conservar solo el audio
      // evita que el navegador mantenga una captura visual innecesaria.
      displayStream.getVideoTracks().forEach((track) => track.stop());
      setIsRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((value) => Math.min(captureSeconds, value + 1)), 1000);
      stopTimerRef.current = setTimeout(stopRecording, captureSeconds * 1000);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo iniciar la grabación.");
    }
  }

  useEffect(() => () => { clearTimers(); recorderRef.current?.stream.getTracks().forEach((track) => track.stop()); }, []);

  return <>
    <header className="site-header"><a className="brand" href="/" aria-label="AntiTube, inicio"><AntiTubeLogo /></a><nav className="site-nav" aria-label="Navegación principal"><a className="site-nav-link" href="/">Descargar</a><a className="site-nav-link active" href="/shazam">SHAZAM</a></nav></header>
    <main className="shell shazam-shell">
      <section className="shazam-hero"><p className="shazam-kicker">Identificación de audio</p><h1>SHAZAM</h1><p>Graba hasta {captureSeconds} segundos del audio de una pestaña y encuentra la canción.</p></section>
      <section className="shazam-capture" aria-labelledby="shazam-capture-title"><div className="shazam-capture-copy"><h2 id="shazam-capture-title">Escucha lo que está sonando</h2><p>Al pulsar el botón, comparte la pestaña que reproduce el audio y activa <strong>Compartir audio</strong>. El fragmento se envía a ShazamIO para reconocerlo y se elimina del backend después.</p><div className="shazam-actions"><button className="download-button shazam-record-button" type="button" disabled={isRecognizing} onClick={isRecording ? stopRecording : startRecording}>{isRecording ? `Detener y reconocer · ${seconds}/${captureSeconds}s` : isRecognizing ? "Reconociendo…" : "Grabar audio de la pestaña"}</button>{isRecording && <span className="shazam-live-status" role="status">Grabando ahora</span>}</div></div><div className={`shazam-signal${isRecording ? " is-active" : ""}`} aria-hidden="true"><span /><span /><span /><span /><span /></div></section>
      {error && <div className="notice error" role="alert">ⓘ <span>{error}</span></div>}
      {recognition?.matched && <section className="shazam-result" aria-live="polite"><div className="shazam-result-art" style={recognition.artworkUrl ? { backgroundImage: `url("${recognition.artworkUrl}")` } : undefined}><span>♪</span></div><div className="shazam-result-copy"><p className="shazam-kicker">Canción reconocida</p><h2>{recognition.title}</h2><p>{recognition.artist}</p><div className="shazam-links"><div className="shazam-link-group"><span>Descarga local</span><button type="button" className="shazam-download-link" disabled={downloadProvider !== null} onClick={() => void downloadRecognized("youtube")}>{downloadProvider === "youtube" ? "Buscando en YouTube…" : "↓ Descargar MP3 desde YouTube"}</button><button type="button" className="shazam-download-link" disabled={downloadProvider !== null} onClick={() => void downloadRecognized("soundcloud")}>{downloadProvider === "soundcloud" ? "Buscando en SoundCloud…" : "↓ Descargar MP3 desde SoundCloud"}</button></div><div className="shazam-link-group"><span>Enlaces oficiales</span>{recognition.youtubeUrl && <a href={recognition.youtubeUrl} target="_blank" rel="noreferrer">Abrir YouTube ↗</a>}{recognition.soundcloudUrl && <a href={recognition.soundcloudUrl} target="_blank" rel="noreferrer">Abrir SoundCloud ↗</a>}{recognition.spotifyUrl && <a href={recognition.spotifyUrl} target="_blank" rel="noreferrer">Abrir Spotify ↗</a>}{recognition.shazamUrl && <a className="shazam-secondary-link" href={recognition.shazamUrl} target="_blank" rel="noreferrer">Ver en Shazam ↗</a>}</div></div>{downloadedFile && <div className="shazam-download-result"><strong>Descarga preparada</strong><a href={downloadedFile.downloadUrl} download>Guardar {downloadedFile.filename} ↓</a></div>}</div></section>}
      {recognition && !recognition.matched && <div className="notice" role="status">No se ha encontrado una coincidencia suficientemente clara. Prueba con un fragmento donde la música suene más limpia.</div>}
      {!recognition && !error && <p className="shazam-note">Para obtener audio, usa Chrome o Edge, reproduce la música en otra pestaña y comparte <strong>una pestaña de Chrome/Edge</strong> (no una ventana ni la pantalla completa) con <strong>Compartir audio</strong> activado. AntiTube no conserva el fragmento después del reconocimiento.</p>}
    </main>
  </>;
}
