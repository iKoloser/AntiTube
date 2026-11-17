import type { Metadata } from "next";
import "./globals.css";
import FuturisticBackground from "./FuturisticBackground";
import AuthGate from "./AuthGate";

export const metadata: Metadata = {
  title: "AntiTube",
  description: "Herramienta local de análisis de contenido multimedia educativo"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <FuturisticBackground />
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
