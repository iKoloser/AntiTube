// Oculta la consola en Windows en las compilaciones de release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Envoltorio de escritorio de AntiTube.
//!
//! 1. Elige un puerto libre en 127.0.0.1.
//! 2. Arranca el backend Express (Node incluido en la app) con ese puerto.
//! 3. Abre la ventana con la interfaz estática e inyecta la URL del backend.
//! 4. Lee los avisos del backend (descargas terminadas, cola) y los muestra
//!    como notificaciones de Windows y en el icono de la bandeja.
//! 5. Al cerrar la ventana se queda en la bandeja; «Salir» detiene el backend.

use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::utils::config::Color;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_notification::NotificationExt;

struct Backend(Mutex<Option<Child>>);

/// Preferencias de la ventana que la interfaz puede cambiar.
struct WindowPrefs {
    close_to_tray: AtomicBool,
    tray_hint_shown: AtomicBool,
}

const TRAY_ID: &str = "antitube-tray";

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
        // La salida estándar la leemos nosotros: lleva los avisos de descargas.
        .stdout(Stdio::piped())
        .stderr(log.try_clone()?);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command.spawn()?;
    if let Some(stdout) = child.stdout.take() {
        let handle = app.handle().clone();
        std::thread::spawn(move || forward_backend_output(handle, stdout, log));
    }
    Ok(child)
}

/// Copia la salida del backend a backend.log y reacciona a las líneas `ANTITUBE_EVENT {json}`.
fn forward_backend_output(app: AppHandle, stdout: std::process::ChildStdout, mut log: File) {
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        if let Some(payload) = line.strip_prefix("ANTITUBE_EVENT ") {
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(payload) {
                handle_backend_event(&app, &event);
            }
            continue;
        }
        let _ = writeln!(log, "{line}");
    }
}

fn window_is_focused(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .map(|window| window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false))
        .unwrap_or(false)
}

fn handle_backend_event(app: &AppHandle, event: &serde_json::Value) {
    let text = |key: &str| event.get(key).and_then(|value| value.as_str()).unwrap_or_default().to_string();
    match event.get("type").and_then(|value| value.as_str()) {
        Some("job") => {
            // Con la ventana delante ya se ve en la app; el aviso de Windows es para cuando no está a la vista.
            if window_is_focused(app) {
                return;
            }
            let completed = text("status") == "completed";
            let title = if completed { "Descarga completada" } else { "Descarga fallida" };
            let body = if completed { text("title") } else { format!("{}\n{}", text("title"), text("message")) };
            let _ = app.notification().builder().title(title).body(body).show();
        }
        Some("queue") => {
            let active = event.get("active").and_then(|value| value.as_u64()).unwrap_or(0);
            let queued = event.get("queued").and_then(|value| value.as_u64()).unwrap_or(0);
            let tooltip = match (active, queued) {
                (0, 0) => "AntiTube".to_string(),
                (active, 0) => format!("AntiTube · {active} descarga(s) en curso"),
                (active, queued) => format!("AntiTube · {active} en curso, {queued} en cola"),
            };
            if let Some(tray) = app.tray_by_id(TRAY_ID) {
                let _ = tray.set_tooltip(Some(tooltip));
            }
        }
        _ => {}
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Envía una orden a la interfaz (reproductor, navegación) como evento del DOM.
fn send_to_ui(app: &AppHandle, action: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let script = format!("window.dispatchEvent(new CustomEvent('antitube-tray', {{ detail: {} }}));", serde_json::Value::String(action.to_string()));
        let _ = window.eval(&script);
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let handle = app.handle();
    let open = MenuItem::with_id(handle, "open", "Abrir AntiTube", true, None::<&str>)?;
    let downloads = MenuItem::with_id(handle, "downloads", "Ver descargas", true, None::<&str>)?;
    let play = MenuItem::with_id(handle, "player:toggle", "Reproducir / pausar", true, None::<&str>)?;
    let next = MenuItem::with_id(handle, "player:next", "Siguiente canción", true, None::<&str>)?;
    let previous = MenuItem::with_id(handle, "player:previous", "Canción anterior", true, None::<&str>)?;
    let quit = MenuItem::with_id(handle, "quit", "Salir de AntiTube", true, None::<&str>)?;
    let menu = Menu::with_items(handle, &[
        &open,
        &downloads,
        &PredefinedMenuItem::separator(handle)?,
        &play,
        &next,
        &previous,
        &PredefinedMenuItem::separator(handle)?,
        &quit,
    ])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("AntiTube")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "downloads" => {
                show_main_window(app);
                send_to_ui(app, "navigate:/descargas/");
            }
            "quit" => app.exit(0),
            action if action.starts_with("player:") => send_to_ui(app, action),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(handle)?;
    Ok(())
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

/// Si es `true`, cerrar la ventana la esconde en la bandeja y las descargas siguen.
#[tauri::command]
fn set_close_to_tray(prefs: tauri::State<'_, WindowPrefs>, enabled: bool) {
    prefs.close_to_tray.store(enabled, Ordering::Relaxed);
}

/// Cierra AntiTube del todo (también desde la bandeja).
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        // Abrir AntiTube otra vez muestra la ventana existente en lugar de arrancar otro motor.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main_window(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(WindowPrefs { close_to_tray: AtomicBool::new(true), tray_hint_shown: AtomicBool::new(false) })
        .invoke_handler(tauri::generate_handler![install_update, set_close_to_tray, quit_app])
        .setup(|app| {
            let port = free_port();
            let child = spawn_backend(app, port)?;
            app.manage(Backend(Mutex::new(Some(child))));
            build_tray(app)?;

            let init_script = format!(
                "window.__ANTITUBE_API_URL__ = 'http://127.0.0.1:{port}';\n{EXTERNAL_LINKS_SCRIPT}"
            );

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("AntiTube")
                .inner_size(1280.0, 840.0)
                .min_inner_size(420.0, 560.0)
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
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let prefs = app.state::<WindowPrefs>();
                if prefs.close_to_tray.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                    if !prefs.tray_hint_shown.swap(true, Ordering::Relaxed) {
                        let _ = app
                            .notification()
                            .builder()
                            .title("AntiTube sigue en la bandeja")
                            .body("Las descargas y la música continúan. Haz clic en el icono para volver o usa «Salir de AntiTube».")
                            .show();
                    }
                }
            }
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
