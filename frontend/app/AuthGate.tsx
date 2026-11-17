"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function AuthGate({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "authenticated" | "anonymous">("checking");

  useEffect(() => {
    if (pathname === "/acceso") {
      setStatus("anonymous");
      return;
    }
    let cancelled = false;
    void fetch(`${apiUrl}/api/auth/session`, { credentials: "include" })
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
          setStatus("anonymous");
          router.replace("/acceso");
        }
      });
    return () => { cancelled = true; };
  }, [pathname, router]);

  if (pathname === "/acceso" || status === "authenticated") return <>{children}</>;
  return <main className="auth-loading" aria-live="polite">Comprobando acceso…</main>;
}
