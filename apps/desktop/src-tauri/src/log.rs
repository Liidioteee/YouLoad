//! In-memory journal (last 2000 lines) mirrored to `youload.log`, shown in Settings
//! and copied into bug reports.

use std::collections::VecDeque;
use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::model::LogLine;

const CAPACITY: usize = 2000;

static LINES: LazyLock<Mutex<VecDeque<LogLine>>> = LazyLock::new(|| Mutex::new(VecDeque::with_capacity(CAPACITY)));
static FILE: LazyLock<Mutex<Option<File>>> = LazyLock::new(|| Mutex::new(None));

pub fn init(dir: &Path) {
    let _ = std::fs::create_dir_all(dir);
    if let Ok(f) = File::create(dir.join("youload.log")) {
        *FILE.lock().unwrap() = Some(f);
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn push(level: &'static str, source: &str, text: &str) {
    let line = LogLine { ts: now_ms(), level, source: source.to_string(), text: text.trim_end().to_string() };
    if let Some(f) = FILE.lock().unwrap().as_mut() {
        let _ = writeln!(f, "{} {:5} [{}] {}", line.ts, level, source, line.text);
    }
    let mut lines = LINES.lock().unwrap();
    if lines.len() >= CAPACITY {
        lines.pop_front();
    }
    lines.push_back(line);
}

pub fn info(source: &str, text: impl AsRef<str>) {
    push("info", source, text.as_ref());
}
pub fn warn(source: &str, text: impl AsRef<str>) {
    push("warn", source, text.as_ref());
}
pub fn error(source: &str, text: impl AsRef<str>) {
    push("error", source, text.as_ref());
}

pub fn snapshot() -> Vec<LogLine> {
    LINES.lock().unwrap().iter().cloned().collect()
}
