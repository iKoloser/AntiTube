import type { NextConfig } from "next";
import { config } from "dotenv";

// Permite centralizar la configuración local en el .env de la raíz.
config({ path: "../.env" });

// La versión de escritorio (Tauri) usa una exportación estática: HTML/JS/CSS
// servidos desde la propia app, sin servidor de Next.js.
// `tauri dev` define TAURI_ENV_PLATFORM al lanzar el servidor de desarrollo.
const desktop = process.env.NEXT_PUBLIC_ANTITUBE_DESKTOP === "1" || Boolean(process.env.TAURI_ENV_PLATFORM);

const nextConfig: NextConfig = desktop
  ? { output: "export", trailingSlash: true, images: { unoptimized: true }, env: { NEXT_PUBLIC_ANTITUBE_DESKTOP: "1" } }
  : {};

export default nextConfig;
