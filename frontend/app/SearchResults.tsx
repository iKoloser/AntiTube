"use client";

import { useEffect, useState } from "react";
import { previewTrack, streamTrack, usePlayer, warmStream } from "./player/PlayerContext";
import { formatTime } from "./player/types";
import { api } from "./runtime";
import { IconDownload, IconHeadphones, IconLink, IconPlay, IconPlus } from "./shell/icons";
import { useToast } from "./shell/Toasts";

export type SearchProvider = "youtube" | "ytmusic" | "soundcloud" | "bandcamp" | "audius";
type Result = { provider: SearchProvider; id: string | null; title: string; uploader: string | null; durationSeconds: number | null; thumbnailUrl: string | null; url: string };
type Group = { provider: SearchProvider; label: string; results: Result[]; error: string | null };

export const providers: Array<{ id: SearchProvider; label: string; mark: string }> = [
  { id: "youtube", label: "YouTube", mark: "YT" },
  { id: "ytmusic", label: "YouTube Music", mark: "YM" },
  { id: "bandcamp", label: "Bandcamp", mark: "BC" },
  { id: "audius", label: "Audius", mark: "AU" },
  { id: "soundcloud", label: "SoundCloud", mark: "SC" }
];

/** Plataformas donde tiene sentido ver la imagen además de escuchar. */
const videoProviders = new Set<SearchProvider>(["youtube"]);

/**
 * Resultados de búsqueda de varias plataformas a la vez. Cada resultado se
 * puede escuchar al momento, abrir con todas las opciones o mandar directo a la cola.
 */
