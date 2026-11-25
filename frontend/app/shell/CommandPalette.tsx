"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePlayer } from "../player/PlayerContext";
import { toPlayerTrack, type LibraryTrack } from "../player/types";
import { sendToOmnibox } from "./omnibox";
import { themes, useTheme } from "./theme";

type Command = { id: string; group: string; label: string; hint?: string; glyph: string; keywords?: string; run: () => void };

const routes = [
  { href: "/", label: "Descargar", hint: "Buscar y bajar", glyph: "↓" },
  { href: "/reproductor/", label: "Reproductor", hint: "Tu música y vídeos", glyph: "◉" },
  { href: "/descargas/", label: "Descargas", hint: "Cola y progreso", glyph: "≡" },
  { href: "/shazam/", label: "SHAZAM", hint: "Reconocer canciones", glyph: "∿" },
  { href: "/herramientas/", label: "Ajustes", hint: "Herramientas y apariencia", glyph: "⚙" }
];

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Puntuación sencilla: coincidencia al principio > palabra > subsecuencia. 0 = no encaja. */
function score(query: string, text: string): number {
  if (!query) return 1;
  const haystack = normalize(text);
  const needle = normalize(query);
  if (haystack.startsWith(needle)) return 100;
  if (haystack.includes(` ${needle}`)) return 80;
  if (haystack.includes(needle)) return 60;
  let position = 0;
  for (const char of needle) {
    position = haystack.indexOf(char, position);
    if (position < 0) return 0;
    position += 1;
  }
  return 20;
}

function looksLikeUrl(value: string): boolean {
  return /^(https?:\/\/|www\.)\S+$/i.test(value.trim()) || /^[\w-]+(\.[\w-]+)+\/\S*$/.test(value.trim());
}

export function openCommandPalette() {
  window.dispatchEvent(new Event("antitube-command-palette"));
}

