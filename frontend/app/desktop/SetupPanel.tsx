"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "../runtime";

export type SetupStep = {
  id: "engine" | "ytdlp" | "ffmpeg" | "shazam";
  title: string;
  description: string;
  optional: boolean;
  status: "pending" | "checking" | "running" | "done" | "error" | "skipped";
  detail: string;
  version: string | null;
  source: "bundled" | "managed" | "system" | null;
  percent: number | null;
};

export type SetupStatus = { ready: boolean; running: boolean; error: string | null; platform: string; toolsDirectory: string; steps: SetupStep[] };

const statusLabel: Record<SetupStep["status"], string> = {
  pending: "Pendiente",
  checking: "Comprobando",
  running: "Instalando",
  done: "Listo",
  error: "Error",
  skipped: "Omitido"
};

const sourceLabel: Record<NonNullable<SetupStep["source"]>, string> = {
  bundled: "incluido",
  managed: "gestionado por AntiTube",
  system: "del sistema"
};

function StepIcon({ step, index }: Readonly<{ step: SetupStep; index: number }>) {
  if (step.status === "done") return <span className="setup-step-icon is-done" aria-hidden="true">✓</span>;
  if (step.status === "error") return <span className="setup-step-icon is-error" aria-hidden="true">!</span>;
  if (step.status === "skipped") return <span className="setup-step-icon is-skipped" aria-hidden="true">–</span>;
  if (step.status === "running" || step.status === "checking") return <span className="setup-step-icon is-running" aria-hidden="true"><span className="setup-spinner" /></span>;
  return <span className="setup-step-icon" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>;
}

export function SetupSteps({ steps }: Readonly<{ steps: SetupStep[] }>) {
  return <ol className="setup-steps">
    {steps.map((step, index) => <li key={step.id} className={`setup-step is-${step.status}`}>
      <StepIcon step={step} index={index} />
      <div className="setup-step-body">
        <div className="setup-step-head">
          <strong>{step.title}{step.optional && <small> · opcional</small>}</strong>
          <span className={`setup-badge is-${step.status}`}>{statusLabel[step.status]}</span>
        </div>
        <p>{step.description}</p>
        <div className="setup-step-detail">
          <span>{step.detail}</span>
          {step.version && <span className="setup-version">{step.version}{step.source ? ` · ${sourceLabel[step.source]}` : ""}</span>}
        </div>
        {step.status === "running" && <div className={`setup-progress${step.percent === null ? " is-indeterminate" : ""}`}><div style={step.percent === null ? undefined : { width: `${step.percent}%` }} /></div>}
      </div>
    </li>)}
  </ol>;
}

/** Hook que consulta el estado de las herramientas mientras haya trabajo en curso. */
export function useSetupStatus() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl()}/api/setup/status`);
      const data = await response.json() as SetupStatus;
      setStatus(data);
      setRequestError(null);
      return data;
    } catch {
      setRequestError("No se puede contactar con el motor local.");
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loop = async () => {
      const data = await refresh();
      if (cancelled) return;
      const busy = !data || data.running || data.steps.some((step) => step.status === "checking" || step.status === "running");
      timer.current = setTimeout(loop, busy ? 400 : 3000);
    };
    void loop();
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
  }, [refresh]);

  const post = useCallback(async (path: string, body?: unknown) => {
    const response = await fetch(`${apiUrl()}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const data = await response.json().catch(() => ({})) as { message?: string; steps?: SetupStep[] };
    if (data.steps) setStatus(data as SetupStatus);
    else await refresh();
    return data;
  }, [refresh]);

  return { status, requestError, refresh, post };
}

/** Asistente completo: lista de pasos, opción de SHAZAM y botones de acción. */
export default function SetupPanel({ onContinue, compact = false }: Readonly<{ onContinue?: () => void; compact?: boolean }>) {
  const { status, requestError, post } = useSetupStatus();
  const [includeShazam, setIncludeShazam] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  if (!status) return <div className="setup-card"><p className="setup-muted">{requestError ?? "Comprobando herramientas…"}</p></div>;

  const busy = status.running || status.steps.some((step) => step.status === "checking" || step.status === "running");
  const missingRequired = status.steps.filter((step) => !step.optional && step.status !== "done");
  const shazamStep = status.steps.find((step) => step.id === "shazam");
  const shazamInstallable = shazamStep?.status === "pending" || shazamStep?.status === "error";
  const needsAction = missingRequired.length > 0 || (includeShazam && shazamInstallable);
  const managedYtDlp = status.steps.find((step) => step.id === "ytdlp")?.source === "managed";
  const completed = status.steps.filter((step) => step.status === "done").length;

  async function install() {
    setNotice(null);
    await post("/api/setup/install", { includeShazam: includeShazam && shazamInstallable });
  }

  async function updateYtDlp() {
    setIsUpdating(true);
    setNotice(null);
    try {
      const data = await post("/api/setup/update-ytdlp");
      setNotice(data.message ?? "Comprobación terminada.");
    } finally {
      setIsUpdating(false);
    }
  }

  return <div className={`setup-card${compact ? " is-compact" : ""}`}>
    <div className="setup-card-head">
      <div><p className="setup-kicker">{status.ready ? "Todo preparado" : "Primer arranque"}</p><h2>{status.ready ? "Herramientas listas" : "Preparemos AntiTube"}</h2></div>
      <span className="setup-counter">{completed}/{status.steps.length}</span>
    </div>
    {!status.ready && !compact && <p className="setup-muted">AntiTube necesita dos herramientas libres para descargar y convertir. Se instalan una sola vez en tu carpeta de usuario, sin permisos de administrador.</p>}
    <SetupSteps steps={status.steps} />
    {status.error && <div className="notice error" role="alert">ⓘ <span>{status.error}</span></div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {shazamInstallable && <label className="setup-option"><input type="checkbox" checked={includeShazam} disabled={busy} onChange={(event) => setIncludeShazam(event.target.checked)} /><span>Instalar también SHAZAM para reconocer canciones <small>({shazamStep?.version ? "usa tu Python" : "descarga un Python privado, unos 30 MB"})</small></span></label>}
    <div className="setup-actions">
      {needsAction && <button type="button" className="download-button" disabled={busy} onClick={() => void install()}>{busy ? "Instalando…" : status.error ? "Reintentar instalación" : missingRequired.length > 0 ? "Instalar y continuar" : "Instalar SHAZAM"}</button>}
      {status.ready && onContinue && <button type="button" className="download-button" disabled={busy} onClick={onContinue}>Empezar a usar AntiTube →</button>}
      {status.ready && managedYtDlp && <button type="button" className="setup-secondary" disabled={busy || isUpdating} onClick={() => void updateYtDlp()}>{isUpdating ? "Buscando actualización…" : "Actualizar yt-dlp"}</button>}
      <button type="button" className="setup-secondary" disabled={busy} onClick={() => void post("/api/setup/check")}>Volver a comprobar</button>
    </div>
    <p className="setup-footnote">Carpeta de herramientas: <code>{status.toolsDirectory}</code></p>
  </div>;
}
