// Prepara todo lo que la app Tauri empaqueta:
//   1. Exportación estática del frontend (frontend/out).
//   2. Backend Express en un único archivo JS (resources/backend/server.cjs).
//   3. Runtime de Node para ejecutar el backend (resources/node/).
//
// Uso: node scripts/prepare.mjs [--skip-frontend]
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(desktopDir, "..");
const resourcesDir = path.join(desktopDir, "src-tauri", "resources");
const skipFrontend = process.argv.includes("--skip-frontend");

function step(title) {
  console.log(`\n▸ ${title}`);
}

if (!skipFrontend) {
  step("Exportando el frontend estático");
  execSync("pnpm --filter @antitube/frontend build", {
    cwd: rootDir,
    stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_ANTITUBE_DESKTOP: "1", NEXT_TELEMETRY_DISABLED: "1" }
  });
}

step("Empaquetando el backend en un solo archivo");
const backendOut = path.join(resourcesDir, "backend");
rmSync(backendOut, { recursive: true, force: true });
mkdirSync(backendOut, { recursive: true });
await build({
  entryPoints: [path.join(rootDir, "backend", "src", "index.ts")],
  outfile: path.join(backendOut, "server.cjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  minify: true,
  legalComments: "none",
  logLevel: "info"
});
copyFileSync(path.join(rootDir, "backend", "shazam_recognize.py"), path.join(backendOut, "shazam_recognize.py"));

step("Copiando el runtime de Node");
const nodeOut = path.join(resourcesDir, "node");
rmSync(nodeOut, { recursive: true, force: true });
mkdirSync(nodeOut, { recursive: true });
const nodeName = process.platform === "win32" ? "node.exe" : "node";
copyFileSync(process.execPath, path.join(nodeOut, nodeName));
console.log(`  ${process.execPath} (${Math.round(statSync(process.execPath).size / 1024 / 1024)} MB)`);

console.log("\n✓ Recursos listos en desktop/src-tauri/resources");
