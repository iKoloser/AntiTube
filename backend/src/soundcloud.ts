/**
 * Datos de las canciones de una playlist de SoundCloud. yt-dlp, en modo rápido
 * (--flat-playlist), solo devuelve el id de cada canción, sin título, artista
 * ni portada. Aquí se piden todas de golpe a la API pública que usa la propia
 * web de SoundCloud, igual que hace yt-dlp por dentro.
 */

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
let clientId: { value: string; expires: number } | null = null;

async function text(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`SoundCloud respondió ${response.status}`);
  return response.text();
}

/** El client_id va dentro de uno de los scripts de soundcloud.com. */
export async function soundcloudClientId(refresh = false): Promise<string> {
  if (!refresh && clientId && clientId.expires > Date.now()) return clientId.value;
  const page = await text("https://soundcloud.com/");
  const scripts = [...page.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]).reverse();
  for (const src of scripts) {
    const script = await text(src).catch(() => "");
    const found = /client_id\s*:\s*"([0-9a-zA-Z]{32})"/.exec(script);
    if (found) {
      clientId = { value: found[1], expires: Date.now() + 6 * 60 * 60 * 1000 };
      return found[1];
    }
  }
  throw new Error("No se encontró el client_id de SoundCloud");
}

export type SoundCloudTrack = { id: string; title: string; artist: string | null; durationSeconds: number | null; thumbnailUrl: string | null; url: string | null };

type ApiTrack = { id?: number; title?: string; duration?: number; full_duration?: number; artwork_url?: string | null; permalink_url?: string; user?: { username?: string; avatar_url?: string } };

export async function soundcloudTracks(ids: string[]): Promise<Map<string, SoundCloudTrack>> {
  const result = new Map<string, SoundCloudTrack>();
  const unique = [...new Set(ids.filter((id) => /^\d+$/.test(id)))];
  for (let start = 0; start < unique.length; start += 50) {
    const batch = unique.slice(start, start + 50);
    let tracks: ApiTrack[] | null = null;
    for (const refresh of [false, true]) {
      const id = await soundcloudClientId(refresh);
      const response = await fetch(`https://api-v2.soundcloud.com/tracks?ids=${batch.join(",")}&client_id=${id}`, { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(10_000) });
      if (response.status === 401 || response.status === 403) continue;
      if (!response.ok) throw new Error(`SoundCloud respondió ${response.status}`);
      tracks = await response.json() as ApiTrack[];
      break;
    }
    for (const track of tracks ?? []) {
      if (track.id === undefined) continue;
      const artwork = track.artwork_url ?? track.user?.avatar_url ?? null;
      result.set(String(track.id), {
        id: String(track.id),
        title: track.title ?? `Pista ${track.id}`,
        artist: track.user?.username ?? null,
        durationSeconds: typeof (track.full_duration ?? track.duration) === "number" ? Math.round((track.full_duration ?? track.duration as number) / 1000) : null,
        // Las portadas de la API vienen en 100×100; la variante t500x500 se ve nítida.
        thumbnailUrl: artwork ? artwork.replace("-large.", "-t500x500.") : null,
        url: track.permalink_url ?? null
      });
    }
  }
  return result;
}

/** Id numérico de una entrada de playlist de SoundCloud (por su id o por la URL de la API). */
export function soundcloudTrackId(id: string | null, url: string | null): string | null {
  if (id && /^\d+$/.test(id)) return id;
  const match = /\/tracks\/(\d+)/.exec(url ?? "") ?? /soundcloud%3Atracks%3A(\d+)/.exec(url ?? "");
  return match ? match[1] : null;
}
