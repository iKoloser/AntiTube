"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * Arrastrar y soltar propio, con eventos de puntero. En Windows, la ventana de
 * Tauri reserva el arrastre nativo para recibir archivos del Explorador, así
 * que el arrastre de canciones dentro de la app se hace a mano.
 *
 * Las zonas de destino se marcan con `data-drop="tipo:valor"`.
 */

export type DragPayload = {
  trackIds: string[];
  label: string;
  /** Origen, para reordenar en lugar de duplicar. */
  from?: { type: "queue"; index: number } | { type: "playlist"; id: string; indices: number[] };
};

type DropHandler = (target: string, payload: DragPayload) => void;

type DragContextValue = {
  begin: (event: React.PointerEvent, payload: () => DragPayload) => void;
  dragging: DragPayload | null;
  register: (handler: DropHandler) => () => void;
};

const DragContext = createContext<DragContextValue | null>(null);

export function useDrag() {
  const value = useContext(DragContext);
  if (!value) throw new Error("useDrag fuera de DragProvider");
  return value;
}

/** Registra quién atiende las soltadas (el reproductor). */
export function useDropHandler(handler: DropHandler) {
  const { register } = useDrag();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => register((target, payload) => ref.current(target, payload)), [register]);
}

export function DragProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const handlers = useRef(new Set<DropHandler>());
  const hoverRef = useRef<Element | null>(null);

  const register = useCallback((handler: DropHandler) => {
    handlers.current.add(handler);
    return () => { handlers.current.delete(handler); };
  }, []);

  const begin = useCallback((event: React.PointerEvent, payload: () => DragPayload) => {
    if (event.button !== 0 || (event.target as Element).closest("button, a, input, select, textarea, [data-no-drag]")) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let active: DragPayload | null = null;

    const setHover = (element: Element | null) => {
      if (hoverRef.current === element) return;
      hoverRef.current?.classList.remove("is-drop-target");
      hoverRef.current = element;
      element?.classList.add("is-drop-target");
    };

    const move = (moveEvent: PointerEvent) => {
      if (!active) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 7) return;
        active = payload();
        setDragging(active);
        document.body.classList.add("is-dragging");
      }
      setPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
      const under = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      setHover(under?.closest("[data-drop]") ?? null);
    };

    const end = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      if (!active) return;
      const target = document.elementFromPoint(upEvent.clientX, upEvent.clientY)?.closest("[data-drop]")?.getAttribute("data-drop");
      const dropped = active;
      setHover(null);
      setDragging(null);
      document.body.classList.remove("is-dragging");
      if (target) for (const handler of handlers.current) handler(target, dropped);
    };

    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      setHover(null);
      setDragging(null);
      document.body.classList.remove("is-dragging");
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
  }, []);

  return <DragContext.Provider value={{ begin, dragging, register }}>
    {children}
    {dragging && <div className="drag-ghost" style={{ transform: `translate(${position.x + 14}px, ${position.y + 10}px)` }}>
      <span className="drag-ghost-icon">♫</span>{dragging.label}
    </div>}
  </DragContext.Provider>;
}
