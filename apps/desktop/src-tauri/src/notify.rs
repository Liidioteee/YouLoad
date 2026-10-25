//! System notifications and the few texts the core shows itself (notifications, tray menu).
//! Everything else is translated in the UI.

use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::model::{Job, JobStatus};
use crate::AppState;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Ru,
    En,
}

pub fn lang(app: &AppHandle) -> Lang {
    let setting = app.state::<AppState>().settings.read().unwrap().language.clone();
    match setting.as_str() {
        "ru" => Lang::Ru,
        "en" => Lang::En,
        _ => {
            let sys = sys_locale::get_locale().unwrap_or_default().to_lowercase();
            if ["ru", "uk", "be", "kk"].iter().any(|p| sys.starts_with(p)) { Lang::Ru } else { Lang::En }
        }
    }
}

pub fn tr(lang: Lang, key: &str) -> &'static str {
    let ru = lang == Lang::Ru;
    match key {
        "done" => if ru { "Загрузка завершена" } else { "Download finished" },
        "failed" => if ru { "Не удалось скачать" } else { "Download failed" },
        "clip_title" => if ru { "Скопирована ссылка на YouTube" } else { "YouTube link copied" },
        "clip_body" => if ru { "Откройте YouLoad, чтобы скачать" } else { "Open YouLoad to download it" },
        "tray_show" => if ru { "Открыть YouLoad" } else { "Open YouLoad" },
        "tray_quit" => if ru { "Выход" } else { "Quit" },
        "tray_tip" => "YouLoad",
        _ => "",
    }
}

fn window_in_focus(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .map(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
        .unwrap_or(false)
}

fn enabled(app: &AppHandle) -> bool {
    app.state::<AppState>().settings.read().unwrap().notifications
}

pub fn job_finished(app: &AppHandle, job: &Job) {
    if !enabled(app) || window_in_focus(app) {
        return;
    }
    let l = lang(app);
    let title = match job.status {
        JobStatus::Done => tr(l, "done"),
        JobStatus::Error => tr(l, "failed"),
        _ => return,
    };
    let body = job.media.as_ref().map(|m| m.title.clone()).unwrap_or_else(|| job.url.clone());
    let _ = app.notification().builder().title(title).body(body).show();
}

pub fn clipboard_link(app: &AppHandle) {
    if !enabled(app) || window_in_focus(app) {
        return;
    }
    let l = lang(app);
    let _ = app.notification().builder().title(tr(l, "clip_title")).body(tr(l, "clip_body")).show();
}
