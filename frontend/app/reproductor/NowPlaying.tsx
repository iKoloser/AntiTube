"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { eqBands, eqPresets, usePlayer } from "../player/PlayerContext";
import { Cover, SeekBar } from "../player/PlayerDock";
import { absolute, formatTime, hue } from "../player/types";
import Visualizer from "../player/Visualizer";
import { setWindowFullscreen } from "../runtime";
import { IconCinema, IconClose, IconEq, IconFullscreen, IconFullscreenExit, IconMute, IconNext, IconPause, IconPip, IconPlay, IconPrevious, IconRepeat, IconShuffle, IconTimer, IconVolume } from "../shell/icons";

type Mode = "radial" | "bars" | "wave";

function Equalizer({ onClose }: Readonly<{ onClose: () => void }>) {
  const player = usePlayer();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const { eq, eqEnabled, preamp } = player.settings;
  const preset = Object.entries(eqPresets).find(([, gains]) => gains.every((gain, band) => gain === eq[band]))?.[0] ?? "Personalizado";
  return <div className="eq-overlay" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
  <div className="equalizer" role="dialog" aria-label="Ecualizador">
    <div className="equalizer-head">
      <label className="switch"><input type="checkbox" checked={eqEnabled} onChange={(event) => player.setEqEnabled(event.target.checked)} /><span />Ecualizador</label>
      <div className="equalizer-head-actions"><div className="select-wrap is-small"><select value={preset} onChange={(event) => { const gains = eqPresets[event.target.value]; if (gains) player.setEq(gains); }} aria-label="Preajuste">{preset === "Personalizado" && <option>Personalizado</option>}{Object.keys(eqPresets).map((name) => <option key={name}>{name}</option>)}</select></div>
      <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar ecualizador"><IconClose size={16} /></button></div>
    </div>
    <div className={`equalizer-bands${eqEnabled ? "" : " is-off"}`}>
      <label className="eq-band is-preamp"><span className="eq-value">{preamp > 0 ? "+" : ""}{preamp}</span><input type="range" min={-12} max={12} step={1} value={preamp} onChange={(event) => player.setPreamp(Number(event.target.value))} aria-label="Preamplificador" /><span className="eq-label">PRE</span></label>
      {eqBands.map((frequency, band) => <label key={frequency} className="eq-band"><span className="eq-value">{eq[band] > 0 ? "+" : ""}{eq[band]}</span><input type="range" min={-12} max={12} step={1} value={eq[band]} onChange={(event) => { const next = [...eq]; next[band] = Number(event.target.value); player.setEq(next); }} aria-label={`${frequency} Hz`} /><span className="eq-label">{frequency >= 1000 ? `${frequency / 1000}k` : frequency}</span></label>)}
    </div>
    <p className="equalizer-hint">Ajusta cada banda entre −12 y +12 dB. PRE sube o baja el volumen antes del ecualizador para evitar saturación.</p>
  </div>
  </div>;
}

