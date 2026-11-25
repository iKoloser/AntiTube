"use client";

import { openCommandPalette } from "../shell/CommandPalette";
import { themes, useTheme } from "../shell/theme";

/** Ajustes › Apariencia: tema de color y efectos visuales. */
export default function Appearance() {
  const { theme, effects, setTheme, setEffects } = useTheme();
  return <section className="settings-card">
    <div className="setup-card-head"><div><p className="setup-kicker">Apariencia</p><h2>Tema y efectos</h2></div></div>
    <div className="theme-grid" role="radiogroup" aria-label="Tema de color">
      {themes.map((item) => <button key={item.id} type="button" role="radio" aria-checked={item.id === theme.id} className={`theme-swatch${item.id === theme.id ? " is-active" : ""}`} style={{ ["--swatch" as string]: item.vars["--accent"] }} onClick={() => setTheme(item.id)}>
        <span className="theme-swatch-bar"><i style={{ background: item.vars["--accent"] }} /><i style={{ background: item.vars["--accent-2"] }} /><i style={{ background: item.vars["--accent-3"] }} /></span>
        <strong>{item.label}</strong>
        <small>{item.hint}</small>
      </button>)}
    </div>
    <div className="settings-row">
      <div><strong>Fondo que late con la música</strong><p>La rejilla del horizonte, la lluvia de datos y las chispas se mueven al ritmo de los graves de lo que suena.</p></div>
      <label className="switch"><input type="checkbox" checked={effects.reactive} onChange={(event) => setEffects({ reactive: event.target.checked })} /><span /></label>
    </div>
    <div className="settings-row">
      <div><strong>Efecto CRT</strong><p>Líneas de barrido y un brillo suave, como en un monitor antiguo.</p></div>
      <label className="switch"><input type="checkbox" checked={effects.crt} onChange={(event) => setEffects({ crt: event.target.checked })} /><span /></label>
    </div>
    <div className="settings-row">
      <div><strong>Animaciones</strong><p>Desactívalas si tu equipo va justo o prefieres una interfaz quieta.</p></div>
      <label className="switch"><input type="checkbox" checked={effects.motion} onChange={(event) => setEffects({ motion: event.target.checked })} /><span /></label>
    </div>
    <div className="settings-row">
      <div><strong>Paleta de comandos</strong><p>Pulsa <kbd>Ctrl</kbd> <kbd>K</kbd> en cualquier sitio para navegar, controlar la música, buscar en tu biblioteca o en internet y cambiar el tema sin tocar el ratón.</p></div>
      <button type="button" className="setup-secondary" onClick={openCommandPalette}>Abrir</button>
    </div>
  </section>;
}
