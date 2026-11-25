"use client";

import { useEffect, useState } from "react";
import { AppUpdateBanner } from "./AppUpdate";
import AntiTubeLogo from "../AntiTubeLogo";
import { apiUrl } from "../runtime";
import SetupPanel, { type SetupStatus, type SetupStep } from "./SetupPanel";

const readyKey = "antitube-desktop-ready";

type Phase = "init" | "booting" | "setup" | "ready" | "failed";

type LogLine = { tag: "OK" | ".." | "FAIL"; text: string };

/** Arranque como el de una terminal: cada paso real aparece como una línea del registro. */
function BootLog({ engine, tools, detail }: Readonly<{ engine: SetupStep["status"]; tools: SetupStep["status"]; detail: string }>) {
  const lines: LogLine[] = [
    { tag: "OK", text: "antitube 1.0 · interfaz cargada" },
    { tag: "OK", text: "tema, efectos y reproductor preparados" }
  ];
  if (engine === "error") lines.push({ tag: "FAIL", text: detail });
  else if (engine !== "done") lines.push({ tag: "..", text: `arrancando el motor local en 127.0.0.1 · ${detail.toLowerCase()}` });
  else {
    lines.push({ tag: "OK", text: "motor local en línea · solo accesible desde este equipo" });
    if (tools === "done") lines.push({ tag: "OK", text: "yt-dlp, FFmpeg y SHAZAM comprobados" }, { tag: "OK", text: "listo ▸ abriendo AntiTube" });
    else lines.push({ tag: "..", text: "buscando yt-dlp, FFmpeg y SHAZAM en tu equipo" });
  }
  const progress = engine === "error" ? 100 : engine !== "done" ? 35 : tools === "done" ? 100 : 70;
  return <div className="boot-log" aria-live="polite">
    {lines.map((line, index) => <div key={`${index}-${line.tag}`} className={`boot-line is-${line.tag === "OK" ? "ok" : line.tag === "FAIL" ? "err" : "run"}`}><span className="boot-tag">[{line.tag === ".." ? " .. " : line.tag === "OK" ? " OK " : "FAIL"}]</span><span>{line.text}</span></div>)}
    <div className="boot-bar"><i style={{ width: `${progress}%` }} /></div>
  </div>;
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
        : <BootLog engine={engine} tools={tools} detail={detail} />}
    </div>
  </main>;
}
