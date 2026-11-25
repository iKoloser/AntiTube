"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { IconExpand, IconFullscreen, IconMute, IconNext, IconPause, IconPlay, IconPrevious, IconQueue, IconRepeat, IconShuffle, IconVolume } from "../shell/icons";
import { useTheme } from "../shell/theme";
import { useToast } from "../shell/Toasts";
import { useDropHandler } from "./dnd";
import { usePlayer } from "./PlayerContext";
import { addToPlaylist, createPlaylist, updatePlaylist } from "./playlists";
import { absolute, formatTime, hue, toPlayerTrack } from "./types";
import Visualizer from "./Visualizer";

export function Cover({ src, title, className, size }: Readonly<{ src: string | null; title: string; className?: string; size?: number }>) {
  const tone = hue(title);
  return <span className={`cover-art ${className ?? ""}`} style={{ width: size, height: size, ["--cover-hue" as string]: tone }}>
    {src ? <img src={absolute(src) ?? undefined} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
    <span className="cover-art-glyph" aria-hidden="true">{title.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "♫"}</span>
  </span>;
}

export function SeekBar({ time, duration, buffered, onSeek, className }: Readonly<{ time: number; duration: number; buffered: number; onSeek: (value: number) => void; className?: string }>) {
  const total = duration > 0 ? duration : 0;
  const played = total ? (time / total) * 100 : 0;
  const loaded = total ? (buffered / total) * 100 : 0;
  return <div className={`seek ${className ?? ""}`} style={{ ["--played" as string]: `${played}%`, ["--loaded" as string]: `${loaded}%` }}>
    <input type="range" min={0} max={total || 1} step={0.1} value={Math.min(time, total || 1)} onChange={(event) => onSeek(Number(event.target.value))} aria-label="Posición" disabled={!total} />
  </div>;
}

/** Atiende lo que se suelta sobre la cola o las listas, en cualquier página. */
export function PlayerDropHandler() {
  const player = usePlayer();
  const toast = useToast();
  const byId = useMemo(() => new Map(player.library.tracks.map((track) => [track.id, track])), [player.library.tracks]);

  useDropHandler((target, payload) => {
    const libraryIds = payload.trackIds.filter((id) => byId.has(id));
    const tracks = libraryIds.map((id) => toPlayerTrack(byId.get(id)!));
    const [kind, first, second] = target.split(":");
    void (async () => {
      try {
        if (kind === "queue") {
          if (payload.from?.type === "queue") return;
          player.addToQueue(tracks);
          toast({ title: `${tracks.length} añadida(s) a la cola`, tone: "ok" });
        } else if (kind === "queue-pos") {
          const position = Number(first);
          if (payload.from?.type === "queue") player.moveInQueue(payload.from.index, position);
          else player.insertInQueue(tracks, position);
        } else if (kind === "playlist" || kind === "playlist-pos") {
          const playlist = player.playlists.find((item) => item.id === first);
          if (!playlist) return;
          const position = kind === "playlist-pos" ? Number(second) : undefined;
          if (payload.from?.type === "playlist" && payload.from.id === playlist.id) {
            if (position === undefined) return;
            // Reordenar dentro de la misma lista.
            const moving = payload.from.indices.map((index) => playlist.trackIds[index]);
            const kept = playlist.trackIds.filter((_, index) => !payload.from || payload.from.type !== "playlist" || !payload.from.indices.includes(index));
            const before = payload.from.indices.filter((index) => index < position).length;
            kept.splice(position - before, 0, ...moving);
            const result = await updatePlaylist(playlist.id, { trackIds: kept });
            player.setPlaylists(result.playlists);
            return;
          }
          if (libraryIds.length === 0) return;
          const result = await addToPlaylist(playlist.id, libraryIds, position);
          player.setPlaylists(result.playlists);
          toast({ title: `Añadida(s) a «${playlist.name}»`, body: `${libraryIds.length} canción(es)`, tone: "ok" });
        } else if (kind === "new-playlist") {
          if (libraryIds.length === 0) return;
          const result = await createPlaylist(libraryIds.length === 1 ? byId.get(libraryIds[0])?.title ?? "Nueva lista" : "Nueva lista", libraryIds);
          player.setPlaylists(result.playlists);
          toast({ title: "Lista creada", body: `${libraryIds.length} canción(es)`, tone: "ok" });
        }
      } catch (error) {
        toast({ title: "No se pudo completar", body: error instanceof Error ? error.message : undefined, tone: "error" });
      }
    })();
  });
  return null;
}

/** Barra inferior del reproductor, visible en todas las páginas. */
export default function PlayerDock() {
  const player = usePlayer();
  const pathname = usePathname();
  const { current, playing, settings } = player;
  const onPlayerPage = pathname?.startsWith("/reproductor");
  const { theme } = useTheme();

  return <footer className={`player-dock${current ? "" : " is-idle"}`} data-drop="queue" aria-label="Reproductor">
    <div className="dock-track">
      {current
        ? <>
            <Link href="/reproductor/" className="dock-cover-link" aria-label="Abrir el reproductor"><Cover src={current.cover} title={current.title} className={`dock-cover${playing ? " is-spinning" : ""}`} /></Link>
            <div className="dock-meta">
              <strong title={current.title}>{current.title}</strong>
              <span>{current.artist ?? "Artista desconocido"}{current.format ? <em>{current.format}</em> : null}</span>
            </div>
          </>
        : <div className="dock-meta is-empty"><strong>Nada sonando</strong><span>Arrastra canciones aquí o abre el <Link href="/reproductor/">reproductor</Link></span></div>}
    </div>
    <div className="dock-center">
      <div className="dock-controls">
        <button type="button" className={`icon-button${settings.shuffle ? " is-on" : ""}`} onClick={player.toggleShuffle} aria-label="Aleatorio" title="Aleatorio"><IconShuffle size={17} /></button>
        <button type="button" className="icon-button" onClick={player.previous} disabled={!current} aria-label="Anterior" title="Anterior"><IconPrevious size={18} /></button>
        <button type="button" className={`play-button${player.loading && playing ? " is-loading" : ""}`} onClick={player.toggle} disabled={!current} aria-label={playing ? "Pausar" : "Reproducir"}>{playing ? <IconPause size={20} /> : <IconPlay size={20} />}</button>
        <button type="button" className="icon-button" onClick={player.next} disabled={!current} aria-label="Siguiente" title="Siguiente"><IconNext size={18} /></button>
        <button type="button" className={`icon-button${settings.repeat !== "off" ? " is-on" : ""}`} onClick={player.cycleRepeat} aria-label="Repetir" title={settings.repeat === "one" ? "Repetir una" : settings.repeat === "all" ? "Repetir todo" : "Sin repetir"}><IconRepeat size={17} />{settings.repeat === "one" && <span className="repeat-one">1</span>}</button>
      </div>
      <div className="dock-seek">
        <span>{formatTime(player.time)}</span>
        <SeekBar time={player.time} duration={player.duration} buffered={player.buffered} onSeek={player.seek} />
        <span>{formatTime(player.duration || current?.durationSeconds)}</span>
      </div>
      {player.error && <p className="dock-error">{player.error}</p>}
    </div>
    <div className="dock-side">
      <Visualizer analyser={player.analyser} playing={playing} variant="mini" className="dock-visualizer" hue={current ? theme.hue - 25 + (hue(current.title) % 50) : theme.hue} />
      <div className="dock-volume">
        <button type="button" className="icon-button" onClick={player.toggleMute} aria-label={settings.muted ? "Activar sonido" : "Silenciar"}>{settings.muted || settings.volume === 0 ? <IconMute size={17} /> : <IconVolume size={17} />}</button>
        <input type="range" className="volume-range" min={0} max={1} step={0.01} value={settings.muted ? 0 : settings.volume} onChange={(event) => player.setVolume(Number(event.target.value))} aria-label="Volumen" style={{ ["--level" as string]: `${(settings.muted ? 0 : settings.volume) * 100}%` }} />
      </div>
      <Link href="/reproductor/#cola" className="icon-button" aria-label="Ver la cola" title="Cola"><IconQueue size={18} />{player.queue.length > 0 && <span className="dock-count">{player.queue.length}</span>}</Link>
      <button type="button" className="icon-button" disabled={!current} onClick={() => window.dispatchEvent(new Event("antitube-immersive"))} aria-label="Modo inmersivo" title="Modo inmersivo"><IconFullscreen size={16} /></button>
      {!onPlayerPage && <Link href="/reproductor/" className="icon-button" aria-label="Abrir el reproductor" title="Abrir el reproductor"><IconExpand size={16} /></Link>}
    </div>
  </footer>;
}
