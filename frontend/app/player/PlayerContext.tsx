"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, apiUrl } from "../runtime";
import { absolute, type LibraryTrack, type PlayerTrack, type Playlist } from "./types";

export type RepeatMode = "off" | "all" | "one";

export const eqBands = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const eqPresets: Record<string, number[]> = {
  Plano: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "Graves +": [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  "Agudos +": [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  Voces: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  Rock: [5, 4, 2, -1, -2, -1, 2, 3, 4, 4],
  Electrónica: [6, 5, 1, 0, -2, 1, 0, 2, 4, 5],
  "Hip hop": [6, 5, 2, 3, -1, -1, 1, 0, 2, 3],
  Clásica: [4, 3, 2, 1, 0, 0, 0, 1, 2, 3],
  Loudness: [6, 4, 0, 0, -1, 0, -1, 0, 4, 6]
};

type Settings = { volume: number; muted: boolean; shuffle: boolean; repeat: RepeatMode; rate: number; eq: number[]; eqEnabled: boolean; preamp: number; crossfade: number };
const defaultSettings: Settings = { volume: 0.8, muted: false, shuffle: false, repeat: "off", rate: 1, eq: eqPresets.Plano, eqEnabled: false, preamp: 0, crossfade: 0 };
const storageKey = "antitube-player-v1";

type Saved = { settings: Settings; queue: PlayerTrack[]; original: PlayerTrack[] | null; index: number; position: number };

type PlayerState = {
  queue: PlayerTrack[];
  index: number;
  current: PlayerTrack | null;
  playing: boolean;
  loading: boolean;
  error: string | null;
  time: number;
  duration: number;
  buffered: number;
  settings: Settings;
  sleepAt: number | null;
  analyser: AnalyserNode | null;
  media: HTMLVideoElement | null;
  /** true mientras una pantalla de vídeo (p. ej. la del reproductor) muestra la imagen. */
  videoDocked: boolean;
  library: { tracks: LibraryTrack[]; loaded: boolean; scanning: { done: number; total: number } | null; folders: string[]; extraFolders: string[] };
  playlists: Playlist[];
};

type PlayerActions = {
  playTracks: (tracks: PlayerTrack[], startIndex?: number) => void;
  addToQueue: (tracks: PlayerTrack[], mode?: "next" | "end") => void;
  removeFromQueue: (index: number) => void;
  moveInQueue: (from: number, to: number) => void;
  insertInQueue: (tracks: PlayerTrack[], position: number) => void;
  clearQueue: () => void;
  jumpTo: (index: number) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  setVolume: (value: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setRate: (value: number) => void;
  setEq: (gains: number[]) => void;
  setEqEnabled: (enabled: boolean) => void;
  setPreamp: (value: number) => void;
  setSleep: (minutes: number | null) => void;
  refreshLibrary: (force?: boolean) => Promise<LibraryTrack[]>;
  setPlaylists: (playlists: Playlist[]) => void;
  /** Muestra la imagen del vídeo dentro de `container`; con null vuelve a la ventanita flotante. */
  dockVideo: (container: HTMLElement | null) => void;
};

const PlayerContext = createContext<(PlayerState & PlayerActions) | null>(null);

export function usePlayer() {
  const value = useContext(PlayerContext);
  if (!value) throw new Error("usePlayer fuera de PlayerProvider");
  return value;
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

export function PlayerProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const audioRef = useRef<HTMLVideoElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [videoDocked, setVideoDocked] = useState(false);
  const [miniClosed, setMiniClosed] = useState(false);
  const graphRef = useRef<{ context: AudioContext; filters: BiquadFilterNode[]; preamp: GainNode; analyser: AnalyserNode } | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [original, setOriginal] = useState<PlayerTrack[] | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [sleepAt, setSleepAt] = useState<number | null>(null);
  const [library, setLibrary] = useState<PlayerState["library"]>({ tracks: [], loaded: false, scanning: null, folders: [], extraFolders: [] });
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const restoredRef = useRef<{ position: number } | null>(null);
  const wantPlayRef = useRef(false);
  const stateRef = useRef({ queue, index, settings });
  stateRef.current = { queue, index, settings };

  const current = queue[index] ?? null;

  // ── Elemento de audio único para toda la app ──
  useEffect(() => {
    // Un <video> sirve para todo: suena igual que un <audio> y además puede mostrar imagen.
    // Siempre está dentro del documento (si se sacara, el navegador lo pausaría).
    const audio = document.createElement("video");
    audio.preload = "auto";
    audio.crossOrigin = "use-credentials";
    audio.playsInline = true;
    audio.disablePictureInPicture = false;
    audio.className = "player-video";
    hostRef.current?.appendChild(audio);
    audioRef.current = audio;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Saved | null;
      if (saved) {
        setSettings({ ...defaultSettings, ...saved.settings });
        // Las vistas previas de internet caducan: solo se recuerda la música de la biblioteca.
        const keep = (saved.queue ?? []).filter((track) => !track.id.startsWith("stream:"));
        setQueue(keep);
        setOriginal(saved.original?.filter((track) => !track.id.startsWith("stream:")) ?? null);
        const savedCurrent = saved.queue?.[saved.index];
        const restoredIndex = savedCurrent ? keep.findIndex((track) => track.id === savedCurrent.id) : -1;
        setIndex(Math.max(0, restoredIndex));
        if (restoredIndex >= 0) restoredRef.current = { position: saved.position ?? 0 };
      }
    } catch { /* sin estado guardado */ }
    return () => { audio.pause(); audio.src = ""; audio.remove(); };
  }, []);

  // Guardar el estado (cola, posición y ajustes) para el próximo arranque.
  useEffect(() => {
    const save = () => {
      const saved: Saved = { settings, queue: queue.slice(0, 2000), original: original?.slice(0, 2000) ?? null, index, position: audioRef.current?.currentTime ?? 0 };
      try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* sin espacio */ }
    };
    save();
    const timer = setInterval(save, 5000);
    window.addEventListener("beforeunload", save);
    return () => { clearInterval(timer); window.removeEventListener("beforeunload", save); };
  }, [settings, queue, original, index]);

  const ensureGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || graphRef.current) {
      void graphRef.current?.context.resume();
      return;
    }
    try {
      const context = new AudioContext();
      const source = context.createMediaElementSource(audio);
      const preamp = context.createGain();
      const filters = eqBands.map((frequency, band) => {
        const filter = context.createBiquadFilter();
        filter.type = band === 0 ? "lowshelf" : band === eqBands.length - 1 ? "highshelf" : "peaking";
        filter.frequency.value = frequency;
        filter.Q.value = 1.1;
        return filter;
      });
      const analyserNode = context.createAnalyser();
      analyserNode.fftSize = 2048;
      analyserNode.smoothingTimeConstant = 0.78;
      source.connect(preamp);
      let node: AudioNode = preamp;
      for (const filter of filters) { node.connect(filter); node = filter; }
      node.connect(analyserNode);
      analyserNode.connect(context.destination);
      graphRef.current = { context, filters, preamp, analyser: analyserNode };
      setAnalyser(analyserNode);
    } catch {
      // Sin Web Audio el reproductor funciona igual, solo sin ecualizador ni visualizador.
    }
  }, []);

  // Ecualizador y preamplificador.
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.filters.forEach((filter, band) => { filter.gain.setTargetAtTime(settings.eqEnabled ? settings.eq[band] ?? 0 : 0, graph.context.currentTime, 0.03); });
    graph.preamp.gain.setTargetAtTime(settings.eqEnabled ? Math.pow(10, settings.preamp / 20) : 1, graph.context.currentTime, 0.03);
  }, [settings.eq, settings.eqEnabled, settings.preamp, analyser]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = settings.volume;
    audio.muted = settings.muted;
    audio.playbackRate = settings.rate;
    audio.preservesPitch = true;
  }, [settings.volume, settings.muted, settings.rate]);

  // Cargar la canción actual.
  const currentSrc = current ? absolute(current.src) : null;
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!currentSrc) {
      audio.removeAttribute("src");
      audio.load();
      setPlaying(false);
      return;
    }
    if (audio.src === currentSrc) return;
    setError(null);
    setTime(0);
    setDuration(current?.durationSeconds ?? 0);
    setBuffered(0);
    setLoading(true);
    audio.src = currentSrc;
    audio.playbackRate = stateRef.current.settings.rate;
    const restore = restoredRef.current;
    restoredRef.current = null;
    if (restore && restore.position > 0) {
      const onMeta = () => { audio.currentTime = Math.min(restore.position, Math.max(0, (audio.duration || restore.position) - 1)); };
      audio.addEventListener("loadedmetadata", onMeta, { once: true });
    }
    if (wantPlayRef.current) {
      ensureGraph();
      void audio.play().catch(() => undefined);
    }
  }, [currentSrc, current?.durationSeconds, ensureGraph]);

  const next = useCallback((auto = false) => {
    const { queue: list, index: position, settings: options } = stateRef.current;
    if (list.length === 0) return;
    if (auto && options.repeat === "one") {
      const audio = audioRef.current;
      if (audio) { audio.currentTime = 0; void audio.play(); }
      return;
    }
    if (position + 1 < list.length) {
      wantPlayRef.current = true;
      setIndex(position + 1);
    } else if (options.repeat === "all" || !auto) {
      wantPlayRef.current = options.repeat === "all" || !auto;
      setIndex(0);
      if (list.length === 1 && audioRef.current) { audioRef.current.currentTime = 0; void audioRef.current.play(); }
    } else {
      wantPlayRef.current = false;
      setPlaying(false);
    }
  }, []);

  // Eventos del elemento de audio.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setTime(audio.currentTime);
    const onDuration = () => { if (Number.isFinite(audio.duration)) setDuration(audio.duration); };
    const onProgress = () => { if (audio.buffered.length) setBuffered(audio.buffered.end(audio.buffered.length - 1)); };
    const onPlay = () => { setPlaying(true); wantPlayRef.current = true; };
    const onPause = () => setPlaying(false);
    const onWaiting = () => setLoading(true);
    const onReady = () => setLoading(false);
    const onEnded = () => next(true);
    const onError = () => {
      setLoading(false);
      if (!audio.getAttribute("src")) return;
      setError("No se puede reproducir este archivo. Puede que se haya movido o que esté dañado.");
      setPlaying(false);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("loadedmetadata", onDuration);
    audio.addEventListener("progress", onProgress);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("canplay", onReady);
    audio.addEventListener("playing", onReady);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("loadedmetadata", onDuration);
      audio.removeEventListener("progress", onProgress);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("canplay", onReady);
      audio.removeEventListener("playing", onReady);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [next]);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.getAttribute("src")) return;
    wantPlayRef.current = true;
    ensureGraph();
    void audio.play().catch(() => undefined);
  }, [ensureGraph]);

  const pause = useCallback(() => {
    wantPlayRef.current = false;
    audioRef.current?.pause();
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) play();
    else pause();
  }, [play, pause]);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const position = stateRef.current.index;
    wantPlayRef.current = true;
    if (position > 0) setIndex(position - 1);
    else if (audio) audio.currentTime = 0;
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(seconds)) return;
    audio.currentTime = Math.max(0, Math.min(seconds, Number.isFinite(audio.duration) ? audio.duration - 0.05 : seconds));
    setTime(audio.currentTime);
  }, []);

  const playTracks = useCallback((tracks: PlayerTrack[], startIndex = 0) => {
    if (tracks.length === 0) return;
    const { settings: options } = stateRef.current;
    wantPlayRef.current = true;
    ensureGraph();
    if (options.shuffle) {
      const first = tracks[startIndex];
      const rest = shuffled(tracks.filter((_, position) => position !== startIndex));
      setOriginal(tracks);
      setQueue([first, ...rest]);
      setIndex(0);
    } else {
      setOriginal(null);
      setQueue(tracks);
      setIndex(startIndex);
    }
    const audio = audioRef.current;
    // Misma canción que ya estaba cargada: empezar desde el principio.
    if (audio && audio.src === absolute(tracks[startIndex].src)) {
      audio.currentTime = 0;
      void audio.play().catch(() => undefined);
    }
  }, [ensureGraph]);

  const addToQueue = useCallback((tracks: PlayerTrack[], mode: "next" | "end" = "end") => {
    if (tracks.length === 0) return;
    const { queue: list, index: position } = stateRef.current;
    if (list.length === 0) {
      setQueue(tracks);
      setIndex(0);
      return;
    }
    const at = mode === "next" ? position + 1 : list.length;
    setQueue([...list.slice(0, at), ...tracks, ...list.slice(at)]);
    setOriginal((value) => (value ? [...value, ...tracks] : value));
  }, []);

  const insertInQueue = useCallback((tracks: PlayerTrack[], at: number) => {
    const { queue: list, index: position } = stateRef.current;
    const target = Math.max(0, Math.min(list.length, at));
    setQueue([...list.slice(0, target), ...tracks, ...list.slice(target)]);
    if (list.length > 0 && target <= position) setIndex(position + tracks.length);
  }, []);

  const removeFromQueue = useCallback((at: number) => {
    const { queue: list, index: position } = stateRef.current;
    if (at < 0 || at >= list.length) return;
    const nextList = list.filter((_, item) => item !== at);
    setQueue(nextList);
    if (at < position) setIndex(position - 1);
    else if (at === position) {
      wantPlayRef.current = !audioRef.current?.paused;
      setIndex(Math.min(position, Math.max(0, nextList.length - 1)));
    }
  }, []);

  const moveInQueue = useCallback((from: number, to: number) => {
    const { queue: list, index: position } = stateRef.current;
    if (from === to || from < 0 || from >= list.length) return;
    const nextList = [...list];
    const [item] = nextList.splice(from, 1);
    const target = Math.max(0, Math.min(nextList.length, to > from ? to - 1 : to));
    nextList.splice(target, 0, item);
    setQueue(nextList);
    if (from === position) setIndex(target);
    else if (from < position && target >= position) setIndex(position - 1);
    else if (from > position && target <= position) setIndex(position + 1);
  }, []);

  const clearQueue = useCallback(() => {
    const audio = audioRef.current;
    const currentTrack = stateRef.current.queue[stateRef.current.index];
    // Se conserva la canción que está sonando.
    if (currentTrack && audio && !audio.paused) {
      setQueue([currentTrack]);
      setIndex(0);
    } else {
      setQueue([]);
      setIndex(0);
    }
    setOriginal(null);
  }, []);

  const jumpTo = useCallback((at: number) => {
    wantPlayRef.current = true;
    ensureGraph();
    setIndex(at);
    const audio = audioRef.current;
    const target = stateRef.current.queue[at];
    if (audio && target && audio.src === absolute(target.src)) {
      audio.currentTime = 0;
      void audio.play().catch(() => undefined);
    }
  }, [ensureGraph]);

  const updateSettings = useCallback((patch: Partial<Settings>) => setSettings((value) => ({ ...value, ...patch })), []);

  const toggleShuffle = useCallback(() => {
    const { queue: list, index: position, settings: options } = stateRef.current;
    if (!options.shuffle) {
      // Baraja lo que queda por sonar; la canción actual sigue igual.
      setOriginal(list);
      const currentTrack = list[position];
      if (currentTrack) {
        setQueue([...list.slice(0, position + 1), ...shuffled(list.slice(position + 1))]);
      }
    } else if (original) {
      const currentTrack = list[position];
      setQueue(original);
      setIndex(Math.max(0, original.findIndex((track) => track.id === currentTrack?.id)));
      setOriginal(null);
    }
    updateSettings({ shuffle: !options.shuffle });
  }, [original, updateSettings]);

  // Temporizador para dormir.
  useEffect(() => {
    if (!sleepAt) return;
    const timer = setInterval(() => {
      if (Date.now() >= sleepAt) {
        const audio = audioRef.current;
        if (audio) {
          // Bajada suave de volumen antes de parar.
          const start = audio.volume;
          let step = 0;
          const fade = setInterval(() => {
            step += 1;
            audio.volume = Math.max(0, start * (1 - step / 20));
            if (step >= 20) { clearInterval(fade); audio.pause(); audio.volume = start; }
          }, 100);
        }
        setSleepAt(null);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [sleepAt]);

  // Biblioteca y listas.
  const refreshLibrary = useCallback(async (force = false) => {
    try {
      const data = await api<{ tracks: LibraryTrack[]; folders: string[]; extraFolders: string[]; scan: { running: boolean; done: number; total: number } }>(`/api/library${force ? "?refresh=1" : ""}`);
      setLibrary({ tracks: data.tracks, loaded: true, scanning: data.scan.running ? { done: data.scan.done, total: data.scan.total } : null, folders: data.folders, extraFolders: data.extraFolders });
      return data.tracks;
    } catch {
      setLibrary((value) => ({ ...value, loaded: true }));
      return [];
    }
  }, []);

  useEffect(() => {
    void refreshLibrary(true);
    void api<{ playlists: Playlist[] }>("/api/playlists").then((data) => setPlaylists(data.playlists)).catch(() => undefined);
  }, [refreshLibrary]);

  // Mientras se revisan las carpetas, se actualiza la lista cada poco.
  useEffect(() => {
    if (!library.scanning) return;
    const timer = setTimeout(() => void refreshLibrary(), 1200);
    return () => clearTimeout(timer);
  }, [library.scanning, refreshLibrary]);

  // Teclas multimedia y controles de Windows (Media Session).
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    if (current) {
      session.metadata = new MediaMetadata({ title: current.title, artist: current.artist ?? "", album: current.album ?? "AntiTube", artwork: current.cover ? [{ src: absolute(current.cover) ?? "", sizes: "512x512" }] : [] });
    }
    session.setActionHandler("play", play);
    session.setActionHandler("pause", pause);
    session.setActionHandler("nexttrack", () => next());
    session.setActionHandler("previoustrack", previous);
    session.setActionHandler("seekto", (details) => { if (details.seekTime !== undefined) seek(details.seekTime); });
    session.setActionHandler("seekbackward", () => seek((audioRef.current?.currentTime ?? 0) - 10));
    session.setActionHandler("seekforward", () => seek((audioRef.current?.currentTime ?? 0) + 10));
  }, [current, play, pause, next, previous, seek]);

  useEffect(() => {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [playing]);

  const dockVideo = useCallback((container: HTMLElement | null) => {
    const video = audioRef.current;
    if (!video) return;
    // appendChild mueve el elemento sin sacarlo del documento: la reproducción no se corta.
    if (container) container.appendChild(video);
    else hostRef.current?.appendChild(video);
    setVideoDocked(Boolean(container));
  }, []);

  useEffect(() => { setMiniClosed(false); }, [current?.id]);

  const value = useMemo(() => ({
    queue, index, current, playing, loading, error, time, duration, buffered, settings, sleepAt, analyser, media: audioRef.current, videoDocked, library, playlists,
    playTracks, addToQueue, removeFromQueue, moveInQueue, insertInQueue, clearQueue, jumpTo, toggle, play, pause,
    next: () => next(false), previous, seek,
    setVolume: (volume: number) => updateSettings({ volume: Math.max(0, Math.min(1, volume)), muted: false }),
    toggleMute: () => updateSettings({ muted: !stateRef.current.settings.muted }),
    toggleShuffle,
    cycleRepeat: () => updateSettings({ repeat: stateRef.current.settings.repeat === "off" ? "all" : stateRef.current.settings.repeat === "all" ? "one" : "off" }),
    setRate: (rate: number) => updateSettings({ rate }),
    setEq: (eq: number[]) => { ensureGraph(); updateSettings({ eq, eqEnabled: true }); },
    setEqEnabled: (eqEnabled: boolean) => { ensureGraph(); updateSettings({ eqEnabled }); },
    setPreamp: (preamp: number) => updateSettings({ preamp }),
    setSleep: (minutes: number | null) => setSleepAt(minutes ? Date.now() + minutes * 60_000 : null),
    refreshLibrary, setPlaylists, dockVideo
  }), [queue, index, current, playing, loading, error, time, duration, buffered, settings, sleepAt, analyser, videoDocked, dockVideo, library, playlists, playTracks, addToQueue, removeFromQueue, moveInQueue, insertInQueue, clearQueue, jumpTo, toggle, play, pause, next, previous, seek, updateSettings, toggleShuffle, ensureGraph, refreshLibrary]);

  const showMini = current?.kind === "video" && !videoDocked && !miniClosed;
  return <PlayerContext.Provider value={value}>
    {children}
    <div className={`player-video-host${showMini ? " is-mini" : ""}`} aria-hidden={!showMini}>
      <div ref={hostRef} className="player-video-frame" onClick={toggle} />
      {showMini && <div className="mini-video-bar">
        <span title={current?.title}>{current?.title}</span>
        <Link href="/reproductor/" className="icon-button" aria-label="Abrir en el reproductor" title="Abrir en el reproductor">⤢</Link>
        <button type="button" className="icon-button" onClick={() => setMiniClosed(true)} aria-label="Ocultar vídeo" title="Ocultar (sigue sonando)">×</button>
      </div>}
    </div>
  </PlayerContext.Provider>;
}

/** Vista previa de un resultado de internet en el reproductor. */
export async function previewTrack(url: string, fallback: { title: string; artist: string | null; cover: string | null; durationSeconds: number | null }, kind: "audio" | "video" = "audio"): Promise<PlayerTrack> {
  const data = await api<{ streamUrl: string; hasVideo: boolean; durationSeconds: number | null; title: string | null; thumbnailUrl: string | null }>("/api/preview", { body: { url, kind: kind === "video" ? "single" : "audio" } });
  return {
    id: `stream:${data.streamUrl}`,
    title: data.title ?? fallback.title,
    artist: fallback.artist,
    album: "Vista previa",
    durationSeconds: data.durationSeconds ?? fallback.durationSeconds,
    cover: fallback.cover ?? data.thumbnailUrl,
    src: data.streamUrl,
    kind: kind === "video" && data.hasVideo ? "video" : "audio",
    format: "STREAM",
    lossless: false,
    needsTranscode: false,
    sourceUrl: url
  };
}

export { apiUrl };
