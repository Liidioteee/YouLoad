//! macOS/Linux bypass: zapret's tpws as a local SOCKS5 proxy on 127.0.0.1.
//! Only YouLoad's own traffic goes through it, so no root rights are needed.
//! Experimental: tpws has no packet-level "fake" tricks, only splitting and reordering.

use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::process::Child;

use super::Strategy;

const YOUTUBE_HOSTS: &str = include_str!("../../resources/app/youtube-hosts.txt");

pub fn strategies() -> Vec<Strategy> {
    let s = |id: &str, name: &str, args: &[&str]| Strategy { id: id.into(), name: name.into(), args: args.iter().map(|a| a.to_string()).collect() };
    vec![
        s("tpws-disorder", "Disorder", &["--split-pos=1,midsld", "--disorder"]),
        s("tpws-tlsrec", "TLS record", &["--tlsrec=sniext", "--split-pos=1"]),
        s("tpws-oob", "OOB", &["--split-pos=2", "--oob"]),
        s("tpws-combo", "Combo", &["--tlsrec=sni", "--split-pos=1,midsld", "--disorder", "--hostcase"]),
    ]
}

pub struct Running {
    child: Child,
    port: u16,
    hosts: PathBuf,
}

impl Running {
    pub async fn start(zapret_dir: &Path, strategy: &str) -> Result<Self, (String, String)> {
        let s = strategies().into_iter().find(|s| s.id == strategy).ok_or_else(|| ("unknown_strategy".to_string(), strategy.to_string()))?;
        let bin = zapret_dir.join("tpws");
        if !bin.is_file() {
            return Err(("tool_missing".into(), bin.display().to_string()));
        }
        let port = std::net::TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map(|a| a.port()).map_err(|e| ("launch_failed".to_string(), e.to_string()))?;
        let hosts = std::env::temp_dir().join(format!("youload-hosts-{}.txt", std::process::id()));
        std::fs::write(&hosts, YOUTUBE_HOSTS).map_err(|e| ("launch_failed".to_string(), e.to_string()))?;

        let mut cmd = crate::tools::command(&bin);
        cmd.args(["--socks", "--bind-addr=127.0.0.1", &format!("--port={port}"), &format!("--hostlist={}", hosts.display())]);
        cmd.args(&s.args);
        let mut child = cmd.spawn().map_err(|e| ("winws_spawn_failed".to_string(), e.to_string()))?;
        tokio::time::sleep(Duration::from_millis(600)).await;
        if let Ok(Some(status)) = child.try_wait() {
            let _ = std::fs::remove_file(&hosts);
            return Err(("winws_exited".into(), status.to_string()));
        }
        Ok(Self { child, port, hosts })
    }

    pub fn proxy_url(&self) -> String {
        format!("socks5://127.0.0.1:{}", self.port)
    }

    pub async fn stop(&mut self) {
        let _ = self.child.kill().await;
        let _ = std::fs::remove_file(&self.hosts);
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
        let _ = std::fs::remove_file(&self.hosts);
    }
}
