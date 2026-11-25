"use client";

import { useEffect, useState } from "react";
import { closeToTrayKey } from "../shell/AppShell";
import { api, discordAvailable, quitApp, setCloseToTray } from "../runtime";
import { discordEnabled, discordKey, discordSettingEvent } from "../shell/DiscordPresence";

/** Ajustes de la aplicación: bandeja de Windows y descargas simultáneas. */
export default function AppSettings() {
  const [tray, setTray] = useState(true);
  const [parallel, setParallel] = useState(3);
  const [discord, setDiscord] = useState(true);
  const [hasDiscord, setHasDiscord] = useState(false);

  useEffect(() => {
    setTray(localStorage.getItem(closeToTrayKey) !== "0");
    setDiscord(discordEnabled());
    void discordAvailable().then(setHasDiscord);
    void api<{ maxConcurrent?: number }>("/api/settings").then((data) => { if (data.maxConcurrent) setParallel(data.maxConcurrent); }).catch(() => undefined);
  }, []);

  function changeTray(enabled: boolean) {
    setTray(enabled);
    localStorage.setItem(closeToTrayKey, enabled ? "1" : "0");
    void setCloseToTray(enabled);
  }

  function changeDiscord(enabled: boolean) {
    setDiscord(enabled);
    localStorage.setItem(discordKey, enabled ? "1" : "0");
    window.dispatchEvent(new Event(discordSettingEvent));
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
    {hasDiscord && <div className="settings-row">
      <div><strong>Mostrar en Discord lo que escuchas</strong><p>Tu perfil de Discord enseña «Escuchando AntiTube» con la canción, el artista, la portada y el tiempo, como hace Spotify. Necesita la app de Discord abierta en este PC.</p></div>
      <label className="switch"><input type="checkbox" checked={discord} onChange={(event) => changeDiscord(event.target.checked)} /><span /></label>
    </div>}
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