/**
 * Paleta de comandos estilo terminal (Ctrl+K): navegar, controlar el
 * reproductor, buscar en tu biblioteca o en internet y cambiar el tema.
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const player = usePlayer();
  const { theme, effects, setTheme, setEffects } = useTheme();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "k" || event.key.toLowerCase() === "p")) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("antitube-command-palette", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("antitube-command-palette", onOpen); };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const close = () => setOpen(false);

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => router.push(href);
    const list: Command[] = [
      ...routes.map((route) => ({ id: `go:${route.href}`, group: "Ir a", label: route.label, hint: route.hint, glyph: route.glyph, keywords: "ir abrir pagina seccion", run: go(route.href) })),
      { id: "player:toggle", group: "Reproductor", label: player.playing ? "Pausar" : "Reproducir", hint: player.current?.title ?? "Nada en la cola", glyph: player.playing ? "❚❚" : "▶", keywords: "play pause reproducir pausar", run: player.toggle },
      { id: "player:next", group: "Reproductor", label: "Siguiente", glyph: "⏭", keywords: "next siguiente cancion", run: player.next },
      { id: "player:previous", group: "Reproductor", label: "Anterior", glyph: "⏮", keywords: "previous anterior", run: player.previous },
      { id: "player:shuffle", group: "Reproductor", label: player.settings.shuffle ? "Desactivar aleatorio" : "Activar aleatorio", glyph: "⤮", keywords: "shuffle aleatorio mezclar", run: player.toggleShuffle },
      { id: "player:repeat", group: "Reproductor", label: "Cambiar repetición", hint: player.settings.repeat === "off" ? "Ahora: sin repetir" : player.settings.repeat === "all" ? "Ahora: repetir todo" : "Ahora: repetir una", glyph: "↻", keywords: "repeat repetir bucle", run: player.cycleRepeat },
      { id: "player:mute", group: "Reproductor", label: player.settings.muted ? "Activar sonido" : "Silenciar", glyph: "🔇", keywords: "mute silencio volumen", run: player.toggleMute },
      { id: "player:immersive", group: "Reproductor", label: "Modo inmersivo", hint: "Visualizador a pantalla completa", glyph: "◎", keywords: "inmersivo pantalla completa visualizador fullscreen", run: () => window.dispatchEvent(new Event("antitube-immersive")) },
      { id: "player:all", group: "Reproductor", label: "Toda mi música en aleatorio", hint: `${player.library.tracks.filter((track) => track.kind === "audio").length} canciones`, glyph: "✦", keywords: "todo aleatorio biblioteca shuffle", run: () => { const tracks = player.library.tracks.filter((track) => track.kind === "audio").sort(() => Math.random() - 0.5); player.playTracks(tracks.map(toPlayerTrack)); } },
      ...themes.map((item) => ({ id: `theme:${item.id}`, group: "Apariencia", label: `Tema ${item.label}`, hint: item.id === theme.id ? "En uso" : item.hint, glyph: "■", keywords: "tema color apariencia theme", run: () => setTheme(item.id) })),
      { id: "fx:crt", group: "Apariencia", label: effects.crt ? "Quitar efecto CRT" : "Activar efecto CRT", hint: "Líneas de barrido de monitor antiguo", glyph: "▤", keywords: "crt scanlines efecto monitor", run: () => setEffects({ crt: !effects.crt }) },
      { id: "fx:reactive", group: "Apariencia", label: effects.reactive ? "Fondo quieto" : "Fondo que late con la música", glyph: "≋", keywords: "fondo reactivo musica animacion", run: () => setEffects({ reactive: !effects.reactive }) },
      { id: "fx:motion", group: "Apariencia", label: effects.motion ? "Reducir animaciones" : "Activar animaciones", glyph: "◌", keywords: "animaciones movimiento rendimiento", run: () => setEffects({ motion: !effects.motion }) },
      ...player.playlists.map((playlist) => ({ id: `playlist:${playlist.id}`, group: "Listas", label: playlist.name, hint: `${playlist.trackIds.length} canciones`, glyph: "☰", keywords: "lista playlist reproducir", run: () => { const byId = new Map(player.library.tracks.map((track) => [track.id, track])); const tracks = playlist.trackIds.map((id) => byId.get(id)).filter((track): track is LibraryTrack => Boolean(track)); if (tracks.length) player.playTracks(tracks.map(toPlayerTrack)); } }))
    ];
    return list;
  }, [router, player, theme.id, effects, setTheme, setEffects]);

  const results = useMemo(() => {
    const text = query.trim();
    const scored = commands
      .map((command) => {
        const keyword = score(text, `${command.group} ${command.keywords ?? ""}`);
        return { command, value: Math.max(score(text, command.label), keyword >= 60 ? keyword * 0.6 : 0) };
      })
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((item) => item.command);
    const dynamic: Command[] = [];
    if (text) {
      if (looksLikeUrl(text)) dynamic.push({ id: "omni:url", group: "Internet", label: "Analizar enlace", hint: text, glyph: "⇣", run: () => sendToOmnibox(text, (href) => router.push(href), pathname === "/") });
      else dynamic.push({ id: "omni:search", group: "Internet", label: `Buscar «${text}» en internet`, hint: "YouTube, YouTube Music, Bandcamp, Audius…", glyph: "⌕", run: () => sendToOmnibox(text, (href) => router.push(href), pathname === "/") });
      const songs = player.library.tracks
        .map((track) => ({ track, value: Math.max(score(text, track.title), score(text, `${track.artist ?? ""} ${track.album ?? ""}`) * 0.8) }))
        .filter((item) => item.value >= 60)
        .sort((a, b) => b.value - a.value)
        .slice(0, 6)
        .map(({ track }) => ({ id: `song:${track.id}`, group: track.kind === "video" ? "Tus vídeos" : "Tu música", label: track.title, hint: [track.artist, track.album].filter(Boolean).join(" · ") || track.filename, glyph: track.kind === "video" ? "▣" : "♪", run: () => player.playTracks([toPlayerTrack(track)]) }));
      return [...songs, ...scored.slice(0, 14), ...dynamic];
    }
    return scored;
  }, [commands, query, player, router, pathname]);

  useEffect(() => { setSelected(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  const run = (command: Command | undefined) => {
    if (!command) return;
    close();
    command.run();
  };

  let lastGroup = "";
  return <div className="palette-overlay" onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="palette" role="dialog" aria-label="Paleta de comandos">
      <div className="palette-prompt">
        <span className="palette-user">antitube@local</span><span className="palette-path">:~$</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="escribe un comando, una canción o algo que buscar…"
          spellCheck={false}
          aria-label="Comando"
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); close(); }
            else if (event.key === "ArrowDown") { event.preventDefault(); setSelected((value) => Math.min(results.length - 1, value + 1)); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setSelected((value) => Math.max(0, value - 1)); }
            else if (event.key === "Enter") { event.preventDefault(); run(results[selected]); }
          }}
        />
        <kbd>Esc</kbd>
      </div>
      <div className="palette-list" ref={listRef}>
        {results.length === 0 && <p className="palette-empty">command not found: {query}</p>}
        {results.map((command, index) => {
          const header = command.group !== lastGroup ? command.group : null;
          lastGroup = command.group;
          return <div key={command.id}>
            {header && <p className="palette-group">// {header.toLowerCase()}</p>}
            <button type="button" data-index={index} className={`palette-item${index === selected ? " is-selected" : ""}`} onPointerMove={() => setSelected(index)} onClick={() => run(command)}>
              <span className="palette-glyph" aria-hidden="true">{command.glyph}</span>
              <span className="palette-label">{command.label}</span>
              {command.hint && <span className="palette-hint">{command.hint}</span>}
              {index === selected && <span className="palette-enter" aria-hidden="true">↵</span>}
            </button>
          </div>;
        })}
      </div>
      <div className="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> moverse</span><span><kbd>↵</kbd> ejecutar</span><span><kbd>Ctrl</kbd><kbd>K</kbd> abrir/cerrar</span></div>
    </div>
  </div>;
}
