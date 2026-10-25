//! "YouLoad Bypass" Windows service. Installed by the installer, it runs as LocalSystem
//! and starts winws when the app asks over a named pipe, so there is no UAC prompt.
//! winws stops as soon as the app disconnects: closing or crashing the app ends the bypass.

use std::ffi::{c_void, OsString};
use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, ReadHalf, WriteHalf};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient, NamedPipeServer, ServerOptions};
use tokio::sync::watch;
use windows_service::service::{
    ServiceAccess, ServiceControl, ServiceControlAccept, ServiceErrorControl, ServiceExitCode, ServiceInfo, ServiceStartType, ServiceState,
    ServiceStatus, ServiceType,
};
use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
use windows_service::{define_windows_service, service_dispatcher};
use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Authorization::{ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1};
use windows_sys::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};

use super::windows::{helper_exit_code_name, wide, winws_command};

pub const NAME: &str = "YouLoadBypass";
const DISPLAY_NAME: &str = "YouLoad Bypass";
const PIPE: &str = r"\\.\pipe\YouLoadBypass";
/// SYSTEM and administrators: full access; interactively logged-on users: read/write.
const PIPE_SDDL: &str = "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;IU)";

// ---------- installer side ----------

pub fn installed() -> bool {
    ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        .and_then(|m| m.open_service(NAME, ServiceAccess::QUERY_STATUS))
        .is_ok()
}

fn stop_and_delete(manager: &ServiceManager) {
    if let Ok(svc) = manager.open_service(NAME, ServiceAccess::STOP | ServiceAccess::DELETE | ServiceAccess::QUERY_STATUS) {
        let _ = svc.stop();
        for _ in 0..50 {
            match svc.query_status() {
                Ok(s) if s.current_state != ServiceState::Stopped => std::thread::sleep(Duration::from_millis(100)),
                _ => break,
            }
        }
        let _ = svc.delete();
    }
}

/// `youload.exe --install-service`, run by the installer with admin rights.
pub fn install() -> i32 {
    let result = (|| -> windows_service::Result<()> {
        let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE)?;
        stop_and_delete(&manager);
        std::thread::sleep(Duration::from_millis(500));
        let exe = std::env::current_exe().map_err(windows_service::Error::Winapi)?;
        let info = ServiceInfo {
            name: OsString::from(NAME),
            display_name: OsString::from(DISPLAY_NAME),
            service_type: ServiceType::OWN_PROCESS,
            start_type: ServiceStartType::AutoStart,
            error_control: ServiceErrorControl::Normal,
            executable_path: exe,
            launch_arguments: vec![OsString::from("--service")],
            dependencies: vec![],
            account_name: None,
            account_password: None,
        };
        let svc = manager.create_service(&info, ServiceAccess::CHANGE_CONFIG | ServiceAccess::START)?;
        svc.set_description("Runs zapret for YouLoad while the app is open. Idle otherwise.")?;
        svc.start::<&str>(&[])?;
        Ok(())
    })();
    if result.is_ok() { 0 } else { 1 }
}

/// `youload.exe --uninstall-service`, run by the uninstaller.
pub fn uninstall() -> i32 {
    match ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT) {
        Ok(m) => {
            stop_and_delete(&m);
            0
        }
        Err(_) => 1,
    }
}

// ---------- service side ----------

define_windows_service!(ffi_service_main, service_main);

pub fn run() -> i32 {
    if service_dispatcher::start(NAME, ffi_service_main).is_ok() { 0 } else { 1 }
}

fn service_main(_args: Vec<OsString>) {
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let handler = move |event| match event {
        ServiceControl::Stop | ServiceControl::Shutdown => {
            let _ = shutdown_tx.send(true);
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
        _ => ServiceControlHandlerResult::NotImplemented,
    };
    let Ok(status) = service_control_handler::register(NAME, handler) else { return };
    let set = |state: ServiceState| {
        let _ = status.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: state,
            controls_accepted: if state == ServiceState::Running { ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN } else { ServiceControlAccept::empty() },
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: Duration::from_secs(3),
            process_id: None,
        });
    };
    set(ServiceState::Running);
    if let Ok(rt) = tokio::runtime::Builder::new_current_thread().enable_all().build() {
        rt.block_on(serve(shutdown_rx));
    }
    set(ServiceState::Stopped);
}

fn create_pipe(first: bool) -> std::io::Result<NamedPipeServer> {
    unsafe {
        let mut sd: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(wide(PIPE_SDDL).as_ptr(), SDDL_REVISION_1, &mut sd, std::ptr::null_mut()) == 0 {
            return Err(std::io::Error::last_os_error());
        }
        let mut sa = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: sd, bInheritHandle: 0 };
        let pipe = ServerOptions::new().first_pipe_instance(first).create_with_security_attributes_raw(PIPE, &mut sa as *mut _ as *mut c_void);
        LocalFree(sd as _);
        pipe
    }
}

