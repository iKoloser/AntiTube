const { app, BrowserWindow, dialog, session } = require("electron");
const { spawn } = require("node:child_process");
const { existsSync, mkdirSync } = require("node:fs");
const path = require("node:path");

const isPackaged = app.isPackaged;
const appRoot = isPackaged ? path.join(process.resourcesPath, "app") : path.resolve(__dirname, "..");
const backendEntry = path.join(appRoot, "desktop", "runtime", "backend.cjs");
const standaloneRoot = path.join(appRoot, "frontend", ".next", "standalone");
const standaloneEntry = existsSync(path.join(standaloneRoot, "frontend", "server.js"))
  ? path.join(standaloneRoot, "frontend", "server.js")
  : path.join(standaloneRoot, "server.js");
const staticSource = path.join(appRoot, "frontend", ".next", "static");
const publicSource = path.join(appRoot, "frontend", "public");
const runtimeRoot = isPackaged ? app.getPath("userData") : path.join(appRoot, "downloads");
const downloadRoot = path.join(runtimeRoot, "downloads");
const vendorRoot = path.join(process.resourcesPath, "vendor");
const port = 4000;
const frontendPort = 3000;
let backendProcess;
let frontendProcess;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  console.log(line.trim());
  try {
    require("node:fs").appendFileSync(path.join(app.getPath("userData"), "startup.log"), line);
  } catch {}
}

function bundledTool(name, fallback) {
  const candidate = path.join(vendorRoot, name);
  return existsSync(candidate) ? candidate : fallback;
}

function spawnService(entry, env, cwd) {
  return spawn(process.execPath, [entry], {
    cwd,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...env },
    windowsHide: true,
    stdio: "pipe",
  });
}

function waitForExit(child, serviceName) {
  child.stderr.on("data", (data) => log(`[${serviceName}:stderr] ${data.toString().trim()}`));
  child.stdout.on("data", (data) => log(`[${serviceName}:stdout] ${data.toString().trim()}`));
  child.on("error", (error) => log(`[${serviceName}:error] ${error.message}`));
  child.on("exit", (code) => {
    log(`${serviceName} terminó con código ${code}`);
    if (code && !app.isQuitting) console.error(`${serviceName} terminó con código ${code}`);
  });
}

async function startServices() {
  mkdirSync(downloadRoot, { recursive: true });
  const commonEnv = {
    NODE_ENV: "production",
    BACKEND_PORT: String(port),
    CORS_ORIGIN: `http://localhost:${frontendPort}`,
    DOWNLOAD_DIR: downloadRoot,
    YTDLP_BIN: bundledTool("yt-dlp.exe", "yt-dlp"),
    FFMPEG_BIN: bundledTool("ffmpeg.exe", "ffmpeg"),
    NEXT_PUBLIC_API_URL: `http://localhost:${port}`,
    ANTITUBE_LOCAL_MODE: "true",
    ANTITUBE_BACKEND_ROOT: path.join(appRoot, "backend"),
  };
  log(`Iniciando backend: ${backendEntry}`);
  backendProcess = spawnService(backendEntry, commonEnv, path.dirname(backendEntry));
  waitForExit(backendProcess, "backend");
  log(`Iniciando frontend: ${standaloneEntry}`);
  frontendProcess = spawnService(standaloneEntry, { ...commonEnv, PORT: String(frontendPort), HOSTNAME: "127.0.0.1" }, standaloneRoot);
  waitForExit(frontendProcess, "frontend");
}

async function createWindow() {
  const window = new BrowserWindow({ width: 1440, height: 960, minWidth: 1024, minHeight: 720, show: true, autoHideMenuBar: true });
  const splash = `<!doctype html><html><head><meta charset="utf-8"><title>AntiTube</title><style>body{margin:0;background:#090b12;color:#f4f7ff;font:16px Segoe UI,Arial;display:grid;place-items:center;height:100vh}.box{text-align:center}.spinner{width:34px;height:34px;border:3px solid #33405f;border-top-color:#67e8f9;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 20px}@keyframes spin{to{transform:rotate(360deg)}}p{color:#aab4cc;margin-top:8px}</style></head><body><div class="box"><div class="spinner"></div><div>Iniciando AntiTube</div><p>Preparando los servicios locales…</p></div></body></html>`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splash)}`);
  return window;
}

async function openFrontend(window) {
  let attempt = 0;
  for (; attempt < 60; attempt += 1) {
    try {
      await fetch(`http://localhost:${frontendPort}`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (attempt >= 60) throw new Error("La interfaz local no respondió en 15 segundos. Revisa startup.log en la carpeta de datos de AntiTube.");
  await window.loadURL(`http://localhost:${frontendPort}`);
}

app.whenReady().then(async () => {
  log(`AntiTube iniciado. appRoot=${appRoot}`);
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === "media"));
  const window = await createWindow();
  try {
    await startServices();
    await openFrontend(window);
  } catch (error) {
    dialog.showErrorBox("AntiTube no pudo iniciar", `No se pudo abrir la interfaz local.\n\n${error.message}`);
    app.quit();
  }
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  app.isQuitting = true;
  backendProcess?.kill();
  frontendProcess?.kill();
});
