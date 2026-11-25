"use client";

import { useEffect, useRef, useState } from "react";
import { usePlayer } from "../player/PlayerContext";
import { Cover, SeekBar } from "../player/PlayerDock";
import { absolute, formatTime, hue } from "../player/types";
import Visualizer from "../player/Visualizer";
import { setWindowFullscreen } from "../runtime";
import { IconClose, IconNext, IconPause, IconPlay, IconPrevious } from "./icons";
import { useTheme } from "./theme";

/**
 * Modo inmersivo: lo que suena a pantalla completa, con el visualizador
 * enorme, la portada girando y el título con efecto glitch. Esc para salir.
 */
export default function Immersive() {
  const [open, setOpen] = useState(false);
  const [idle, setIdle] = useState(false);
  const player = usePlayer();
  const { theme } = useTheme();
  const videoRef = useRef<HTMLDivElement | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerRef = useRef(player);
  playerRef.current = player;
  const { current, playing, dockVideo } = player;
  const isVideo = current?.kind === "video";
  const tone = current ? theme.hue - 30 + (hue(current.title) % 60) : theme.hue;

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("antitube-immersive", onOpen);
    return () => window.removeEventListener("antitube-immersive", onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    // Solo depende de `open`: el reproductor cambia cada fracción de segundo
    // y, si estuviera en las dependencias, la ventana entraría y saldría de
    // pantalla completa sin parar (parpadeo de la barra de tareas).
    void setWindowFullscreen(true);
    const onKey = (event: KeyboardEvent) => {
      const live = playerRef.current;
      if (event.key === "Escape") setOpen(false);
      else if (event.key === " ") { event.preventDefault(); live.toggle(); }
      else if (event.key === "ArrowRight") live.seek(live.time + 5);
      else if (event.key === "ArrowLeft") live.seek(live.time - 5);
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); void setWindowFullscreen(false); };
  }, [open]);

  useEffect(() => {
    if (!open || !isVideo) return;
    dockVideo(videoRef.current);
    return () => dockVideo(null);
  }, [open, isVideo, dockVideo]);

  if (!open) return null;

  const wake = () => {
    setIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 3000);
  };

  return <div className={`immersive${idle ? " is-idle" : ""}`} style={{ ["--np-hue" as string]: tone }} onPointerMove={wake} role="dialog" aria-label="Modo inmersivo">
    {current?.cover && !isVideo && <div className="immersive-backdrop" style={{ backgroundImage: `url("${absolute(current.cover)}")` }} />}
    {isVideo
      ? <div ref={videoRef} className="immersive-video" onClick={player.toggle} />
      : <div className="immersive-stage">
          <Visualizer analyser={player.analyser} playing={playing} variant="radial" className="immersive-visualizer" hue={tone} />
          <div className={`immersive-cover${playing ? " is-playing" : ""}`}><Cover src={current?.cover ?? null} title={current?.title ?? "AntiTube"} className="np-cover" /></div>
        </div>}
    {!isVideo && <Visualizer analyser={player.analyser} playing={playing} variant="bars" className="immersive-bars" hue={tone} />}
    <div className="immersive-meta">
      <span className="immersive-kicker">{playing ? "// reproduciendo" : "// en pausa"} · {theme.label.toLowerCase()}</span>
      <h2 className="glitch" data-text={current?.title ?? "Nada sonando"}>{current?.title ?? "Nada sonando"}</h2>
      <p>{current ? [current.artist ?? "Artista desconocido", current.album].filter(Boolean).join(" · ") : "Elige algo en el reproductor"}</p>
    </div>
    <div className="immersive-controls">
      <span className="immersive-time">{formatTime(player.time)}</span>
      <SeekBar time={player.time} duration={player.duration} buffered={player.buffered} onSeek={player.seek} className="is-large immersive-seek" />
      <span className="immersive-time">{formatTime(player.duration)}</span>
      <div className="immersive-buttons">
        <button type="button" className="icon-button is-large" onClick={player.previous} aria-label="Anterior"><IconPrevious size={22} /></button>
        <button type="button" className="play-button is-large" onClick={player.toggle} aria-label={playing ? "Pausar" : "Reproducir"}>{playing ? <IconPause size={26} /> : <IconPlay size={26} />}</button>
        <button type="button" className="icon-button is-large" onClick={player.next} aria-label="Siguiente"><IconNext size={22} /></button>
      </div>
    </div>
    <button type="button" className="immersive-close" onClick={() => setOpen(false)} aria-label="Salir del modo inmersivo" title="Salir (Esc)"><IconClose size={20} /></button>
  </div>;
}