async fn serve(mut shutdown: watch::Receiver<bool>) {
    let mut first = true;
    loop {
        let server = match create_pipe(first) {
            Ok(s) => s,
            Err(_) => {
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(1)) => continue,
                    _ = shutdown.changed() => return,
                }
            }
        };
        first = false;
        tokio::select! {
            connected = server.connect() => {
                if connected.is_ok() {
                    handle_client(server, &mut shutdown).await;
                }
            }
            _ = shutdown.changed() => return,
        }
        if *shutdown.borrow() {
            return;
        }
    }
}

#[derive(Deserialize)]
struct Request {
    cmd: String,
    strategy: Option<String>,
}

struct Winws {
    child: std::process::Child,
    hosts: PathBuf,
}

impl Winws {
    fn stop(mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_file(&self.hosts);
    }
}

async fn handle_client(pipe: NamedPipeServer, shutdown: &mut watch::Receiver<bool>) {
    let (r, mut w) = tokio::io::split(pipe);
    let mut lines = BufReader::new(r).lines();
    let mut winws: Option<Winws> = None;
    loop {
        tokio::select! {
            line = lines.next_line() => {
                let Ok(Some(line)) = line else { break };
                let reply = match serde_json::from_str::<Request>(&line) {
                    Ok(req) => handle(req, &mut winws).await,
                    Err(_) => json!({"ok": false, "code": "bad_request"}),
                };
                if w.write_all(format!("{reply}\n").as_bytes()).await.is_err() {
                    break;
                }
            }
            _ = shutdown.changed() => break,
        }
    }
    // The app closed or crashed: the bypass ends with it.
    if let Some(x) = winws.take() {
        x.stop();
    }
}

async fn handle(req: Request, winws: &mut Option<Winws>) -> Value {
    match req.cmd.as_str() {
        "start" => {
            if let Some(x) = winws.take() {
                x.stop();
            }
            let strategy = req.strategy.unwrap_or_default();
            let launch = match winws_command(&strategy) {
                Ok(l) => l,
                Err(code) => return json!({"ok": false, "code": helper_exit_code_name(code as u32)}),
            };
            let mut command = launch.command;
            let mut child = match command.spawn() {
                Ok(c) => c,
                Err(e) => return json!({"ok": false, "code": "winws_spawn_failed", "detail": e.to_string()}),
            };
            // winws exits right away on bad arguments or when the driver cannot load.
            tokio::time::sleep(Duration::from_millis(1500)).await;
            if let Ok(Some(status)) = child.try_wait() {
                let _ = std::fs::remove_file(&launch.hosts_file);
                return json!({"ok": false, "code": "winws_exited", "detail": format!("{status}")});
            }
            *winws = Some(Winws { child, hosts: launch.hosts_file });
            json!({"ok": true})
        }
        "stop" => {
            if let Some(x) = winws.take() {
                x.stop();
            }
            json!({"ok": true})
        }
        "status" => {
            let running = winws.as_mut().is_some_and(|x| matches!(x.child.try_wait(), Ok(None)));
            json!({"ok": true, "running": running})
        }
        "version" => json!({"ok": true, "version": env!("CARGO_PKG_VERSION")}),
        _ => json!({"ok": false, "code": "bad_request"}),
    }
}

// ---------- app side ----------

pub struct Client {
    io: tokio::sync::Mutex<(tokio::io::Lines<BufReader<ReadHalf<NamedPipeClient>>>, WriteHalf<NamedPipeClient>)>,
}

impl Client {
    pub async fn connect() -> Result<Self, String> {
        const ERROR_PIPE_BUSY: i32 = 231;
        for _ in 0..10 {
            match ClientOptions::new().open(PIPE) {
                Ok(pipe) => {
                    let (r, w) = tokio::io::split(pipe);
                    return Ok(Self { io: tokio::sync::Mutex::new((BufReader::new(r).lines(), w)) });
                }
                Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) => tokio::time::sleep(Duration::from_millis(200)).await,
                Err(e) => return Err(e.to_string()),
            }
        }
        Err("pipe busy".into())
    }

    async fn request(&self, req: Value) -> Result<Value, String> {
        let mut io = self.io.lock().await;
        io.1.write_all(format!("{req}\n").as_bytes()).await.map_err(|e| e.to_string())?;
        match tokio::time::timeout(Duration::from_secs(15), io.0.next_line()).await {
            Ok(Ok(Some(line))) => serde_json::from_str(&line).map_err(|e| e.to_string()),
            Ok(Ok(None)) => Err("service closed the connection".into()),
            Ok(Err(e)) => Err(e.to_string()),
            Err(_) => Err("service did not answer".into()),
        }
    }

    pub async fn start(&self, strategy: &str) -> Result<(), (String, String)> {
        let reply = self.request(json!({"cmd": "start", "strategy": strategy})).await.map_err(|e| ("service_failed".to_string(), e))?;
        if reply["ok"].as_bool() == Some(true) {
            Ok(())
        } else {
            Err((reply["code"].as_str().unwrap_or("service_failed").to_string(), reply["detail"].as_str().unwrap_or_default().to_string()))
        }
    }

    pub async fn stop(&self) {
        let _ = self.request(json!({"cmd": "stop"})).await;
    }
}
