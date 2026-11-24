"use client";

import { useEffect, useState } from "react";
import { AppUpdateBanner } from "./AppUpdate";
import AntiTubeLogo from "../AntiTubeLogo";
import { apiUrl } from "../runtime";
import SetupPanel, { SetupSteps, type SetupStatus, type SetupStep } from "./SetupPanel";

const readyKey = "antitube-desktop-ready";

type Phase = "init" | "booting" | "setup" | "ready" | "failed";

function bootSteps(engine: SetupStep["status"], tools: SetupStep["status"], detail: string): SetupStep[] {
  const base = { optional: false, version: null, source: null, percent: null } as const;
  return [
    { ...base, id: "engine", title: "Abrir AntiTube", description: "Ventana e interfaz cargadas.", status: "done", detail: "Listo" },
    { ...base, id: "ytdlp", title: "Iniciar el motor local", description: "Servidor privado en 127.0.0.1, sin acceso desde la red.", status: engine, detail: engine === "done" ? "En marcha" : detail },
    { ...base, id: "ffmpeg", title: "Comprobar herramientas", description: "yt-dlp, FFmpeg y SHAZAM.", status: tools, detail: tools === "done" ? "Comprobadas" : tools === "checking" ? "Buscando en tu equipo…" : "En espera" }
  ];
}

/**
 * Pantalla de arranque de la versión de escritorio: espera a que el backend
 * responda, comprueba las herramientas y muestra el asistente si falta algo.
 */
export default function DesktopGate({ children }: Readonly<{ children: React.ReactNode }>) {
  const [phase, setPhase] = useState<Phase>("init");
  const [engine, setEngine] = useState<SetupStep["status"]>("checking");
  const [tools, setTools] = useState<SetupStep["status"]>("pending");
  const [detail, setDetail] = useState("Arrancando…");

  // Al navegar entre páginas no repetimos el arranque si ya se completó en esta sesión.
  useEffect(() => {
    setPhase(sessionStorage.getItem(readyKey) === "1" ? "ready" : "booting");
  }, []);

  useEffect(() => {
    if (phase !== "booting") return;
    let cancelled = false;
    const startedAt = Date.now();
    void (async () => {
      // 1. Esperar al backend.
      while (!cancelled) {
        try {
          const response = await fetch(`${apiUrl()}/api/health`);
          if (response.ok) break;
        } catch { /* todavía arrancando */ }
        if (Date.now() - startedAt > 45_000) { setEngine("error"); setDetail("El motor local no ha respondido. Cierra y vuelve a abrir AntiTube; si se repite, revisa backend.log en %LOCALAPPDATA%\\com.ikoloser.antitube."); setPhase("failed"); return; }
        setDetail(`Arrancando… ${Math.round((Date.now() - startedAt) / 1000)} s`);
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (cancelled) return;
      setEngine("done");
      setTools("checking");
      // 2. Esperar a que termine la detección de herramientas.
      while (!cancelled) {
        try {
          const response = await fetch(`${apiUrl()}/api/setup/status`);
          const status = await response.json() as SetupStatus;
          if (!status.running) {
            setTools("done");
            await new Promise((resolve) => setTimeout(resolve, 350));
            if (status.ready) { sessionStorage.setItem(readyKey, "1"); setPhase("ready"); }
            else setPhase("setup");
            return;
          }
        } catch { /* reintentar */ }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    })();
    return () => { cancelled = true; };
  }, [phase]);

  if (phase === "ready") return <>{children}<AppUpdateBanner /></>;
  if (phase === "init") return null;

  return <main className="desktop-gate">
    <div className="desktop-gate-inner">
      <div className="desktop-gate-logo"><AntiTubeLogo /></div>
      {phase === "setup"
        ? <SetupPanel onContinue={() => { sessionStorage.setItem(readyKey, "1"); setPhase("ready"); }} />
        : <div className="setup-card is-compact" aria-live="polite">
            <div className="setup-card-head"><div><p className="setup-kicker">Arranque</p><h2>{phase === "failed" ? "No se pudo iniciar" : "Iniciando AntiTube"}</h2></div></div>
            <SetupSteps steps={bootSteps(engine, tools, detail)} />
          </div>}
    </div>
  </main>;
}
