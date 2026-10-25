//! Locates the bundled third-party programs and keeps yt-dlp up to date.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use tokio::process::Command;

pub const EXE: &str = if cfg!(windows) { ".exe" } else { "" };

#[derive(Clone, Debug)]
pub struct Tools {
    /// Writable copy, so it can update itself without admin rights.
    pub ytdlp: PathBuf,
    pub ffmpeg_dir: PathBuf,
    pub deno: PathBuf,
    pub zapret_dir: PathBuf,
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolsStatus {
    pub ytdlp_version: Option<String>,
    pub updating: bool,
    pub ffmpeg_ok: bool,
    pub deno_ok: bool,
    pub message: Option<String>,
}

impl Tools {
    pub fn locate(resource_dir: &Path, local_data: &Path) -> anyhow::Result<Self> {
        let bundled = resource_dir.join("tools");
        let ytdlp_src = bundled.join(format!("yt-dlp{EXE}"));
        let tools_dir = local_data.join("tools");
        std::fs::create_dir_all(&tools_dir)?;
        let ytdlp = tools_dir.join(format!("yt-dlp{EXE}"));
        if !ytdlp.exists() {
            anyhow::ensure!(ytdlp_src.exists(), "yt-dlp не найден в {}", ytdlp_src.display());
            std::fs::copy(&ytdlp_src, &ytdlp)?;
        }
        Ok(Self {
            ytdlp,
            ffmpeg_dir: bundled.join("ffmpeg"),
            deno: bundled.join(format!("deno{EXE}")),
            zapret_dir: bundled.join("zapret"),
        })
    }

    /// Arguments every yt-dlp call gets: our ffmpeg and Deno, no user config files,
    /// UTF-8 output, optional proxy.
    pub fn base_args(&self, proxy: &str) -> Vec<String> {
        let mut args = vec![
            "--no-config".into(),
            "--encoding".into(),
            "utf-8".into(),
            "--ffmpeg-location".into(),
            self.ffmpeg_dir.to_string_lossy().into_owned(),
            "--js-runtimes".into(),
            format!("deno:{}", self.deno.to_string_lossy()),
        ];
        if !proxy.is_empty() {
            args.push("--proxy".into());
            args.push(proxy.into());
        }
        args
    }

    pub fn status_basics(&self) -> ToolsStatus {
        ToolsStatus {
            ffmpeg_ok: self.ffmpeg_dir.join(format!("ffmpeg{EXE}")).exists(),
            deno_ok: self.deno.exists(),
            ..Default::default()
        }
    }

    pub async fn ytdlp_version(&self) -> Option<String> {
        let out = command(&self.ytdlp).arg("--version").output().await.ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    /// Runs yt-dlp's own updater, which checks the release SHA-256 sums.
    pub async fn update_ytdlp(&self, proxy: &str) -> Result<String, String> {
        let mut cmd = command(&self.ytdlp);
        cmd.args(["--no-config", "--update-to", "stable"]);
        if !proxy.is_empty() {
            cmd.args(["--proxy", proxy]);
        }
        let out = tokio::time::timeout(Duration::from_secs(120), cmd.output())
            .await
            .map_err(|_| "Обновление yt-dlp не ответило за 2 минуты".to_string())?
            .map_err(|e| e.to_string())?;
        let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        if out.status.success() {
            Ok(text.lines().last().unwrap_or_default().trim().to_string())
        } else {
            Err(text.lines().rfind(|l| l.contains("ERROR")).unwrap_or("Не удалось обновить yt-dlp").trim().to_string())
        }
    }
}

/// A command that never flashes a console window on Windows.
pub fn command(program: &Path) -> Command {
    let mut cmd = Command::new(program);
    cmd.stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.kill_on_drop(true);
    cmd
}
