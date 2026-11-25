/**
 * Temas de color y efectos visuales. Cada tema cambia las variables CSS del
 * acento (todo el diseño las usa) y el tono base del fondo vivo y el visualizador.
 */
export type ThemeId = "cian" | "matrix" | "ambar" | "neon" | "rojo";

export type ThemeDefinition = { id: ThemeId; label: string; hint: string; hue: number; vars: Record<string, string> };

export const themes: ThemeDefinition[] = [
  { id: "cian", label: "Cian", hint: "El azul eléctrico de siempre", hue: 207, vars: { "--accent": "#39a7ff", "--accent-rgb": "57 167 255", "--accent-2": "#00e5ff", "--accent-3": "#8b5cff", "--accent-soft": "#0a1e36", "--accent-dim": "#2678bd", "--border-strong": "#2b4c6f" } },
  { id: "matrix", label: "Matrix", hint: "Fósforo verde de terminal", hue: 148, vars: { "--accent": "#00ff88", "--accent-rgb": "0 255 136", "--accent-2": "#b6ff3b", "--accent-3": "#00c2a8", "--accent-soft": "#062616", "--accent-dim": "#00b863", "--border-strong": "#1f5c3d" } },
  { id: "ambar", label: "Ámbar", hint: "Monitor CRT de los 80", hue: 40, vars: { "--accent": "#ffb000", "--accent-rgb": "255 176 0", "--accent-2": "#ffd866", "--accent-3": "#ff6b2c", "--accent-soft": "#2a1c04", "--accent-dim": "#c78600", "--border-strong": "#6b4a12" } },
  { id: "neon", label: "Neón", hint: "Cyberpunk magenta y cian", hue: 312, vars: { "--accent": "#ff2bd6", "--accent-rgb": "255 43 214", "--accent-2": "#00f0ff", "--accent-3": "#ffe600", "--accent-soft": "#2a0626", "--accent-dim": "#c21ea3", "--border-strong": "#5c1f55" } },
  { id: "rojo", label: "Red team", hint: "Alerta roja", hue: 354, vars: { "--accent": "#ff3b4e", "--accent-rgb": "255 59 78", "--accent-2": "#ff8a3d", "--accent-3": "#ff2bd6", "--accent-soft": "#2a070c", "--accent-dim": "#c22a3a", "--border-strong": "#5f2028" } }
];

export type Effects = { crt: boolean; reactive: boolean; motion: boolean };
export const defaultEffects: Effects = { crt: true, reactive: true, motion: true };
export const themeKey = "antitube-theme";
export const effectsKey = "antitube-effects";


/** Aplica el tema guardado antes de que React arranque, para que no parpadee el azul por defecto. */
export const themeBootScript = `(function(){try{var t=localStorage.getItem("${themeKey}");var m=${JSON.stringify(Object.fromEntries(themes.map((item) => [item.id, { ...item.vars, "--theme-hue": String(item.hue) }])))};var v=m[t]||m.cian;var r=document.documentElement;for(var k in v)r.style.setProperty(k,v[k]);r.dataset.theme=m[t]?t:"cian";var e=JSON.parse(localStorage.getItem("${effectsKey}")||"{}");r.dataset.crt=e.crt===false?"off":"on";r.dataset.motion=e.motion===false?"off":"on";}catch(x){}})();`;
