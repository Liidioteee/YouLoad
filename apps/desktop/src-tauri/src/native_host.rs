//! Native messaging host for the YouLoad browser extension.
//!
//! The browser starts this exe with the extension's origin as an argument and talks to it
//! over stdin/stdout (4-byte little-endian length + JSON). We relay every message to the
//! running app over the bridge channel (bridge.rs), starting the app if needed.
//! The app registers this host with the installed browsers on every launch.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

pub const HOST_NAME: &str = "app.youload.host";
pub const CHROME_EXTENSION_ID: &str = "gjgjkhcdjdnnhhmggkmfpcklnenencke";
pub const FIREFOX_EXTENSION_ID: &str = "youload@liidioteee";
/// Browsers send at most 1 MB to the extension per message.
const MAX_MESSAGE: usize = 1024 * 1024;

/// Chrome passes `chrome-extension://<id>/`, Firefox passes the manifest path and the add-on id.
pub fn is_host_invocation(args: &[String]) -> bool {
    args.iter().any(|a| a.starts_with("chrome-extension://") || a == FIREFOX_EXTENSION_ID)
}

fn read_message(input: &mut impl Read) -> Option<Vec<u8>> {
    let mut len = [0u8; 4];
    input.read_exact(&mut len).ok()?;
    let len = u32::from_le_bytes(len) as usize;
    if len == 0 || len > 64 * 1024 * 1024 {
        return None;
    }
    let mut buf = vec![0u8; len];
    input.read_exact(&mut buf).ok()?;
    Some(buf)
}

fn write_message(out: &mut impl Write, bytes: &[u8]) -> std::io::Result<()> {
    out.write_all(&(bytes.len() as u32).to_le_bytes())?;
    out.write_all(bytes)?;
    out.flush()
}

#[cfg(windows)]
async fn connect() -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeClient> {
    tokio::net::windows::named_pipe::ClientOptions::new().open(crate::bridge::endpoint())
}

#[cfg(unix)]
async fn connect() -> std::io::Result<tokio::net::UnixStream> {
    tokio::net::UnixStream::connect(crate::bridge::endpoint()).await
}

/// The app path to start when it is not running (inside an AppImage, the image itself).
fn app_path() -> Option<PathBuf> {
    std::env::var_os("APPIMAGE").map(PathBuf::from).or_else(|| std::env::current_exe().ok())
}

fn launch_app() {
    if let Some(exe) = app_path() {
        let mut cmd = std::process::Command::new(exe);
        cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const DETACHED_PROCESS: u32 = 0x0000_0008;
            cmd.creation_flags(DETACHED_PROCESS);
        }
        let _ = cmd.spawn();
    }
}

/// One line per host start in %TEMP%/youload-native-host.log, for "the extension cannot
/// reach YouLoad" support cases. Only the browser's arguments and the connection result.
fn trace(text: &str) {
    let path = std::env::temp_dir().join("youload-native-host.log");
    // Start over once it passes 256 KB, so the file never grows without bound.
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > 256 * 1024) {
        let _ = std::fs::remove_file(&path);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{} {text}", crate::log::now_ms());
    }
}

/// Entry point when started by the browser. Returns the exit code.
pub fn run_relay() -> i32 {
    trace(&format!("start args={:?}", std::env::args().skip(1).collect::<Vec<_>>()));
    let code = relay();
    trace(&format!("exit {code}"));
    code
}

fn relay() -> i32 {
    let Ok(rt) = tokio::runtime::Builder::new_current_thread().enable_all().build() else { return 1 };
    rt.block_on(async {
        let mut conn = connect().await;
        if conn.is_err() {
            launch_app();
            for _ in 0..40 {
                tokio::time::sleep(Duration::from_millis(250)).await;
                conn = connect().await;
                if conn.is_ok() {
                    break;
                }
            }
        }
        trace(&format!("connect to app: {}", if conn.is_ok() { "ok".to_string() } else { format!("{:?}", conn.as_ref().err()) }));
        let Ok(conn) = conn else {
            let mut out = std::io::stdout().lock();
            let _ = write_message(&mut out, json!({"id": null, "ok": false, "error": "app_unavailable"}).to_string().as_bytes());
            return 2;
        };
        let (r, mut w) = tokio::io::split(conn);

        // Browser → app: a blocking reader thread feeds a channel.
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        std::thread::spawn(move || {
            let mut stdin = std::io::stdin().lock();
            while let Some(msg) = read_message(&mut stdin) {
                if tx.send(msg).is_err() {
                    break;
                }
            }
        });
        let to_app = async move {
            while let Some(mut msg) = rx.recv().await {
                msg.retain(|b| *b != b'\n');
                msg.push(b'\n');
                if w.write_all(&msg).await.is_err() {
                    break;
                }
            }
        };
        // App → browser.
        let to_browser = async move {
            let mut lines = BufReader::new(r).lines();
            let mut out = std::io::stdout().lock();
            while let Ok(Some(line)) = lines.next_line().await {
                let bytes = if line.len() > MAX_MESSAGE {
                    let id = serde_json::from_str::<serde_json::Value>(&line).ok().and_then(|v| v.get("id").cloned());
                    json!({"id": id, "ok": false, "error": "too_large"}).to_string().into_bytes()
                } else {
                    line.into_bytes()
                };
                if let Err(e) = write_message(&mut out, &bytes) {
                    trace(&format!("write to browser failed: {e}"));
                    break;
                }
            }
        };
        // Whichever side closes first ends the relay (the browser closing stdin is normal).
        tokio::select! {
            _ = to_app => {}
            _ = to_browser => {}
        }
        0
    })
}

