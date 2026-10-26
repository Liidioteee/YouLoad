//! Playlist size estimate on the Rust side, for the browser extension (whose messages are
//! limited to 1 MB, too small to ship every video's formats). Mirrors
//! `playlistEntryBytes` in packages/shared/src/formats.ts — keep the two in step.

use std::collections::HashSet;

use crate::model::{DownloadOptions, Format, FormatKind, MediaInfo, Mode};

fn codec_of(f: &Format) -> Option<&'static str> {
    let v = f.vcodec.as_deref().unwrap_or_default();
    if v.starts_with("av01") {
        Some("av1")
    } else if v.starts_with("vp09") || v.starts_with("vp9") {
        Some("vp9")
    } else if v.starts_with("avc1") || v.starts_with("h264") {
        Some("h264")
    } else {
        None
    }
}

fn is_video(f: &Format) -> bool {
    matches!(f.kind, FormatKind::Video | FormatKind::Muxed) && f.height.is_some() && codec_of(f).is_some()
}

fn is_audio(f: &Format) -> bool {
    f.kind == FormatKind::Audio && !f.drc
}

/// Size of a format, or a bitrate-based guess when YouTube gives none.
fn bytes_of(f: Option<&Format>, duration: Option<f64>) -> f64 {
    let Some(f) = f else { return 0.0 };
    if let Some(s) = f.size {
        return s as f64;
    }
    match (f.tbr.or(f.abr), duration) {
        (Some(kbps), Some(d)) => kbps * 1000.0 * d / 8.0,
        _ => 0.0,
    }
}

fn pick_audio<'a>(formats: &'a [Format], lang: Option<&str>, prefer: Option<&str>) -> Option<&'a Format> {
    let audio: Vec<&Format> = formats.iter().filter(|f| is_audio(f)).collect();
    let same_lang: Vec<&Format> = match lang {
        Some(l) => audio.iter().copied().filter(|f| f.language.as_deref().is_some_and(|x| x.starts_with(l))).collect(),
        None => Vec::new(),
    };
    let original = audio.iter().max_by_key(|f| f.language_preference.unwrap_or(-100)).and_then(|f| f.language.clone());
    let by_original: Vec<&Format> = audio.iter().copied().filter(|f| f.language == original).collect();
    let pool = if !same_lang.is_empty() { same_lang } else if !by_original.is_empty() { by_original } else { audio };
    let preferred: Vec<&Format> = match prefer {
        Some("m4a") => pool.iter().copied().filter(|f| f.ext == "m4a").collect(),
        Some("opus") => pool.iter().copied().filter(|f| f.acodec.as_deref() == Some("opus")).collect(),
        _ => Vec::new(),
    };
    let finals = if preferred.is_empty() { pool } else { preferred };
    finals.into_iter().max_by(|a, b| a.abr.or(a.tbr).unwrap_or(0.0).total_cmp(&b.abr.or(b.tbr).unwrap_or(0.0)))
}

fn entry_bytes(formats: &[Format], duration: Option<f64>, o: &DownloadOptions) -> f64 {
    let lang = o.audio_language.as_deref();
    if o.mode == Mode::Audio {
        let prefer = match o.audio_codec.as_str() {
            "m4a" => Some("m4a"),
            "opus" => Some("opus"),
            _ => None,
        };
        let src = pick_audio(formats, lang, prefer);
        let same_codec = (o.audio_codec == "m4a" && src.is_some_and(|f| f.ext == "m4a"))
            || (o.audio_codec == "opus" && src.is_some_and(|f| f.acodec.as_deref() == Some("opus")));
        if same_codec && o.audio_quality.is_none() {
            return bytes_of(src, duration);
        }
        let kbps = o.audio_quality.map(f64::from).unwrap_or(match o.audio_codec.as_str() {
            "m4a" | "opus" => 160.0,
            "flac" => 800.0,
            "wav" => 1411.0,
            _ => 245.0,
        });
        return match duration {
            Some(d) => kbps * 1000.0 * d / 8.0,
            None => bytes_of(src, duration),
        };
    }
    let fit: Vec<&Format> = formats.iter().filter(|f| is_video(f) && o.max_height.is_none_or(|m| f.height.unwrap_or(0) <= m)).collect();
    let by_codec: Vec<&Format> = match o.video_codec.as_deref() {
        Some(c) => fit.iter().copied().filter(|f| codec_of(f) == Some(c)).collect(),
        None => fit.clone(),
    };
    let mut pool = if by_codec.is_empty() { fit } else { by_codec };
    pool.sort_by(|a, b| {
        (a.kind == FormatKind::Muxed)
            .cmp(&(b.kind == FormatKind::Muxed))
            .then(b.height.cmp(&a.height))
            .then(b.fps.unwrap_or(0.0).total_cmp(&a.fps.unwrap_or(0.0)))
            .then(b.tbr.unwrap_or(0.0).total_cmp(&a.tbr.unwrap_or(0.0)))
    });
    let Some(best) = pool.first().copied() else { return 0.0 };
    if best.kind == FormatKind::Muxed {
        return bytes_of(Some(best), duration);
    }
    let prefer = (o.container == "mp4" && o.video_codec.as_deref() == Some("h264")).then_some("m4a");
    bytes_of(Some(best), duration) + bytes_of(pick_audio(formats, lang, prefer), duration)
}

/// (bytes, scanned videos, selected videos)
pub fn playlist(media: &MediaInfo, o: &DownloadOptions) -> (f64, usize, usize) {
    let chosen: Option<HashSet<u32>> = o.playlist_items.as_ref().map(|v| v.iter().copied().collect());
    let mut bytes = 0.0;
    let mut known = 0;
    let mut total = 0;
    for e in media.entries.iter().filter(|e| chosen.as_ref().is_none_or(|c| c.contains(&e.index))) {
        total += 1;
        if let Some(f) = &e.formats {
            known += 1;
            bytes += entry_bytes(f, e.duration, o);
        }
    }
    (bytes, known, total)
}
