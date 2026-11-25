/**
 * Utilidades compartidas entre la versión web y la de escritorio.
 *
 * En escritorio, la app Tauri inyecta `window.__ANTITUBE_API_URL__` con el
 * puerto local que ha elegido para el backend antes de cargar la página.
 */

declare global {
  interface Window { __ANTITUBE_API_URL__?: string }
}

export const isDesktop = process.env.NEXT_PUBLIC_ANTITUBE_DESKTOP === "1";

export function apiUrl(): string {
  if (typeof window !== "undefined" && window.__ANTITUBE_API_URL__) return window.__ANTITUBE_API_URL__;
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
}

/** Muestra el archivo descargado en el explorador del sistema (solo escritorio). */
export async function revealDownload(filename?: string): Promise<void> {
  await fetch(`${apiUrl()}/api/desktop/open`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename }) });
}

type TauriInternals = { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };

/** Abre el selector de carpetas nativo (solo en la app de escritorio). Devuelve null si se cancela. */
export async function pickFolder(defaultPath?: string): Promise<string | null | undefined> {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  if (!internals?.invoke) return undefined;
  const result = await internals.invoke("plugin:dialog|open", { options: { directory: true, multiple: false, title: "Elige la carpeta de descargas", defaultPath } });
  return typeof result === "string" ? result : null;
}

/** Ejecuta el instalador de una actualización descargada y cierra la app (solo escritorio). */
export async function installUpdate(path: string): Promise<void> {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  if (!internals?.invoke) throw new Error("La actualización automática solo funciona en la app de escritorio.");
  await internals.invoke("install_update", { path });
}

type TauriEventInternals = TauriInternals & { transformCallback?: (callback: (event: { payload: unknown }) => void, once?: boolean) => number };

function tauriInternals(): TauriEventInternals | null {
  if (typeof window === "undefined") return null;
  const internals = (window as unknown as { __TAURI_INTERNALS__?: TauriEventInternals }).__TAURI_INTERNALS__;
  return internals?.invoke && internals.transformCallback ? internals : null;
}

/** Escucha un evento de Tauri (p. ej. archivos arrastrados a la ventana). Devuelve una función para dejar de escuchar. */
export async function listenTauri<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  const internals = tauriInternals();
  if (!internals) return () => undefined;
  const callbackId = internals.transformCallback!((message) => handler(message.payload as T));
  const eventId = await internals.invoke("plugin:event|listen", { event, target: { kind: "Any" }, handler: callbackId }) as number;
  return () => { void internals.invoke("plugin:event|unlisten", { event, eventId }).catch(() => undefined); };
}

/** Indica a la app si al cerrar la ventana debe quedarse en la bandeja. */
export async function setCloseToTray(enabled: boolean): Promise<void> {
  await tauriInternals()?.invoke("set_close_to_tray", { enabled }).catch(() => undefined);
}

let windowFullscreen = false;

/**
 * Pone la ventana de la app a pantalla completa (solo escritorio; en la web no
 * hace nada). Ignora peticiones repetidas: en Windows cada cambio redimensiona
 * la ventana y hace parpadear la barra de tareas.
 */
export async function setWindowFullscreen(enabled: boolean): Promise<void> {
  if (windowFullscreen === enabled) return;
  windowFullscreen = enabled;
  await tauriInternals()?.invoke("plugin:window|set_fullscreen", { label: "main", value: enabled }).catch(() => undefined);
}

/** Graba el audio que suena en el equipo (WASAPI loopback). Devuelve un WAV en base64. */
export async function recordSystemAudio(seconds: number): Promise<string> {
  const internals = tauriInternals();
  if (!internals) throw new Error("Escuchar el sistema solo está disponible en la app de escritorio.");
  return await internals.invoke("record_system_audio", { seconds }) as string;
}

/** Corta la escucha del sistema antes de tiempo. */
export async function stopSystemAudio(): Promise<void> {
  await tauriInternals()?.invoke("stop_system_audio").catch(() => undefined);
}

export type DiscordPresence = { title: string; artist: string | null; album: string | null; cover: string | null; sourceUrl: string | null; video: boolean; playing: boolean; start: number | null; end: number | null };

/** Si esta versión de escritorio puede mostrar lo que suena en Discord. */
export async function discordAvailable(): Promise<boolean> {
  return Boolean(await tauriInternals()?.invoke("discord_available").catch(() => false));
}

/** Muestra (o borra, con null) en Discord lo que suena. Solo escritorio. */
export async function setDiscordPresence(presence: DiscordPresence | null): Promise<void> {
  await tauriInternals()?.invoke("discord_presence", { presence }).catch(() => undefined);
}

export async function quitApp(): Promise<void> {
  await tauriInternals()?.invoke("quit_app").catch(() => undefined);
}

/** Abre el selector de archivos de audio nativo (solo escritorio). */
export async function pickMediaFiles(): Promise<string[] | undefined> {
  const internals = tauriInternals();
  if (!internals) return undefined;
  const result = await internals.invoke("plugin:dialog|open", { options: { multiple: true, directory: false, title: "Añadir música a la biblioteca", filters: [{ name: "Audio y vídeo", extensions: ["mp3", "m4a", "m4b", "aac", "opus", "ogg", "oga", "flac", "wav", "weba", "aiff", "aif", "wma", "ape", "wv", "mka", "ac3", "dts", "mp2", "mpc", "tta", "caf", "dsf", "mp4", "m4v", "mkv", "webm", "mov", "avi", "wmv", "flv", "ts"] }] } });
  if (Array.isArray(result)) return result.filter((item): item is string => typeof item === "string");
  return typeof result === "string" ? [result] : [];
}

/** Abre el selector de carpetas para añadir una carpeta de música. */
export async function pickMusicFolder(): Promise<string | null | undefined> {
  const internals = tauriInternals();
  if (!internals) return undefined;
  const result = await internals.invoke("plugin:dialog|open", { options: { directory: true, multiple: false, title: "Añadir una carpeta de música" } });
  return typeof result === "string" ? result : null;
}

/** Petición JSON al motor local. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const response = await fetch(`${apiUrl()}${path}`, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    credentials: "include",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init?.signal
  });
  const data = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(data.message ?? `Error ${response.status}`);
  return data;
}
