"use client";

import { usePathname } from "next/navigation";
import { apiUrl, isDesktop } from "./runtime";

export default function LogoutButton() {
  const pathname = usePathname();
  async function handleLogout() {
    await fetch(`${apiUrl()}/api/auth/logout`, { method: "POST", credentials: "include" });
    window.location.href = "/acceso";
  }

  // La versión de escritorio no usa clave de acceso: muestra el enlace a herramientas.
  if (isDesktop) return <a className={`site-nav-link${pathname?.startsWith("/herramientas") ? " active" : ""}`} href="/herramientas/">Herramientas</a>;
  return <button className="logout-button" type="button" onClick={() => void handleLogout()}>Salir</button>;
}
