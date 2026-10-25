//! DPI bypass. Runs only while the app is open.
//!
//! Windows: zapret's winws, started by the "YouLoad Bypass" service (no UAC prompt) or,
//! when the service is not installed, by an elevated helper copy of this exe. If the user
//! already runs zapret, we use theirs and start nothing.
//! macOS/Linux: zapret's tpws as a local SOCKS proxy that only yt-dlp uses.

pub mod check;
#[cfg(windows)]
pub mod service;
#[cfg(unix)]
pub mod tpws;
#[cfg(windows)]
pub mod windows;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::{log, AppState};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Strategy {
    pub id: String,
    pub name: String,
    pub args: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StrategyInfo {
    pub id: String,
    pub name: String,
}

#[cfg(windows)]
pub fn strategies() -> Vec<Strategy> {
    windows::strategies()
}
#[cfg(unix)]
pub fn strategies() -> Vec<Strategy> {
    tpws::strategies()
}

pub fn strategy_list() -> Vec<StrategyInfo> {
    strategies().into_iter().map(|s| StrategyInfo { id: s.id, name: s.name }).collect()
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum BypassStatus {
    Off,
    Starting,
    /// mode: "service" | "helper" | "tpws"
    Active { strategy: String, mode: String },
    /// The user's own zapret is running; we rely on it.
    External,
    Error { code: String, detail: String },
}

enum Backend {
    #[cfg(windows)]
    Helper(Arc<windows::Helper>),
    #[cfg(windows)]
    Service(Arc<service::Client>),
    #[cfg(unix)]
    Tpws(tpws::Running),
}

pub struct Bypass {
    app: AppHandle,
    status: Mutex<BypassStatus>,
    stopping: Arc<AtomicBool>,
    backend: Mutex<Option<Backend>>,
    /// Serializes start/stop so quick toggles cannot interleave.
    op: tokio::sync::Mutex<()>,
}

impl Bypass {
    pub fn new(app: AppHandle) -> Arc<Self> {
        Arc::new(Self {
            app,
            status: Mutex::new(BypassStatus::Off),
            stopping: Arc::new(AtomicBool::new(false)),
            backend: Mutex::new(None),
            op: tokio::sync::Mutex::new(()),
        })
    }

    pub fn status(&self) -> BypassStatus {
        self.status.lock().unwrap().clone()
    }

    fn set(&self, status: BypassStatus) {
        let changed = *self.status.lock().unwrap() != status;
        *self.status.lock().unwrap() = status.clone();
        if changed {
            match &status {
                BypassStatus::Error { code, detail } => log::warn("bypass", format!("{code}: {detail}")),
                s => log::info("bypass", format!("{s:?}")),
            }
        }
        let _ = self.app.emit("bypass", &status);
    }

    pub fn service_available(&self) -> bool {
        #[cfg(windows)]
        return service::installed();
        #[cfg(not(windows))]
        return false;
    }

    /// SOCKS address of tpws while it runs (macOS/Linux).
    pub fn local_proxy(&self) -> Option<String> {
        #[cfg(unix)]
        if let Some(Backend::Tpws(t)) = self.backend.lock().unwrap().as_ref() {
            return Some(t.proxy_url());
        }
        None
    }

    pub async fn start(self: &Arc<Self>, strategy: String) {
        let _guard = self.op.lock().await;
        self.stop_inner().await;
        if !strategies().iter().any(|s| s.id == strategy) {
            self.set(BypassStatus::Error { code: "unknown_strategy".into(), detail: strategy });
            return;
        }
        self.stopping.store(false, Ordering::SeqCst);
        #[cfg(windows)]
        {
            if windows::winws_running() {
                self.set(BypassStatus::External);
                return;
            }
            self.set(BypassStatus::Starting);
            if service::installed() {
                match service::Client::connect().await {
                    Ok(client) => match client.start(&strategy).await {
                        Ok(()) => {
                            let client = Arc::new(client);
                            *self.backend.lock().unwrap() = Some(Backend::Service(client));
                            self.set(BypassStatus::Active { strategy, mode: "service".into() });
                            return;
                        }
                        Err((code, detail)) => {
                            self.set(BypassStatus::Error { code, detail });
                            return;
                        }
                    },
                    Err(e) => log::warn("bypass", format!("service unavailable, using helper: {e}")),
                }
            }
            self.start_helper(strategy).await;
        }
        #[cfg(unix)]
        {
            self.set(BypassStatus::Starting);
            let res = { self.app.state::<AppState>().tools.clone() };
            let Ok(tools) = res else {
                self.set(BypassStatus::Error { code: "tool_missing".into(), detail: String::new() });
                return;
            };
            match tpws::Running::start(&tools.zapret_dir, &strategy).await {
                Ok(t) => {
                    *self.backend.lock().unwrap() = Some(Backend::Tpws(t));
                    self.set(BypassStatus::Active { strategy, mode: "tpws".into() });
                }
                Err((code, detail)) => self.set(BypassStatus::Error { code, detail }),
            }
        }
    }

    #[cfg(windows)]
    async fn start_helper(self: &Arc<Self>, strategy: String) {
        let launch = {
            let s = strategy.clone();
            tauri::async_runtime::spawn_blocking(move || windows::launch_helper(&s)).await
        };
        let helper = match launch {
            Ok(Ok(h)) => Arc::new(h),
            Ok(Err((code, detail))) => return self.set(BypassStatus::Error { code, detail }),
            Err(e) => return self.set(BypassStatus::Error { code: "launch_failed".into(), detail: e.to_string() }),
        };
        *self.backend.lock().unwrap() = Some(Backend::Helper(helper.clone()));

        // Watch the helper: if it exits on its own, report why.
        let this = self.clone();
        let watched = helper.clone();
        std::thread::spawn(move || {
            let code = watched.wait_exit();
            let current = matches!(this.backend.lock().unwrap().as_ref(), Some(Backend::Helper(h)) if Arc::ptr_eq(h, &watched));
            if !current {
                return;
            }
            *this.backend.lock().unwrap() = None;
            if this.stopping.load(Ordering::SeqCst) {
                this.set(BypassStatus::Off);
            } else {
                this.set(BypassStatus::Error { code: windows::helper_exit_code_name(code).into(), detail: format!("exit {code}") });
            }
        });

        // winws needs a moment to load the WinDivert driver.
        for _ in 0..30 {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            if !matches!(self.status(), BypassStatus::Starting) {
                return;
            }
            if windows::winws_running() {
                self.set(BypassStatus::Active { strategy, mode: "helper".into() });
                return;
            }
        }
        self.set(BypassStatus::Error { code: "winws_timeout".into(), detail: String::new() });
        self.stop_inner().await;
    }

    pub async fn stop(&self) {
        let _guard = self.op.lock().await;
        self.stop_inner().await;
        if !matches!(self.status(), BypassStatus::Error { .. }) || self.backend.lock().unwrap().is_none() {
            self.set(BypassStatus::Off);
        }
    }

    async fn stop_inner(&self) {
        let backend = self.backend.lock().unwrap().take();
        self.stopping.store(true, Ordering::SeqCst);
        match backend {
            None => {}
            #[cfg(windows)]
            Some(Backend::Helper(helper)) => {
                helper.signal_stop();
                let _ = tauri::async_runtime::spawn_blocking(move || helper.wait_exit_timeout(3000)).await;
            }
            #[cfg(windows)]
            Some(Backend::Service(client)) => client.stop().await,
            #[cfg(unix)]
            Some(Backend::Tpws(mut t)) => t.stop().await,
        }
        if matches!(self.status(), BypassStatus::Active { .. } | BypassStatus::External) {
            self.set(BypassStatus::Off);
        }
    }

    /// Called on app exit; must not block for long.
    pub fn stop_now(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        match self.backend.lock().unwrap().take() {
            None => {}
            #[cfg(windows)]
            Some(Backend::Helper(helper)) => {
                helper.signal_stop();
                helper.wait_exit_timeout(1500);
            }
            // The service notices the closed pipe and stops winws by itself.
            #[cfg(windows)]
            Some(Backend::Service(_)) => {}
            #[cfg(unix)]
            Some(Backend::Tpws(t)) => drop(t),
        }
    }

    /// Without the service each restart would ask for admin rights, so autoselect
    /// needs the service on Windows.
    pub fn can_autoselect(&self) -> bool {
        cfg!(unix) || (self.service_available() && !matches!(self.status(), BypassStatus::External))
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AutoselectProgress {
    index: usize,
    total: usize,
    strategy: String,
    speed: Option<f64>,
}

/// Tries each strategy and keeps the first one with a good video download speed.
pub async fn autoselect(app: &AppHandle) -> Option<String> {
    let state = app.state::<AppState>();
    let bypass = state.bypass.clone();
    if !bypass.can_autoselect() {
        return None;
    }
    let original = state.settings.read().unwrap().bypass.strategy.clone();
    let list = strategies();
    let total = list.len();
    for (index, s) in list.iter().enumerate() {
        let _ = app.emit("bypass-autoselect", AutoselectProgress { index, total, strategy: s.name.clone(), speed: None });
        bypass.start(s.id.clone()).await;
        if !matches!(bypass.status(), BypassStatus::Active { .. }) {
            continue;
        }
        let Ok((tools, args)) = state.ytdlp() else { break };
        let sample = check::speed_sample(&tools, &args, &state.effective_proxy()).await;
        let _ = app.emit("bypass-autoselect", AutoselectProgress { index, total, strategy: s.name.clone(), speed: sample.speed });
        log::info("autoselect", format!("{}: {:?} B/s", s.id, sample.speed));
        if sample.ok {
            return Some(s.id.clone());
        }
    }
    bypass.start(original).await;
    None
}
