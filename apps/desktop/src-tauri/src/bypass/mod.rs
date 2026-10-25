//! DPI bypass via zapret. Runs only while the app is open.
//!
//! Windows: an elevated copy of this exe (`--bypass-helper`) starts winws and stops it
//! when asked or when the app process disappears. If the user already runs zapret,
//! we use theirs and start nothing.

pub mod check;
#[cfg(windows)]
pub mod windows;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// Strategies extracted from the Flowseal bundle at build time (scripts/fetch-tools.mjs).
pub const STRATEGIES_JSON: &str = include_str!("../../resources/tools/zapret/strategies.json");
/// Domains the bypass applies to.
pub const YOUTUBE_HOSTS: &str = include_str!("../../resources/app/youtube-hosts.txt");

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

pub fn strategies() -> Vec<Strategy> {
    serde_json::from_str(STRATEGIES_JSON).unwrap_or_default()
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum BypassStatus {
    Off,
    Starting,
    Active { strategy: String },
    /// The user's own zapret is running; we rely on it.
    External,
    Error { code: String, detail: String },
    Unsupported,
}

pub struct Bypass {
    app: AppHandle,
    status: Mutex<BypassStatus>,
    stopping: AtomicBool,
    #[cfg(windows)]
    helper: Mutex<Option<Arc<windows::Helper>>>,
}

impl Bypass {
    pub fn new(app: AppHandle) -> Arc<Self> {
        Arc::new(Self {
            app,
            status: Mutex::new(if cfg!(windows) { BypassStatus::Off } else { BypassStatus::Unsupported }),
            stopping: AtomicBool::new(false),
            #[cfg(windows)]
            helper: Mutex::new(None),
        })
    }

    pub fn status(&self) -> BypassStatus {
        self.status.lock().unwrap().clone()
    }

    fn set(&self, status: BypassStatus) {
        *self.status.lock().unwrap() = status.clone();
        let _ = self.app.emit("bypass", &status);
    }

    #[cfg(not(windows))]
    pub async fn start(self: &Arc<Self>, _strategy: String) {}

    #[cfg(not(windows))]
    pub async fn stop(&self) {}

    #[cfg(windows)]
    pub async fn start(self: &Arc<Self>, strategy: String) {
        if matches!(self.status(), BypassStatus::Starting) {
            return;
        }
        self.stop().await;
        if !strategies().iter().any(|s| s.id == strategy) {
            self.set(BypassStatus::Error { code: "unknown_strategy".into(), detail: strategy });
            return;
        }
        if windows::winws_running() {
            self.set(BypassStatus::External);
            return;
        }
        self.set(BypassStatus::Starting);
        self.stopping.store(false, Ordering::SeqCst);

        let launch = { let s = strategy.clone(); tauri::async_runtime::spawn_blocking(move || windows::launch_helper(&s)).await };
        let helper = match launch {
            Ok(Ok(h)) => Arc::new(h),
            Ok(Err((code, detail))) => return self.set(BypassStatus::Error { code, detail }),
            Err(e) => return self.set(BypassStatus::Error { code: "launch_failed".into(), detail: e.to_string() }),
        };
        *self.helper.lock().unwrap() = Some(helper.clone());

        // Watch the helper: if it exits on its own, report why.
        let this = self.clone();
        let watched = helper.clone();
        std::thread::spawn(move || {
            let code = watched.wait_exit();
            let current = this.helper.lock().unwrap().as_ref().is_some_and(|h| Arc::ptr_eq(h, &watched));
            if !current {
                return;
            }
            *this.helper.lock().unwrap() = None;
            if this.stopping.load(Ordering::SeqCst) {
                this.set(BypassStatus::Off);
            } else {
                this.set(BypassStatus::Error { code: windows::helper_exit_code_name(code).into(), detail: format!("код {code}") });
            }
        });

        // winws needs a moment to load the WinDivert driver.
        for _ in 0..30 {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            if !matches!(self.status(), BypassStatus::Starting) {
                return;
            }
            if windows::winws_running() {
                self.set(BypassStatus::Active { strategy });
                return;
            }
        }
        self.set(BypassStatus::Error { code: "winws_timeout".into(), detail: "winws не запустился за 6 секунд".into() });
        self.stop().await;
    }

    #[cfg(windows)]
    pub async fn stop(&self) {
        let helper = self.helper.lock().unwrap().clone();
        if let Some(helper) = helper {
            self.stopping.store(true, Ordering::SeqCst);
            helper.signal_stop();
            let h = helper.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || h.wait_exit_timeout(3000)).await;
            *self.helper.lock().unwrap() = None;
        }
        if !matches!(self.status(), BypassStatus::Error { .. }) {
            self.set(BypassStatus::Off);
        }
    }

    /// Called on app exit; must not block for long.
    pub fn stop_now(&self) {
        #[cfg(windows)]
        if let Some(helper) = self.helper.lock().unwrap().take() {
            self.stopping.store(true, Ordering::SeqCst);
            helper.signal_stop();
            helper.wait_exit_timeout(1500);
        }
    }
}
