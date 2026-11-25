"use client";

export type DownloadFormat = "mp4" | "mp3" | "m4a" | "opus" | "flac";
export type AudioAvailability = { m4a: { kbps: number | null } | null; opus: { kbps: number | null } | null; lossless: { codec: string } | null; best: { codec: string; kbps: number | null } | null } | null;

type Option = { id: DownloadFormat; title: string; tag: string; detail: string; state: "ok" | "unknown" | "missing" };

/**
 * Elegir formato de salida. M4A y Opus son el audio original de la plataforma
 * (sin recomprimir) y FLAC solo aparece disponible si la fuente es de verdad sin pérdida.
 */
export function formatOptions(audio: AudioAvailability, platform: string, isPlaylist: boolean): Option[] {
  const known = audio !== null && !isPlaylist;
  const kbps = (value: { kbps: number | null } | null) => (value?.kbps ? `~${value.kbps} kbps` : "");
  const youtubeLike = /YouTube/i.test(platform);
  return [
    { id: "mp4", title: "Vídeo", tag: "MP4", detail: "Vídeo con audio, hasta la calidad que elijas.", state: "ok" },
    { id: "mp3", title: "MP3", tag: "CONVERTIDO", detail: "Compatible con todo. Se recomprime desde el original.", state: "ok" },
    {
      id: "m4a",
      title: "M4A · AAC",
      tag: "ORIGINAL",
      detail: known ? (audio?.m4a ? `Pista AAC original ${kbps(audio.m4a)}, sin conversión.` : "Esta fuente no ofrece AAC original.") : "Pista AAC original, sin conversión (se comprueba al descargar).",
      state: known ? (audio?.m4a ? "ok" : "missing") : "unknown"
    },
    {
      id: "opus",
      title: "Opus",
      tag: "ORIGINAL",
      detail: known ? (audio?.opus ? `Pista Opus original ${kbps(audio.opus)}, sin conversión. La mejor de YouTube.` : "Esta fuente no ofrece Opus original.") : "Pista Opus original, sin conversión (se comprueba al descargar).",
      state: known ? (audio?.opus ? "ok" : "missing") : "unknown"
    },
    {
      id: "flac",
      title: "FLAC",
      tag: "SIN PÉRDIDA",
      detail: known
        ? audio?.lossless ? `La fuente es sin pérdida (${audio.lossless.codec}). Calidad íntegra.` : `No disponible: la fuente solo tiene audio con pérdida${audio?.best ? ` (${audio.best.codec.toUpperCase()} ${kbps(audio.best)})` : ""}. Convertirlo a FLAC no mejoraría nada.`
        : youtubeLike ? "YouTube no ofrece audio sin pérdida." : "Solo si la fuente es sin pérdida (se comprueba al descargar).",
      state: known ? (audio?.lossless ? "ok" : "missing") : youtubeLike ? "missing" : "unknown"
    }
  ];
}

export default function FormatPicker({ format, onChange, audio, platform, videoOnly, isPlaylist }: Readonly<{ format: DownloadFormat; onChange: (format: DownloadFormat) => void; audio: AudioAvailability; platform: string; videoOnly: boolean; isPlaylist: boolean }>) {
  const options = formatOptions(audio, platform, isPlaylist).filter((option) => !videoOnly || option.id === "mp4");
  return <div className="format-grid" role="radiogroup" aria-label="Formato de salida">
    {options.map((option) => <button
      key={option.id}
      type="button"
      role="radio"
      aria-checked={format === option.id}
      disabled={option.state === "missing"}
      className={`format-option is-${option.state}${format === option.id ? " active" : ""}`}
      onClick={() => onChange(option.id)}
      title={option.detail}
    >
      <span className="format-option-head"><strong>{option.title}</strong><em>{option.tag}</em></span>
      <span className="format-option-detail">{option.detail}</span>
    </button>)}
  </div>;
}
