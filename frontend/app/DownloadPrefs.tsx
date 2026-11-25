"use client";

import { useEffect, useState } from "react";
import type { DownloadFormat } from "./FormatPicker";

/** Preferencias de descarga compartidas: plantilla de nombre, duplicados y etiquetas ID3. */

export type Id3 = { artist: string; album: string; year: string; genre: string };
export type DownloadPrefs = { filenameTemplate: string; skipDuplicates: boolean; id3: Id3 };

const storageKey = "antitube-download-prefs";
const emptyId3: Id3 = { artist: "", album: "", year: "", genre: "" };

export const templatePresets = [
  { label: "Título", value: "{title}.{ext}" },
  { label: "Autor - Título", value: "{uploader} - {title}.{ext}" },
  { label: "Artista - Título", value: "{artist} - {title}.{ext}" },
  { label: "Nº - Título (playlists)", value: "{index} - {title}.{ext}" },
  { label: "Playlist - Nº - Título", value: "{playlist} - {index} - {title}.{ext}" },
  { label: "Año - Título", value: "{year} - {title}.{ext}" }
];

const fields = ["title", "uploader", "artist", "album", "playlist", "index", "year", "date", "id", "ext"];

export function useDownloadPrefs() {
  const [prefs, setPrefs] = useState<DownloadPrefs>({ filenameTemplate: templatePresets[0].value, skipDuplicates: true, id3: emptyId3 });

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Partial<DownloadPrefs>;
      setPrefs((current) => ({ ...current, filenameTemplate: saved.filenameTemplate || current.filenameTemplate, skipDuplicates: saved.skipDuplicates ?? current.skipDuplicates }));
    } catch { /* sin preferencias guardadas */ }
  }, []);

  function update(patch: Partial<DownloadPrefs>) {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      // Las etiquetas ID3 son de cada descarga; solo se recuerdan plantilla y duplicados.
      localStorage.setItem(storageKey, JSON.stringify({ filenameTemplate: next.filenameTemplate, skipDuplicates: next.skipDuplicates }));
      return next;
    });
  }

  /** Campos que se envían al backend junto a la descarga. */
  function requestFields(format: DownloadFormat) {
    const id3 = Object.values(prefs.id3).some((value) => value.trim()) ? prefs.id3 : null;
    return { filenameTemplate: prefs.filenameTemplate, skipDuplicates: prefs.skipDuplicates, id3: format !== "mp4" ? id3 : null };
  }

  return { prefs, update, requestFields };
}

function previewName(template: string, format: string): string {
  const sample: Record<string, string> = { title: "Remember Me", uploader: "Canal Oficial", artist: "Artista", album: "Álbum", playlist: "Mi playlist", index: "03", year: "2024", date: "2024-05-17", id: "dQw4w9WgXcQ", ext: format };
  const name = template.replace(/\{([a-z_]+)\}/gi, (match, key: string) => sample[key.toLowerCase()] ?? match);
  return /\.[a-z0-9]+$/i.test(name) ? name : `${name}.${format}`;
}

export default function AdvancedOptions({ prefs, update, format, isPlaylist }: Readonly<{ prefs: DownloadPrefs; update: (patch: Partial<DownloadPrefs>) => void; format: DownloadFormat; isPlaylist: boolean }>) {
  const preset = templatePresets.find((item) => item.value === prefs.filenameTemplate)?.value ?? "custom";
  const setId3 = (key: keyof Id3, value: string) => update({ id3: { ...prefs.id3, [key]: value } });

  return <details className="advanced-options">
    <summary><span>Opciones avanzadas</span><small>Nombre del archivo, duplicados{format !== "mp4" ? " y etiquetas" : ""}</small></summary>
    <div className="advanced-grid">
      <label className="advanced-field advanced-wide">
        <span>Plantilla de nombre</span>
        <div className="advanced-row">
          <div className="select-wrap"><select value={preset} onChange={(event) => { if (event.target.value !== "custom") update({ filenameTemplate: event.target.value }); }}>{templatePresets.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}<option value="custom">Personalizada</option></select></div>
          <input type="text" value={prefs.filenameTemplate} onChange={(event) => update({ filenameTemplate: event.target.value })} spellCheck={false} aria-label="Plantilla personalizada" />
        </div>
        <small>Ejemplo: <code>{previewName(prefs.filenameTemplate, format)}</code> · Campos: {fields.map((field) => <button type="button" key={field} className="template-chip" onClick={() => update({ filenameTemplate: prefs.filenameTemplate.replace(/(\.\{ext\})?$/, `{${field}}$1`) })}>{`{${field}}`}</button>)}</small>
      </label>
      <label className="advanced-check advanced-wide">
        <input type="checkbox" checked={prefs.skipDuplicates} onChange={(event) => update({ skipDuplicates: event.target.checked })} />
        <span>{isPlaylist ? "Descargar solo las que faltan" : "Omitir si ya lo descargaste"} <small>(AntiTube recuerda lo que has descargado en cada formato)</small></span>
      </label>
      {format !== "mp4" && <>
        <p className="advanced-note advanced-wide">Etiquetas: AntiTube ya guarda título, artista, fecha y portada cuando la plataforma los da. Rellena lo que quieras cambiar.</p>
        <label className="advanced-field"><span>Artista</span><input type="text" value={prefs.id3.artist} onChange={(event) => setId3("artist", event.target.value)} placeholder="Automático" /></label>
        <label className="advanced-field"><span>Álbum</span><input type="text" value={prefs.id3.album} onChange={(event) => setId3("album", event.target.value)} placeholder={isPlaylist ? "Nombre de la playlist" : "Automático"} /></label>
        <label className="advanced-field"><span>Año</span><input type="text" inputMode="numeric" maxLength={4} value={prefs.id3.year} onChange={(event) => setId3("year", event.target.value.replace(/\D/g, ""))} placeholder="Automático" /></label>
        <label className="advanced-field"><span>Género</span><input type="text" value={prefs.id3.genre} onChange={(event) => setId3("genre", event.target.value)} placeholder="Automático" /></label>
      </>}
    </div>
  </details>;
}
