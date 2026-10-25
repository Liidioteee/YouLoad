//! "Check YouTube": reachability of the main hosts plus a real download speed sample.
//! DPI throttling lets the TLS handshake through and slows the video stream, so the
//! speed sample from googlevideo.com is what tells "works" from "throttled".

use std::time::{Duration, Instant};

use serde::Serialize;

use crate::tools::{command, Tools};

/// Big Buck Bunny on the Blender Foundation channel: long-lived and public.
const SAMPLE_VIDEO: &str = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";
const SAMPLE_BYTES: u64 = 6 * 1024 * 1024;
/// Throttled YouTube in Russia crawls at tens of KB/s; 500 KB/s is enough for 1080p.
pub const GOOD_SPEED: f64 = 500.0 * 1024.0;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckItem {
    /// "youtube" | "ytimg" | "googlevideo" | "speed"
    pub id: String,
    pub ok: bool,
    pub ms: Option<u64>,
    /// bytes per second, for the speed sample
    pub speed: Option<f64>,
    pub bytes: Option<u64>,
    /// Raw error text (network library or yt-dlp), shown as a detail.
    pub error: Option<String>,
    pub timeout: bool,
}

impl CheckItem {
    fn fail(id: &str, error: String, timeout: bool) -> Self {
        Self { id: id.into(), ok: false, ms: None, speed: None, bytes: None, error: Some(error), timeout }
    }
}

fn client(proxy: &str) -> reqwest::Client {
    let mut b = reqwest::Client::builder().timeout(Duration::from_secs(10)).user_agent("Mozilla/5.0 YouLoad");
    if !proxy.is_empty() {
        if let Ok(p) = reqwest::Proxy::all(proxy) {
            b = b.proxy(p);
        }
    }
    b.build().unwrap_or_default()
}

async fn reach(c: &reqwest::Client, id: &str, url: &str) -> CheckItem {
    let start = Instant::now();
    match c.get(url).send().await {
        Ok(r) => CheckItem {
            id: id.into(),
            ok: r.status().as_u16() < 500,
            ms: Some(start.elapsed().as_millis() as u64),
            speed: None,
            bytes: None,
            error: (r.status().as_u16() >= 500).then(|| format!("HTTP {}", r.status().as_u16())),
            timeout: false,
        },
        Err(e) => CheckItem::fail(id, e.to_string(), e.is_timeout()),
    }
}

pub async fn speed_sample(tools: &Tools, base_args: &[String], proxy: &str) -> CheckItem {
    let c = client(proxy);
    let mut cmd = command(&tools.ytdlp);
    cmd.args(base_args).args(["-g", "-f", "18/b", "--no-playlist", "--no-warnings", "--", SAMPLE_VIDEO]);
    let out = match tokio::time::timeout(Duration::from_secs(45), cmd.output()).await {
        Ok(Ok(o)) if o.status.success() => o,
        Ok(Ok(o)) => return CheckItem::fail("speed", crate::probe::classify_error(&String::from_utf8_lossy(&o.stderr)).detail, false),
        Ok(Err(e)) => return CheckItem::fail("speed", e.to_string(), false),
        Err(_) => return CheckItem::fail("speed", "yt-dlp".into(), true),
    };
    let url = String::from_utf8_lossy(&out.stdout).lines().next().unwrap_or_default().trim().to_string();
    if url.is_empty() {
        return CheckItem::fail("speed", "yt-dlp: no URL".into(), false);
    }
    let start = Instant::now();
    let mut resp = match c.get(&url).header("Range", format!("bytes=0-{}", SAMPLE_BYTES - 1)).timeout(Duration::from_secs(20)).send().await {
        Ok(r) => r,
        Err(e) => return CheckItem::fail("speed", e.to_string(), e.is_timeout()),
    };
    let mut got: u64 = 0;
    loop {
        match tokio::time::timeout(Duration::from_secs(20), resp.chunk()).await {
            Ok(Ok(Some(chunk))) => {
                got += chunk.len() as u64;
                if got >= SAMPLE_BYTES {
                    break;
                }
            }
            _ => break,
        }
        if start.elapsed() > Duration::from_secs(20) {
            break;
        }
    }
    let secs = start.elapsed().as_secs_f64().max(0.001);
    let speed = got as f64 / secs;
    CheckItem { id: "speed".into(), ok: speed >= GOOD_SPEED, ms: Some(start.elapsed().as_millis() as u64), speed: Some(speed), bytes: Some(got), error: None, timeout: false }
}

pub async fn run(tools: &Tools, base_args: &[String], proxy: &str) -> Vec<CheckItem> {
    let c = client(proxy);
    let (a, b, d) = tokio::join!(
        reach(&c, "youtube", "https://www.youtube.com/generate_204"),
        reach(&c, "ytimg", "https://i.ytimg.com/vi/aqz-KE-bpKQ/default.jpg"),
        reach(&c, "googlevideo", "https://redirector.googlevideo.com/report_mapping?di=no"),
    );
    let speed = speed_sample(tools, base_args, proxy).await;
    vec![a, b, d, speed]
}
