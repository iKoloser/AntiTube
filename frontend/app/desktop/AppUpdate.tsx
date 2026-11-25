"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiUrl, installUpdate, isDesktop } from "../runtime";

export type AppUpdateStatus = {
  current: string;
  checking: boolean;
  checkedAt: number | null;
  error: string | null;
  available: boolean;
  supported: boolean;
  latest: { version: string; notes: string; publishedAt: string | null; size: number; pageUrl: string } | null;
  download: { status: "idle" | "downloading" | "ready" | "error"; percent: number | null; received: number; total: number | null; path: string | null; error: string | null };
};

/** Extrae la sección «Novedades» de las notas de la release. */
function releaseNotes(notes: string): string[] {
  const section = /##\s*Novedades\s*\n([\s\S]*?)(\n##\s|$)/.exec(notes)?.[1] ?? "";
  return section.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 12);
}

const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

async function call(path: string, method = "GET"): Promise<AppUpdateStatus> {
  const response = await fetch(`${apiUrl()}${path}`, { method });
  return await response.json() as AppUpdateStatus;
}

export function useAppUpdate(autoCheck: boolean) {
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);

  const refresh = useCallback(async () => {
    try { setStatus(await call("/api/app/update")); } catch { /* el motor aún no responde */ }
  }, []);

  const check = useCallback(async () => {
    setStatus((value) => value ? { ...value, checking: true } : value);
    try {
      let data = await call("/api/app/update/check", "POST");
      // Si otra parte de la interfaz ya estaba comprobando, esperamos su resultado.
      for (let attempt = 0; data.checking && attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        data = await call("/api/app/update");
      }
      setStatus(data);
    } catch { /* sin conexión */ }
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    void (async () => {
      try {
        const data = await call("/api/app/update");
        setStatus(data);
        if (autoCheck && !data.checkedAt && !data.checking) await check();
      } catch { /* el motor aún no responde */ }
    })();
  }, [autoCheck, check]);

  // Mientras se descarga, se consulta el progreso.
  useEffect(() => {
    if (status?.download.status !== "downloading") return;
    const timer = setTimeout(() => void refresh(), 500);
    return () => clearTimeout(timer);
  }, [status, refresh]);

  const download = useCallback(async () => {
    try { setStatus(await call("/api/app/update/download", "POST")); } catch { /* sin conexión */ }
  }, []);

  return { status, check, download };
}

/** Tarjeta de Herramientas: versión instalada, novedades y botón de actualizar. */
export default function AppUpdatePanel() {
  const { status, check, download } = useAppUpdate(true);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  if (!status) return null;
  const latest = status.latest;
  const notes = latest ? releaseNotes(latest.notes) : [];
  const { download: progress } = status;

  async function install() {
    if (!progress.path) return;
    setInstalling(true);
    setInstallError(null);
    try { await installUpdate(progress.path); } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error));
      setInstalling(false);
    }
  }

  return <section className={`app-update${status.available ? " is-available" : ""}`} aria-label="Actualizar AntiTube">
    <div className="app-update-head">
      <div>
        <p className="setup-kicker">Aplicación</p>
        <h2>{status.available && latest ? `AntiTube ${latest.version} disponible` : "AntiTube está al día"}</h2>
        <p className="setup-muted">Versión instalada: <strong>{status.current}</strong>{latest && !status.available ? ` · última publicada: ${latest.version}` : ""}</p>
      </div>
      <span className="app-update-version">v{status.current}</span>
    </div>

    {status.available && notes.length > 0 && <div className="app-update-notes"><strong>Novedades</strong><ul>{notes.map((line, index) => <li key={index}>{line.replace(/^[-*]\s*/, "")}</li>)}</ul></div>}

    {progress.status === "downloading" && <div className="app-update-progress"><div className={`setup-progress${progress.percent === null ? " is-indeterminate" : ""}`}><div style={progress.percent === null ? undefined : { width: `${progress.percent}%` }} /></div><span>Descargando… {megabytes(progress.received)}{progress.total ? ` de ${megabytes(progress.total)}` : ""}</span></div>}
    {status.error && <div className="notice error" role="alert">ⓘ <span>{status.error}</span></div>}
    {progress.status === "error" && <div className="notice error" role="alert">ⓘ <span>{progress.error}</span></div>}
    {installError && <div className="notice error" role="alert">ⓘ <span>{installError}</span></div>}
    {progress.status === "ready" && <div className="notice" role="status">Instalador listo. AntiTube se cerrará, se actualizará y volverá a abrirse solo. Las descargas en curso se detendrán.</div>}

    <div className="setup-actions">
      {status.available && status.supported && progress.status !== "ready" && <button type="button" className="download-button" disabled={progress.status === "downloading"} onClick={() => void download()}>{progress.status === "downloading" ? `Descargando ${progress.percent ?? 0}%` : progress.status === "error" ? "Reintentar descarga" : `Actualizar a ${latest?.version}`}</button>}
      {progress.status === "ready" && <button type="button" className="download-button" disabled={installing} onClick={() => void install()}>{installing ? "Abriendo instalador…" : "Reiniciar y actualizar"}</button>}
      <button type="button" className="setup-secondary" disabled={status.checking || progress.status === "downloading"} onClick={() => void check()}>{status.checking ? "Buscando…" : "Buscar actualizaciones"}</button>
      {latest && <a className="setup-secondary" href={latest.pageUrl} target="_blank" rel="noreferrer">Ver en GitHub ↗</a>}
    </div>
    {status.checkedAt && <p className="setup-footnote">Última comprobación: {new Date(status.checkedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</p>}
  </section>;
}

/** Aviso flotante que aparece en cualquier página cuando hay una versión nueva. */
export function AppUpdateBanner() {
  const { status } = useAppUpdate(true);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { setDismissed(sessionStorage.getItem("antitube-update-dismissed") === status?.latest?.version); }, [status?.latest?.version]);
  if (!status?.available || !status.latest || dismissed) return null;
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/herramientas")) return null;
  const version = status.latest.version;
  return <div className="app-update-banner" role="status">
    <span><strong>AntiTube {version}</strong> está disponible.</span>
    <Link href="/herramientas/">Actualizar</Link>
    <button type="button" aria-label="Ocultar aviso" onClick={() => { sessionStorage.setItem("antitube-update-dismissed", version); setDismissed(true); }}>×</button>
  </div>;
}
