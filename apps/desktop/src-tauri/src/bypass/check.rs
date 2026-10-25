//! "Проверить YouTube": reachability of the main hosts plus a real download speed sample.
//! DPI throttling lets the TLS handshake through and slows the video stream, so the
//! speed sample from googlevideo.com is what tells "works" from "throttled".

use std::time::{Duration, Instant};

use serde::Serialize;

use crate::tools::{command, Tools};

/// Big Buck Bunny on the Blender Foundation channel: long-lived and public.
const SAMPLE_VIDEO: &str = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";
const SAMPLE_BYTES: u64 = 6 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckItem {
    pub id: String,
    pub label: String,
    pub ok: bool,
    pub ms: Option<u64>,
    /// bytes per second, for the speed sample
    pub speed: Option<f64>,
    pub detail: Option<String>,
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

async fn reach(c: &reqwest::Client, id: &str, label: &str, url: &str) -> CheckItem {
    let start = Instant::now();
    match c.get(url).send().await {
        Ok(r) => CheckItem {
            id: id.into(),
            label: label.into(),
            ok: r.status().as_u16() < 500,
            ms: Some(start.elapsed().as_millis() as u64),
            speed: None,
            detail: Some(format!("HTTP {}", r.status().as_u16())),
        },
        Err(e) => CheckItem {
            id: id.into(),
            label: label.into(),
            ok: false,
            ms: None,
            speed: None,
            detail: Some(if e.is_timeout() { "нет ответа за 10 секунд".into() } else { e.to_string() }),
        },
    }
}

async fn speed_sample(tools: &Tools, proxy: &str, c: &reqwest::Client) -> CheckItem {
    let fail = |detail: String| CheckItem {
        id: "speed".into(),
        label: "Скорость видео".into(),
        ok: false,
        ms: None,
        speed: None,
        detail: Some(detail),
    };
    let mut cmd = command(&tools.ytdlp);
    cmd.args(tools.base_args(proxy)).args(["-g", "-f", "18/b", "--no-playlist", "--no-warnings", "--", SAMPLE_VIDEO]);
    let out = match tokio::time::timeout(Duration::from_secs(45), cmd.output()).await {
        Ok(Ok(o)) if o.status.success() => o,
        Ok(Ok(o)) => return fail(crate::probe::classify_error(&String::from_utf8_lossy(&o.stderr)).detail),
        _ => return fail("yt-dlp не получил ссылку на видео".into()),
    };
    let url = String::from_utf8_lossy(&out.stdout).lines().next().unwrap_or_default().trim().to_string();
    if url.is_empty() {
        return fail("yt-dlp не вернул ссылку на видео".into());
    }
    let start = Instant::now();
    let resp = match c.get(&url).header("Range", format!("bytes=0-{}", SAMPLE_BYTES - 1)).timeout(Duration::from_secs(20)).send().await {
        Ok(r) => r,
        Err(e) => return fail(e.to_string()),
    };
    let mut resp = resp;
    let mut got: u64 = 0;
    loop {
        match tokio::time::timeout(Duration::from_secs(20), resp.chunk()).await {
            Ok(Ok(Some(chunk))) => {
                got += chunk.len() as u64;
                if got >= SAMPLE_BYTES {
                    break;
                }
            }
            Ok(Ok(None)) => break,
            _ => break,
        }
        if start.elapsed() > Duration::from_secs(20) {
            break;
        }
    }
    let secs = start.elapsed().as_secs_f64().max(0.001);
    let speed = got as f64 / secs;
    CheckItem {
        id: "speed".into(),
        label: "Скорость видео".into(),
        // Throttled YouTube in Russia crawls at tens of KB/s; 500 KB/s is enough for 1080p.
        ok: speed >= 500.0 * 1024.0,
        ms: Some(start.elapsed().as_millis() as u64),
        speed: Some(speed),
        detail: Some(format!("{:.1} МБ за {:.1} с", got as f64 / 1_048_576.0, secs)),
    }
}

pub async fn run(tools: &Tools, proxy: &str) -> Vec<CheckItem> {
    let c = client(proxy);
    let (a, b, d) = tokio::join!(
        reach(&c, "youtube", "youtube.com", "https://www.youtube.com/generate_204"),
        reach(&c, "ytimg", "i.ytimg.com", "https://i.ytimg.com/vi/aqz-KE-bpKQ/default.jpg"),
        reach(&c, "googlevideo", "googlevideo.com", "https://redirector.googlevideo.com/report_mapping?di=no"),
    );
    let speed = speed_sample(tools, proxy, &c).await;
    vec![a, b, d, speed]
}
