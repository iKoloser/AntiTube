"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// En el EXE la API se sirve a través del proxy de Next (/api). Así evitamos
// problemas de CORS entre localhost y 127.0.0.1.
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";

export default function AuthGate({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "authenticated" | "anonymous" | "error">("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pathname === "/acceso") {
      setStatus("anonymous");
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 7000);
    setStatus("checking");
    setError(null);
    void fetch(`${apiUrl}/api/auth/session`, { credentials: "include", signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<{ authenticated?: boolean }> : { authenticated: false })
      .then((data) => {
        if (cancelled) return;
        if (data.authenticated) setStatus("authenticated");
        else {
          setStatus("anonymous");
          router.replace("/acceso");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
          setError("No se pudo conectar con el servicio local de AntiTube.");
        }
      });
    return () => { cancelled = true; window.clearTimeout(timeout); controller.abort(); };
  }, [pathname, router]);

  if (pathname === "/acceso" || status === "authenticated") return <>{children}</>;
  if (status === "error") return <main className="auth-loading" aria-live="polite">
    <p>{error}</p>
    <button className="download-button" type="button" onClick={() => window.location.reload()}>Reintentar conexión</button>
  </main>;
  return <main className="auth-loading" aria-live="polite">Comprobando acceso…<small>Conectando con el servicio local…</small></main>;
}
