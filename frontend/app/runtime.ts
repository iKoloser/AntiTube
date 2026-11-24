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
