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
  index: number;
  id: string;
  title: string;
  duration: number | null;
  url: string;
  viewCount: number | null;
  downloaded: boolean;
  /** Filled in the background for the size estimate; null until scanned. */
  formats: Format[] | null;
}

export type ChannelTab = "videos" | "shorts" | "streams";

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
  channelTab: ChannelTab | null;
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
  playlistItems: number[] | null;
  sectionStart: number | null;
  sectionEnd: number | null;
  manualFormats: boolean;
  preset: string | null;
}

export type JobStatus = "analyzing" | "ready" | "queued" | "downloading" | "processing" | "paused" | "done" | "error" | "canceled";

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
  doneIds: string[];
  finishedAt: number | null;
  size: number | null;
}

export interface HistoryItem {
  id: string;
  url: string;
  kind: "video" | "playlist";
  videoId: string;
  title: string;
  channel: string | null;
  duration: number | null;
  finishedAt: number;
  outputs: string[];
  size: number | null;
  options: DownloadOptions | null;
  count: number;
  thumbId: string | null;
}

export interface Preset {
  id: string;
  name: string;
  builtin?: boolean;
  mode: Mode;
  maxHeight: number | null;
  videoCodec: VideoCodec | null;
  container: Container;
  audioCodec: AudioCodec;
  audioQuality: number | null;
  /** "original" or a language code to prefer when available. */
  audioLanguage: string;
  subtitles: string[];
  embedSubtitles: boolean;
  embedThumbnail: boolean;
  embedMetadata: boolean;
  embedChapters: boolean;
}

export interface Settings {
  downloadDir: string;
  maxParallel: number;
  filenameTemplate: string;
  proxy: string;
  speedLimitKbps: number;
  cookiesFile: string;
  bypass: { enabled: boolean; strategy: string };
  theme: "system" | "dark" | "light";
  language: "system" | "ru" | "en";
  closeToTray: boolean;
  notifications: boolean;
  clipboardWatch: boolean;
  autoUpdate: boolean;
  presets: Preset[];
  defaultPreset: string;
  onboarded: boolean;
}

export type BypassStatus =
  | { state: "off" }
  | { state: "starting" }
  | { state: "active"; strategy: string; mode: "service" | "helper" | "tpws" }
  | { state: "external" }
  | { state: "error"; code: string; detail: string };

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
  history: HistoryItem[];
  bypass: BypassStatus;
  bypassService: boolean;
  tools: ToolsStatus;
  strategies: StrategyInfo[];
  platform: string;
  version: string;
  systemLanguage: string;
}

export interface CheckItem {
  id: "youtube" | "ytimg" | "googlevideo" | "speed";
  ok: boolean;
  ms: number | null;
  speed: number | null;
  bytes: number | null;
  error: string | null;
  timeout: boolean;
}

export interface AutoselectProgress {
  index: number;
  total: number;
  strategy: string;
  speed: number | null;
}

export interface LogLine {
  ts: number;
  level: "info" | "warn" | "error";
  source: string;
  text: string;
}