/** Pantalla de vídeo: el elemento del reproductor se muestra aquí mientras está montada. */
function VideoStage({ cinema, onCinema }: Readonly<{ cinema: boolean; onCinema: () => void }>) {
  const player = usePlayer();
  const { dockVideo, media, toggle, seek } = player;
  const shellRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fit, setFit] = useState<"contain" | "cover">("contain");
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    dockVideo(frameRef.current);
    return () => dockVideo(null);
  }, [dockVideo]);

  useEffect(() => { if (media) media.style.objectFit = fit; }, [media, fit]);

  const toggleFullscreen = useCallback(async () => {
    const shell = shellRef.current;
    if (!shell) return;
    if (fullscreen) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      setFullscreen(false);
      void setWindowFullscreen(false);
      return;
    }
    setFullscreen(true);
    void setWindowFullscreen(true);
    await shell.requestFullscreen?.().catch(() => undefined);
  }, [fullscreen]);

  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && fullscreen) { setFullscreen(false); void setWindowFullscreen(false); }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [fullscreen]);

  // Atajos: espacio/K pausa, F pantalla completa, flechas ±5 s, Esc sale.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable]") || event.ctrlKey || event.metaKey || event.altKey)) return;
      if (event.key === " " && target?.closest("button, a, [role=button]")) return;
      if (event.key === " " || event.key.toLowerCase() === "k") { event.preventDefault(); toggle(); }
      else if (event.key.toLowerCase() === "f") { event.preventDefault(); void toggleFullscreen(); }
      else if (event.key === "ArrowRight") { event.preventDefault(); seek((media?.currentTime ?? 0) + 5); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); seek((media?.currentTime ?? 0) - 5); }
      else if (event.key === "Escape" && fullscreen) { void toggleFullscreen(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, toggleFullscreen, seek, media, fullscreen]);

  useEffect(() => () => { if (idleTimer.current) clearTimeout(idleTimer.current); void setWindowFullscreen(false); }, []);

  function wake() {
    setIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 2500);
  }

  const canPip = typeof document !== "undefined" && "pictureInPictureEnabled" in document && document.pictureInPictureEnabled;

  return <div ref={shellRef} className={`np-video-shell${fullscreen ? " is-fullscreen" : ""}${idle && player.playing ? " is-idle" : ""}`} onPointerMove={wake} onPointerLeave={() => setIdle(true)}>
    <div ref={frameRef} className="np-video" onClick={toggle} onDoubleClick={() => void toggleFullscreen()} />
    {player.loading && <div className="np-video-status"><span className="spinner" /></div>}
    {!player.playing && !player.loading && <button type="button" className="np-video-bigplay" onClick={toggle} aria-label="Reproducir"><IconPlay size={34} /></button>}
    <div className="np-video-bar">
      <button type="button" className="icon-button" onClick={toggle} aria-label={player.playing ? "Pausar" : "Reproducir"}>{player.playing ? <IconPause size={18} /> : <IconPlay size={18} />}</button>
      {fullscreen && <>
        <button type="button" className="icon-button" onClick={player.previous} aria-label="Anterior"><IconPrevious size={16} /></button>
        <button type="button" className="icon-button" onClick={player.next} aria-label="Siguiente"><IconNext size={16} /></button>
        <span className="np-video-time">{formatTime(player.time)}</span>
        <SeekBar time={player.time} duration={player.duration} buffered={player.buffered} onSeek={player.seek} className="np-video-seek" />
        <span className="np-video-time">{formatTime(player.duration)}</span>
        <button type="button" className="icon-button" onClick={player.toggleMute} aria-label="Silenciar">{player.settings.muted || player.settings.volume === 0 ? <IconMute size={17} /> : <IconVolume size={17} />}</button>
        <input type="range" className="volume-range np-video-volume" min={0} max={1} step={0.01} value={player.settings.muted ? 0 : player.settings.volume} onChange={(event) => player.setVolume(Number(event.target.value))} aria-label="Volumen" style={{ ["--level" as string]: `${(player.settings.muted ? 0 : player.settings.volume) * 100}%` }} />
      </>}
      <span className="np-video-spacer" />
      <button type="button" className="chip-button is-small" onClick={() => setFit((value) => (value === "contain" ? "cover" : "contain"))} title={fit === "contain" ? "Rellenar la pantalla (recorta los bordes)" : "Ver el vídeo entero"}>{fit === "contain" ? "Ajustar" : "Rellenar"}</button>
      {canPip && <button type="button" className="icon-button" onClick={() => { if (document.pictureInPictureElement) void document.exitPictureInPicture(); else void media?.requestPictureInPicture().catch(() => undefined); }} aria-label="Ventana flotante" title="Ventana flotante (imagen en imagen)"><IconPip size={17} /></button>}
      {!fullscreen && <button type="button" className={`icon-button${cinema ? " is-on" : ""}`} onClick={onCinema} aria-label="Modo cine" title="Modo cine: vídeo grande"><IconCinema size={17} /></button>}
      <button type="button" className="icon-button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "Salir de pantalla completa" : "Pantalla completa"} title={fullscreen ? "Salir (Esc)" : "Pantalla completa (F)"}>{fullscreen ? <IconFullscreenExit size={17} /> : <IconFullscreen size={17} />}</button>
    </div>
  </div>;
}

