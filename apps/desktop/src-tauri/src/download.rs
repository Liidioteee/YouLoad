//! Builds the yt-dlp command for a job and turns its output into progress updates.

use std::collections::VecDeque;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;

use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::sync::mpsc;

use crate::model::{DownloadOptions, FormatKind, JobError, MediaInfo, MediaKind, Mode, Progress};
use crate::probe::{classify_error, is_single_video};
use crate::procgroup::{isolate, ProcGroup};
use crate::settings::Settings;
use crate::tools::{command, Tools};

const DL_TEMPLATE: &str = concat!(
    r#"download:YLDL|{"status":"%(progress.status)s","d":%(progress.downloaded_bytes|0)s,"#,
    r#""t":%(progress.total_bytes|null)s,"te":%(progress.total_bytes_estimate|null)s,"#,
    r#""s":%(progress.speed|null)s,"eta":%(progress.eta|null)s,"#,
    r#""fmt":"%(info.format_id)s","vc":"%(info.vcodec)s","#,
    r#""pi":%(info.playlist_index|null)s,"pn":%(info.n_entries|null)s}"#
);
const PP_TEMPLATE: &str = r#"postprocess:YLPP|{"status":"%(progress.status)s","pp":"%(progress.postprocessor)s"}"#;

pub struct RunSpec {
    pub args: Vec<String>,
    /// Streams we expect to download, with known sizes (single video, explicit formats).
    pub expected: Vec<(String, Option<u64>)>,
    /// Video and audio are fetched separately and merged.
    pub two_streams: bool,
    pub playlist: bool,
    pub items: Option<u32>,
}

