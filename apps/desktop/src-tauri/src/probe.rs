//! Turns a user-supplied link into `MediaInfo` via `yt-dlp -J`.

use std::time::Duration;

use serde_json::Value;

use crate::model::{Format, FormatKind, JobError, MediaInfo, MediaKind, PlaylistEntry, SubtitleTrack};
use crate::tools::{command, Tools};

const YOUTUBE_HOSTS: &[&str] = &["youtube.com", "youtu.be", "youtube-nocookie.com"];

/// Accepts YouTube links (any subdomain) or a bare 11-character video id.
/// Returns a normalized https URL.
pub fn normalize_url(input: &str) -> Result<String, String> {
    let s = input.trim();
    if s.len() == 11 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Ok(format!("https://www.youtube.com/watch?v={s}"));
    }
    let with_scheme = if s.starts_with("http://") || s.starts_with("https://") { s.to_string() } else { format!("https://{s}") };
    let url = url::Url::parse(&with_scheme).map_err(|_| "Это не похоже на ссылку".to_string())?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let ok = YOUTUBE_HOSTS.iter().any(|h| host == *h || host.ends_with(&format!(".{h}")));
    if !ok {
        return Err("Поддерживаются только ссылки на YouTube".into());
    }
    let mut url = url;
    let _ = url.set_scheme("https");
    Ok(url.to_string())
}

/// A link that points at one video, even if it also carries `&list=`.
pub fn is_single_video(url: &str) -> bool {
    let Ok(u) = url::Url::parse(url) else { return true };
    let host = u.host_str().unwrap_or_default();
    host.ends_with("youtu.be")
        || u.path().starts_with("/shorts/")
        || u.path().starts_with("/live/")
        || u.path().starts_with("/embed/")
        || u.query_pairs().any(|(k, _)| k == "v")
}

pub async fn probe(tools: &Tools, proxy: &str, url: &str) -> Result<MediaInfo, JobError> {
    let mut cmd = command(&tools.ytdlp);
    cmd.args(tools.base_args(proxy));
    cmd.args(["-J", "--flat-playlist", "--no-warnings"]);
    if is_single_video(url) {
        cmd.arg("--no-playlist");
    }
    cmd.arg("--").arg(url);
    let out = tokio::time::timeout(Duration::from_secs(90), cmd.output())
        .await
        .map_err(|_| JobError { code: "timeout".into(), detail: "yt-dlp не ответил за 90 секунд".into() })?
        .map_err(|e| JobError { code: "tool_missing".into(), detail: e.to_string() })?;
    if !out.status.success() {
        return Err(classify_error(&String::from_utf8_lossy(&out.stderr)));
    }
    let json: Value = serde_json::from_slice(&out.stdout)
        .map_err(|e| JobError { code: "unknown".into(), detail: format!("Не удалось разобрать ответ yt-dlp: {e}") })?;
    Ok(parse_media(&json, url))
}

fn s(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_string).filter(|x| !x.is_empty() && x != "none")
}
fn f(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(Value::as_f64)
}
fn u(v: &Value, key: &str) -> Option<u64> {
    v.get(key).and_then(Value::as_u64)
}

