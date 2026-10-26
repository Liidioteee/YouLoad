mod bridge;
mod bypass;
mod clipboard;
mod download;
mod estimate;
mod log;
mod model;
mod native_host;
mod notify;
mod probe;
mod procgroup;
mod queue;
mod settings;
mod tools;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_opener::OpenerExt;

use bypass::{Bypass, BypassStatus, StrategyInfo};
use model::{DownloadOptions, HistoryItem, Job, JobError, LogLine};
use queue::Queue;
use settings::Settings;
use tools::{Tools, ToolsStatus};

pub struct AppState {
    pub tools: Result<Tools, String>,
    pub settings: RwLock<Settings>,
    pub settings_path: PathBuf,
    /// Our copy of the user's cookies file: yt-dlp rewrites the file it is given.
    pub cookies_copy: PathBuf,
    pub queue: Arc<Queue>,
    pub bypass: Arc<Bypass>,
    pub tools_status: Mutex<ToolsStatus>,
}

impl AppState {
    /// The user's proxy wins; otherwise the local bypass proxy (tpws on macOS/Linux) if running.
    pub fn effective_proxy(&self) -> String {
        let user = self.settings.read().unwrap().proxy.clone();
        if !user.is_empty() {
            return user;
        }
        self.bypass.local_proxy().unwrap_or_default()
    }

    /// Tools plus the arguments every yt-dlp call needs right now.
    pub fn ytdlp(&self) -> Result<(Tools, Vec<String>), JobError> {
        let tools = self.tools.clone().map_err(|e| JobError { code: "tool_missing".into(), detail: e })?;
        let has_cookies = !self.settings.read().unwrap().cookies_file.is_empty() && self.cookies_copy.is_file();
        let args = tools.base_args(&self.effective_proxy(), has_cookies.then_some(self.cookies_copy.as_path()));
        Ok((tools, args))
    }

