// Prepara todo lo que la app Tauri empaqueta:
//   1. Exportación estática del frontend (frontend/out).
//   2. Backend Express en un único archivo JS (resources/backend/server.cjs).
//   3. Runtime de Node para ejecutar el backend (resources/node/).
//
// Uso: node scripts/prepare.mjs [--skip-frontend]
import { execSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
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
  // YouTube.js no se mete dentro: va aparte con sus archivos originales de npm
  // (ver más abajo). Así server.cjs es como el de antes y el antivirus ve
  // archivos ya conocidos en vez de uno nuevo y enorme.
  external: ["youtubei.js"],
  // Sin minificar y con las licencias de cada librería: un único archivo
  // enorme y ofuscado hace que los antivirus por heurística (Windows Defender
  // «!ml») lo confundan con malware. Legible, se reconoce como lo que es.
  minify: false,
  keepNames: true,
  legalComments: "inline",
  banner: { js: "// AntiTube: motor local de la app de escritorio (https://github.com/iKoloser/AntiTube). Código abierto, licencia MIT." },
  logLevel: "info"
});
copyFileSync(path.join(rootDir, "backend", "shazam_recognize.py"), path.join(backendOut, "shazam_recognize.py"));

step("Copiando YouTube.js y sus dependencias tal cual vienen de npm");
const packageRoot = (name, from) => realpathSync(path.dirname(createRequire(from).resolve(`${name}/package.json`)));
const youtubeRoot = packageRoot("youtubei.js", path.join(rootDir, "backend", "package.json"));
const modulesOut = path.join(backendOut, "node_modules");
const copyPackage = (name, source) => {
  // Sin mapas de código, tipos ni las versiones para navegador: solo lo que ejecuta Node.
  cpSync(source, path.join(modulesOut, name), {
    recursive: true,
    dereference: true,
    filter: (file) => !/\.(map|d\.ts|d\.mts|d\.cts)$/.test(file) && !/[\\/](bundle|node_modules)$/.test(file) && !/[\\/]bundle[\\/]/.test(file)
  });
  console.log(`  ${name}`);
};
copyPackage("youtubei.js", youtubeRoot);
const youtubePackage = JSON.parse(readFileSync(path.join(youtubeRoot, "package.json"), "utf8"));
for (const dependency of Object.keys(youtubePackage.dependencies ?? {})) {
  // Con pnpm, las dependencias están junto a youtubei.js en su node_modules.
  copyPackage(dependency, realpathSync(path.join(path.dirname(youtubeRoot), dependency)));
}

step("Copiando el runtime de Node");
const nodeOut = path.join(resourcesDir, "node");
rmSync(nodeOut, { recursive: true, force: true });
mkdirSync(nodeOut, { recursive: true });
const nodeName = process.platform === "win32" ? "node.exe" : "node";
copyFileSync(process.execPath, path.join(nodeOut, nodeName));
console.log(`  ${process.execPath} (${Math.round(statSync(process.execPath).size / 1024 / 1024)} MB)`);

console.log("\n✓ Recursos listos en desktop/src-tauri/resources");
