"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";

/**
 * Estado que sobrevive al cambiar de pestaña dentro de la app (se guarda en
 * memoria mientras la app está abierta). Así, al volver a una pestaña, sigue
 * todo como lo dejaste: búsqueda, resultados, enlace analizado y opciones.
 */
const store = new Map<string, unknown>();
const listeners = new Map<string, Set<(value: unknown) => void>>();

function write(key: string, value: unknown): void {
  store.set(key, value);
  for (const listener of listeners.get(key) ?? []) listener(value);
}

export function usePersistentState<T>(key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() => (store.has(key) ? store.get(key) as T : typeof initial === "function" ? (initial as () => T)() : initial));
  const latest = useRef(value);
  latest.current = value;
  // Si algo termina mientras estás en otra pestaña (una búsqueda, un análisis),
  // el resultado se guarda igualmente y aparece al volver.
  useEffect(() => {
    const listener = (next: unknown) => setValue(next as T);
    const set = listeners.get(key) ?? new Set();
    set.add(listener);
    listeners.set(key, set);
    if (store.has(key) && store.get(key) !== latest.current) setValue(store.get(key) as T);
    return () => { set.delete(listener); };
  }, [key]);
  const update = useCallback((next: SetStateAction<T>) => {
    const previous = (store.has(key) ? store.get(key) : latest.current) as T;
    const resolved = typeof next === "function" ? (next as (value: T) => T)(previous) : next;
    latest.current = resolved;
    write(key, resolved);
    setValue(resolved);
  }, [key]);
  return [value, update] as const;
}

export function remember<T>(key: string, value: T): void {
  store.set(key, value);
}

export function recall<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

/** Recuerda por dónde ibas en la página y vuelve ahí al regresar a la pestaña. */
export function useScrollMemory(key: string): void {
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>(".app-content");
    if (!scroller) return;
    const saved = recall<number>(`scroll:${key}`);
    let frames = 0;
    let raf = 0;
    // El contenido puede tardar un par de fotogramas en tener su altura final.
    const restore = () => {
      if (saved && scroller.scrollHeight - scroller.clientHeight < saved && frames++ < 30) { raf = requestAnimationFrame(restore); return; }
      if (saved) scroller.scrollTo({ top: saved, behavior: "instant" as ScrollBehavior });
    };
    raf = requestAnimationFrame(restore);
    const onScroll = () => remember(`scroll:${key}`, scroller.scrollTop);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => { cancelAnimationFrame(raf); scroller.removeEventListener("scroll", onScroll); };
  }, [key]);
}
