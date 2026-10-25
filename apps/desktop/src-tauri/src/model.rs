//! Data shared between the Rust core and the UI. Field names are camelCase on the wire;
//! the TypeScript mirror lives in `src/lib/types.ts`.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FormatKind {
    Video,
    Audio,
    Muxed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Format {
    pub id: String,
    pub ext: String,
    pub kind: FormatKind,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub hdr: bool,
    /// Total bitrate, kbit/s.
    pub tbr: Option<f64>,
    pub abr: Option<f64>,
    pub size: Option<u64>,
    pub size_approx: bool,
    pub language: Option<String>,
    /// yt-dlp marks the original audio track with a higher preference than dubs.
    pub language_preference: Option<i64>,
    pub note: Option<String>,
    /// Dynamic range compressed audio variant.
    pub drc: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleTrack {
    pub code: String,
    pub name: String,
    pub auto: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistEntry {
    pub id: String,
    pub title: String,
    pub duration: Option<f64>,
    pub url: String,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Video,
    Playlist,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub kind: MediaKind,
    pub id: String,
    pub url: String,
    pub title: String,
    pub channel: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub view_count: Option<u64>,
    pub is_live: bool,
    pub formats: Vec<Format>,
    pub subtitles: Vec<SubtitleTrack>,
    pub chapters: u32,
    pub entries: Vec<PlaylistEntry>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    #[default]
    Video,
    Audio,
}

/// What the user picked in the inspector. A single video sends explicit format ids;
/// a playlist (no per-video formats known) sends selector hints instead.
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct DownloadOptions {
    pub mode: Mode,
    pub video_format: Option<String>,
    pub audio_format: Option<String>,
    pub max_height: Option<u32>,
    /// "av1" | "vp9" | "h264"
    pub video_codec: Option<String>,
    pub audio_language: Option<String>,
    /// "mp4" | "mkv" | "webm"
    pub container: String,
    /// "mp3" | "m4a" | "opus" | "flac" | "wav"
    pub audio_codec: String,
    /// kbit/s for lossy audio, None = best
    pub audio_quality: Option<u32>,
    pub subtitles: Vec<String>,
    pub embed_subtitles: bool,
    pub embed_thumbnail: bool,
    pub embed_metadata: bool,
    pub embed_chapters: bool,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Analyzing,
    Ready,
    Queued,
    Downloading,
    Processing,
    Done,
    Error,
    Canceled,
}

impl JobStatus {
    pub fn is_active(self) -> bool {
        matches!(self, JobStatus::Downloading | JobStatus::Processing)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// 0..1 for the whole job
    pub fraction: Option<f64>,
    pub downloaded: u64,
    pub total: Option<u64>,
    /// bytes per second
    pub speed: Option<f64>,
    /// seconds
    pub eta: Option<f64>,
    /// "download" | "merging" | "converting" | "finishing"
    pub stage: Option<String>,
    /// playlist position, 1-based
    pub item: Option<u32>,
    pub items: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobError {
    /// Stable machine code, translated by the UI.
    pub code: String,
    /// Last meaningful line from yt-dlp.
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub url: String,
    pub created_at: u64,
    pub status: JobStatus,
    pub media: Option<MediaInfo>,
    pub options: Option<DownloadOptions>,
    pub progress: Progress,
    pub error: Option<JobError>,
    pub outputs: Vec<String>,
}
