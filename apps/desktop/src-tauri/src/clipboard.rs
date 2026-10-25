//! Optional clipboard watch: when a new YouTube link is copied, the UI offers to add it.

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::{notify, probe, AppState};

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last = String::new();
        let mut first = true;
        loop {
            tokio::time::sleep(Duration::from_millis(1200)).await;
            let state = app.state::<AppState>();
            if !state.settings.read().unwrap().clipboard_watch {
                first = true;
                continue;
            }
            let Ok(text) = app.clipboard().read_text() else { continue };
            let text = text.trim().to_string();
            if text == last {
                continue;
            }
            last = text.clone();
            // Do not react to whatever was in the clipboard when the watch turned on.
            if std::mem::take(&mut first) || text.len() > 300 || text.contains(char::is_whitespace) {
                continue;
            }
            let Ok(url) = probe::normalize_url(&text) else { continue };
            if !text.contains("youtu") || state.queue.has_url(&url) {
                continue;
            }
            let _ = app.emit("clipboard-link", &url);
            notify::clipboard_link(&app);
        }
    });
}
