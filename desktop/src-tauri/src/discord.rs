//! Discord Rich Presence: muestra en tu perfil de Discord lo que suena en
//! AntiTube («Escuchando AntiTube»: canción, artista, portada y tiempo).
//! Habla con la app de Discord del propio PC por su canal local; si Discord no
//! está abierto, lo reintenta cada poco sin molestar.

use discord_rich_presence::activity::{Activity, ActivityType, Assets, Button, StatusDisplayType, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// Id de la aplicación «AntiTube» en el portal de desarrolladores de Discord.
const APP_ID: &str = "1575163968648122408";

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    title: String,
    artist: Option<String>,
    album: Option<String>,
    cover: Option<String>,
    source_url: Option<String>,
    video: bool,
    playing: bool,
    /// Milisegundos Unix en que empezó (descontando lo ya escuchado) y en que acabará.
    start: Option<i64>,
    end: Option<i64>,
}

/// Discord pide textos de 2 a 128 caracteres.
fn fit(text: &str) -> String {
    let mut value: String = text.trim().chars().take(128).collect();
    while value.chars().count() < 2 {
        value.push(' ');
    }
    value
}

fn apply(client: &mut DiscordIpcClient, presence: &Option<Presence>) -> bool {
    let Some(presence) = presence else {
        return client.clear_activity().is_ok();
    };
    let title = fit(&presence.title);
    let artist = presence.artist.clone().filter(|value| !value.trim().is_empty());
    let state = if presence.playing {
        fit(artist.as_deref().unwrap_or("AntiTube"))
    } else {
        fit(&format!("En pausa{}", artist.as_deref().map(|name| format!(" · {name}")).unwrap_or_default()))
    };
    let cover = presence.cover.clone().filter(|url| url.starts_with("https://") && url.len() <= 256);
    let large_text = fit(presence.album.as_deref().filter(|value| !value.trim().is_empty()).unwrap_or("AntiTube"));
    let mut assets = Assets::new().large_text(large_text.clone());
    assets = match cover.as_deref() {
        Some(url) => assets.large_image(url.to_string()).small_image("logo").small_text("AntiTube"),
        None => assets.large_image("logo"),
    };
    let mut activity = Activity::new()
        .activity_type(if presence.video { ActivityType::Watching } else { ActivityType::Listening })
        .status_display_type(StatusDisplayType::Details)
        .details(title.clone())
        .state(state.clone())
        .assets(assets);
    if presence.playing {
        let mut timestamps = Timestamps::new();
        if let Some(start) = presence.start {
            timestamps = timestamps.start(start);
        }
        if let Some(end) = presence.end {
            timestamps = timestamps.end(end);
        }
        activity = activity.timestamps(timestamps);
    }
    if let Some(url) = presence.source_url.as_deref().filter(|url| url.starts_with("https://") && url.len() <= 512) {
        let label = if url.contains("soundcloud.com") { "Abrir en SoundCloud" } else if url.contains("youtu") { "Abrir en YouTube" } else { "Abrir original" };
        activity = activity.buttons(vec![Button::new(label, url.to_string())]);
    }
    client.set_activity(activity).is_ok()
}

fn worker() -> Sender<Option<Presence>> {
    let (sender, receiver) = channel::<Option<Presence>>();
    std::thread::spawn(move || {
        let mut client: Option<DiscordIpcClient> = None;
        let mut wanted: Option<Presence> = None;
        let mut dirty = false;
        loop {
            match receiver.recv_timeout(Duration::from_secs(15)) {
                Ok(next) => {
                    wanted = next;
                    dirty = true;
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            if !dirty {
                continue;
            }
            if client.is_none() {
                if wanted.is_none() {
                    dirty = false;
                    continue;
                }
                let mut fresh = DiscordIpcClient::new(APP_ID);
                if fresh.connect().is_err() {
                    continue; // Discord cerrado: se reintenta en 15 s.
                }
                client = Some(fresh);
            }
            if let Some(active) = client.as_mut() {
                if apply(active, &wanted) {
                    dirty = false;
                } else {
                    let _ = active.close();
                    client = None; // Se reconecta en el siguiente intento.
                }
            }
        }
    });
    sender
}

static SENDER: OnceLock<Mutex<Sender<Option<Presence>>>> = OnceLock::new();

/// Actualiza (o borra, con `null`) lo que AntiTube muestra en Discord.
#[tauri::command]
pub fn discord_presence(presence: Option<Presence>) {
    if APP_ID.is_empty() {
        return;
    }
    let sender = SENDER.get_or_init(|| Mutex::new(worker()));
    if let Ok(sender) = sender.lock() {
        let _ = sender.send(presence);
    }
}

/// Si esta versión trae configurada la aplicación de Discord (para mostrar el ajuste).
#[tauri::command]
pub fn discord_available() -> bool {
    !APP_ID.is_empty()
}
