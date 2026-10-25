use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BypassSettings {
    /// Start zapret together with the app.
    pub enabled: bool,
    /// Strategy id from tools/zapret/strategies.json.
    pub strategy: String,
}

impl Default for BypassSettings {
    fn default() -> Self {
        Self { enabled: true, strategy: "alt".into() }
    }
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
    pub bypass: BypassSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            download_dir: PathBuf::new(),
            max_parallel: 2,
            filename_template: "%(title)s.%(ext)s".into(),
            proxy: String::new(),
            bypass: BypassSettings::default(),
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
        if self.filename_template.trim().is_empty() {
            self.filename_template = Settings::default().filename_template;
        }
        if !self.bypass.strategy.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') || self.bypass.strategy.is_empty() {
            self.bypass.strategy = BypassSettings::default().strategy;
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if !self.proxy.is_empty() {
            let ok = ["http://", "https://", "socks5://", "socks5h://", "socks4://"]
                .iter()
                .any(|p| self.proxy.starts_with(p));
            if !ok {
                return Err("Адрес прокси должен начинаться с http://, https:// или socks5://".into());
            }
        }
        if self.filename_template.contains("..") {
            return Err("Шаблон имени не может содержать «..»".into());
        }
        Ok(())
    }
}
