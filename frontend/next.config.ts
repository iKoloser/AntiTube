import type { NextConfig } from "next";
import { config } from "dotenv";

// Permite centralizar la configuración local en el .env de la raíz.
config({ path: "../.env" });

const nextConfig: NextConfig = {};

export default nextConfig;