pub fn parse_media(j: &Value, url: &str) -> MediaInfo {
    let is_playlist = j.get("_type").and_then(Value::as_str) == Some("playlist");
    let entries = if is_playlist {
        j.get("entries")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|e| {
                        let id = s(e, "id")?;
                        Some(PlaylistEntry {
                            title: s(e, "title").unwrap_or_else(|| id.clone()),
                            duration: f(e, "duration"),
                            url: s(e, "url").unwrap_or_else(|| format!("https://www.youtube.com/watch?v={id}")),
                            id,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let formats = j
        .get("formats")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(parse_format).collect())
        .unwrap_or_default();

    let mut subtitles = Vec::new();
    for (key, auto) in [("subtitles", false), ("automatic_captions", true)] {
        if let Some(map) = j.get(key).and_then(Value::as_object) {
            for (code, tracks) in map {
                if code == "live_chat" {
                    continue;
                }
                // Auto captions list every translation target; keep originals ("-orig") and a few common languages.
                if auto && !(code.ends_with("-orig") || ["ru", "en", "uk", "de", "fr", "es"].contains(&code.as_str())) {
                    continue;
                }
                let name = tracks
                    .as_array()
                    .and_then(|t| t.first())
                    .and_then(|t| s(t, "name"))
                    .unwrap_or_else(|| code.clone());
                subtitles.push(SubtitleTrack { code: code.clone(), name, auto });
            }
        }
    }

    let thumbnail = s(j, "thumbnail").or_else(|| {
        j.get("thumbnails")
            .and_then(Value::as_array)
            .and_then(|t| t.iter().rev().find_map(|x| s(x, "url")))
    });

    MediaInfo {
        kind: if is_playlist { MediaKind::Playlist } else { MediaKind::Video },
        id: s(j, "id").unwrap_or_default(),
        url: s(j, "webpage_url").unwrap_or_else(|| url.to_string()),
        title: s(j, "title").unwrap_or_else(|| "Без названия".into()),
        channel: s(j, "channel").or_else(|| s(j, "uploader")),
        duration: f(j, "duration"),
        thumbnail,
        view_count: u(j, "view_count"),
        is_live: j.get("is_live").and_then(Value::as_bool).unwrap_or(false),
        formats,
        subtitles,
        chapters: j.get("chapters").and_then(Value::as_array).map(|c| c.len() as u32).unwrap_or(0),
        entries,
    }
}

fn parse_format(v: &Value) -> Option<Format> {
    let protocol = s(v, "protocol").unwrap_or_default();
    // HLS/DASH manifests duplicate the plain https streams and storyboards are images.
    if protocol.contains("m3u8") || protocol == "mhtml" || protocol.contains("dash") {
        return None;
    }
    let vcodec = s(v, "vcodec");
    let acodec = s(v, "acodec");
    let kind = match (&vcodec, &acodec) {
        (Some(_), Some(_)) => FormatKind::Muxed,
        (Some(_), None) => FormatKind::Video,
        (None, Some(_)) => FormatKind::Audio,
        (None, None) => return None,
    };
    let id = s(v, "format_id")?;
    let note = s(v, "format_note");
    let (size, size_approx) = match (u(v, "filesize"), u(v, "filesize_approx")) {
        (Some(x), _) => (Some(x), false),
        (None, Some(x)) => (Some(x), true),
        _ => (None, false),
    };
    Some(Format {
        drc: id.ends_with("-drc") || note.as_deref().is_some_and(|n| n.contains("DRC")),
        id,
        ext: s(v, "ext").unwrap_or_default(),
        kind,
        width: u(v, "width").map(|x| x as u32),
        height: u(v, "height").map(|x| x as u32),
        fps: f(v, "fps"),
        hdr: s(v, "dynamic_range").is_some_and(|d| d != "SDR"),
        vcodec,
        acodec,
        tbr: f(v, "tbr"),
        abr: f(v, "abr"),
        size,
        size_approx,
        language: s(v, "language"),
        language_preference: v.get("language_preference").and_then(Value::as_i64),
        note,
    })
}

/// Maps yt-dlp's stderr to a stable error code the UI can explain.
pub fn classify_error(stderr: &str) -> JobError {
    let detail = stderr
        .lines()
        .rev()
        .find(|l| l.starts_with("ERROR:"))
        .or_else(|| stderr.lines().rev().find(|l| !l.trim().is_empty()))
        .unwrap_or("yt-dlp завершился с ошибкой")
        .trim_start_matches("ERROR:")
        .trim()
        .to_string();
    let l = detail.to_lowercase();
    let code = if l.contains("confirm you’re not a bot") || l.contains("confirm you're not a bot") || l.contains("sign in to confirm") {
        "bot_check"
    } else if l.contains("age") && (l.contains("restrict") || l.contains("inappropriate") || l.contains("confirm your age")) {
        "age_restricted"
    } else if l.contains("members-only") || l.contains("join this channel") {
        "members_only"
    } else if l.contains("private video") {
        "private"
    } else if l.contains("not available in your country") || l.contains("geo") {
        "geo_blocked"
    } else if l.contains("video unavailable") || l.contains("has been removed") || l.contains("does not exist") {
        "unavailable"
    } else if l.contains("requested format is not available") {
        "no_format"
    } else if l.contains("http error 403") {
        "forbidden"
    } else if l.contains("timed out") || l.contains("unable to download") || l.contains("connection") || l.contains("getaddrinfo") || l.contains("ssl") {
        "network"
    } else if l.contains("ffmpeg") || l.contains("postprocessing") {
        "ffmpeg"
    } else if l.contains("no space left") {
        "disk_full"
    } else {
        "unknown"
    };
    JobError { code: code.into(), detail }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_links() {
        assert_eq!(normalize_url("jNQXAC9IVRw").unwrap(), "https://www.youtube.com/watch?v=jNQXAC9IVRw");
        assert!(normalize_url("youtu.be/jNQXAC9IVRw").unwrap().starts_with("https://youtu.be/"));
        assert!(normalize_url("https://music.youtube.com/watch?v=abc").is_ok());
        assert!(normalize_url("https://evil-youtube.com/watch?v=abc").is_err());
        assert!(normalize_url("https://example.com/youtube.com").is_err());
    }

    #[test]
    fn detects_single_videos() {
        assert!(is_single_video("https://www.youtube.com/watch?v=x&list=PL1"));
        assert!(is_single_video("https://youtu.be/x"));
        assert!(is_single_video("https://www.youtube.com/shorts/x"));
        assert!(!is_single_video("https://www.youtube.com/playlist?list=PL1"));
        assert!(!is_single_video("https://www.youtube.com/@channel/videos"));
    }

    #[test]
    fn classifies_errors() {
        assert_eq!(classify_error("ERROR: [youtube] x: Private video. Sign in").code, "private");
        assert_eq!(classify_error("ERROR: [youtube] x: Sign in to confirm you're not a bot").code, "bot_check");
        assert_eq!(classify_error("ERROR: unable to download video data: HTTP Error 403: Forbidden").code, "forbidden");
    }
}