pub fn build(tools: &Tools, settings: &Settings, url: &str, media: Option<&MediaInfo>, o: &DownloadOptions) -> RunSpec {
    let playlist = media.map(|m| m.kind == MediaKind::Playlist).unwrap_or(!is_single_video(url));
    let mut a = tools.base_args(&settings.proxy);
    a.extend(
        ["--newline", "--progress", "--no-simulate", "--no-mtime", "--windows-filenames", "--progress-template", DL_TEMPLATE, "--progress-template", PP_TEMPLATE, "--print", "after_move:YLFILE|%(filepath)s"]
            .map(String::from),
    );
    a.push("-P".into());
    a.push(settings.download_dir.to_string_lossy().into_owned());
    a.push("-o".into());
    if playlist {
        a.push(format!("%(playlist_title|Плейлист)s/%(playlist_index|0)03d - {}", settings.filename_template));
        a.extend(["--yes-playlist", "--ignore-errors"].map(String::from));
    } else {
        a.push(settings.filename_template.clone());
        a.push("--no-playlist".into());
    }

    let lang = o.audio_language.as_deref().filter(|l| l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
    let lang_filter = lang.map(|l| format!("[language^={l}]")).unwrap_or_default();
    let mut expected = Vec::new();
    let mut two_streams = false;

    match o.mode {
        Mode::Video => {
            let h = o.max_height.map(|h| format!("[height<={h}]")).unwrap_or_default();
            let codec = match o.video_codec.as_deref() {
                Some("av1") => "[vcodec^=av01]",
                Some("vp9") => "[vcodec~='^vp0?9']",
                Some("h264") => "[vcodec^=avc1]",
                _ => "",
            };
            let ba = if o.container == "mp4" && o.video_codec.as_deref() == Some("h264") { "ba[ext=m4a]" } else { "ba" };
            let selector = format!("bv*{h}{codec}+{ba}{lang_filter}/bv*{h}{codec}+ba/bv*{h}+ba/b{h}/bv*+ba/b");
            let format = match (&o.video_format, &o.audio_format) {
                (Some(v), Some(au)) => {
                    expected = explicit_sizes(media, &[v, au]);
                    two_streams = true;
                    format!("{v}+{au}/{selector}")
                }
                (Some(v), None) => {
                    expected = explicit_sizes(media, &[v]);
                    two_streams = media.and_then(|m| m.formats.iter().find(|f| &f.id == v)).is_some_and(|f| f.kind == FormatKind::Video);
                    if two_streams {
                        format!("{v}+ba/{selector}")
                    } else {
                        format!("{v}/{selector}")
                    }
                }
                _ => {
                    two_streams = true;
                    selector
                }
            };
            a.extend(["-f".into(), format]);
            let merge = match o.container.as_str() {
                "mkv" => "mkv",
                "webm" => "webm/mkv",
                _ => "mp4/mkv",
            };
            a.extend(["--merge-output-format".into(), merge.into()]);
        }
        Mode::Audio => {
            let format = match &o.audio_format {
                Some(au) => {
                    expected = explicit_sizes(media, &[au]);
                    format!("{au}/ba{lang_filter}/ba/b")
                }
                None => format!("ba{lang_filter}/ba/b"),
            };
            let codec = match o.audio_codec.as_str() {
                c @ ("mp3" | "m4a" | "opus" | "flac" | "wav") => c,
                _ => "mp3",
            };
            a.extend(["-f".into(), format, "-x".into(), "--audio-format".into(), codec.into()]);
            if matches!(codec, "mp3" | "m4a" | "opus") {
                let q = o.audio_quality.map(|k| format!("{}K", k.clamp(32, 320))).unwrap_or_else(|| "0".into());
                a.extend(["--audio-quality".into(), q]);
            }
        }
    }

    let subs: Vec<&str> = o
        .subtitles
        .iter()
        .map(String::as_str)
        .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
        .collect();
    if !subs.is_empty() {
        a.extend(["--write-subs", "--write-auto-subs", "--sub-langs"].map(String::from));
        a.push(subs.join(","));
        if o.embed_subtitles && o.mode == Mode::Video {
            a.push("--embed-subs".into());
        } else {
            a.extend(["--convert-subs", "srt"].map(String::from));
        }
    }
    if o.embed_thumbnail && !(o.mode == Mode::Audio && o.audio_codec == "wav") {
        a.push("--embed-thumbnail".into());
    }
    if o.embed_metadata {
        a.push("--embed-metadata".into());
    }
    if o.embed_chapters {
        a.push("--embed-chapters".into());
    }
    a.push("--".into());
    a.push(url.into());

    RunSpec {
        args: a,
        expected,
        two_streams,
        playlist,
        items: media.filter(|m| m.kind == MediaKind::Playlist).map(|m| m.entries.len() as u32),
    }
}

fn explicit_sizes(media: Option<&MediaInfo>, ids: &[&String]) -> Vec<(String, Option<u64>)> {
    ids.iter()
        .map(|id| {
            let size = media.and_then(|m| m.formats.iter().find(|f| &&f.id == id)).and_then(|f| f.size);
            ((*id).clone(), size)
        })
        .collect()
}

#[derive(Deserialize)]
struct DlLine {
    status: String,
    d: u64,
    t: Option<f64>,
    te: Option<f64>,
    s: Option<f64>,
    eta: Option<f64>,
    fmt: String,
    vc: String,
    pi: Option<u32>,
    pn: Option<u32>,
}

#[derive(Deserialize)]
struct PpLine {
    status: String,
    pp: String,
}

/// Folds per-stream yt-dlp progress into one number for the job.
struct Tracker {
    spec_expected: Vec<(String, Option<u64>)>,
    two_streams: bool,
    /// (format id, downloaded, total, finished, is_video)
    streams: Vec<(String, u64, Option<u64>, bool, bool)>,
    item: Option<u32>,
    items: Option<u32>,
    progress: Progress,
}

impl Tracker {
    fn new(spec: &RunSpec) -> Self {
        Self {
            spec_expected: spec.expected.clone(),
            two_streams: spec.two_streams,
            streams: Vec::new(),
            item: None,
            items: spec.items,
            progress: Progress { stage: Some("download".into()), items: spec.items, ..Default::default() },
        }
    }

    fn on_download(&mut self, line: &DlLine) {
        if line.pi.is_some() && line.pi != self.item {
            self.item = line.pi;
            self.streams.clear();
        }
        if line.pn.is_some() {
            self.items = line.pn;
        }
        let total = line.t.or(line.te).map(|x| x as u64);
        let finished = line.status == "finished";
        match self.streams.iter_mut().find(|s| s.0 == line.fmt) {
            Some(s) => {
                s.1 = line.d;
                s.2 = total.or(s.2);
                s.3 |= finished;
            }
            None => self.streams.push((line.fmt.clone(), line.d, total, finished, line.vc != "none")),
        }
        if finished {
            if let Some(s) = self.streams.iter_mut().find(|s| s.0 == line.fmt) {
                s.1 = s.2.unwrap_or(s.1).max(s.1);
            }
        }

        let item_fraction = self.item_fraction();
        let p = &mut self.progress;
        p.stage = Some("download".into());
        p.item = self.item;
        p.items = self.items;
        p.speed = line.s;
        p.downloaded = self.streams.iter().map(|s| s.1).sum();
        let known: Vec<u64> = self.spec_expected.iter().filter_map(|e| e.1).collect();
        p.total = if !known.is_empty() && known.len() == self.spec_expected.len() {
            Some(known.iter().sum())
        } else {
            let t: u64 = self.streams.iter().filter_map(|s| s.2).sum();
            (t > 0).then_some(t)
        };
        p.eta = match (p.total, p.speed) {
            (Some(t), Some(s)) if s > 0.0 && self.items.is_none() => Some(t.saturating_sub(p.downloaded) as f64 / s),
            _ => line.eta,
        };
        p.fraction = Some(match (self.item, self.items) {
            (Some(i), Some(n)) if n > 0 => ((i.saturating_sub(1)) as f64 + item_fraction) / n as f64,
            _ => item_fraction,
        });
    }

    fn item_fraction(&self) -> f64 {
        let sizes: Option<Vec<(String, u64)>> =
            self.spec_expected.iter().map(|(id, s)| s.map(|s| (id.clone(), s))).collect();
        if let Some(sizes) = sizes.filter(|s| !s.is_empty() && self.item.is_none()) {
            let total: u64 = sizes.iter().map(|s| s.1).sum();
            let done: u64 = sizes
                .iter()
                .map(|(id, size)| self.streams.iter().find(|s| &s.0 == id).map(|s| s.1.min(*size)).unwrap_or(0))
                .sum();
            return (done as f64 / total.max(1) as f64).min(1.0);
        }
        // Sizes unknown: weigh video 85 %, audio 15 % when two streams get merged.
        let mut f = 0.0;
        for s in &self.streams {
            let weight = if !self.two_streams { 1.0 } else if s.4 { 0.85 } else { 0.15 };
            let frac = if s.3 { 1.0 } else { s.2.map(|t| s.1 as f64 / t.max(1) as f64).unwrap_or(0.0) };
            f += weight * frac.min(1.0);
        }
        f.min(1.0)
    }

    fn on_postprocess(&mut self, line: &PpLine) {
        if line.status != "started" {
            return;
        }
        let stage = match line.pp.as_str() {
            "Merger" => "merging",
            "ExtractAudio" | "FFmpegExtractAudio" | "VideoConvertor" | "VideoRemuxer" => "converting",
            _ => "finishing",
        };
        self.progress.stage = Some(stage.into());
        self.progress.speed = None;
        self.progress.eta = None;
        if self.items.is_none() {
            self.progress.fraction = Some(1.0);
        }
    }
}

pub async fn run(
    ytdlp: &Path,
    spec: RunSpec,
    group: Arc<ProcGroup>,
    mut on_progress: impl FnMut(&Progress, bool),
) -> Result<Vec<String>, JobError> {
    let mut cmd = command(ytdlp);
    cmd.args(&spec.args).stdout(Stdio::piped()).stderr(Stdio::piped());
    isolate(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| JobError { code: "tool_missing".into(), detail: e.to_string() })?;
    group.add(&child);

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    if let Some(out) = child.stdout.take() {
        tokio::spawn(pump_lines(out, tx.clone()));
    }
    if let Some(err) = child.stderr.take() {
        tokio::spawn(pump_lines(err, tx.clone()));
    }
    drop(tx);

    let mut tracker = Tracker::new(&spec);
    let mut tail: VecDeque<String> = VecDeque::new();
    let mut outputs = Vec::new();
    while let Some(line) = rx.recv().await {
        if let Some(rest) = line.strip_prefix("YLDL|") {
            if let Ok(dl) = serde_json::from_str::<DlLine>(rest) {
                tracker.on_download(&dl);
                on_progress(&tracker.progress, false);
            }
        } else if let Some(rest) = line.strip_prefix("YLPP|") {
            if let Ok(pp) = serde_json::from_str::<PpLine>(rest) {
                tracker.on_postprocess(&pp);
                on_progress(&tracker.progress, true);
            }
        } else if let Some(path) = line.strip_prefix("YLFILE|") {
            outputs.push(path.trim().to_string());
        } else if !line.trim().is_empty() {
            if tail.len() >= 40 {
                tail.pop_front();
            }
            tail.push_back(line);
        }
    }
    let status = child.wait().await.map_err(|e| JobError { code: "unknown".into(), detail: e.to_string() })?;
    if status.success() || (spec.playlist && !outputs.is_empty()) {
        Ok(outputs)
    } else {
        Err(classify_error(&tail.into_iter().collect::<Vec<_>>().join("\n")))
    }
}

async fn pump_lines(stream: impl AsyncRead + Unpin, tx: mpsc::UnboundedSender<String>) {
    let mut reader = BufReader::new(stream);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let line = String::from_utf8_lossy(&buf).trim_end_matches(['\r', '\n']).to_string();
                if tx.send(line).is_err() {
                    break;
                }
            }
        }
    }
}
