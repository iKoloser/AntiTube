"use client";

import { useState } from "react";
import AdvancedOptions, { type DownloadPrefs } from "./DownloadPrefs";
import { apiUrl } from "./runtime";

type Props = {
  prefs: DownloadPrefs;
  update: (patch: Partial<DownloadPrefs>) => void;
  requestFields: (format: "mp4" | "mp3") => Record<string, unknown>;
};

/** Pegar muchas URLs (una por línea) y mandarlas todas a la cola con las mismas opciones. */
export default function BatchPanel({ prefs, update, requestFields }: Readonly<Props>) {
  const [text, setText] = useState("");
  const [format, setFormat] = useState<"mp4" | "mp3">("mp3");
  const [videoQuality, setVideoQuality] = useState("720");
  const [audioQuality, setAudioQuality] = useState("320");
  const [allowPlaylists, setAllowPlaylists] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ message: string; rejected: Array<{ url: string; reason: string }> } | null>(null);
  const urls = [...new Set(text.split(/\s+/).map((value) => value.trim()).filter((value) => /^https?:\/\//i.test(value)))];

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(`${apiUrl()}/api/download/batch`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, format, quality: format === "mp4" ? videoQuality : audioQuality, allowPlaylists, ...requestFields(format) })
      });
      const data = await response.json() as { message: string; rejected?: Array<{ url: string; reason: string }> };
      setResult({ message: data.message, rejected: data.rejected ?? [] });
      if (response.ok) setText("");
    } catch {
      setResult({ message: "No se pudo contactar con el motor local.", rejected: [] });
    } finally {
      setBusy(false);
    }
  }

  return <section className="batch-panel" aria-label="Descargar varias URLs">
    <div className="batch-head"><h3>Varias URLs</h3><span>{urls.length} detectada{urls.length === 1 ? "" : "s"}</span></div>
    <textarea value={text} onChange={(event) => setText(event.target.value)} rows={6} placeholder={"Pega aquí los enlaces, uno por línea o separados por espacios.\nhttps://www.youtube.com/watch?v=…\nhttps://soundcloud.com/…"} spellCheck={false} />
    <div className="batch-options">
      <div className="tabs"><button type="button" className={format === "mp3" ? "active" : ""} onClick={() => setFormat("mp3")}>♫ MP3</button><button type="button" className={format === "mp4" ? "active" : ""} onClick={() => setFormat("mp4")}>▣ MP4</button></div>
      <div className="select-wrap"><select aria-label="Calidad" value={format === "mp4" ? videoQuality : audioQuality} onChange={(event) => format === "mp4" ? setVideoQuality(event.target.value) : setAudioQuality(event.target.value)}>{format === "mp4" ? <><option value="best">MP4: Mejor disponible</option><option value="1080">MP4: Hasta 1080p</option><option value="720">MP4: Hasta 720p</option><option value="480">MP4: Hasta 480p</option><option value="360">MP4: Hasta 360p</option></> : <><option value="320">MP3: 320 kbps</option><option value="256">MP3: 256 kbps</option><option value="192">MP3: 192 kbps</option><option value="128">MP3: 128 kbps</option></>}</select></div>
      <label className="advanced-check"><input type="checkbox" checked={allowPlaylists} onChange={(event) => setAllowPlaylists(event.target.checked)} /><span>Descargar playlists completas</span></label>
    </div>
    <AdvancedOptions prefs={prefs} update={update} format={format} isPlaylist={false} />
    <button type="button" className="download-button" disabled={busy || urls.length === 0} onClick={() => void submit()}>↓ {busy ? "Añadiendo…" : `Añadir ${urls.length || ""} a la cola`}</button>
    {result && <div className="notice" role="status"><span>{result.message} {result.message.includes("añadidas") && <a href="/descargas/">Ver en Descargas →</a>}{result.rejected.length > 0 && <><br />No se añadieron: {result.rejected.map((item) => `${item.url} (${item.reason})`).join(", ")}</>}</span></div>}
  </section>;
}
