"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDrag } from "../player/dnd";
import { usePlayer } from "../player/PlayerContext";
import { Cover } from "../player/PlayerDock";
import { addToPlaylist, createPlaylist, deletePlaylist, updatePlaylist } from "../player/playlists";
import { formatLabel, formatTime, playableFormats, toPlayerTrack, type LibraryTrack } from "../player/types";
import { api, isDesktop, pickMediaFiles, pickMusicFolder } from "../runtime";
import { IconClose, IconDisc, IconFile, IconFolder, IconHeadphones, IconList, IconPlay, IconPlus, IconQueue, IconRefresh, IconSearch, IconShuffle, IconTrash, IconUser, IconVideo } from "../shell/icons";
import { useToast } from "../shell/Toasts";
import NowPlaying from "./NowPlaying";
import TrackTable, { type SortKey, type TrackMenuRequest } from "./TrackTable";

type View = { type: "songs" } | { type: "videos" } | { type: "albums"; album?: string } | { type: "artists"; artist?: string } | { type: "queue" } | { type: "playlist"; id: string };

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

function sortTracks(tracks: LibraryTrack[], key: SortKey, descending: boolean): LibraryTrack[] {
  const value = (track: LibraryTrack): string | number => {
    switch (key) {
      case "artist": return track.artist ?? track.albumArtist ?? "";
      case "album": return `${track.album ?? ""}\u0000${String(track.trackNumber ?? 0).padStart(4, "0")}`;
      case "duration": return track.durationSeconds ?? 0;
      case "format": return formatLabel(track);
      case "added": return track.modified;
      default: return track.title;
    }
  };
  const sorted = [...tracks].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    return typeof left === "number" && typeof right === "number" ? left - right : collator.compare(String(left), String(right));
  });
  return descending ? sorted.reverse() : sorted;
}

function matches(track: LibraryTrack, query: string): boolean {
  if (!query) return true;
  const haystack = `${track.title} ${track.artist ?? ""} ${track.albumArtist ?? ""} ${track.album ?? ""} ${track.genre ?? ""} ${track.filename}`.toLocaleLowerCase("es");
  return query.toLocaleLowerCase("es").split(/\s+/).every((word) => haystack.includes(word));
}

function TrackMenu({ request, playlistId, onClose }: Readonly<{ request: TrackMenuRequest; playlistId?: string; onClose: () => void }>) {
  const player = usePlayer();
  const toast = useToast();
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x: request.x, y: request.y });
  const items = request.tracks.map(toPlayerTrack);
  const ids = request.tracks.map((track) => track.id);

  useEffect(() => {
    const element = ref.current;
    if (element) {
      const rect = element.getBoundingClientRect();
      setPosition({ x: Math.min(request.x, window.innerWidth - rect.width - 12), y: Math.min(request.y, window.innerHeight - rect.height - 12) });
    }
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", escape); };
  }, [request, onClose]);

  const run = (action: () => void | Promise<void>) => () => { void Promise.resolve(action()).catch((error) => toast({ title: "No se pudo completar", body: error instanceof Error ? error.message : undefined, tone: "error" })); onClose(); };

  return <div ref={ref} className="context-menu" style={{ left: position.x, top: position.y }} role="menu">
    <p className="context-title">{request.tracks.length === 1 ? request.tracks[0].title : `${request.tracks.length} canciones`}</p>
    <button type="button" role="menuitem" onClick={run(() => player.playTracks(items))}>▶ Reproducir</button>
    <button type="button" role="menuitem" onClick={run(() => { player.addToQueue(items, "next"); toast({ title: "Sonará a continuación", tone: "ok" }); })}>⤵ Reproducir a continuación</button>
    <button type="button" role="menuitem" onClick={run(() => { player.addToQueue(items); toast({ title: "Añadida(s) a la cola", tone: "ok" }); })}>＋ Añadir a la cola</button>
    <div className="context-sep" />
    <p className="context-label">Añadir a una lista</p>
    <div className="context-scroll">
      {player.playlists.map((playlist) => <button key={playlist.id} type="button" role="menuitem" onClick={run(async () => { const result = await addToPlaylist(playlist.id, ids); player.setPlaylists(result.playlists); toast({ title: `Añadida(s) a «${playlist.name}»`, tone: "ok" }); })}>♫ {playlist.name}</button>)}
    </div>
    <button type="button" role="menuitem" onClick={run(async () => { const name = window.prompt("Nombre de la nueva lista", "Nueva lista"); if (!name) return; const result = await createPlaylist(name, ids); player.setPlaylists(result.playlists); toast({ title: `Lista «${name}» creada`, tone: "ok" }); })}>＋ Nueva lista con esto…</button>
    {playlistId && <button type="button" role="menuitem" onClick={run(async () => { const playlist = player.playlists.find((item) => item.id === playlistId); if (!playlist) return; const result = await updatePlaylist(playlistId, { trackIds: playlist.trackIds.filter((_, index) => !request.indices.includes(index)) }); player.setPlaylists(result.playlists); })}>✕ Quitar de esta lista</button>}
    <div className="context-sep" />
    {request.tracks.length === 1 && isDesktop && <button type="button" role="menuitem" onClick={run(() => api("/api/library/reveal", { body: { id: request.tracks[0].id } }))}>📂 Mostrar en la carpeta</button>}
    {request.tracks.some((track) => track.source === "file") && <button type="button" role="menuitem" onClick={run(async () => { await api("/api/library/forget", { body: { ids: request.tracks.filter((track) => track.source === "file").map((track) => track.id) } }); await player.refreshLibrary(true); })}>Quitar de la biblioteca</button>}
  </div>;
}

