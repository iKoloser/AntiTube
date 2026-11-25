"use client";

import AppUpdatePanel from "../desktop/AppUpdate";
import SetupPanel from "../desktop/SetupPanel";
import { isDesktop } from "../runtime";
import AppSettings from "./AppSettings";
import DownloadFolder from "./DownloadFolder";

export default function ToolsPage() {
  return <>
    <main className="page tools-shell">
      <div className="view-head"><div><p className="kicker">// sistema</p><h1>Ajustes</h1></div></div>
      {isDesktop
        ? <>
            <AppUpdatePanel />
            <AppSettings />
            <DownloadFolder />
            <SetupPanel compact />
          </>
        : <div className="notice">Esta página solo está disponible en la versión de escritorio.</div>}
    </main>
  </>;
}
