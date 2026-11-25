"use client";

import { useEffect, useState } from "react";
import { apiUrl, pickFolder, revealDownload } from "../runtime";

type Settings = { downloadDirectory: string; defaultDownloadDirectory: string };

/** Muestra y cambia la carpeta donde se guardan las descargas. */
export default function DownloadFolder() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    void fetch(`${apiUrl()}/api/settings`, { credentials: "include" }).then((response) => response.json() as Promise<Settings>).then(setSettings).catch(() => undefined);
  }, []);

  async function save(directory: string | null) {
    setMessage(null);
    const response = await fetch(`${apiUrl()}/api/settings`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ downloadDirectory: directory }) });
    const data = await response.json() as Settings & { message?: string };
    if (!response.ok) {
      setMessage({ text: data.message ?? "No se pudo usar esa carpeta.", error: true });
      return;
    }
    setSettings(data);
    setEditing(false);
    setMessage({ text: "Carpeta guardada. Las próximas descargas irán ahí.", error: false });
  }

  async function choose() {
    const picked = await pickFolder(settings?.downloadDirectory);
    if (picked === undefined) {
      // Sin selector nativo (versión web): se escribe la ruta a mano.
      setDraft(settings?.downloadDirectory ?? "");
      setEditing(true);
      return;
    }
    if (picked) await save(picked);
  }

  const isDefault = settings && settings.downloadDirectory === settings.defaultDownloadDirectory;

  return <div className="tools-folder">
    <div className="tools-folder-copy">
      <strong>Carpeta de descargas</strong>
      {editing
        ? <form className="tools-folder-edit" onSubmit={(event) => { event.preventDefault(); void save(draft); }}><input type="text" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} aria-label="Ruta de la carpeta" autoFocus /><button type="submit" className="setup-secondary is-accent">Guardar</button><button type="button" className="job-remove" onClick={() => setEditing(false)}>Cancelar</button></form>
        : <p><code>{settings?.downloadDirectory ?? "…"}</code>{isDefault && <small> (por defecto)</small>}</p>}
      {message && <p className={message.error ? "tools-folder-error" : "tools-folder-ok"}>{message.text}</p>}
    </div>
    {!editing && <div className="tools-folder-actions">
      <button type="button" className="setup-secondary is-accent" onClick={() => void choose()}>Cambiar…</button>
      <button type="button" className="setup-secondary" onClick={() => { setDraft(settings?.downloadDirectory ?? ""); setEditing(true); }}>Escribir ruta</button>
      {!isDefault && <button type="button" className="setup-secondary" onClick={() => void save(null)}>Restablecer</button>}
      <button type="button" className="setup-secondary" onClick={() => void revealDownload()}>Abrir</button>
    </div>}
  </div>;
}
