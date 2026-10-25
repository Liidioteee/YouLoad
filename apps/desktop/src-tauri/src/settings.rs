use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BypassSettings {
    /// Start zapret together with the app.
    pub enabled: bool,
    /// Strategy id (winws on Windows, tpws elsewhere).
    pub strategy: String,
}

impl Default for BypassSettings {
    fn default() -> Self {
        Self { enabled: true, strategy: default_strategy().into() }
    }
}

pub fn default_strategy() -> &'static str {
    if cfg!(windows) { "alt" } else { "tpws-disorder" }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub download_dir: PathBuf,
    pub max_parallel: u32,
    /// yt-dlp output template for single videos.
    pub filename_template: String,
    /// http://, https:// or socks5:// proxy for yt-dlp; empty = none.
    pub proxy: String,
    /// Total download speed limit, KB/s; 0 = none.
    pub speed_limit_kbps: u32,
    /// Netscape cookies.txt for age-restricted and members-only videos.
    pub cookies_file: String,
    pub bypass: BypassSettings,
    /// "system" | "dark" | "light"
    pub theme: String,
    /// "system" | "ru" | "en"
    pub language: String,
    pub close_to_tray: bool,
    pub notifications: bool,
    pub clipboard_watch: bool,
    pub auto_update: bool,
    /// User presets, stored as the UI defines them.
    pub presets: Vec<serde_json::Value>,
    pub default_preset: String,
    /// First-run wizard finished.
    pub onboarded: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            download_dir: PathBuf::new(),
            max_parallel: 2,
            filename_template: "%(title)s.%(ext)s".into(),
            proxy: String::new(),
            speed_limit_kbps: 0,
            cookies_file: String::new(),
            bypass: BypassSettings::default(),
            theme: "system".into(),
            language: "system".into(),
            close_to_tray: false,
            notifications: true,
            clipboard_watch: false,
            auto_update: true,
            presets: Vec::new(),
            default_preset: "standard".into(),
            onboarded: false,
        }
    }
}

impl Settings {
    pub fn load(path: &Path, default_download_dir: PathBuf) -> Self {
        let mut s: Settings = std::fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        if s.download_dir.as_os_str().is_empty() {
            s.download_dir = default_download_dir;
        }
        s.normalize();
        s
    }

    pub fn save(&self, path: &Path) -> anyhow::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(tmp, path)?;
        Ok(())
    }

    pub fn normalize(&mut self) {
        self.max_parallel = self.max_parallel.clamp(1, 5);
        self.proxy = self.proxy.trim().to_string();
        self.cookies_file = self.cookies_file.trim().to_string();
        if self.filename_template.trim().is_empty() {
            self.filename_template = Settings::default().filename_template;
        }
        let s = &self.bypass.strategy;
        if s.is_empty() || !s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            self.bypass.strategy = default_strategy().into();
        }
        if !["system", "dark", "light"].contains(&self.theme.as_str()) {
            self.theme = "system".into();
        }
        if !["system", "ru", "en"].contains(&self.language.as_str()) {
            self.language = "system".into();
        }
    }

    /// Returns an error code the UI translates.
    pub fn validate(&self) -> Result<(), String> {
        if !self.proxy.is_empty() {
            let ok = ["http://", "https://", "socks5://", "socks5h://", "socks4://"].iter().any(|p| self.proxy.starts_with(p));
            if !ok {
                return Err("proxy_invalid".into());
            }
        }
        if self.filename_template.contains("..") {
            return Err("template_invalid".into());
        }
        if !self.cookies_file.is_empty() && !Path::new(&self.cookies_file).is_file() {
            return Err("cookies_missing".into());
        }
        Ok(())
    }

    /// Per-process yt-dlp limit: the total is shared by the parallel downloads.
    pub fn per_download_limit_kbps(&self) -> Option<u32> {
        (self.speed_limit_kbps > 0).then(|| (self.speed_limit_kbps / self.max_parallel.max(1)).max(16))
    }
}
