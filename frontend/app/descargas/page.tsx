"use client";

import AntiTubeLogo from "../AntiTubeLogo";
import DownloadsLink from "../DownloadsLink";
import { useJobs, type JobSummary } from "../jobs";
import LogoutButton from "../LogoutButton";
import { apiUrl, isDesktop, revealDownload } from "../runtime";

const statusLabel: Record<JobSummary["status"], string> = {
  queued: "En cola",
  downloading: "Descargando",
  paused: "En pausa",
  completed: "Completada",
  failed: "Error",
  cancelled: "Cancelada"
};

const badgeClass: Record<JobSummary["status"], string> = { queued: "pending", downloading: "running", paused: "pending", completed: "done", failed: "error", cancelled: "skipped" };

function qualityLabel(job: JobSummary): string {
  if (job.format === "mp3") return `MP3 · ${job.quality} kbps`;
  return job.quality === "best" ? "MP4 · mejor calidad" : `MP4 · hasta ${job.quality}p`;
}

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function JobCard({ job, onRemove, onAction }: Readonly<{ job: JobSummary; onRemove: (jobId: string) => void; onAction: (jobId: string, action: "pause" | "resume" | "cancel") => void }>) {
  const running = job.status === "downloading";
  const percent = job.status === "completed" ? 100 : Math.round(job.progress.percent);
  const files = job.result?.archive ? [{ filename: job.result.archive.filename, downloadUrl: job.result.archive.downloadUrl }] : job.result?.files ?? [];
  const detail = job.status === "failed"
    ? job.error?.message ?? "La descarga ha fallado."
    : job.status === "cancelled" ? "Cancelada"
    : job.status === "completed"
      ? files.length === 1 ? `Guardado como ${files[0].filename}` : job.result?.message ?? "Descarga completada"
      : [job.progress.message, job.progress.speed ? `${job.progress.speed}` : null, job.progress.eta ? `ETA ${job.progress.eta}` : null].filter(Boolean).join(" · ");

  return <li className={`job-card is-${job.status}`}>
    <span className="job-icon" aria-hidden="true">{job.isPlaylist ? "▤" : job.format === "mp4" ? "▣" : "♫"}</span>
    <div className="job-body">
      <div className="job-head">
        <strong title={job.title}>{job.title}</strong>
        <span className={`setup-badge is-${badgeClass[job.status]}`}>{statusLabel[job.status]}{job.status === "queued" && job.queuePosition ? ` #${job.queuePosition}` : ""}</span>
      </div>
      <div className="job-meta"><span>{job.platform}</span><span>{qualityLabel(job)}</span>{job.isPlaylist && <span>Playlist{job.progress.total ? ` · ${job.progress.current ?? 0}/${job.progress.total}` : ""}</span>}<span>{timeLabel(job.createdAt)}</span></div>
      {job.status !== "failed" && job.status !== "cancelled" && <div className={`setup-progress${job.status === "queued" || job.status === "paused" ? " is-waiting" : ""}`}><div style={{ width: `${percent}%` }} /></div>}
      <div className="job-detail"><span>{detail}</span>{running && <b>{percent}%</b>}</div>
      {running && job.lastLog && <p className="job-log" title={job.lastLog}>{job.lastLog}</p>}
      {job.isPlaylist && job.items.length > 0 && <details className="job-items" open={running}>
        <summary>Progreso por archivo · {job.items.filter((item) => item.status !== "downloading").length}/{job.progress.total ?? job.items.length}</summary>
        <ol>{job.items.map((item) => <li key={item.index} className={`job-item is-${item.status}`}>
          <span className="job-item-index">{String(item.index).padStart(2, "0")}</span>
          <span className="job-item-title">{item.title ?? `Elemento ${item.index}`}</span>
          <span className="job-item-bar"><span style={{ width: `${item.percent}%` }} /></span>
          <span className="job-item-state">{item.status === "skipped" ? "ya estaba" : item.status === "done" ? "✓" : `${Math.round(item.percent)}%`}</span>
        </li>)}</ol>
      </details>}
      {<div className="job-actions">
        {job.status === "completed" && files.map((file) => isDesktop
          ? <button type="button" key={file.filename} className="setup-secondary" onClick={() => void revealDownload(file.filename)}>Mostrar {files.length > 1 ? file.filename : "en la carpeta"}</button>
          : <a key={file.filename} className="setup-secondary" href={`${apiUrl()}${file.downloadUrl}`} download>Guardar {file.filename} ↓</a>)}
        {(job.status === "downloading" || job.status === "queued") && <button type="button" className="setup-secondary" onClick={() => onAction(job.jobId, "pause")}>❚❚ Pausar</button>}
        {job.status === "paused" && <button type="button" className="setup-secondary is-accent" onClick={() => onAction(job.jobId, "resume")}>▶ Reanudar</button>}
        {(job.status === "failed" || job.status === "cancelled") && <button type="button" className="setup-secondary" onClick={() => onAction(job.jobId, "resume")}>↻ Reintentar</button>}
        {(job.status === "downloading" || job.status === "queued" || job.status === "paused") && <button type="button" className="job-remove" onClick={() => onAction(job.jobId, "cancel")}>Cancelar</button>}
        {job.status !== "downloading" && job.status !== "queued" && <button type="button" className="job-remove" onClick={() => onRemove(job.jobId)}>Quitar de la lista</button>}
      </div>}
    </div>
  </li>;
}

