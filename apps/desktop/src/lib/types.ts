// Mirror of the Rust types in src-tauri/src/model.rs (camelCase on the wire).

export type FormatKind = "video" | "audio" | "muxed";

export interface Format {
  id: string;
  ext: string;
  kind: FormatKind;
  width: number | null;
  height: number | null;
  fps: number | null;
  vcodec: string | null;
  acodec: string | null;
  hdr: boolean;
  tbr: number | null;
  abr: number | null;
  size: number | null;
  sizeApprox: boolean;
  language: string | null;
  languagePreference: number | null;
  note: string | null;
  drc: boolean;
}

export interface SubtitleTrack {
  code: string;
  name: string;
  auto: boolean;
}

export interface PlaylistEntry {
  id: string;
  title: string;
  duration: number | null;
  url: string;
}

export interface MediaInfo {
  kind: "video" | "playlist";
  id: string;
  url: string;
  title: string;
  channel: string | null;
  duration: number | null;
  thumbnail: string | null;
  viewCount: number | null;
  isLive: boolean;
  formats: Format[];
  subtitles: SubtitleTrack[];
  chapters: number;
  entries: PlaylistEntry[];
}

export type Mode = "video" | "audio";
export type VideoCodec = "av1" | "vp9" | "h264";
export type Container = "mp4" | "mkv" | "webm";
export type AudioCodec = "mp3" | "m4a" | "opus" | "flac" | "wav";

export interface DownloadOptions {
  mode: Mode;
  videoFormat: string | null;
  audioFormat: string | null;
  maxHeight: number | null;
  videoCodec: VideoCodec | null;
  audioLanguage: string | null;
  container: Container;
  audioCodec: AudioCodec;
  audioQuality: number | null;
  subtitles: string[];
  embedSubtitles: boolean;
  embedThumbnail: boolean;
  embedMetadata: boolean;
  embedChapters: boolean;
}

export type JobStatus = "analyzing" | "ready" | "queued" | "downloading" | "processing" | "done" | "error" | "canceled";

export interface Progress {
  fraction: number | null;
  downloaded: number;
  total: number | null;
  speed: number | null;
  eta: number | null;
  stage: "download" | "merging" | "converting" | "finishing" | null;
  item: number | null;
  items: number | null;
}

export interface JobError {
  code: string;
  detail: string;
}

export interface Job {
  id: string;
  url: string;
  createdAt: number;
  status: JobStatus;
  media: MediaInfo | null;
  options: DownloadOptions | null;
  progress: Progress;
  error: JobError | null;
  outputs: string[];
}

export interface Settings {
  downloadDir: string;
  maxParallel: number;
  filenameTemplate: string;
  proxy: string;
  bypass: { enabled: boolean; strategy: string };
}

export type BypassStatus =
  | { state: "off" }
  | { state: "starting" }
  | { state: "active"; strategy: string }
  | { state: "external" }
  | { state: "error"; code: string; detail: string }
  | { state: "unsupported" };

export interface ToolsStatus {
  ytdlpVersion: string | null;
  updating: boolean;
  ffmpegOk: boolean;
  denoOk: boolean;
  message: string | null;
}

export interface StrategyInfo {
  id: string;
  name: string;
}

export interface Snapshot {
  settings: Settings;
  jobs: Job[];
  bypass: BypassStatus;
  tools: ToolsStatus;
  strategies: StrategyInfo[];
  platform: string;
  version: string;
}

export interface CheckItem {
  id: string;
  label: string;
  ok: boolean;
  ms: number | null;
  speed: number | null;
  detail: string | null;
}