export default function SearchResults({ query, selected, onOpen, onQuickDownload }: Readonly<{ query: string; selected: SearchProvider[]; onOpen: (url: string) => void; onQuickDownload: (result: Result) => Promise<void> }>) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<SearchProvider | "all">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const player = usePlayer();
  const toast = useToast();

  useEffect(() => {
    const controller = new AbortController();
    setGroups(null);
    setError(null);
    setTab("all");
    api<{ groups: Group[] }>("/api/search", { body: { query, providers: selected, limit: 12 }, signal: controller.signal })
      .then((data) => setGroups(data.groups))
      .catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "No se pudo buscar."); });
    return () => controller.abort();
  }, [query, selected]);

  // En cuanto llegan los resultados, el motor prepara el audio de los primeros
  // para que al pulsar «Escuchar» suenen al instante, como en Spotify.
  useEffect(() => {
    if (!groups) return;
    const first = groups.flatMap((group) => group.results.slice(0, 3)).slice(0, 6);
    first.forEach((result) => warmStream(result.url));
  }, [groups]);

  const toStream = (result: Result) => streamTrack(result.url, { title: result.title, artist: result.uploader, cover: result.thumbnailUrl, durationSeconds: result.durationSeconds });

  /** Escuchar en streaming: suena este resultado y, detrás, el resto de la lista. */
  function listenFrom(list: Result[], start: number) {
    player.playTracks(list.map(toStream), start);
  }

  function enqueue(result: Result) {
    player.addToQueue([toStream(result)]);
    toast({ title: "Añadida a la cola", body: result.title, tone: "ok" });
  }

  async function listen(result: Result, kind: "audio" | "video" = "audio") {
    setBusy(`${kind === "video" ? "watch" : "listen"}:${result.url}`);
    try {
      const track = await previewTrack(result.url, { title: result.title, artist: result.uploader, cover: result.thumbnailUrl, durationSeconds: result.durationSeconds }, kind);
      player.playTracks([track]);
    } catch (caught) {
      toast({ title: "No se puede escuchar", body: caught instanceof Error ? caught.message : undefined, tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function quick(result: Result) {
    setBusy(`get:${result.url}`);
    try { await onQuickDownload(result); } finally { setBusy(null); }
  }

  if (error) return <div className="notice error">ⓘ <span>{error}</span></div>;
  if (!groups) return <section className="search-panel is-loading" aria-busy="true"><div className="search-head"><span className="search-kicker">&gt; buscando «{query}»</span></div><div className="search-skeleton">{Array.from({ length: 6 }, (_, index) => <span key={index} style={{ animationDelay: `${index * 80}ms` }} />)}</div></section>;

  const visible = groups.filter((group) => tab === "all" || group.provider === tab);
  const total = groups.reduce((sum, group) => sum + group.results.length, 0);
  const playable = visible.flatMap((group) => group.results);
  const playingUrl = player.current?.id.startsWith("listen:") ? player.current.sourceUrl : null;

  return <section className="search-panel" aria-label="Resultados de búsqueda">
    <div className="search-head">
      <span className="search-kicker">&gt; {total} resultado(s) para «{query}»</span>
      {playable.length > 0 && <button type="button" className="chip-button is-accent search-listen-all" onClick={() => listenFrom(playable, 0)} title="Escuchar todos los resultados en streaming, solo audio y sin descargar"><IconHeadphones size={15} /> Escuchar todo</button>}
      {groups.length > 1 && <div className="segmented">
        <button type="button" className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>Todo</button>
        {groups.map((group) => <button key={group.provider} type="button" className={tab === group.provider ? "active" : ""} onClick={() => setTab(group.provider)}>{group.label} <small>{group.results.length}</small></button>)}
      </div>}
    </div>
    {visible.map((group) => <div key={group.provider} className="search-group">
      {groups.length > 1 && <h3 className="search-group-title"><span className={`provider-mark is-${group.provider}`}>{providers.find((item) => item.id === group.provider)?.mark}</span>{group.label}</h3>}
      {group.error && <p className="search-error">{group.error}</p>}
      {!group.error && group.results.length === 0 && <p className="search-error">Sin resultados en {group.label}.</p>}
      <ul className="search-list">
        {group.results.map((result) => <li key={`${group.provider}-${result.url}`} className={`search-item${playingUrl === result.url ? " is-playing" : ""}`} onPointerEnter={() => warmStream(result.url, true)}>
          <button type="button" className="search-thumb" onClick={() => listenFrom(playable, playable.indexOf(result))} aria-label={`Escuchar ${result.title}`}>
            {result.thumbnailUrl ? <img src={result.thumbnailUrl} alt="" loading="lazy" /> : <span>♫</span>}
            <span className="search-thumb-play">{playingUrl === result.url && player.loading ? <span className="spinner" /> : <IconPlay size={22} />}</span>
            {result.durationSeconds ? <em>{formatTime(result.durationSeconds)}</em> : null}
          </button>
          <div className="search-copy">
            <strong title={result.title}>{result.title}</strong>
            <span>{result.uploader ?? group.label}</span>
          </div>
          <div className="search-actions">
            <button type="button" className="chip-button" onClick={() => listenFrom(playable, playable.indexOf(result))} title="Escuchar en streaming: solo audio, sin descargar"><IconHeadphones size={15} /> Escuchar</button>
            <button type="button" className="icon-button search-enqueue" onClick={() => enqueue(result)} aria-label="Añadir a la cola" title="Añadir a la cola (streaming)"><IconPlus size={15} /></button>
            {videoProviders.has(group.provider) && <button type="button" className="chip-button" disabled={busy === `watch:${result.url}`} onClick={() => void listen(result, "video")} title="Ver el vídeo en el reproductor">{busy === `watch:${result.url}` ? <span className="spinner" /> : "▶"} Ver</button>}
            <button type="button" className="chip-button" onClick={() => onOpen(result.url)} title="Ver opciones: formato, calidad y recorte"><IconLink size={15} /> Opciones</button>
            <button type="button" className="chip-button is-accent" disabled={busy === `get:${result.url}`} onClick={() => void quick(result)} title="Añadir a la cola con tus ajustes rápidos"><IconDownload size={15} /> {busy === `get:${result.url}` ? "…" : "Bajar"}</button>
          </div>
        </li>)}
      </ul>
    </div>)}
  </section>;
}