export default function DownloadsPage() {
  const { jobs, active, loaded, failed, refresh } = useJobs();
  const finished = jobs.filter((job) => job.status === "completed" || job.status === "failed" || job.status === "cancelled").length;

  async function remove(jobId: string) {
    await fetch(`${apiUrl()}/api/jobs/${jobId}`, { method: "DELETE", credentials: "include" });
    await refresh();
  }

  async function act(jobId: string, action: "pause" | "resume" | "cancel") {
    await fetch(`${apiUrl()}/api/jobs/${jobId}/${action}`, { method: "POST", credentials: "include" });
    await refresh();
  }

  async function clearFinished() {
    await fetch(`${apiUrl()}/api/jobs/clear`, { method: "POST", credentials: "include" });
    await refresh();
  }

  return <>
    <header className="site-header"><a className="brand" href="/" aria-label="AntiTube, inicio"><AntiTubeLogo /></a><nav className="site-nav" aria-label="Navegación principal"><a className="site-nav-link" href="/">Descargar</a><a className="site-nav-link" href="/shazam/">SHAZAM</a><DownloadsLink /><LogoutButton /></nav></header>
    <main className="shell jobs-shell">
      <div className="jobs-heading">
        <div><p className="setup-kicker">Cola de trabajo</p><h1>Descargas</h1><p className="setup-muted">{active > 0 ? `${active} en curso o en cola. Se procesan de una en una; puedes seguir añadiendo más.` : "No hay descargas en curso. Las nuevas aparecerán aquí."}</p></div>
        <div className="jobs-heading-actions">
          {isDesktop && <button type="button" className="setup-secondary" onClick={() => void revealDownload()}>Abrir carpeta</button>}
          {finished > 0 && <button type="button" className="setup-secondary" onClick={() => void clearFinished()}>Limpiar terminadas</button>}
        </div>
      </div>
      {failed && <div className="notice error">ⓘ <span>No se puede consultar el estado de las descargas.</span></div>}
      {loaded && jobs.length === 0 && <div className="empty-state">Todavía no has descargado nada en esta sesión. <a href="/">Pega un enlace</a> para empezar.</div>}
      {jobs.length > 0 && <ul className="job-list">{jobs.map((job) => <JobCard key={job.jobId} job={job} onRemove={(jobId) => void remove(jobId)} onAction={(jobId, action) => void act(jobId, action)} />)}</ul>}
    </main>
  </>;
}
