// Oculta la consola en Windows en las compilaciones de release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Envoltorio de escritorio de AntiTube.
//!
//! 1. Elige un puerto libre en 127.0.0.1.
//! 2. Arranca el backend Express (Node incluido en la app) con ese puerto.
//! 3. Abre la ventana con la interfaz estática e inyecta la URL del backend.
//! 4. Al cerrar la ventana, detiene el backend.

use std::fs::{self, File};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::utils::config::Color;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct Backend(Mutex<Option<Child>>);

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .unwrap_or(47_831)
}

fn node_binary(resource_dir: &Path) -> PathBuf {
    let name = if cfg!(windows) { "node.exe" } else { "node" };
    let bundled = resource_dir.join("node").join(name);
    // En `tauri dev` sin recursos preparados, recurrimos al Node del sistema.
    if bundled.exists() { bundled } else { PathBuf::from(name) }
}

/// En Windows, Tauri devuelve rutas con el prefijo `\\?\` (p. ej. `\\?\C:\Users\…`).
/// Node no sabe resolverlas como script de entrada, así que las normalizamos.
fn plain(path: PathBuf) -> PathBuf {
    dunce::simplified(&path).to_path_buf()
}

fn spawn_backend(app: &tauri::App, port: u16) -> Result<Child, Box<dyn std::error::Error>> {
    let resource_dir = plain(app.path().resource_dir()?);
    let data_dir = plain(app.path().app_local_data_dir()?);
    let download_dir = plain(
        app.path()
            .download_dir()
            .unwrap_or_else(|_| data_dir.join("downloads")),
    )
    .join("AntiTube");
    fs::create_dir_all(&data_dir)?;

    let backend_dir = resource_dir.join("backend");
    let log = File::create(data_dir.join("backend.log"))?;

    let mut command = Command::new(node_binary(&resource_dir));
    command
        .arg(backend_dir.join("server.cjs"))
        .current_dir(&backend_dir)
        .env("ANTITUBE_DESKTOP", "1")
        .env("ANTITUBE_APP_VERSION", app.package_info().version.to_string())
        .env("NODE_ENV", "production")
        .env("BACKEND_PORT", port.to_string())
        .env("ANTITUBE_DATA_DIR", &data_dir)
        .env("ANTITUBE_RESOURCE_DIR", &backend_dir)
        .env("DOWNLOAD_DIR", &download_dir)
        // El backend se cierra solo cuando se cierra su entrada estándar
        // (por ejemplo, si la app termina de forma inesperada).
        .stdin(Stdio::piped())
        .stdout(log.try_clone()?)
        .stderr(log);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    Ok(command.spawn()?)
}

fn is_internal(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" | "asset" | "about" | "data" | "blob" => true,
        "http" | "https" => matches!(url.host_str(), Some("tauri.localhost" | "localhost" | "127.0.0.1")),
        _ => false,
    }
}

// Los enlaces externos (YouTube, Spotify…) se abren en el navegador del sistema.
const EXTERNAL_LINKS_SCRIPT: &str = r#"
document.addEventListener("click", (event) => {
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!anchor) return;
  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin && /^https?:$/.test(url.protocol)) {
    event.preventDefault();
    location.href = url.href;
  }
}, true);
"#;

/// Ejecuta el instalador de una actualización ya descargada por el backend y
/// cierra la app. El instalador NSIS de Tauri, con `/P` (modo pasivo) y `/R`,
/// instala sin preguntas y vuelve a abrir AntiTube al terminar.
#[tauri::command]
fn install_update(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let invalid = || "El instalador descargado no es válido.".to_string();
    let file = dunce::canonicalize(PathBuf::from(&path)).map_err(|_| invalid())?;
    let folder = dunce::canonicalize(std::env::temp_dir().join("AntiTube-update")).map_err(|_| invalid())?;
    let name = file.file_name().and_then(|name| name.to_str()).unwrap_or_default();
    let valid_name = name.starts_with("AntiTube_") && name.to_ascii_lowercase().ends_with("_x64-setup.exe");
    if !valid_name || file.parent() != Some(folder.as_path()) || !file.is_file() {
        return Err(invalid());
    }
    Command::new(&file)
        .args(["/P", "/R"])
        .spawn()
        .map_err(|error| format!("No se pudo abrir el instalador: {error}"))?;
    app.exit(0);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![install_update])
        .setup(|app| {
            let port = free_port();
            let child = spawn_backend(app, port)?;
            app.manage(Backend(Mutex::new(Some(child))));

            let init_script = format!(
                "window.__ANTITUBE_API_URL__ = 'http://127.0.0.1:{port}';\n{EXTERNAL_LINKS_SCRIPT}"
            );

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("AntiTube")
                .inner_size(1180.0, 820.0)
                .min_inner_size(820.0, 600.0)
                .center()
                .background_color(Color(3, 5, 8, 255))
                .initialization_script(&init_script)
                .on_navigation(|url| {
                    if is_internal(url) {
                        return true;
                    }
                    let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                    false
                })
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("no se pudo iniciar AntiTube")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(mut child) = app.state::<Backend>().0.lock().ok().and_then(|mut guard| guard.take()) {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        });
}
