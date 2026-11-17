import type { Metadata } from "next";
import "./globals.css";
import FuturisticBackground from "./FuturisticBackground";

export const metadata: Metadata = {
  title: "AntiTube",
  description: "Herramienta local de análisis de contenido multimedia educativo"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <FuturisticBackground />
        {children}
      </body>
    </html>
  );
}
