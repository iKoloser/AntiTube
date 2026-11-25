import type { Metadata } from "next";
import "./globals.css";
import "./shell.css";
import AuthGate from "./AuthGate";
import AppShell from "./shell/AppShell";
import { themeBootScript } from "./shell/themeData";

export const metadata: Metadata = {
  title: "AntiTube",
  description: "Busca, descarga y reproduce tu música y vídeo en local"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootScript }} /></head>
      <body>
        <AuthGate><AppShell>{children}</AppShell></AuthGate>
      </body>
    </html>
  );
}
