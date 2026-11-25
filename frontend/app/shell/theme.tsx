"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { defaultEffects, effectsKey, themeKey, themes, type Effects, type ThemeDefinition, type ThemeId } from "./themeData";

export { themes, type Effects, type ThemeId };

type ThemeState = { theme: ThemeDefinition; effects: Effects; setTheme: (id: ThemeId) => void; setEffects: (patch: Partial<Effects>) => void };
const ThemeContext = createContext<ThemeState | null>(null);

export function useTheme(): ThemeState {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme fuera de ThemeProvider");
  return value;
}

function apply(theme: ThemeDefinition, effects: Effects) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.vars)) root.style.setProperty(name, value);
  root.style.setProperty("--theme-hue", String(theme.hue));
  root.dataset.theme = theme.id;
  root.dataset.crt = effects.crt ? "on" : "off";
  root.dataset.motion = effects.motion ? "on" : "off";
}

export function ThemeProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [themeId, setThemeId] = useState<ThemeId>("cian");
  const [effects, setEffectsState] = useState<Effects>(defaultEffects);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(themeKey) as ThemeId | null;
    if (saved && themes.some((item) => item.id === saved)) setThemeId(saved);
    try {
      const savedEffects = JSON.parse(localStorage.getItem(effectsKey) ?? "null") as Partial<Effects> | null;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setEffectsState({ ...defaultEffects, ...(reduced ? { motion: false } : {}), ...savedEffects });
    } catch { /* valores por defecto */ }
    setLoaded(true);
  }, []);

  const theme = themes.find((item) => item.id === themeId) ?? themes[0];
  // Hasta leer lo guardado no se toca nada: el script de arranque ya pintó el tema correcto.
  useEffect(() => { if (loaded) apply(theme, effects); }, [theme, effects, loaded]);

  const setTheme = useCallback((id: ThemeId) => {
    setThemeId(id);
    localStorage.setItem(themeKey, id);
  }, []);

  const setEffects = useCallback((patch: Partial<Effects>) => {
    setEffectsState((current) => {
      const next = { ...current, ...patch };
      localStorage.setItem(effectsKey, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, effects, setTheme, setEffects }), [theme, effects, setTheme, setEffects]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

