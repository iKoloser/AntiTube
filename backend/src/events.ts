/**
 * Avisos para la app de escritorio. La app Tauri lee la salida estándar del
 * backend: cada línea `ANTITUBE_EVENT {json}` se convierte en una notificación
 * de Windows o en un cambio del icono de la bandeja.
 */
export type DesktopEvent =
  | { type: "job"; status: "completed" | "failed"; title: string; message: string; file?: string | null }
  | { type: "queue"; active: number; queued: number };

export function emitDesktopEvent(event: DesktopEvent): void {
  if (process.env.ANTITUBE_DESKTOP !== "1") return;
  process.stdout.write(`ANTITUBE_EVENT ${JSON.stringify(event)}\n`);
}
