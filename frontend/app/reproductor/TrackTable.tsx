"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Cover } from "../player/PlayerDock";
import { useDrag, type DragPayload } from "../player/dnd";
import { usePlayer } from "../player/PlayerContext";
import { formatLabel, formatTime, type LibraryTrack } from "../player/types";
import { IconMore, IconPlay } from "../shell/icons";

export type SortKey = "title" | "artist" | "album" | "duration" | "format" | "added";

const rowHeight = 54;

export type TrackMenuRequest = { tracks: LibraryTrack[]; indices: number[]; x: number; y: number };

/**
 * Lista de canciones con selección (clic, Ctrl, Mayús), doble clic para
 * reproducir, arrastrar a listas o a la cola, y solo pinta las filas visibles
 * para que bibliotecas enormes vayan fluidas.
 */
export default function TrackTable({ tracks, playlistId, sort, onSort, onPlay, onMenu, emptyText }: Readonly<{
  tracks: LibraryTrack[];
  playlistId?: string;
  sort?: { key: SortKey; descending: boolean };
  onSort?: (key: SortKey) => void;
  onPlay: (index: number) => void;
  onMenu: (request: TrackMenuRequest) => void;
  emptyText: string;
}>) {
  const player = usePlayer();
  const { begin } = useDrag();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 800 });

  useEffect(() => { setSelected(new Set()); setAnchor(null); }, [tracks]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setViewport({ top: element.scrollTop, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    return () => { observer.disconnect(); element.removeEventListener("scroll", update); };
  }, []);

  const first = Math.max(0, Math.floor(viewport.top / rowHeight) - 8);
  const last = Math.min(tracks.length, Math.ceil((viewport.top + viewport.height) / rowHeight) + 8);
  const visible = useMemo(() => tracks.slice(first, last), [tracks, first, last]);

  function select(index: number, event: React.MouseEvent) {
    if (event.shiftKey && anchor !== null) {
      const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
      setSelected(new Set(Array.from({ length: to - from + 1 }, (_, offset) => from + offset)));
    } else if (event.ctrlKey || event.metaKey) {
      const next = new Set(selected);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      setSelected(next);
      setAnchor(index);
    } else {
      setSelected(new Set([index]));
      setAnchor(index);
    }
  }

  function dragPayload(index: number): DragPayload {
    const indices = selected.has(index) ? [...selected].sort((a, b) => a - b) : [index];
    const items = indices.map((item) => tracks[item]);
    return {
      trackIds: items.map((track) => track.id),
      label: items.length === 1 ? items[0].title : `${items.length} canciones`,
      from: playlistId ? { type: "playlist", id: playlistId, indices } : undefined
    };
  }

  function menu(index: number, x: number, y: number) {
    const indices = selected.has(index) ? [...selected].sort((a, b) => a - b) : [index];
    if (!selected.has(index)) { setSelected(new Set([index])); setAnchor(index); }
    onMenu({ tracks: indices.map((item) => tracks[item]), indices, x, y });
  }

  const header = (key: SortKey, label: string, className: string) => <button type="button" className={`track-sort ${className}${sort?.key === key ? " active" : ""}`} onClick={() => onSort?.(key)} disabled={!onSort}>{label}{sort?.key === key ? (sort.descending ? " ↓" : " ↑") : ""}</button>;

  return <div className="track-table" onKeyDown={(event) => {
    if (event.key === "Enter" && selected.size > 0) onPlay(Math.min(...selected));
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); setSelected(new Set(tracks.map((_, index) => index))); }
  }} tabIndex={0}>
    <div className="track-head">
      <span className="track-col-index">#</span>
      {header("title", "Título", "track-col-title")}
      {header("album", "Álbum", "track-col-album")}
      {header("format", "Formato", "track-col-format")}
      {header("duration", "⏱", "track-col-duration")}
      <span className="track-col-actions" />
    </div>
    <div className="track-scroll" ref={scrollRef}>
      {tracks.length === 0 && <div className="track-empty">{emptyText}</div>}
      <div className="track-canvas" style={{ height: tracks.length * rowHeight }}>
        {visible.map((track, offset) => {
          const index = first + offset;
          const isCurrent = player.current?.id === track.id;
          return <div
            key={`${track.id}-${index}`}
            className={`track-row${selected.has(index) ? " is-selected" : ""}${isCurrent ? " is-current" : ""}`}
            style={{ transform: `translateY(${index * rowHeight}px)` }}
            onClick={(event) => select(index, event)}
            onDoubleClick={() => onPlay(index)}
            onContextMenu={(event) => { event.preventDefault(); menu(index, event.clientX, event.clientY); }}
            onPointerDown={(event) => begin(event, () => dragPayload(index))}
            data-drop={playlistId ? `playlist-pos:${playlistId}:${index}` : undefined}
          >
            <span className="track-col-index">
              {isCurrent && player.playing ? <span className="eq-bars" aria-label="Sonando"><i /><i /><i /></span> : <span className="track-number">{index + 1}</span>}
              <button type="button" className="track-play" onClick={(event) => { event.stopPropagation(); onPlay(index); }} aria-label={`Reproducir ${track.title}`}><IconPlay size={14} /></button>
            </span>
            <span className="track-col-title">
              <Cover src={track.hasCover ? `/api/library/cover/${track.id}` : null} title={track.album ?? track.title} className="track-cover" />
              <span className="track-title-copy"><strong title={track.title}>{track.title}</strong><small>{track.artist ?? track.albumArtist ?? "Artista desconocido"}</small></span>
            </span>
            <span className="track-col-album" title={track.album ?? ""}>{track.album ?? "—"}</span>
            <span className="track-col-format"><em className={`format-chip${track.lossless ? " is-lossless" : ""}`}>{formatLabel(track)}</em></span>
            <span className="track-col-duration">{formatTime(track.durationSeconds)}</span>
            <span className="track-col-actions"><button type="button" className="icon-button" onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); menu(index, rect.left, rect.bottom); }} aria-label="Más opciones"><IconMore size={18} /></button></span>
          </div>;
        })}
      </div>
      {playlistId && tracks.length > 0 && <div className="track-drop-end" data-drop={`playlist-pos:${playlistId}:${tracks.length}`}>Suelta aquí para añadir al final</div>}
    </div>
    {selected.size > 1 && <div className="track-selection-bar"><span>{selected.size} seleccionadas</span><button type="button" className="chip-button is-accent" onClick={() => { const indices = [...selected].sort((a, b) => a - b); onMenu({ tracks: indices.map((item) => tracks[item]), indices, x: window.innerWidth / 2, y: window.innerHeight / 2 }); }}>Acciones…</button><button type="button" className="chip-button" onClick={() => setSelected(new Set())}>Quitar selección</button></div>}
  </div>;
}
