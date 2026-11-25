"use client";

import { useEffect, useRef, useState } from "react";
import type { JobSummary } from "../jobs";

/** «3.21MiB/s» → bytes por segundo. */
function parseSpeed(value: string | null): number {
  const match = value?.match(/([\d.]+)\s*([KMG]?)i?B\/s/i);
  if (!match) return 0;
  const units: Record<string, number> = { "": 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 };
  return Number(match[1]) * (units[match[2].toUpperCase()] ?? 1);
}

function formatRate(bytes: number): string {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB/s`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB/s`;
  return "0 KB/s";
}

/**
 * Lecturas de la barra superior: velocidad total de descarga con su gráfica,
 * descargas activas y reloj. Le da a la app su aire de consola en vivo.
 */
export default function Telemetry({ jobs, active }: Readonly<{ jobs: JobSummary[]; active: number }>) {
  const [history, setHistory] = useState<number[]>(() => Array(40).fill(0));
  const [clock, setClock] = useState("");
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  useEffect(() => {
    const tick = () => {
      const total = jobsRef.current.filter((job) => job.status === "downloading").reduce((sum, job) => sum + parseSpeed(job.progress.speed), 0);
      setHistory((values) => [...values.slice(1), total]);
      setClock(new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  const peak = Math.max(1, ...history);
  const points = history.map((value, index) => `${(index / (history.length - 1)) * 100},${22 - (value / peak) * 20}`).join(" ");
  const current = history[history.length - 1];

  return <div className="telemetry" aria-label="Estado en vivo">
    <span className={`telemetry-net${current > 0 ? " is-active" : ""}`} title="Velocidad total de descarga">
      <svg viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><polyline points={`0,24 ${points} 100,24`} className="telemetry-area" /><polyline points={points} className="telemetry-line" /></svg>
      <b>↓ {formatRate(current)}</b>
    </span>
    <span className="telemetry-jobs">{active > 0 ? <><i className="telemetry-dot" />{active} en curso</> : "en espera"}</span>
    <span className="telemetry-clock">{clock}</span>
  </div>;
}
