//! Local channel for the browser extension. The native-messaging host (this exe started by
//! the browser, see native_host.rs) relays the extension's messages here.
//!
//! Wire format: one JSON object per line. Requests `{"id":1,"cmd":"probe","url":"…"}`,
//! responses `{"id":1,"ok":true,"data":…}` or `{"id":1,"ok":false,"error":"code"}`.
//! Windows: a named pipe per user; macOS/Linux: a Unix socket readable only by the user.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

use crate::model::{DownloadOptions, JobStatus, MediaInfo, MediaKind};
use crate::{estimate, log, probe, AppState};

const CACHE_TTL: Duration = Duration::from_secs(10 * 60);

/// Analyzed links, so reopening the menu is instant and playlist scans are shared.
static CACHE: LazyLock<Mutex<HashMap<String, (Instant, Arc<Mutex<MediaInfo>>)>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn user_tag() -> String {
    let user = std::env::var("USERNAME").or_else(|_| std::env::var("USER")).unwrap_or_else(|_| "user".into());
    user.chars().filter(|c| c.is_ascii_alphanumeric()).take(32).collect()
}

pub fn endpoint() -> String {
    #[cfg(windows)]
    return format!(r"\\.\pipe\YouLoadApp-{}", user_tag());
    #[cfg(unix)]
    {
        let dir = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().into_owned());
        format!("{dir}/youload-{}.sock", user_tag())
    }
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = serve(app).await {
            log::warn("bridge", format!("extension channel unavailable: {e}"));
        }
    });
}

#[cfg(windows)]
async fn serve(app: AppHandle) -> std::io::Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;
    let name = endpoint();
    let mut server = ServerOptions::new().first_pipe_instance(true).create(&name)?;
    log::info("bridge", "extension channel ready");
    loop {
        server.connect().await?;
        let client = server;
        server = ServerOptions::new().create(&name)?;
        tauri::async_runtime::spawn(handle_conn(app.clone(), client));
    }
}

#[cfg(unix)]
async fn serve(app: AppHandle) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let path = endpoint();
    let _ = std::fs::remove_file(&path);
    let listener = tokio::net::UnixListener::bind(&path)?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    log::info("bridge", "extension channel ready");
    loop {
        let (stream, _) = listener.accept().await?;
        tauri::async_runtime::spawn(handle_conn(app.clone(), stream));
    }
}

#[derive(Deserialize)]
struct Request {
    id: Value,
    cmd: String,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    options: Option<DownloadOptions>,
}

async fn handle_conn<S: AsyncRead + AsyncWrite + Send + 'static>(app: AppHandle, stream: S) {
    let (r, mut w) = tokio::io::split(stream);
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    // One writer; requests run concurrently so a slow analysis does not block the rest.
    let writer = tokio::spawn(async move {
        while let Some(line) = rx.recv().await {
            if w.write_all(line.as_bytes()).await.is_err() || w.write_all(b"\n").await.is_err() {
                break;
            }
        }
    });
    let mut lines = BufReader::new(r).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(req) = serde_json::from_str::<Request>(&line) else { continue };
        let (app, tx) = (app.clone(), tx.clone());
        tauri::async_runtime::spawn(async move {
            let reply = match handle(&app, &req).await {
                Ok(data) => json!({"id": req.id, "ok": true, "data": data}),
                Err(code) => json!({"id": req.id, "ok": false, "error": code}),
            };
            let _ = tx.send(reply.to_string());
        });
    }
    drop(tx);
    let _ = writer.await;
}