fn manifest(path: &Path, firefox: bool) -> serde_json::Value {
    let mut m = json!({
        "name": HOST_NAME,
        "description": "YouLoad",
        "path": path.to_string_lossy(),
        "type": "stdio",
    });
    if firefox {
        m["allowed_extensions"] = json!([FIREFOX_EXTENSION_ID]);
    } else {
        m["allowed_origins"] = json!([format!("chrome-extension://{CHROME_EXTENSION_ID}/")]);
    }
    m
}

/// Registers the host for the current user with every supported browser.
/// Runs on each app start, so the path follows updates and moves.
pub fn register(data_dir: &Path) -> std::io::Result<()> {
    let exe = app_path().ok_or_else(|| std::io::Error::other("no exe path"))?;
    let dir = data_dir.join("native-host");
    std::fs::create_dir_all(&dir)?;
    let chrome = dir.join("chrome.json");
    let firefox = dir.join("firefox.json");
    std::fs::write(&chrome, serde_json::to_vec_pretty(&manifest(&exe, false))?)?;
    std::fs::write(&firefox, serde_json::to_vec_pretty(&manifest(&exe, true))?)?;
    register_platform(&chrome, &firefox)
}

#[cfg(windows)]
fn register_platform(chrome: &Path, firefox: &Path) -> std::io::Result<()> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let chromium = [
        r"Software\Google\Chrome",
        r"Software\Chromium",
        r"Software\Microsoft\Edge",
        r"Software\Yandex\YandexBrowser",
        r"Software\BraveSoftware\Brave-Browser",
        r"Software\Vivaldi",
    ];
    for base in chromium {
        let (key, _) = hkcu.create_subkey(format!(r"{base}\NativeMessagingHosts\{HOST_NAME}"))?;
        key.set_value("", &chrome.to_string_lossy().as_ref())?;
    }
    let (key, _) = hkcu.create_subkey(format!(r"Software\Mozilla\NativeMessagingHosts\{HOST_NAME}"))?;
    key.set_value("", &firefox.to_string_lossy().as_ref())?;
    Ok(())
}

#[cfg(unix)]
fn register_platform(chrome: &Path, firefox: &Path) -> std::io::Result<()> {
    let home = PathBuf::from(std::env::var_os("HOME").ok_or_else(|| std::io::Error::other("no HOME"))?);
    #[cfg(target_os = "macos")]
    let (chromium, mozilla) = {
        let base = home.join("Library/Application Support");
        (
            ["Google/Chrome", "Chromium", "Microsoft Edge", "Yandex/YandexBrowser", "BraveSoftware/Brave-Browser", "Vivaldi"].map(|p| base.join(p)),
            base.join("Mozilla"),
        )
    };
    #[cfg(not(target_os = "macos"))]
    let (chromium, mozilla) = {
        let base = home.join(".config");
        (
            ["google-chrome", "chromium", "microsoft-edge", "yandex-browser", "BraveSoftware/Brave-Browser", "vivaldi"].map(|p| base.join(p)),
            home.join(".mozilla"),
        )
    };
    let file = format!("{HOST_NAME}.json");
    // Only browsers that are installed (their profile folder exists).
    for browser in chromium.iter().filter(|p| p.is_dir()) {
        let dir = browser.join("NativeMessagingHosts");
        std::fs::create_dir_all(&dir)?;
        std::fs::copy(chrome, dir.join(&file))?;
    }
    if mozilla.is_dir() {
        #[cfg(target_os = "macos")]
        let dir = mozilla.join("NativeMessagingHosts");
        #[cfg(not(target_os = "macos"))]
        let dir = mozilla.join("native-messaging-hosts");
        std::fs::create_dir_all(&dir)?;
        std::fs::copy(firefox, dir.join(&file))?;
    }
    Ok(())
}
