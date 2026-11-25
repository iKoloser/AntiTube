"use client";

import { useEffect, useState } from "react";
import { closeToTrayKey } from "../shell/AppShell";
import { api, quitApp, setCloseToTray } from "../runtime";

/** Ajustes de la aplicación: bandeja de Windows y descargas simultáneas. */
export default function AppSettings() {
  const [tray, setTray] = useState(true);
  const [parallel, setParallel] = useState(3);

  useEffect(() => {
    setTray(localStorage.getItem(closeToTrayKey) !== "0");
    void api<{ maxConcurrent?: number }>("/api/settings").then((data) => { if (data.maxConcurrent) setParallel(data.maxConcurrent); }).catch(() => undefined);
  }, []);

  function changeTray(enabled: boolean) {
    setTray(enabled);
    localStorage.setItem(closeToTrayKey, enabled ? "1" : "0");
    void setCloseToTray(enabled);
  }

  async function changeParallel(value: number) {
    setParallel(value);
    await api("/api/settings/concurrency", { body: { maxConcurrent: value } }).catch(() => undefined);
  }

  return <section className="settings-card">
    <div className="setup-card-head"><div><p className="setup-kicker">Aplicación</p><h2>Ajustes</h2></div></div>
    <div className="settings-row">
      <div><strong>Seguir en la bandeja al cerrar</strong><p>Al cerrar la ventana, AntiTube se queda junto al reloj: las descargas y la música continúan y recibes un aviso de Windows al terminar cada descarga.</p></div>
      <label className="switch"><input type="checkbox" checked={tray} onChange={(event) => changeTray(event.target.checked)} /><span /></label>
    </div>
    <div className="settings-row">
      <div><strong>Descargas a la vez</strong><p>Cuántas descargas se hacen en paralelo. Más es más rápido con muchas canciones; si tu conexión es lenta, baja el número.</p></div>
      <div className="parallel-picker">{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" className={parallel === value ? "active" : ""} onClick={() => void changeParallel(value)}>{value}</button>)}</div>
    </div>
    <div className="settings-row">
      <div><strong>Cerrar AntiTube del todo</strong><p>Detiene las descargas en curso y la música. También desde el icono de la bandeja › «Salir de AntiTube».</p></div>
      <button type="button" className="setup-secondary" onClick={() => void quitApp()}>Salir</button>
    </div>
  </section>;
}
