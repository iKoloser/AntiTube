import type { Metadata } from "next";
import "./globals.css";
import "./shell.css";
import FuturisticBackground from "./FuturisticBackground";
import AuthGate from "./AuthGate";
import AppShell from "./shell/AppShell";

export const metadata: Metadata = {
  title: "AntiTube",
  description: "Busca, descarga y reproduce tu música y vídeo en local"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <FuturisticBackground />
        <AuthGate><AppShell>{children}</AppShell></AuthGate>
      </body>
    </html>
  );
}
