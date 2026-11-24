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
  update?: { latest: string | null; available: boolean; canUpdate: boolean; note: string; checkedAt: number } | null;
};

export type SetupStatus = { ready: boolean; running: boolean; checkingUpdates?: boolean; error: string | null; platform: string; toolsDirectory: string; steps: SetupStep[] };

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

export function SetupSteps({ steps, onUpdate, busy = false }: Readonly<{ steps: SetupStep[]; onUpdate?: (id: SetupStep["id"]) => void; busy?: boolean }>) {
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
        {step.update && step.status === "done" && <div className={`setup-update${step.update.available ? " is-available" : ""}`}>
          <span>{step.update.available ? "↑ " : "✓ "}{step.update.note}</span>
          {step.update.available && step.update.canUpdate && onUpdate && <button type="button" className="setup-secondary" disabled={busy} onClick={() => onUpdate(step.id)}>Actualizar</button>}
        </div>}
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
  const [isChecking, setIsChecking] = useState(false);

  if (!status) return <div className="setup-card"><p className="setup-muted">{requestError ?? "Comprobando herramientas…"}</p></div>;

  const busy = status.running || status.steps.some((step) => step.status === "checking" || step.status === "running");
  const missingRequired = status.steps.filter((step) => !step.optional && (step.status === "pending" || step.status === "error"));
  const shazamStep = status.steps.find((step) => step.id === "shazam");
  const shazamInstallable = shazamStep?.status === "pending" || shazamStep?.status === "error";
  const needsAction = missingRequired.length > 0 || (includeShazam && shazamInstallable);
  const pendingUpdates = status.steps.filter((step) => step.update?.available && step.update.canUpdate);
  const checkedAt = status.steps.map((step) => step.update?.checkedAt ?? 0).reduce((a, b) => Math.max(a, b), 0);
  const completed = status.steps.filter((step) => step.status === "done").length;

  async function install() {
    setNotice(null);
    await post("/api/setup/install", { includeShazam: includeShazam && shazamInstallable });
  }

  async function checkForUpdates() {
    setIsChecking(true);
    setNotice(null);
    try {
      const data = await post("/api/setup/check-updates") as SetupStatus;
      const available = data.steps?.filter((step) => step.update?.available).length ?? 0;
      setNotice(available > 0 ? `Hay ${available} actualización${available > 1 ? "es" : ""} disponible${available > 1 ? "s" : ""}.` : "Todo está al día.");
    } finally {
      setIsChecking(false);
    }
  }

  async function applyUpdate(id: SetupStep["id"]) {
    setNotice(null);
    await post("/api/setup/update", { id });
  }

  async function applyAll() {
    // Se aplican de una en una: el backend solo ejecuta una tarea a la vez.
    for (const step of pendingUpdates) {
      await post("/api/setup/update", { id: step.id });
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        const response = await fetch(`${apiUrl()}/api/setup/status`);
        const current = await response.json() as SetupStatus;
        if (!current.running) break;
      }
    }
  }


  return <div className={`setup-card${compact ? " is-compact" : ""}`}>
    <div className="setup-card-head">
      <div><p className="setup-kicker">{compact ? "Herramientas" : status.ready ? "Todo preparado" : "Primer arranque"}</p><h2>{compact ? "Estado y actualizaciones" : status.ready ? "Herramientas listas" : "Preparemos AntiTube"}</h2></div>
      <span className="setup-counter">{completed}/{status.steps.length}</span>
    </div>
    {!status.ready && !compact && <p className="setup-muted">AntiTube necesita dos herramientas libres para descargar y convertir. Se instalan una sola vez en tu carpeta de usuario, sin permisos de administrador.</p>}
    <SetupSteps steps={status.steps} busy={busy} onUpdate={(id) => void applyUpdate(id)} />
    {status.error && <div className="notice error" role="alert">ⓘ <span>{status.error}</span></div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {shazamInstallable && <label className="setup-option"><input type="checkbox" checked={includeShazam} disabled={busy} onChange={(event) => setIncludeShazam(event.target.checked)} /><span>Instalar también SHAZAM para reconocer canciones <small>({shazamStep?.version ? "usa tu Python" : "descarga un Python privado, unos 30 MB"})</small></span></label>}
    <div className="setup-actions">
      {(needsAction || (busy && !status.ready && !compact)) && <button type="button" className="download-button" disabled={busy} onClick={() => void install()}>{busy ? "Instalando…" : status.error ? "Reintentar instalación" : missingRequired.length > 0 ? "Instalar y continuar" : "Instalar SHAZAM"}</button>}
      {status.ready && onContinue && <button type="button" className="download-button" disabled={busy} onClick={onContinue}>Empezar a usar AntiTube →</button>}
      {status.ready && <button type="button" className="setup-secondary" disabled={busy || isChecking} onClick={() => void checkForUpdates()}>{isChecking ? "Buscando actualizaciones…" : "Buscar actualizaciones"}</button>}
      {status.ready && pendingUpdates.length > 1 && <button type="button" className="setup-secondary is-accent" disabled={busy} onClick={() => void applyAll()}>Actualizar todo ({pendingUpdates.length})</button>}
      <button type="button" className="setup-secondary" disabled={busy} onClick={() => void post("/api/setup/check")}>Volver a comprobar</button>
    </div>
    {checkedAt > 0 && <p className="setup-footnote">Última comprobación: {new Date(checkedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</p>}
    <p className="setup-footnote">Carpeta de herramientas: <code>{status.toolsDirectory}</code></p>
  </div>;
}
