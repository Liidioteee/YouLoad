mod bypass;
mod download;
mod model;
mod probe;
mod procgroup;
mod queue;
mod settings;
mod tools;

use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_opener::OpenerExt;

use bypass::{Bypass, BypassStatus, StrategyInfo};
use model::{DownloadOptions, Job};
use queue::Queue;
use settings::Settings;
use tools::{Tools, ToolsStatus};

pub struct AppState {
    pub tools: Result<Tools, String>,
    pub settings: RwLock<Settings>,
    pub settings_path: PathBuf,
    pub queue: Arc<Queue>,
    pub bypass: Arc<Bypass>,
    pub tools_status: Mutex<ToolsStatus>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    settings: Settings,
    jobs: Vec<Job>,
    bypass: BypassStatus,
    tools: ToolsStatus,
    strategies: Vec<StrategyInfo>,
    platform: &'static str,
    version: &'static str,
}

#[tauri::command]
fn get_snapshot(state: State<AppState>) -> Snapshot {
    Snapshot {
        settings: state.settings.read().unwrap().clone(),
        jobs: state.queue.snapshot(),
        bypass: state.bypass.status(),
        tools: state.tools_status.lock().unwrap().clone(),
        strategies: bypass::strategies().into_iter().map(|s| StrategyInfo { id: s.id, name: s.name }).collect(),
        platform: std::env::consts::OS,
        version: env!("CARGO_PKG_VERSION"),
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

/// Opens the downloaded file (or reveals it) by job id, so the UI never passes raw paths.
#[tauri::command]
fn open_output(app: AppHandle, state: State<AppState>, id: String, reveal: bool) -> Result<(), String> {
    let job = state.queue.get(&id).ok_or("Загрузка не найдена")?;
    let path = job.outputs.last().cloned().ok_or("Файл ещё не готов")?;
    if !std::path::Path::new(&path).exists() {
        return Err("Файл не найден: возможно, его переместили или удалили".into());
    }
    if reveal {
        app.opener().reveal_item_in_dir(&path).map_err(|e| e.to_string())
    } else {
        app.opener().open_path(&path, None::<&str>).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn open_download_dir(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let dir = state.settings.read().unwrap().download_dir.clone();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_settings(app: AppHandle, state: State<'_, AppState>, settings: Settings) -> Result<Settings, String> {
    let mut settings = settings;
    settings.normalize();
    settings.validate()?;
    let previous = state.settings.read().unwrap().clone();
    settings.save(&state.settings_path).map_err(|e| e.to_string())?;
    *state.settings.write().unwrap() = settings.clone();

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
async fn bypass_check(state: State<'_, AppState>) -> Result<Vec<bypass::check::CheckItem>, String> {
    let tools = state.tools.clone()?;
    let proxy = state.settings.read().unwrap().proxy.clone();
    Ok(bypass::check::run(&tools, &proxy).await)
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
        let proxy = state.settings.read().unwrap().proxy.clone();
        let result = tools.update_ytdlp(&proxy).await;
        let version = tools.ytdlp_version().await;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The elevated bypass helper is this same exe started with special arguments.
    #[cfg(windows)]
    {
        let args: Vec<String> = std::env::args().collect();
        if args.iter().any(|a| a == "--bypass-helper") {
            std::process::exit(bypass::windows::run_helper(&args));
        }
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let paths = app.path();
            let config_dir = paths.app_config_dir()?;
            let local_data = paths.app_local_data_dir()?;
            let default_dir = paths.video_dir().or_else(|_| paths.download_dir()).map(|d| d.join("YouLoad")).unwrap_or_default();
            let settings_path = config_dir.join("settings.json");
            let settings = Settings::load(&settings_path, default_dir);
            let tools = Tools::locate(&paths.resource_dir()?, &local_data).map_err(|e| e.to_string());
            let tools_status = tools.as_ref().map(Tools::status_basics).unwrap_or_default();
            let bypass_cfg = settings.bypass.clone();

            app.manage(AppState {
                tools,
                settings: RwLock::new(settings),
                settings_path,
                queue: Queue::new(handle.clone()),
                bypass: Bypass::new(handle.clone()),
                tools_status: Mutex::new(tools_status),
            });

            let h = handle.clone();
            tauri::async_runtime::spawn(async move {
                refresh_tools(h.clone(), false).await;
                refresh_tools(h, true).await;
            });
            if bypass_cfg.enabled {
                let b = app.state::<AppState>().bypass.clone();
                tauri::async_runtime::spawn(async move { b.start(bypass_cfg.strategy).await });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            add_url,
            set_job_options,
            start_job,
            cancel_job,
            retry_job,
            remove_job,
            clear_finished,
            open_output,
            open_download_dir,
            save_settings,
            bypass_restart,
            bypass_stop,
            bypass_check,
            update_tools,
        ])
        .build(tauri::generate_context!())
        .expect("error while building YouLoad");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            let state = app.state::<AppState>();
            state.queue.cancel_all();
            state.bypass.stop_now();
        }
    });
}