    fn refresh_cookies_copy(&self) {
        let src = self.settings.read().unwrap().cookies_file.clone();
        if src.is_empty() {
            let _ = std::fs::remove_file(&self.cookies_copy);
        } else if let Err(e) = std::fs::copy(&src, &self.cookies_copy) {
            log::warn("cookies", format!("copy failed: {e}"));
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    settings: Settings,
    jobs: Vec<Job>,
    history: Vec<HistoryItem>,
    bypass: BypassStatus,
    bypass_service: bool,
    tools: ToolsStatus,
    strategies: Vec<StrategyInfo>,
    platform: &'static str,
    version: &'static str,
    system_language: String,
}

#[tauri::command]
fn get_snapshot(state: State<AppState>) -> Snapshot {
    Snapshot {
        settings: state.settings.read().unwrap().clone(),
        jobs: state.queue.snapshot(),
        history: state.queue.history(),
        bypass: state.bypass.status(),
        bypass_service: state.bypass.service_available(),
        tools: state.tools_status.lock().unwrap().clone(),
        strategies: bypass::strategy_list(),
        platform: std::env::consts::OS,
        version: env!("CARGO_PKG_VERSION"),
        system_language: sys_locale::get_locale().unwrap_or_default(),
    }
}

#[tauri::command]
fn add_url(state: State<AppState>, url: String) -> Result<Job, String> {
    let url = probe::normalize_url(&url)?;
    Ok(state.queue.add(url))
}

#[tauri::command]
fn set_job_options(state: State<AppState>, id: String, options: DownloadOptions) {
    state.queue.set_options(&id, options);
}

#[tauri::command]
fn start_job(state: State<AppState>, id: String, options: DownloadOptions) -> Result<Job, String> {
    state.queue.start(&id, options)
}

#[tauri::command]
fn pause_job(state: State<AppState>, id: String) {
    state.queue.pause(&id);
}

#[tauri::command]
fn resume_job(state: State<AppState>, id: String) -> Result<(), String> {
    state.queue.resume(&id)
}

#[tauri::command]
fn cancel_job(state: State<AppState>, id: String) {
    state.queue.cancel(&id);
}

#[tauri::command]
fn retry_job(state: State<AppState>, id: String) -> Result<(), String> {
    state.queue.retry(&id)
}

#[tauri::command]
fn remove_job(state: State<AppState>, id: String) {
    state.queue.remove(&id);
}

#[tauri::command]
fn clear_finished(state: State<AppState>) {
    state.queue.clear_finished();
}

#[tauri::command]
fn switch_channel_tab(state: State<AppState>, id: String, tab: String) -> Result<(), String> {
    state.queue.switch_tab(&id, &tab)
}

fn open_path(app: &AppHandle, path: &str, reveal: bool) -> Result<(), String> {
    if !Path::new(path).exists() {
        return Err("file_missing".into());
    }
    if reveal {
        app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
    } else {
        app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
    }
}

/// Opens the downloaded file (or reveals it) by job id, so the UI never passes raw paths.
#[tauri::command]
fn open_output(app: AppHandle, state: State<AppState>, id: String, reveal: bool) -> Result<(), String> {
    let job = state.queue.get(&id).ok_or("job_not_found")?;
    let path = job.outputs.last().cloned().ok_or("file_not_ready")?;
    open_path(&app, &path, reveal)
}

#[tauri::command]
fn open_history_output(app: AppHandle, state: State<AppState>, id: String, reveal: bool) -> Result<(), String> {
    let item = state.queue.history_item(&id).ok_or("job_not_found")?;
    let path = item.outputs.iter().rev().find(|p| Path::new(p).exists()).cloned().ok_or("file_missing")?;
    open_path(&app, &path, reveal)
}

#[tauri::command]
fn remove_history(state: State<AppState>, id: String) {
    state.queue.remove_history(&id);
}

#[tauri::command]
fn clear_history(state: State<AppState>) {
    state.queue.clear_history();
}

#[tauri::command]
fn open_download_dir(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let dir = state.settings.read().unwrap().download_dir.clone();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_log() -> Vec<LogLine> {
    log::snapshot()
}

#[tauri::command]
async fn save_settings(app: AppHandle, state: State<'_, AppState>, settings: Settings) -> Result<Settings, String> {
    let mut settings = settings;
    settings.normalize();
    settings.validate()?;
    let previous = state.settings.read().unwrap().clone();
    settings.save(&state.settings_path).map_err(|e| e.to_string())?;
    *state.settings.write().unwrap() = settings.clone();

    if previous.cookies_file != settings.cookies_file {
        state.refresh_cookies_copy();
    }
    let bypass_changed = previous.bypass.enabled != settings.bypass.enabled || previous.bypass.strategy != settings.bypass.strategy;
    if bypass_changed {
        let b = state.bypass.clone();
        let s = settings.bypass.clone();
        tauri::async_runtime::spawn(async move {
            if s.enabled { b.start(s.strategy).await } else { b.stop().await }
        });
    }
    state.queue.pump();
    let _ = app.emit("settings", &settings);
    Ok(settings)
}

#[tauri::command]
async fn bypass_restart(state: State<'_, AppState>) -> Result<(), String> {
    let strategy = state.settings.read().unwrap().bypass.strategy.clone();
    state.bypass.start(strategy).await;
    Ok(())
}

#[tauri::command]
async fn bypass_stop(state: State<'_, AppState>) -> Result<(), String> {
    state.bypass.stop().await;
    Ok(())
}

#[tauri::command]
async fn bypass_check(state: State<'_, AppState>) -> Result<Vec<bypass::check::CheckItem>, JobError> {
    let (tools, args) = state.ytdlp()?;
    Ok(bypass::check::run(&tools, &args, &state.effective_proxy()).await)
}

/// Tries strategies one by one and keeps the first that gives a good video speed.
#[tauri::command]
async fn bypass_autoselect(app: AppHandle, state: State<'_, AppState>) -> Result<Option<String>, String> {
    let found = bypass::autoselect(&app).await;
    if let Some(id) = &found {
        let mut s = state.settings.read().unwrap().clone();
        s.bypass.strategy = id.clone();
        s.bypass.enabled = true;
        s.save(&state.settings_path).map_err(|e| e.to_string())?;
        *state.settings.write().unwrap() = s.clone();
        let _ = app.emit("settings", &s);
    }
    Ok(found)
}

#[tauri::command]
async fn update_tools(app: AppHandle) -> Result<(), String> {
    refresh_tools(app, true).await;
    Ok(())
}

async fn refresh_tools(app: AppHandle, update: bool) {
    let state = app.state::<AppState>();
    let Ok(tools) = state.tools.clone() else { return };
    let set = |f: &dyn Fn(&mut ToolsStatus)| {
        let status = {
            let mut s = state.tools_status.lock().unwrap();
            f(&mut s);
            s.clone()
        };
        let _ = app.emit("tools", &status);
    };
    if update {
        set(&|s| s.updating = true);
        let result = tools.update_ytdlp(&state.effective_proxy()).await;
        let version = tools.ytdlp_version().await;
        match &result {
            Ok(m) => log::info("tools", m),
            Err(e) => log::warn("tools", e),
        }
        set(&|s| {
            s.updating = false;
            s.ytdlp_version = version.clone();
            s.message = Some(match &result {
                Ok(m) => m.clone(),
                Err(e) => e.clone(),
            });
        });
    } else {
        let version = tools.ytdlp_version().await;
        set(&|s| s.ytdlp_version = version.clone());
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let l = notify::lang(app);
    let show = MenuItem::with_id(app, "show", notify::tr(l, "tray_show"), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", notify::tr(l, "tray_quit"), true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main").tooltip(notify::tr(l, "tray_tip")).menu(&menu).show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(|app, event| match event.id.as_ref() {
        "show" => show_main(app),
        "quit" => app.exit(0),
        _ => {}
    })
    .on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
            show_main(tray.app_handle());
        }
    })
    .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Special modes of the same exe: the browser extension's host, the elevated bypass
    // helper and the bypass service.
    let args: Vec<String> = std::env::args().collect();
    if native_host::is_host_invocation(&args) {
        std::process::exit(native_host::run_relay());
    }
    #[cfg(windows)]
    if let Some(code) = bypass::windows::dispatch(&args) {
        std::process::exit(code);
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let paths = app.path();
            let config_dir = paths.app_config_dir()?;
            let local_data = paths.app_local_data_dir()?;
            let cache = paths.app_cache_dir()?;
            log::init(&paths.app_log_dir()?);
            log::info("app", format!("YouLoad {} on {}", env!("CARGO_PKG_VERSION"), std::env::consts::OS));

            let default_dir = paths.video_dir().or_else(|_| paths.download_dir()).map(|d| d.join("YouLoad")).unwrap_or_default();
            let settings_path = config_dir.join("settings.json");
            let settings = Settings::load(&settings_path, default_dir);
            let tools = Tools::locate(&paths.resource_dir()?, &local_data).map_err(|e| e.to_string());
            if let Err(e) = &tools {
                log::error("tools", e);
            }
            let tools_status = tools.as_ref().map(Tools::status_basics).unwrap_or_default();
            let bypass_cfg = settings.bypass.clone();
            let queue = Queue::new(handle.clone(), local_data.clone(), cache.join("partial"));
            queue.start_autosave();

            app.manage(AppState {
                tools,
                settings: RwLock::new(settings),
                settings_path,
                cookies_copy: local_data.join("cookies.txt"),
                queue,
                bypass: Bypass::new(handle.clone()),
                tools_status: Mutex::new(tools_status),
            });
            app.state::<AppState>().refresh_cookies_copy();

            let h = handle.clone();
            tauri::async_runtime::spawn(async move {
                refresh_tools(h.clone(), false).await;
                refresh_tools(h, true).await;
            });
            if bypass_cfg.enabled {
                let b = app.state::<AppState>().bypass.clone();
                tauri::async_runtime::spawn(async move { b.start(bypass_cfg.strategy).await });
            }
            clipboard::start(handle.clone());
            bridge::start(handle.clone());
            if let Err(e) = native_host::register(&local_data) {
                log::warn("extension", format!("browser registration failed: {e}"));
            }
            if let Err(e) = build_tray(&handle) {
                log::warn("tray", e.to_string());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if app.state::<AppState>().settings.read().unwrap().close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            add_url,
            set_job_options,
            start_job,
            pause_job,
            resume_job,
            cancel_job,
            retry_job,
            remove_job,
            clear_finished,
            switch_channel_tab,
            open_output,
            open_history_output,
            remove_history,
            clear_history,
            open_download_dir,
            get_log,
            save_settings,
            bypass_restart,
            bypass_stop,
            bypass_check,
            bypass_autoselect,
            update_tools,
        ])
        .build(tauri::generate_context!())
        .expect("error while building YouLoad");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            let state = app.state::<AppState>();
            state.queue.shutdown();
            state.bypass.stop_now();
            log::info("app", "exit");
        }
    });
}
