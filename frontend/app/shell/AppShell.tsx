"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AntiTubeLogo from "../AntiTubeLogo";
import FuturisticBackground from "../FuturisticBackground";
import { useJobs, type JobSummary } from "../jobs";
import { DragProvider } from "../player/dnd";
import { PlayerProvider, usePlayer } from "../player/PlayerContext";
import PlayerDock, { PlayerDropHandler } from "../player/PlayerDock";
import { toPlayerTrack } from "../player/types";
import { api, apiUrl, isDesktop, listenTauri, setCloseToTray } from "../runtime";
import { IconDownload, IconFolder, IconPlayer, IconQueue, IconTools, IconWave } from "./icons";
import CommandPalette, { openCommandPalette } from "./CommandPalette";
import DiscordBridge from "./DiscordPresence";
import Immersive from "./Immersive";
import LiveBackground from "./LiveBackground";
import Telemetry from "./Telemetry";
import { ThemeProvider } from "./theme";
import { ToastProvider, useToast } from "./Toasts";

export const closeToTrayKey = "antitube-close-to-tray";

const navItems = [
  { href: "/", label: "Descargar", hint: "Buscar y bajar", icon: IconDownload, match: (path: string) => path === "/" },
  { href: "/reproductor/", label: "Reproductor", hint: "Tu música", icon: IconPlayer, match: (path: string) => path.startsWith("/reproductor") },
  { href: "/descargas/", label: "Descargas", hint: "Cola y progreso", icon: IconQueue, match: (path: string) => path.startsWith("/descargas") },
  { href: "/shazam/", label: "SHAZAM", hint: "Reconocer canciones", icon: IconWave, match: (path: string) => path.startsWith("/shazam") },
  { href: "/herramientas/", label: "Ajustes", hint: "Herramientas y app", icon: IconTools, match: (path: string) => path.startsWith("/herramientas") }
];

const audioExtensions = /\.(mp3|m4a|opus|flac)$/i;

/** Avisa dentro de la app cuando termina una descarga y la añade a la biblioteca. */
function JobWatcher({ jobs }: Readonly<{ jobs: JobSummary[] }>) {
  const seen = useRef<Map<string, JobSummary["status"]> | null>(null);
  const toast = useToast();
  const player = usePlayer();

  useEffect(() => {
    if (jobs.length === 0 && !seen.current) return;
    const previous = seen.current;
    seen.current = new Map(jobs.map((job) => [job.jobId, job.status]));
    if (!previous) return;
    for (const job of jobs) {
      const before = previous.get(job.jobId);
      if (!before || before === job.status) continue;
      if (job.status === "completed") {
        const files = (job.result?.files ?? []).map((file) => file.filename).filter((name) => audioExtensions.test(name));
        toast({
          title: "Descarga completada",
          body: job.title,
          tone: "ok",
          action: files.length > 0 ? {
            label: "▶ Reproducir",
            run: () => {
              void player.refreshLibrary(true).then((tracks) => {
                const found = files.map((name) => tracks.find((track) => track.filename === name)).filter((track) => track !== undefined);
                if (found.length) player.playTracks(found.map(toPlayerTrack));
              });
            }
          } : undefined
        });
        void player.refreshLibrary(true);
      } else if (job.status === "failed") {
        toast({ title: "Descarga fallida", body: job.error?.message ?? job.title, tone: "error" });
      }
    }
  }, [jobs, toast, player]);
  return null;
}

/** Órdenes del menú de la bandeja de Windows. */
function TrayBridge() {
  const router = useRouter();
  const player = usePlayer();
  const playerRef = useRef(player);
  playerRef.current = player;
  useEffect(() => {
    const onTray = (event: Event) => {
      const action = String((event as CustomEvent).detail ?? "");
      if (action.startsWith("navigate:")) router.push(action.slice("navigate:".length));
      else if (action === "player:toggle") playerRef.current.toggle();
      else if (action === "player:next") playerRef.current.next();
      else if (action === "player:previous") playerRef.current.previous();
    };
    window.addEventListener("antitube-tray", onTray);
    return () => window.removeEventListener("antitube-tray", onTray);
  }, [router]);
  return null;
}

