import { apiUrl } from "../runtime";

/** Canción tal y como la devuelve la biblioteca del motor local. */
export type LibraryTrack = {
  id: string;
  path: string;
  filename: string;
  folder: string;
  extension: string;
  kind: "audio" | "video";
  size: number;
  modified: number;
  title: string;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  year: number | null;
  genre: string | null;
  trackNumber: number | null;
  durationSeconds: number | null;
  codec: string | null;
  bitrateKbps: number | null;
  sampleRate: number | null;
  bitsPerSample: number | null;
  lossless: boolean;
  hasCover: boolean;
  needsTranscode: boolean;
  source: "downloads" | "folder" | "file";
};

export type Playlist = { id: string; name: string; tracks: string[]; trackIds: string[]; createdAt: number; updatedAt: number };

/** Lo que el reproductor necesita para sonar: canción de la biblioteca o vista previa en streaming. */
export type PlayerTrack = {
  /** Id de la biblioteca, o `stream:…` para una vista previa de internet. */
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  durationSeconds: number | null;
  cover: string | null;
  /** Ruta relativa al motor (se le antepone la URL del backend al reproducir). */
  src: string;
  kind: "audio" | "video";
  format: string | null;
  lossless: boolean;
  needsTranscode: boolean;
  /** Para vistas previas: URL original, para poder descargarla. */
  sourceUrl?: string;
};

export function toPlayerTrack(track: LibraryTrack): PlayerTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist ?? track.albumArtist,
    album: track.album,
    durationSeconds: track.durationSeconds,
    cover: track.hasCover ? `/api/library/cover/${track.id}` : null,
    src: `/api/library/stream/${track.id}`,
    kind: track.kind,
    format: formatLabel(track),
    lossless: track.lossless,
    needsTranscode: track.needsTranscode
  };
}

export function absolute(path: string | null): string | null {
  if (!path) return null;
  return /^https?:/.test(path) ? path : `${apiUrl()}${path}`;
}

/** «FLAC · 24 bit · 96 kHz», «OPUS · 160 kbps»… */
export function formatLabel(track: Pick<LibraryTrack, "extension" | "codec" | "bitrateKbps" | "sampleRate" | "bitsPerSample" | "lossless">): string {
  const codec = (track.codec ?? track.extension).replace(/^MPEG 1 Layer 3$/i, "MP3").replace(/^MPEG-4\/AAC$/i, "AAC").split(/[ /]/)[0].toUpperCase();
  const parts = [codec === "MPEG" ? "MP3" : codec];
  if (track.lossless) {
    if (track.bitsPerSample) parts.push(`${track.bitsPerSample} bit`);
    if (track.sampleRate) parts.push(`${(track.sampleRate / 1000).toFixed(track.sampleRate % 1000 ? 1 : 0)} kHz`);
  } else if (track.bitrateKbps) {
    parts.push(`${track.bitrateKbps} kbps`);
  }
  return parts.join(" · ");
}

export function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "--:--";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** Color estable a partir de un texto (para portadas generadas). */
export function hue(text: string): number {
  let value = 0;
  for (let index = 0; index < text.length; index += 1) value = (value * 31 + text.charCodeAt(index)) % 360;
  return value;
}

export const playableFormats = ["MP3", "M4A/AAC", "OPUS", "OGG", "FLAC", "WAV", "WEBM", "MP4", "ALAC", "AIFF", "WMA", "APE", "WavPack", "MKA", "AC3", "DTS", "MP2", "MPC", "TTA", "CAF", "DSF"];
