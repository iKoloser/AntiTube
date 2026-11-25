"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "../runtime";

export type HistoryEntry = {
  id: string;
  recognizedAt: number;
  title: string;
  artist: string;
  artworkUrl: string | null;
  shazamUrl: string | null;
  youtubeUrl: string | null;
  soundcloudUrl: string | null;
  spotifyUrl: string | null;
};

function when(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? `Hoy, ${date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`
    : date.toLocaleDateString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Historial de canciones reconocidas; al elegir una se vuelve a mostrar con su vista previa y descarga. */
export default function ShazamHistory({ refreshKey, onSelect }: Readonly<{ refreshKey: string; onSelect: (entry: HistoryEntry) => void }>) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void fetch(`${apiUrl()}/api/shazam/history`, { credentials: "include" })
      .then((response) => response.json() as Promise<{ entries: HistoryEntry[] }>)
      .then((data) => setEntries(data.entries))
      .catch(() => setEntries([]));
  }, [refreshKey]);

  async function remove(id: string | null) {
    const response = await fetch(`${apiUrl()}/api/shazam/history${id ? `/${id}` : ""}`, { method: "DELETE", credentials: "include" });
    const data = await response.json() as { entries: HistoryEntry[] };
    setEntries(data.entries);
  }

  if (!entries || entries.length === 0) return null;
  const filtered = query.trim() ? entries.filter((entry) => `${entry.title} ${entry.artist}`.toLowerCase().includes(query.trim().toLowerCase())) : entries;

  return <section className="shazam-history" aria-label="Historial de SHAZAM">
    <div className="shazam-history-head">
      <div><p className="shazam-kicker">Historial</p><h2>Canciones reconocidas</h2></div>
      <div className="shazam-history-tools">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar en el historial…" aria-label="Buscar en el historial" />
        <button type="button" className="job-remove" onClick={() => void remove(null)}>Borrar todo</button>
      </div>
    </div>
    <ul className="shazam-history-list">
      {filtered.map((entry) => <li key={entry.id}>
        <button type="button" className="shazam-history-item" onClick={() => { onSelect(entry); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
          <span className="shazam-history-art" style={entry.artworkUrl ? { backgroundImage: `url("${entry.artworkUrl}")` } : undefined}>{entry.artworkUrl ? "" : "♪"}</span>
          <span className="shazam-history-copy"><strong>{entry.title}</strong><span>{entry.artist}</span></span>
          <span className="shazam-history-when">{when(entry.recognizedAt)}</span>
        </button>
        <button type="button" className="shazam-history-remove" aria-label={`Quitar ${entry.title} del historial`} onClick={() => void remove(entry.id)}>×</button>
      </li>)}
    </ul>
    {filtered.length === 0 && <p className="setup-muted">Nada coincide con «{query}».</p>}
  </section>;
}