async fn handle(app: &AppHandle, req: &Request) -> Result<Value, String> {
    let state = app.state::<AppState>();
    match req.cmd.as_str() {
        "status" => {
            let s = state.settings.read().unwrap().clone();
            Ok(json!({
                "version": env!("CARGO_PKG_VERSION"),
                "bypass": state.bypass.status(),
                "language": s.language,
                "systemLanguage": sys_locale::get_locale().unwrap_or_default(),
                "theme": s.theme,
                "presets": s.presets,
                "defaultPreset": s.default_preset,
            }))
        }
        "probe" => {
            let url = probe::normalize_url(req.url.as_deref().unwrap_or_default())?;
            let media = cached_probe(app, &url).await?;
            let mut m = media.lock().unwrap().clone();
            // Keep the reply under the browser's 1 MB message limit; sizes come from "estimate".
            for e in &mut m.entries {
                e.formats = None;
            }
            Ok(serde_json::to_value(m).unwrap_or_default())
        }
        "estimate" => {
            let url = probe::normalize_url(req.url.as_deref().unwrap_or_default())?;
            let options = req.options.clone().ok_or("bad_request")?;
            let media = cached_probe(app, &url).await?;
            let (bytes, known, total) = estimate::playlist(&media.lock().unwrap(), &options);
            Ok(json!({"bytes": bytes, "known": known, "total": total}))
        }
        "enqueue" => {
            let url = probe::normalize_url(req.url.as_deref().unwrap_or_default())?;
            let options = req.options.clone().ok_or("bad_request")?;
            let job = state.queue.add_and_start(url, options);
            log::info("bridge", format!("download from browser: {}", job.url));
            Ok(json!({"jobId": job.id}))
        }
        "open" => {
            let url = probe::normalize_url(req.url.as_deref().unwrap_or_default())?;
            let job = state.queue.add(url);
            crate::show_main(app);
            let _ = app.emit("select-job", &job.id);
            Ok(json!({"jobId": job.id}))
        }
        "focus" => {
            crate::show_main(app);
            Ok(Value::Null)
        }
        "jobs" => {
            let jobs: Vec<Value> = state
                .queue
                .snapshot()
                .into_iter()
                .filter(|j| !matches!(j.status, JobStatus::Canceled))
                .take(8)
                .map(|j| {
                    json!({
                        "id": j.id,
                        "title": j.media.as_ref().map(|m| m.title.clone()).unwrap_or(j.url.clone()),
                        "status": j.status,
                        "fraction": j.progress.fraction,
                        "speed": j.progress.speed,
                        "item": j.progress.item,
                        "items": j.progress.items,
                    })
                })
                .collect();
            Ok(json!(jobs))
        }
        _ => Err("bad_request".into()),
    }
}

/// Analyzes a link once; playlists then get their sizes scanned in the background.
async fn cached_probe(app: &AppHandle, url: &str) -> Result<Arc<Mutex<MediaInfo>>, String> {
    if let Some((at, media)) = CACHE.lock().unwrap().get(url) {
        if at.elapsed() < CACHE_TTL {
            return Ok(media.clone());
        }
    }
    let state = app.state::<AppState>();
    let (tools, args) = state.ytdlp().map_err(|e| e.code)?;
    let mut media = probe::probe(&tools, &args, url).await.map_err(|e| e.code)?;
    let downloaded = state.queue.downloaded_ids();
    for e in &mut media.entries {
        e.downloaded = downloaded.contains(&e.id);
    }
    let playlist = media.kind == MediaKind::Playlist;
    let shared = Arc::new(Mutex::new(media));
    {
        let mut cache = CACHE.lock().unwrap();
        cache.retain(|_, (at, _)| at.elapsed() < CACHE_TTL);
        cache.insert(url.to_string(), (Instant::now(), shared.clone()));
    }
    if playlist {
        scan(app.clone(), shared.clone());
    }
    Ok(shared)
}

fn scan(app: AppHandle, media: Arc<Mutex<MediaInfo>>) {
    let urls: Vec<String> = media.lock().unwrap().entries.iter().map(|e| e.url.clone()).collect();
    let sem = Arc::new(tokio::sync::Semaphore::new(3));
    for chunk in urls.chunks(6).map(<[String]>::to_vec) {
        let (app, media, sem) = (app.clone(), media.clone(), sem.clone());
        tauri::async_runtime::spawn(async move {
            let Ok(_permit) = sem.acquire_owned().await else { return };
            let Ok((tools, args)) = app.state::<AppState>().ytdlp() else { return };
            let mut found = probe::scan_formats(&tools, &args, &chunk).await;
            let mut m = media.lock().unwrap();
            for e in m.entries.iter_mut().filter(|e| chunk.contains(&e.url)) {
                e.formats = Some(found.remove(&e.id).unwrap_or_default());
            }
        });
    }
}