function QueueView() {
  const player = usePlayer();
  const { begin } = useDrag();
  return <div className="queue-view">
    <div className="view-head"><div><p className="kicker">// cola de reproducción</p><h2>Cola <small>{player.queue.length} canciones · {formatTime(player.queue.reduce((total, track) => total + (track.durationSeconds ?? 0), 0))}</small></h2></div><div className="view-actions">{player.queue.length > 0 && <button type="button" className="chip-button" onClick={player.clearQueue}><IconTrash size={15} /> Vaciar</button>}</div></div>
    {player.queue.length === 0 && <div className="track-empty">La cola está vacía. Arrastra canciones aquí o usa «Añadir a la cola».</div>}
    <ol className="queue-list" data-drop="queue">
      {player.queue.map((track, index) => <li
        key={`${track.id}-${index}`}
        className={`queue-item${index === player.index ? " is-current" : ""}${index < player.index ? " is-played" : ""}`}
        data-drop={`queue-pos:${index}`}
        onPointerDown={(event) => begin(event, () => ({ trackIds: [track.id], label: track.title, from: { type: "queue", index } }))}
        onDoubleClick={() => player.jumpTo(index)}
      >
        <span className="queue-index">{index === player.index && player.playing ? <span className="eq-bars"><i /><i /><i /></span> : index + 1}</span>
        <Cover src={track.cover} title={track.album ?? track.title} className="track-cover" />
        <span className="track-title-copy"><strong>{track.title}</strong><small>{track.artist ?? "Artista desconocido"}</small></span>
        <span className="queue-duration">{formatTime(track.durationSeconds)}</span>
        <button type="button" className="icon-button" onClick={() => player.jumpTo(index)} aria-label="Reproducir"><IconPlay size={14} /></button>
        <button type="button" className="icon-button" onClick={() => player.removeFromQueue(index)} aria-label="Quitar de la cola"><IconClose size={15} /></button>
      </li>)}
      {player.queue.length > 0 && <li className="track-drop-end" data-drop={`queue-pos:${player.queue.length}`}>Suelta aquí para añadir al final</li>}
    </ol>
  </div>;
}

function Grid({ items, onOpen, onPlay }: Readonly<{ items: Array<{ key: string; title: string; subtitle: string; cover: string | null; tracks: LibraryTrack[] }>; onOpen: (key: string) => void; onPlay: (tracks: LibraryTrack[]) => void }>) {
  const { begin } = useDrag();
  return <div className="album-grid">
    {items.map((item) => <div key={item.key} className="album-card" onClick={() => onOpen(item.key)} onPointerDown={(event) => begin(event, () => ({ trackIds: item.tracks.map((track) => track.id), label: `${item.title} (${item.tracks.length})` }))}>
      <div className="album-cover-wrap"><Cover src={item.cover} title={item.title} className="album-cover" /><button type="button" className="album-play" onClick={(event) => { event.stopPropagation(); onPlay(item.tracks); }} aria-label={`Reproducir ${item.title}`}><IconPlay size={22} /></button></div>
      <strong title={item.title}>{item.title}</strong>
      <span>{item.subtitle}</span>
    </div>)}
  </div>;
}

