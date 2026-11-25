"use client";

import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "./runtime";

export type JobSummary = {
  jobId: string;
  title: string;
  url: string;
  platform: string;
  format: "mp4" | "mp3" | "m4a" | "opus" | "flac";
  section: { start: number; end: number } | null;
  quality: string;
  isPlaylist: boolean;
  createdAt: number;
  finishedAt: number | null;
  status: "queued" | "downloading" | "paused" | "completed" | "failed" | "cancelled";
  items: Array<{ index: number; title: string | null; percent: number; status: "downloading" | "done" | "skipped" }>;
  skipped: number;
  playlistItems: number[] | null;
  queuePosition: number | null;
  progress: { percent: number; speed: string | null; eta: string | null; current: number | null; total: number | null; message: string };
  lastLog: string | null;
  result?: { message: string; files: Array<{ filename: string; downloadUrl: string }>; archive?: { filename: string; downloadUrl: string; count: number } };
  error?: { error: string; message: string };
};

type JobsResponse = { jobs: JobSummary[]; active: number; maxConcurrent?: number };

/** Consulta la lista de descargas: rápido mientras hay alguna activa, despacio si no. */
export function useJobs(intervalActive = 1000, intervalIdle = 4000) {
  const [data, setData] = useState<JobsResponse | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl()}/api/jobs`, { credentials: "include" });
      if (!response.ok) throw new Error();
      const next = await response.json() as JobsResponse;
      setData(next);
      setFailed(false);
      return next;
    } catch {
      setFailed(true);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      const next = await refresh();
      if (cancelled) return;
      timer = setTimeout(loop, next && next.active > 0 ? intervalActive : intervalIdle);
    };
    void loop();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [refresh, intervalActive, intervalIdle]);

  return { jobs: data?.jobs ?? [], active: data?.active ?? 0, maxConcurrent: data?.maxConcurrent ?? null, loaded: data !== null, failed, refresh };
}
