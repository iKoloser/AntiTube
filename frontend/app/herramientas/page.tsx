"use client";

import AntiTubeLogo from "../AntiTubeLogo";
import SetupPanel from "../desktop/SetupPanel";
import DownloadsLink from "../DownloadsLink";
import LogoutButton from "../LogoutButton";
import { isDesktop } from "../runtime";
import DownloadFolder from "./DownloadFolder";

export default function ToolsPage() {
  return <>
    <header className="site-header"><a className="brand" href="/" aria-label="AntiTube, inicio"><AntiTubeLogo /></a><nav className="site-nav" aria-label="Navegación principal"><a className="site-nav-link" href="/">Descargar</a><a className="site-nav-link" href="/shazam/">SHAZAM</a><DownloadsLink />{isDesktop && <LogoutButton />}</nav></header>
    <main className="shell tools-shell">
      {isDesktop
        ? <>
            <DownloadFolder />
            <SetupPanel compact />
          </>
        : <div className="notice">Esta página solo está disponible en la versión de escritorio.</div>}
    </main>
  </>;
}