export default function PlayerPage() {
  const player = usePlayer();
  const toast = useToast();
  const [view, setView] = useState<View>({ type: "songs" });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "added", descending: true });
  const [menu, setMenu] = useState<TrackMenuRequest | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const tracks = player.library.tracks;
  const [cinema, setCinema] = useState(false);
  const byId = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);

  useEffect(() => {
    const fromHash = () => { if (window.location.hash === "#cola") setView({ type: "queue" }); };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  // Atajos de teclado del reproductor.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select")) return;
      if (event.code === "Space") { event.preventDefault(); player.toggle(); }
      else if (event.key === "ArrowRight" && event.shiftKey) player.next();
      else if (event.key === "ArrowLeft" && event.shiftKey) player.previous();
      else if (event.key === "ArrowRight") player.seek(player.time + 5);
      else if (event.key === "ArrowLeft") player.seek(player.time - 5);
      else if (event.key === "ArrowUp") { event.preventDefault(); player.setVolume(player.settings.volume + 0.05); }
      else if (event.key === "ArrowDown") { event.preventDefault(); player.setVolume(player.settings.volume - 0.05); }
      else if (event.key.toLowerCase() === "m") player.toggleMute();
      else if (event.key.toLowerCase() === "s") player.toggleShuffle();
      else if (event.key.toLowerCase() === "r") player.cycleRepeat();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player]);

  const filtered = useMemo(() => tracks.filter((track) => matches(track, query)), [tracks, query]);

  const albums = useMemo(() => {
    const groups = new Map<string, LibraryTrack[]>();
    for (const track of filtered) {
      const key = `${track.album ?? "Sin álbum"}\u0000${track.albumArtist ?? (track.album ? track.artist ?? "" : "")}`;
      groups.set(key, [...(groups.get(key) ?? []), track]);
    }
    return [...groups.entries()].map(([key, list]) => {
      const [title, artist] = key.split("\u0000");
      const ordered = [...list].sort((a, b) => (a.trackNumber ?? 999) - (b.trackNumber ?? 999) || collator.compare(a.title, b.title));
      const withCover = ordered.find((track) => track.hasCover);
      return { key, title, subtitle: `${artist || "Varios artistas"} · ${list.length}`, cover: withCover ? `/api/library/cover/${withCover.id}` : null, tracks: ordered };
    }).sort((a, b) => collator.compare(a.title, b.title));
  }, [filtered]);

  const artists = useMemo(() => {
    const groups = new Map<string, LibraryTrack[]>();
    for (const track of filtered) {
      const key = track.albumArtist ?? track.artist ?? "Artista desconocido";
      groups.set(key, [...(groups.get(key) ?? []), track]);
    }
    return [...groups.entries()].map(([key, list]) => {
      const withCover = list.find((track) => track.hasCover);
      return { key, title: key, subtitle: `${list.length} canción(es)`, cover: withCover ? `/api/library/cover/${withCover.id}` : null, tracks: list };
    }).sort((a, b) => collator.compare(a.title, b.title));
  }, [filtered]);

  const videoCount = useMemo(() => tracks.filter((track) => track.kind === "video").length, [tracks]);
  const playlist = view.type === "playlist" ? player.playlists.find((item) => item.id === view.id) ?? null : null;

  const listed = useMemo(() => {
    if (view.type === "playlist") return (playlist?.trackIds ?? []).map((id) => byId.get(id)).filter((track): track is LibraryTrack => Boolean(track)).filter((track) => matches(track, query));
    if (view.type === "albums" && view.album) return albums.find((album) => album.key === view.album)?.tracks ?? [];
    if (view.type === "artists" && view.artist) return sortTracks(artists.find((artist) => artist.key === view.artist)?.tracks ?? [], "album", false);
    if (view.type === "videos") return sortTracks(filtered.filter((track) => track.kind === "video"), sort.key, sort.descending);
    return sortTracks(filtered, sort.key, sort.descending);
  }, [view, playlist, byId, query, albums, artists, filtered, sort]);

  const playFrom = useCallback((list: LibraryTrack[], index: number) => player.playTracks(list.map(toPlayerTrack), index), [player]);

  async function newPlaylist() {
    const result = await createPlaylist(`Lista ${player.playlists.length + 1}`);
    player.setPlaylists(result.playlists);
    if (result.playlist) { setView({ type: "playlist", id: result.playlist.id }); setRenaming(result.playlist.id); }
  }

  async function addFolder() {
    const folder = await pickMusicFolder();
    if (folder === undefined) { toast({ title: "Arrastra una carpeta a la ventana", body: "Desde el Explorador de Windows, suéltala sobre AntiTube.", tone: "info" }); return; }
    if (!folder) return;
    await api("/api/library/import", { body: { paths: [folder] } });
    await player.refreshLibrary(true);
    toast({ title: "Carpeta añadida", body: folder, tone: "ok" });
  }

  async function addFiles() {
    const files = await pickMediaFiles();
    if (!files?.length) return;
    await api("/api/library/import", { body: { paths: files } });
    await player.refreshLibrary(true);
    toast({ title: `${files.length} archivo(s) añadidos`, tone: "ok" });
  }

  const totalDuration = listed.reduce((total, track) => total + (track.durationSeconds ?? 0), 0);
  const heading = view.type === "songs" ? "Canciones"
    : view.type === "videos" ? "Vídeos"
    : view.type === "albums" ? (view.album ? albums.find((album) => album.key === view.album)?.title ?? "Álbum" : "Álbumes")
    : view.type === "artists" ? (view.artist ?? "Artistas")
    : view.type === "queue" ? "Cola"
    : playlist?.name ?? "Lista";
  const showGrid = (view.type === "albums" && !view.album) || (view.type === "artists" && !view.artist);

  return <main className={`page page-player${cinema && player.current?.kind === "video" ? " is-cinema" : ""}`}>
    <aside className="library-nav">
      <p className="kicker">// biblioteca</p>
      <button type="button" className={`library-link${view.type === "songs" ? " active" : ""}`} onClick={() => setView({ type: "songs" })}><IconHeadphones size={17} /> Canciones <small>{tracks.length}</small></button>
      <button type="button" className={`library-link${view.type === "videos" ? " active" : ""}`} onClick={() => setView({ type: "videos" })}><IconVideo size={17} /> Vídeos <small>{videoCount}</small></button>
      <button type="button" className={`library-link${view.type === "albums" ? " active" : ""}`} onClick={() => setView({ type: "albums" })}><IconDisc size={17} /> Álbumes</button>
      <button type="button" className={`library-link${view.type === "artists" ? " active" : ""}`} onClick={() => setView({ type: "artists" })}><IconUser size={17} /> Artistas</button>
      <button type="button" className={`library-link${view.type === "queue" ? " active" : ""}`} onClick={() => setView({ type: "queue" })} data-drop="queue"><IconQueue size={17} /> Cola <small>{player.queue.length}</small></button>
      <p className="kicker library-lists-title">// listas <button type="button" className="icon-button" onClick={() => void newPlaylist()} aria-label="Nueva lista" title="Nueva lista"><IconPlus size={16} /></button></p>
      <div className="library-lists">
        {player.playlists.map((item) => <div key={item.id} className={`library-link is-playlist${view.type === "playlist" && view.id === item.id ? " active" : ""}`} data-drop={`playlist:${item.id}`} onClick={() => setView({ type: "playlist", id: item.id })} role="button" tabIndex={0}>
          <IconList size={16} />
          {renaming === item.id
            ? <input autoFocus defaultValue={item.name} onClick={(event) => event.stopPropagation()} onBlur={(event) => { const name = event.target.value.trim(); setRenaming(null); if (name && name !== item.name) void updatePlaylist(item.id, { name }).then((result) => player.setPlaylists(result.playlists)); }} onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); if (event.key === "Escape") setRenaming(null); }} />
            : <span onDoubleClick={(event) => { event.stopPropagation(); setRenaming(item.id); }}>{item.name}</span>}
          <small>{item.trackIds.length}</small>
        </div>)}
        <div className="library-new-drop" data-drop="new-playlist"><IconPlus size={15} /> Suelta aquí para crear una lista</div>
      </div>
      <p className="kicker">// añadir música</p>
      <button type="button" className="library-link is-quiet" onClick={() => void addFolder()}><IconFolder size={16} /> Carpeta…</button>
      {isDesktop && <button type="button" className="library-link is-quiet" onClick={() => void addFiles()}><IconFile size={16} /> Archivos…</button>}
      <p className="library-hint">También puedes arrastrar archivos o carpetas desde el Explorador a la ventana.</p>
      {player.library.extraFolders.length > 0 && <details className="library-folders"><summary>Carpetas ({player.library.folders.length})</summary>{player.library.folders.map((folder, index) => <div key={folder} className="library-folder"><code title={folder}>{folder}</code>{index > 0 && <button type="button" className="icon-button" aria-label="Quitar carpeta" onClick={() => void api<{ extraFolders: string[] }>("/api/library/folders", { method: "DELETE", body: { folder } }).then(() => player.refreshLibrary(true))}><IconClose size={14} /></button>}</div>)}</details>}
    </aside>

    <section className="library-main">
      {view.type === "queue" ? <QueueView /> : <>
        <div className="view-head">
          <div>
            <p className="kicker">{view.type === "playlist" ? "// lista" : view.type === "albums" && view.album ? "// álbum" : view.type === "artists" && view.artist ? "// artista" : "// biblioteca"}</p>
            <h2>{heading} {!showGrid && <small>{listed.length} {view.type === "videos" ? "vídeos" : "canciones"} · {formatTime(totalDuration)}</small>}</h2>
          </div>
          <div className="view-actions">
            {((view.type === "albums" && view.album) || (view.type === "artists" && view.artist)) && <button type="button" className="chip-button" onClick={() => setView({ type: view.type } as View)}>← Volver</button>}
            {!showGrid && listed.length > 0 && <>
              <button type="button" className="chip-button is-accent" onClick={() => playFrom(listed, 0)}><IconPlay size={14} /> Reproducir</button>
              <button type="button" className="chip-button" onClick={() => { const shuffledList = [...listed].sort(() => Math.random() - 0.5); playFrom(shuffledList, 0); }}><IconShuffle size={14} /> Aleatorio</button>
            </>}
            {view.type === "playlist" && playlist && <>
              <button type="button" className="chip-button" onClick={() => setRenaming(playlist.id)}>Renombrar</button>
              <button type="button" className="chip-button is-danger" onClick={() => { if (window.confirm(`¿Borrar la lista «${playlist.name}»? Las canciones no se borran.`)) void deletePlaylist(playlist.id).then((result) => { player.setPlaylists(result.playlists); setView({ type: "songs" }); }); }}><IconTrash size={14} /></button>
            </>}
            <button type="button" className="icon-button" onClick={() => void player.refreshLibrary(true)} aria-label="Volver a leer las carpetas" title="Volver a leer las carpetas"><IconRefresh size={16} /></button>
          </div>
        </div>
        <div className="library-search"><IconSearch size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrar por título, artista, álbum o género…" />{player.library.scanning && <span className="library-scan"><span className="spinner" /> Leyendo {player.library.scanning.done}/{player.library.scanning.total}</span>}</div>
        {showGrid
          ? <Grid items={view.type === "albums" ? albums : artists} onOpen={(key) => setView(view.type === "albums" ? { type: "albums", album: key } : { type: "artists", artist: key })} onPlay={(list) => playFrom(list, 0)} />
          : <TrackTable
              tracks={listed}
              playlistId={view.type === "playlist" ? view.id : undefined}
              sort={view.type === "songs" || view.type === "videos" ? sort : undefined}
              onSort={view.type === "songs" || view.type === "videos" ? (key) => setSort((current) => ({ key, descending: current.key === key ? !current.descending : key === "added" })) : undefined}
              onPlay={(index) => playFrom(listed, index)}
              onMenu={setMenu}
              emptyText={!player.library.loaded ? "Cargando biblioteca…" : view.type === "videos" && !query ? "Aún no hay vídeos. Descarga algo en MP4 o arrastra tus vídeos (MP4, MKV, WEBM, MOV, AVI…) a la ventana." : view.type === "playlist" ? "Lista vacía. Arrastra canciones aquí o usa «Añadir a una lista»." : query ? "Nada coincide con el filtro." : "Aún no hay música. Descarga algo en MP3, M4A, Opus o FLAC, o arrastra tus archivos a la ventana."}
            />}
        <p className="library-formats">Reproduce {playableFormats.join(" · ")}</p>
      </>}
    </section>

    <NowPlaying cinema={cinema} onCinema={() => setCinema((value) => !value)} />
    {menu && <TrackMenu request={menu} playlistId={view.type === "playlist" ? view.id : undefined} onClose={() => setMenu(null)} />}
  </main>;
}