/** Panel grande de lo que suena: portada con visualizador, controles completos, ecualizador. */
export default function NowPlaying({ cinema = false, onCinema }: Readonly<{ cinema?: boolean; onCinema?: () => void }>) {
  const player = usePlayer();
  const { current, playing, settings } = player;
  const [mode, setMode] = useState<Mode>("radial");
  const [showEq, setShowEq] = useState(false);
  const [now, setNow] = useState(Date.now());
  const tone = current ? 185 + (hue(current.title) % 70) : 205;
  const isVideo = current?.kind === "video";
  const closeEq = useCallback(() => setShowEq(false), []);

  useEffect(() => {
    const saved = localStorage.getItem("antitube-visualizer") as Mode | null;
    if (saved) setMode(saved);
  }, []);

  useEffect(() => {
    if (!player.sleepAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [player.sleepAt]);

  const cycleMode = () => {
    const next: Mode = mode === "radial" ? "bars" : mode === "bars" ? "wave" : "radial";
    setMode(next);
    localStorage.setItem("antitube-visualizer", next);
  };

  return <section className={`now-playing${isVideo ? " is-video" : ""}${isVideo && cinema ? " is-cinema" : ""}`} style={{ ["--np-hue" as string]: tone }} aria-label="Ahora suena">
    {current?.cover && !isVideo && <div className="np-backdrop" style={{ backgroundImage: `url("${absolute(current.cover)}")` }} />}
    {isVideo
      ? <VideoStage cinema={cinema} onCinema={() => onCinema?.()} />
      : <div className="np-stage" onClick={cycleMode} title="Cambiar visualizador">
        <Visualizer analyser={player.analyser} playing={playing} variant={mode} className={`np-visualizer is-${mode}`} hue={tone} />
        <div className={`np-cover-wrap is-${mode}${playing ? " is-playing" : ""}`}><Cover src={current?.cover ?? null} title={current?.title ?? "AntiTube"} className="np-cover" /></div>
      </div>}
    <div className="np-meta">
      <span className="np-kicker">{playing ? "// reproduciendo" : current ? "// en pausa" : "// sin reproducir"}</span>
      <h2 title={current?.title}>{current?.title ?? "Elige algo que escuchar"}</h2>
      <p>{current ? [current.artist ?? "Artista desconocido", current.album].filter(Boolean).join(" · ") : "Haz doble clic en una canción, o arrástrala a la cola."}</p>
      {current && <div className="np-chips">{current.format && <em className={`format-chip${current.lossless ? " is-lossless" : ""}`}>{current.format}</em>}{current.lossless && <em className="format-chip is-lossless">SIN PÉRDIDA</em>}{current.needsTranscode && <em className="format-chip" title="El motor lo descodifica a FLAC sin pérdida para poder reproducirlo">DESCODIFICADO</em>}{isVideo && <em className="format-chip is-video">VÍDEO</em>}{current.id.startsWith("stream:") && <em className="format-chip is-stream">STREAMING</em>}</div>}
    </div>
    <div className="np-seek">
      <SeekBar time={player.time} duration={player.duration} buffered={player.buffered} onSeek={player.seek} className="is-large" />
      <div className="np-times"><span>{formatTime(player.time)}</span><span>-{formatTime(Math.max(0, (player.duration || 0) - player.time))}</span></div>
    </div>
    <div className="np-controls">
      <button type="button" className={`icon-button${settings.shuffle ? " is-on" : ""}`} onClick={player.toggleShuffle} aria-label="Aleatorio" title="Aleatorio"><IconShuffle size={19} /></button>
      <button type="button" className="icon-button is-large" onClick={player.previous} disabled={!current} aria-label="Anterior"><IconPrevious size={22} /></button>
      <button type="button" className="play-button is-large" onClick={player.toggle} disabled={!current} aria-label={playing ? "Pausar" : "Reproducir"}>{playing ? <IconPause size={26} /> : <IconPlay size={26} />}</button>
      <button type="button" className="icon-button is-large" onClick={player.next} disabled={!current} aria-label="Siguiente"><IconNext size={22} /></button>
      <button type="button" className={`icon-button${settings.repeat !== "off" ? " is-on" : ""}`} onClick={player.cycleRepeat} aria-label="Repetir" title={settings.repeat === "one" ? "Repetir una" : settings.repeat === "all" ? "Repetir todo" : "Sin repetir"}><IconRepeat size={19} />{settings.repeat === "one" && <span className="repeat-one">1</span>}</button>
    </div>
    <div className="np-tools">
      <div className="dock-volume is-wide">
        <button type="button" className="icon-button" onClick={player.toggleMute} aria-label="Silenciar">{settings.muted || settings.volume === 0 ? <IconMute size={18} /> : <IconVolume size={18} />}</button>
        <input type="range" className="volume-range" min={0} max={1} step={0.01} value={settings.muted ? 0 : settings.volume} onChange={(event) => player.setVolume(Number(event.target.value))} aria-label="Volumen" style={{ ["--level" as string]: `${(settings.muted ? 0 : settings.volume) * 100}%` }} />
        <span className="np-volume-value">{Math.round((settings.muted ? 0 : settings.volume) * 100)}</span>
      </div>
      <div className="np-tool-row">
        <label className="mini-select" title="Velocidad"><span>×</span><select value={settings.rate} onChange={(event) => player.setRate(Number(event.target.value))} aria-label="Velocidad">{[0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}</option>)}</select></label>
        <label className={`mini-select${player.sleepAt ? " is-on" : ""}`} title="Temporizador para dormir"><IconTimer size={15} /><select value="" onChange={(event) => player.setSleep(event.target.value === "off" ? null : Number(event.target.value))} aria-label="Temporizador"><option value="" disabled>{player.sleepAt ? `${Math.max(0, Math.ceil((player.sleepAt - now) / 60000))} min` : "Dormir"}</option><option value="15">15 min</option><option value="30">30 min</option><option value="45">45 min</option><option value="60">1 hora</option><option value="90">1 h 30</option>{player.sleepAt && <option value="off">Cancelar</option>}</select></label>
        <button type="button" className={`chip-button${showEq || settings.eqEnabled ? " is-accent" : ""}`} onClick={() => setShowEq((value) => !value)}><IconEq size={15} /> EQ</button>
        {!isVideo && <button type="button" className="chip-button" onClick={cycleMode} title="Cambiar visualizador">{mode === "radial" ? "◎" : mode === "bars" ? "▮▮▮" : "∿"}</button>}
      </div>
    </div>
    {showEq && createPortal(<Equalizer onClose={closeEq} />, document.body)}
  </section>;
}
