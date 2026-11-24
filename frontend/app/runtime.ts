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
