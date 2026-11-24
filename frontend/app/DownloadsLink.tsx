"use client";

import { usePathname } from "next/navigation";
import { useJobs } from "./jobs";

/** Enlace del menú a la página de descargas, con el número de descargas activas. */
export default function DownloadsLink() {
  const pathname = usePathname();
  const { active } = useJobs(1500, 4000);
  const isActive = pathname?.startsWith("/descargas");
  return <a className={`site-nav-link downloads-nav-link${isActive ? " active" : ""}`} href="/descargas/">
    Descargas{active > 0 && <span className="downloads-nav-badge" aria-label={`${active} en curso`}>{active}</span>}
  </a>;
}
