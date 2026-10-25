//! Windows side of the bypass: elevating a helper copy of this exe, and the helper itself.

use std::os::windows::io::AsRawHandle;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE};
use windows_sys::Win32::System::Threading::{
    CreateEventW, GetExitCodeProcess, OpenEventW, OpenProcess, SetEvent, WaitForMultipleObjects, WaitForSingleObject,
};
use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

use super::{strategies, YOUTUBE_HOSTS};

include!(concat!(env!("OUT_DIR"), "/zapret_hashes.rs"));

const SYNCHRONIZE: u32 = 0x0010_0000;
const INFINITE: u32 = 0xFFFF_FFFF;
const ERROR_CANCELLED: u32 = 1223;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const EXIT_OK: i32 = 0;
const EXIT_BAD_ARGS: i32 = 2;
const EXIT_PARENT_GONE: i32 = 3;
const EXIT_WINWS_EXITED: i32 = 4;
const EXIT_SPAWN_FAILED: i32 = 5;
const EXIT_INTEGRITY: i32 = 6;

pub fn helper_exit_code_name(code: u32) -> &'static str {
    match code as i32 {
        EXIT_BAD_ARGS => "bad_strategy",
        EXIT_PARENT_GONE => "parent_gone",
        EXIT_WINWS_EXITED => "winws_exited",
        EXIT_SPAWN_FAILED => "winws_spawn_failed",
        EXIT_INTEGRITY => "integrity",
        _ => "helper_exited",
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn winws_running() -> bool {
    let mut sys = sysinfo::System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    sys.processes().values().any(|p| p.name().to_string_lossy().eq_ignore_ascii_case("winws.exe"))
}

/// The elevated helper process, seen from the app.
pub struct Helper {
    process: usize,
    stop_event: usize,
}

unsafe impl Send for Helper {}
unsafe impl Sync for Helper {}

impl Helper {
    pub fn signal_stop(&self) {
        unsafe { SetEvent(self.stop_event as HANDLE) };
    }

    pub fn wait_exit(&self) -> u32 {
        self.wait_exit_timeout(INFINITE).unwrap_or(u32::MAX)
    }

    pub fn wait_exit_timeout(&self, ms: u32) -> Option<u32> {
        unsafe {
            if WaitForSingleObject(self.process as HANDLE, ms) != 0 {
                return None;
            }
            let mut code = 0u32;
            GetExitCodeProcess(self.process as HANDLE, &mut code);
            Some(code)
        }
    }
}

impl Drop for Helper {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.process as HANDLE);
            CloseHandle(self.stop_event as HANDLE);
        }
    }
}

/// Starts `<this exe> --bypass-helper …` with a UAC prompt. Blocks while the prompt is shown.
pub fn launch_helper(strategy: &str) -> Result<Helper, (String, String)> {
    let pid = std::process::id();
    let event_name = format!("Local\\YouLoadBypassStop-{pid}-{}", uuid::Uuid::new_v4().simple());
    let stop_event = unsafe { CreateEventW(std::ptr::null(), 1, 0, wide(&event_name).as_ptr()) };
    if stop_event.is_null() {
        return Err(("launch_failed".into(), "CreateEvent".into()));
    }
    let exe = std::env::current_exe().map_err(|e| ("launch_failed".to_string(), e.to_string()))?;
    let params = format!("--bypass-helper --parent {pid} --stop-event {event_name} --strategy {strategy}");
    let verb = wide("runas");
    let file = wide(&exe.to_string_lossy());
    let params = wide(&params);
    unsafe {
        let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.lpParameters = params.as_ptr();
        info.nShow = SW_HIDE;
        if ShellExecuteExW(&mut info) == 0 || info.hProcess.is_null() {
            let err = GetLastError();
            CloseHandle(stop_event);
            return Err(if err == ERROR_CANCELLED {
                ("uac_denied".into(), "Запрос прав администратора отклонён".into())
            } else {
                ("launch_failed".into(), format!("ShellExecuteEx: {err}"))
            });
        }
        Ok(Helper { process: info.hProcess as usize, stop_event: stop_event as usize })
    }
}

fn arg_value(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn sha256_file(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    Some(Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect())
}

/// Entry point of the elevated helper. Runs winws until the app asks to stop or exits.
pub fn run_helper(args: &[String]) -> i32 {
    let (Some(parent), Some(event_name), Some(strategy_id)) =
        (arg_value(args, "--parent"), arg_value(args, "--stop-event"), arg_value(args, "--strategy"))
    else {
        return EXIT_BAD_ARGS;
    };
    let Ok(parent) = parent.parse::<u32>() else { return EXIT_BAD_ARGS };
    if !event_name.starts_with("Local\\YouLoadBypassStop-") {
        return EXIT_BAD_ARGS;
    }
    let Some(strategy) = strategies().into_iter().find(|s| s.id == strategy_id) else { return EXIT_BAD_ARGS };

    let Some(exe_dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) else {
        return EXIT_SPAWN_FAILED;
    };
    let zapret = exe_dir.join("tools").join("zapret");

    // Only run the exact zapret binaries this build was made with.
    if ZAPRET_HASHES.is_empty() {
        return EXIT_INTEGRITY;
    }
    for (name, expected) in ZAPRET_HASHES {
        if sha256_file(&zapret.join(name)).as_deref() != Some(*expected) {
            return EXIT_INTEGRITY;
        }
    }

    // The host list is compiled in; write it next to the data the helper controls.
    let hosts: PathBuf = std::env::temp_dir().join(format!("youload-hosts-{}.txt", std::process::id()));
    if std::fs::write(&hosts, YOUTUBE_HOSTS).is_err() {
        return EXIT_SPAWN_FAILED;
    }
    let fake_dir = zapret.join("fake");
    let mut winws_args = vec!["--wf-tcp=443".to_string(), "--filter-tcp=443".to_string(), format!("--hostlist={}", hosts.display())];
    winws_args.extend(strategy.args.iter().map(|a| a.replace("{fake}", &fake_dir.to_string_lossy())));

    let parent_handle = unsafe { OpenProcess(SYNCHRONIZE, 0, parent) };
    if parent_handle.is_null() {
        return EXIT_PARENT_GONE;
    }
    let stop_handle = unsafe { OpenEventW(SYNCHRONIZE, 0, wide(&event_name).as_ptr()) };
    if stop_handle.is_null() {
        unsafe { CloseHandle(parent_handle) };
        return EXIT_PARENT_GONE;
    }

    let child = std::process::Command::new(zapret.join("winws.exe"))
        .args(&winws_args)
        .current_dir(&zapret)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
    let mut child = match child {
        Ok(c) => c,
        Err(_) => {
            unsafe {
                CloseHandle(parent_handle);
                CloseHandle(stop_handle);
            }
            let _ = std::fs::remove_file(&hosts);
            return EXIT_SPAWN_FAILED;
        }
    };

    let handles: [HANDLE; 3] = [parent_handle, stop_handle, child.as_raw_handle() as HANDLE];
    let which = unsafe { WaitForMultipleObjects(3, handles.as_ptr(), 0, INFINITE) };
    let _ = child.kill();
    let _ = child.wait();
    unsafe {
        CloseHandle(parent_handle);
        CloseHandle(stop_handle);
    }
    let _ = std::fs::remove_file(&hosts);
    if which == 2 { EXIT_WINWS_EXITED } else { EXIT_OK }
}