/** Archivos o carpetas arrastrados desde el Explorador de Windows a la ventana. */
function FileDropBridge() {
  const [over, setOver] = useState(false);
  const player = usePlayer();
  const toast = useToast();
  const playerRef = useRef(player);
  playerRef.current = player;

  useEffect(() => {
    if (!isDesktop) return;
    const stops: Array<() => void> = [];
    let cancelled = false;
    void (async () => {
      const add = async (event: string, handler: (payload: { paths?: string[] }) => void) => {
        const stop = await listenTauri(event, handler);
        if (cancelled) stop();
        else stops.push(stop);
      };
      await add("tauri://drag-enter", () => setOver(true));
      await add("tauri://drag-over", () => setOver(true));
      await add("tauri://drag-leave", () => setOver(false));
      await add("tauri://drag-drop", (payload) => {
        setOver(false);
        const paths = payload.paths ?? [];
        if (paths.length === 0) return;
        void api<{ added: string[] }>("/api/library/import", { body: { paths } }).then(async (result) => {
          if (result.added.length === 0) {
            toast({ title: "Nada que añadir", body: "Arrastra archivos de audio o vídeo, o carpetas de música.", tone: "error" });
            return;
          }
          const tracks = await playerRef.current.refreshLibrary(true);
          const added = tracks.filter((track) => result.added.some((item) => track.path === item || track.path.startsWith(`${item}\\`) || track.path.startsWith(`${item}/`)));
          toast({
            title: "Añadido a la biblioteca",
            body: added.length ? `${added.length} archivo(s) listos para escuchar` : "Revisando la carpeta…",
            tone: "ok",
            action: added.length ? { label: "▶ Reproducir", run: () => playerRef.current.playTracks(added.map(toPlayerTrack)) } : undefined
          });
        }).catch((error) => toast({ title: "No se pudo añadir", body: error instanceof Error ? error.message : undefined, tone: "error" }));
      });
    })();
    return () => { cancelled = true; stops.forEach((stop) => stop()); };
  }, [toast]);

  if (!over) return null;
  return <div className="file-drop-overlay" aria-hidden="true"><div><IconFolder size={42} /><strong>Suelta para añadir a tu biblioteca</strong><span>Audio, vídeo o carpetas enteras</span></div></div>;
}

function Shell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname() ?? "/";
  const { jobs, active } = useJobs(1200, 4000);
  const [engine, setEngine] = useState<"online" | "offline">("online");
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!isDesktop) return;
    void setCloseToTray(localStorage.getItem(closeToTrayKey) !== "0");
    setCollapsed(localStorage.getItem("antitube-nav-collapsed") === "1");
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ping = () => fetch(`${apiUrl()}/api/health`).then((response) => { if (!cancelled) setEngine(response.ok ? "online" : "offline"); }).catch(() => { if (!cancelled) setEngine("offline"); });
    void ping();
    const timer = setInterval(ping, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const current = navItems.find((item) => item.match(pathname));

  return <>
  <LiveBackground />
  <div className={`app-shell${collapsed ? " is-collapsed" : ""}`}>
    <aside className="app-sidebar">
      <div className="sidebar-top">
        <Link className="brand" href="/" aria-label="AntiTube, inicio"><AntiTubeLogo /></Link>
        <button type="button" className="sidebar-collapse" onClick={() => { const next = !collapsed; setCollapsed(next); localStorage.setItem("antitube-nav-collapsed", next ? "1" : "0"); }} aria-label={collapsed ? "Expandir menú" : "Contraer menú"}>{collapsed ? "»" : "«"}</button>
      </div>
      <nav className="app-nav" aria-label="Navegación principal">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.match(pathname);
          return <Link key={item.href} href={item.href} className={`app-nav-link${isActive ? " active" : ""}`} aria-current={isActive ? "page" : undefined} title={item.label}>
            <span className="app-nav-icon"><Icon size={19} /></span>
            <span className="app-nav-copy"><strong>{item.label}</strong><small>{item.hint}</small></span>
            {item.href === "/descargas/" && active > 0 && <span className="app-nav-badge" aria-label={`${active} en curso`}>{active}</span>}
          </Link>;
        })}
      </nav>
      <div className="sidebar-status">
        <span className={`status-led is-${engine}`} aria-hidden="true" />
        <div><strong>{engine === "online" ? "MOTOR EN LÍNEA" : "MOTOR SIN RESPUESTA"}</strong><small>{isDesktop ? "127.0.0.1 · local" : "servidor privado"}</small></div>
      </div>
      {!isDesktop && <WebLogout />}
    </aside>
    <div className="app-main">
      <div className="app-topbar">
        <span className="topbar-path">~/antitube/<b>{(current?.label ?? "inicio").toLowerCase()}</b><i className="topbar-caret" /></span>
        <button type="button" className="topbar-command" onClick={openCommandPalette} title="Paleta de comandos"><span>&gt;_ ejecutar comando…</span><kbd>Ctrl</kbd><kbd>K</kbd></button>
        <Telemetry jobs={jobs} active={active} />
      </div>
      <div className="app-content"><div key={pathname} className="page-transition">{children}</div></div>
    </div>
    <PlayerDock />
    <JobWatcher jobs={jobs} />
    <TrayBridge />
    <FileDropBridge />
    <PlayerDropHandler />
    <CommandPalette />
    <Immersive />
    <DiscordBridge />
  </div>
  <div className="crt-overlay" aria-hidden="true" />
  </>;
}

function WebLogout() {
  return <button className="logout-button" type="button" onClick={() => { void fetch(`${apiUrl()}/api/auth/logout`, { method: "POST", credentials: "include" }).then(() => { window.location.href = "/acceso"; }); }}>Salir</button>;
}

export default function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  if (pathname === "/acceso" || pathname === "/acceso/") return <><FuturisticBackground />{children}</>;
  return <ThemeProvider><ToastProvider><PlayerProvider><DragProvider><Shell>{children}</Shell></DragProvider></PlayerProvider></ToastProvider></ThemeProvider>;
}
