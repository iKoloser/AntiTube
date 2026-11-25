"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatTime } from "./player/types";
import { api, apiUrl } from "./runtime";
import { IconPause, IconPlay, IconScissors } from "./shell/icons";

export type Section = { start: number; end: number };

function parseTime(value: string): number | null {
  const parts = value.trim().replace(",", ".").split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function preciseTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = (seconds - minutes * 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${rest}`;
}

function TimeField({ label, value, onCommit }: Readonly<{ label: string; value: number; onCommit: (seconds: number) => void }>) {
  const [draft, setDraft] = useState(preciseTime(value));
  useEffect(() => setDraft(preciseTime(value)), [value]);
  return <label className="trim-field"><span>{label}</span><input type="text" inputMode="decimal" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => { const parsed = parseTime(draft); if (parsed === null) setDraft(preciseTime(value)); else onCommit(parsed); }} onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }} /></label>;
}

/**
 * Elige el trozo exacto que se va a descargar. Carga una vista previa ligera
 * (vídeo si es posible, si no audio) y permite marcar inicio y fin arrastrando,
 * con los botones o escribiendo los tiempos.
 */
export default function Trimmer({ url, preferVideo, knownDuration, thumbnailUrl, value, onChange, onDuration }: Readonly<{ url: string; preferVideo: boolean; knownDuration: number | null; thumbnailUrl: string | null; value: Section | null; onChange: (section: Section | null) => void; onDuration?: (seconds: number) => void }>) {
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<{ src: string; hasVideo: boolean } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [duration, setDuration] = useState(knownDuration ?? 0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loopSelection, setLoopSelection] = useState(false);
  const section = value ?? { start: 0, end: duration };
  const sectionRef = useRef(section);
  sectionRef.current = section;

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setPreview(null);
    api<{ streamUrl: string; hasVideo: boolean; durationSeconds: number | null }>("/api/preview", { body: { url, kind: preferVideo ? "video" : "audio" } })
      .then((data) => {
        if (cancelled) return;
        setPreview({ src: `${apiUrl()}${data.streamUrl}`, hasVideo: data.hasVideo });
        if (data.durationSeconds) setDuration(data.durationSeconds);
        setStatus("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus("unavailable");
        setMessage(error instanceof Error ? error.message : "Sin vista previa.");
      });
    return () => { cancelled = true; };
  }, [url, preferVideo]);

  useEffect(() => { if (duration > 0) onDuration?.(duration); }, [duration, onDuration]);

  // Valor inicial: todo el contenido (sin recorte real hasta que se mueva algo).
  useEffect(() => {
    if (!value && duration > 0) onChange({ start: 0, end: duration });
  }, [duration, value, onChange]);

  const update = useCallback((patch: Partial<Section>) => {
    const current = sectionRef.current;
    let start = Math.max(0, Math.min(patch.start ?? current.start, duration || Infinity));
    let end = Math.max(0, Math.min(patch.end ?? current.end, duration || Infinity));
    if (end - start < 0.5) {
      if (patch.start !== undefined) start = Math.max(0, end - 0.5);
      else end = Math.min(duration || end + 0.5, start + 0.5);
    }
    onChange({ start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10 });
  }, [duration, onChange]);

  useEffect(() => {
    const element = mediaRef.current;
    if (!element) return;
    const onTime = () => {
      setTime(element.currentTime);
      // Al escuchar la selección, se para (o vuelve a empezar) al llegar al final.
      if (loopSelection && element.currentTime >= sectionRef.current.end) {
        element.currentTime = sectionRef.current.start;
      }
    };
    const onMeta = () => { if (Number.isFinite(element.duration) && element.duration > 0) setDuration(element.duration); };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    element.addEventListener("timeupdate", onTime);
    element.addEventListener("loadedmetadata", onMeta);
    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onPause);
    return () => {
      element.removeEventListener("timeupdate", onTime);
      element.removeEventListener("loadedmetadata", onMeta);
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
    };
  }, [preview, loopSelection]);

  function positionFromEvent(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration;
  }

  function dragHandle(event: React.PointerEvent, which: "start" | "end" | "range") {
    event.preventDefault();
    event.stopPropagation();
    const origin = positionFromEvent(event.clientX);
    const initial = { ...sectionRef.current };
    const move = (moveEvent: PointerEvent) => {
      const at = positionFromEvent(moveEvent.clientX);
      if (which === "start") update({ start: at });
      else if (which === "end") update({ end: at });
      else {
        const length = initial.end - initial.start;
        const start = Math.max(0, Math.min(duration - length, initial.start + (at - origin)));
        onChange({ start: Math.round(start * 10) / 10, end: Math.round((start + length) * 10) / 10 });
      }
      if (mediaRef.current && which !== "range") mediaRef.current.currentTime = at;
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function playSelection() {
    const element = mediaRef.current;
    if (!element) return;
    setLoopSelection(true);
    element.currentTime = section.start;
    void element.play();
  }

  const percent = (seconds: number) => (duration > 0 ? (seconds / duration) * 100 : 0);
  const length = Math.max(0, section.end - section.start);
  const isFull = duration > 0 && section.start <= 0.05 && section.end >= duration - 0.15;

  return <div className="trimmer">
    <div className="trim-head"><span className="trim-title"><IconScissors size={16} /> Recortar fragmento</span><span className="trim-length">{isFull ? "Contenido completo" : `Selección: ${formatTime(length)} (${preciseTime(section.start)} → ${preciseTime(section.end)})`}</span></div>
    <div className={`trim-stage${preview?.hasVideo ? " has-video" : ""}`} style={!preview?.hasVideo && thumbnailUrl ? { backgroundImage: `url("${thumbnailUrl}")` } : undefined}>
      {status === "loading" && <div className="trim-status"><span className="spinner" /> Preparando vista previa…</div>}
      {status === "unavailable" && <div className="trim-status">{message} Escribe los tiempos abajo.</div>}
      {preview && <video ref={mediaRef} src={preview.src} preload="metadata" playsInline crossOrigin="use-credentials" className={preview.hasVideo ? "" : "is-audio"} onClick={() => { const element = mediaRef.current; if (!element) return; if (element.paused) void element.play(); else element.pause(); }} />}
      {preview && !preview.hasVideo && <div className="trim-audio-badge">♫ Vista previa de audio</div>}
    </div>
    <div className="trim-timeline" ref={trackRef} onPointerDown={(event) => { if (mediaRef.current) mediaRef.current.currentTime = positionFromEvent(event.clientX); }}>
      <div className="trim-ticks">{Array.from({ length: 11 }, (_, index) => <span key={index} style={{ left: `${index * 10}%` }}><em>{duration ? formatTime((duration * index) / 10) : ""}</em></span>)}</div>
      <div className="trim-dim" style={{ left: 0, width: `${percent(section.start)}%` }} />
      <div className="trim-dim" style={{ left: `${percent(section.end)}%`, right: 0 }} />
      <div className="trim-range" style={{ left: `${percent(section.start)}%`, width: `${percent(length)}%` }} onPointerDown={(event) => dragHandle(event, "range")} />
      <button type="button" className="trim-handle is-start" style={{ left: `${percent(section.start)}%` }} onPointerDown={(event) => dragHandle(event, "start")} aria-label="Inicio del recorte" />
      <button type="button" className="trim-handle is-end" style={{ left: `${percent(section.end)}%` }} onPointerDown={(event) => dragHandle(event, "end")} aria-label="Fin del recorte" />
      {preview && <div className="trim-playhead" style={{ left: `${percent(time)}%` }} />}
    </div>
    <div className="trim-controls">
      <button type="button" className="icon-button is-solid" disabled={!preview} onClick={() => { setLoopSelection(false); const element = mediaRef.current; if (!element) return; if (element.paused) void element.play(); else element.pause(); }} aria-label={playing ? "Pausar" : "Reproducir"}>{playing ? <IconPause size={16} /> : <IconPlay size={16} />}</button>
      <span className="trim-clock">{preciseTime(time)} / {formatTime(duration)}</span>
      <button type="button" className="chip-button" disabled={!preview} onClick={() => update({ start: time })}>[ Inicio aquí</button>
      <button type="button" className="chip-button" disabled={!preview} onClick={() => update({ end: time })}>Fin aquí ]</button>
      <button type="button" className="chip-button is-accent" disabled={!preview} onClick={playSelection}>▶ Escuchar selección</button>
      <TimeField label="Inicio" value={section.start} onCommit={(seconds) => update({ start: seconds })} />
      <TimeField label="Fin" value={section.end} onCommit={(seconds) => update({ end: seconds })} />
      {!isFull && <button type="button" className="chip-button" onClick={() => onChange({ start: 0, end: duration })}>Restablecer</button>}
    </div>
  </div>;
}
