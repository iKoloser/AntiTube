import type { NextConfig } from "next";
import { config } from "dotenv";

// Permite centralizar la configuración local en el .env de la raíz.
config({ path: "../.env" });

const nextConfig: NextConfig = {
  // Permite copiar el servidor Next y sus dependencias dentro del paquete
  // portable de Electron sin necesitar una instalación de Node aparte.
  output: "standalone",
  async rewrites() {
    return [{
      source: "/api/:path*",
      destination: `${process.env.BACKEND_INTERNAL_URL ?? "http://localhost:4000"}/api/:path*`,
    }];
  },
};

export default nextConfig;
