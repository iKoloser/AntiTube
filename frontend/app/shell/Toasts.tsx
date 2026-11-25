"use client";

import { createContext, useCallback, useContext, useState } from "react";

type Toast = { id: number; title: string; body?: string; tone?: "ok" | "error" | "info"; action?: { label: string; run: () => void } };

const ToastContext = createContext<(toast: Omit<Toast, "id">) => void>(() => undefined);

export function useToast() {
  return useContext(ToastContext);
}

let counter = 0;

/** Avisos flotantes dentro de la app (las notificaciones de Windows salen cuando la ventana no está delante). */
export function ToastProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)), []);
  const push = useCallback((toast: Omit<Toast, "id">) => {
    const id = ++counter;
    setToasts((list) => [...list.slice(-3), { ...toast, id }]);
    setTimeout(() => dismiss(id), toast.action ? 9000 : 5000);
  }, [dismiss]);

  return <ToastContext.Provider value={push}>
    {children}
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => <div key={toast.id} className={`toast is-${toast.tone ?? "info"}`}>
        <span className="toast-led" aria-hidden="true" />
        <div className="toast-copy"><strong>{toast.title}</strong>{toast.body && <span>{toast.body}</span>}</div>
        {toast.action && <button type="button" className="toast-action" onClick={() => { toast.action?.run(); dismiss(toast.id); }}>{toast.action.label}</button>}
        <button type="button" className="toast-close" aria-label="Cerrar aviso" onClick={() => dismiss(toast.id)}>×</button>
      </div>)}
    </div>
  </ToastContext.Provider>;
}
