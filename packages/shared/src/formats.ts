// Turns yt-dlp's raw format list into the choices the inspector shows, and back into
// explicit format ids for the download.

import type { T } from "./i18n";
import type { AudioCodec, Container, DownloadOptions, Format, MediaInfo, VideoCodec } from "./types";

export interface Quality {
  key: string;
  height: number;
  fps60: boolean;
  hdr: boolean;
  label: string;
}

export interface AudioTrack {
  lang: string | null;
  label: string;
  original: boolean;
}

export const CODEC_LABEL: Record<VideoCodec, string> = { av1: "AV1", vp9: "VP9", h264: "H.264" };
export const PLAYLIST_HEIGHTS = [2160, 1440, 1080, 720, 480, 360];

export function codecOf(f: Format): VideoCodec | null {
  const v = f.vcodec ?? "";
  if (v.startsWith("av01")) return "av1";
  if (v.startsWith("vp09") || v.startsWith("vp9")) return "vp9";
  if (v.startsWith("avc1") || v.startsWith("h264")) return "h264";
  return null;
}

export const isVideo = (f: Format) => (f.kind === "video" || f.kind === "muxed") && f.height != null && codecOf(f) != null;
export const isAudio = (f: Format) => f.kind === "audio" && !f.drc;
const fps60 = (f: Format) => (f.fps ?? 0) >= 48;
export const qualityKey = (f: Format) => `${f.height}-${fps60(f) ? 60 : 30}-${f.hdr ? "hdr" : "sdr"}`;

export function heightLabel(h: number): string {
  if (h >= 4320) return "8K";
  if (h >= 2160) return "4K";
  return `${h}p`;
}

export function qualities(media: MediaInfo): Quality[] {
  const map = new Map<string, Quality>();
  for (const f of media.formats.filter(isVideo)) {
    const key = qualityKey(f);
    if (!map.has(key)) {
      const h = f.height!;
      map.set(key, { key, height: h, fps60: fps60(f), hdr: f.hdr, label: `${h >= 2160 ? heightLabel(h) : `${h}p`}${fps60(f) ? "60" : ""}${f.hdr ? " HDR" : ""}` });
    }
  }
  return [...map.values()].sort((a, b) => b.height - a.height || Number(b.fps60) - Number(a.fps60) || Number(a.hdr) - Number(b.hdr));
}

export function codecsFor(media: MediaInfo, q: Quality): Set<VideoCodec> {
  return new Set(media.formats.filter((f) => isVideo(f) && qualityKey(f) === q.key).map((f) => codecOf(f)!));
}

export function bestCodec(available: Set<VideoCodec>, container: Container): VideoCodec {
  if (available.has("av1")) return "av1";
  if (available.has("vp9")) return "vp9";
  return container === "webm" ? "vp9" : "h264";
}

const displayNames = new Map<string, Intl.DisplayNames | null>();
export function languageName(code: string | null, t: T): string {
  if (!code) return t("inspector.trackMain");
  if (!displayNames.has(t.lang)) {
    try {
      displayNames.set(t.lang, new Intl.DisplayNames([t.lang], { type: "language" }));
    } catch {
      displayNames.set(t.lang, null);
    }
  }
  const base = code.split(/[-_]/)[0] ?? code;
  const name = displayNames.get(t.lang)?.of(base) ?? code;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function audioTracks(media: MediaInfo, t: T): AudioTrack[] {
  const audio = media.formats.filter(isAudio);
  const langs = [...new Set(audio.map((f) => f.language))];
  if (langs.length <= 1) return [{ lang: langs[0] ?? null, label: t("inspector.trackMain"), original: true }];
  const prefOf = (lang: string | null) => Math.max(...audio.filter((f) => f.language === lang).map((f) => f.languagePreference ?? -100));
  const best = Math.max(...langs.map(prefOf));
  return langs
    .map((lang) => {
      const notes = audio.filter((f) => f.language === lang).map((f) => (f.note ?? "").toLowerCase());
      const original = notes.some((n) => n.includes("original")) || prefOf(lang) === best;
      const dubbed = notes.some((n) => n.includes("dub"));
      const suffix = original ? ` · ${t("inspector.trackOriginal")}` : dubbed ? ` · ${t("inspector.trackDub")}` : "";
      return { lang, original, label: `${languageName(lang, t)}${suffix}` };
    })
    .sort((a, b) => Number(b.original) - Number(a.original) || a.label.localeCompare(b.label, t.lang));
}

/** Language of the original track (used when a preset says "original"). */
export function originalLanguage(media: MediaInfo): string | null {
  const audio = media.formats.filter(isAudio);
  const byNote = audio.find((f) => (f.note ?? "").toLowerCase().includes("original"));
  if (byNote) return byNote.language;
  return [...audio].sort((a, b) => (b.languagePreference ?? -100) - (a.languagePreference ?? -100))[0]?.language ?? null;
}

export function pickVideo(media: MediaInfo, q: Quality, codec: VideoCodec | null): Format | null {
  const all = media.formats.filter((f) => isVideo(f) && qualityKey(f) === q.key);
  const withCodec = codec ? all.filter((f) => codecOf(f) === codec) : all;
  const pool = withCodec.length ? withCodec : all;
  // Separate video streams merge with the chosen audio; muxed ones are a fallback.
  return [...pool].sort((a, b) => Number(a.kind === "muxed") - Number(b.kind === "muxed") || (b.tbr ?? 0) - (a.tbr ?? 0))[0] ?? null;
}

function pickAudio(media: MediaInfo, lang: string | null, prefer: "m4a" | "opus" | null): Format | null {
  const audio = media.formats.filter(isAudio);
  const sameLang = audio.filter((f) => f.language === lang);
  const pool = sameLang.length ? sameLang : audio;
  const preferred = prefer ? pool.filter((f) => (prefer === "m4a" ? f.ext === "m4a" : f.acodec === "opus")) : [];
  const final = preferred.length ? preferred : pool;
  return [...final].sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0))[0] ?? null;
}

/** MP4 gets AAC for the widest player support; MKV/WebM get Opus. */
const audioPreferenceFor = (container: Container): "m4a" | "opus" => (container === "mp4" ? "m4a" : "opus");

export function currentQuality(media: MediaInfo, o: DownloadOptions): Quality | null {
  const f = media.formats.find((x) => x.id === o.videoFormat);
  const list = qualities(media);
  return (f && list.find((q) => q.key === qualityKey(f))) ?? null;
}

export function emptyOptions(): DownloadOptions {
  return {
    mode: "video",
    videoFormat: null,
    audioFormat: null,
    maxHeight: 1080,
    videoCodec: null,
    audioLanguage: null,
    container: "mp4",
    audioCodec: "mp3",
    audioQuality: null,
    subtitles: [],
    embedSubtitles: true,
    embedThumbnail: true,
    embedMetadata: true,
    embedChapters: true,
    playlistItems: null,
    sectionStart: null,
    sectionEnd: null,
    manualFormats: false,
    preset: null,
  };
}

/** Recomputes explicit format ids after the user changed any choice. */
export function resolve(media: MediaInfo, o: DownloadOptions, q?: Quality | null): DownloadOptions {
  if (media.kind === "playlist") return { ...o, videoFormat: null, audioFormat: null, manualFormats: false };
  if (o.manualFormats) return o;
  if (o.mode === "audio") {
    const prefer = o.audioCodec === "m4a" ? "m4a" : o.audioCodec === "opus" ? "opus" : null;
    return { ...o, videoFormat: null, audioFormat: pickAudio(media, o.audioLanguage, prefer)?.id ?? null };
  }
  const quality = q ?? currentQuality(media, o) ?? qualities(media).find((x) => !o.maxHeight || x.height <= o.maxHeight) ?? qualities(media)[0] ?? null;
  let codec = o.videoCodec;
  if (o.container === "webm" && codec === "h264") codec = "vp9";
  const video = quality ? pickVideo(media, quality, codec) : null;
  const audio = video?.kind === "muxed" ? null : pickAudio(media, o.audioLanguage, audioPreferenceFor(o.container));
  return {
    ...o,
    videoCodec: video ? codecOf(video) : codec,
    maxHeight: quality?.height ?? o.maxHeight,
    videoFormat: video?.id ?? null,
    audioFormat: audio?.id ?? null,
  };
}

const LOSSY_DEFAULT_KBPS: Record<AudioCodec, number> = { mp3: 245, m4a: 160, opus: 160, flac: 800, wav: 1411 };

export function estimateSize(media: MediaInfo, o: DownloadOptions): { bytes: number; approx: boolean } | null {
  if (media.kind === "playlist") return null;
  const find = (id: string | null) => (id ? media.formats.find((f) => f.id === id) ?? null : null);
  // A clip is a share of the whole file.
  const share = o.sectionStart != null && o.sectionEnd != null && media.duration ? Math.max(0, o.sectionEnd - o.sectionStart) / media.duration : 1;
  const approxClip = share < 1;
  if (o.mode === "audio") {
    const src = find(o.audioFormat);
    const sameCodec = (o.audioCodec === "m4a" && src?.ext === "m4a") || (o.audioCodec === "opus" && src?.acodec === "opus");
    if (sameCodec && !o.audioQuality && src?.size) return { bytes: src.size * share, approx: src.sizeApprox || approxClip };
    if (!media.duration) return null;
    const kbps = o.audioQuality ?? LOSSY_DEFAULT_KBPS[o.audioCodec];
    return { bytes: ((kbps * 1000 * media.duration) / 8) * share, approx: true };
  }
  const v = find(o.videoFormat);
  const a = find(o.audioFormat);
  if (!v?.size) return null;
  return { bytes: (v.size + (a?.size ?? 0)) * share, approx: v.sizeApprox || !!a?.sizeApprox || (!!a && !a.size) || approxClip };
}

/** Size of a format, or a bitrate-based guess when YouTube gives none. */
function formatBytes(f: Format | null | undefined, duration: number | null): number {
  if (!f) return 0;
  if (f.size) return f.size;
  const kbps = f.tbr ?? f.abr;
  return kbps && duration ? (kbps * 1000 * duration) / 8 : 0;
}

/** What yt-dlp's selector would pick for one playlist video, mirrored for the estimate. */
function playlistEntryBytes(formats: Format[], duration: number | null, o: DownloadOptions): number {
  const audio = formats.filter(isAudio);
  const pickAudio = (prefer: "m4a" | "opus" | null) => {
    const lang = o.audioLanguage;
    const sameLang = lang ? audio.filter((f) => f.language?.startsWith(lang)) : [];
    const original = [...audio].sort((a, b) => (b.languagePreference ?? -100) - (a.languagePreference ?? -100))[0]?.language;
    const pool = sameLang.length ? sameLang : audio.filter((f) => f.language === original).length ? audio.filter((f) => f.language === original) : audio;
    const preferred = prefer ? pool.filter((f) => (prefer === "m4a" ? f.ext === "m4a" : f.acodec === "opus")) : [];
    return [...(preferred.length ? preferred : pool)].sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0))[0] ?? null;
  };
  if (o.mode === "audio") {
    const src = pickAudio(o.audioCodec === "m4a" ? "m4a" : o.audioCodec === "opus" ? "opus" : null);
    const sameCodec = (o.audioCodec === "m4a" && src?.ext === "m4a") || (o.audioCodec === "opus" && src?.acodec === "opus");
    if (sameCodec && !o.audioQuality) return formatBytes(src, duration);
    const kbps = o.audioQuality ?? LOSSY_DEFAULT_KBPS[o.audioCodec];
    return duration ? (kbps * 1000 * duration) / 8 : formatBytes(src, duration);
  }
  const fit = formats.filter((f) => isVideo(f) && (!o.maxHeight || (f.height ?? 0) <= o.maxHeight));
  const byCodec = o.videoCodec ? fit.filter((f) => codecOf(f) === o.videoCodec) : fit;
  const pool = byCodec.length ? byCodec : fit;
  const best = [...pool].sort(
    (a, b) => Number(a.kind === "muxed") - Number(b.kind === "muxed") || (b.height ?? 0) - (a.height ?? 0) || (b.fps ?? 0) - (a.fps ?? 0) || (b.tbr ?? 0) - (a.tbr ?? 0),
  )[0];
  if (!best) return 0;
  if (best.kind === "muxed") return formatBytes(best, duration);
  const a = pickAudio(o.container === "mp4" && o.videoCodec === "h264" ? "m4a" : null);
  return formatBytes(best, duration) + formatBytes(a, duration);
}

/** Estimated total of the selected playlist videos; `known` of `total` are scanned so far. */
export function estimatePlaylist(media: MediaInfo, o: DownloadOptions): { bytes: number; known: number; total: number } {
  const chosen = o.playlistItems ? new Set(o.playlistItems) : null;
  const entries = media.entries.filter((e) => !chosen || chosen.has(e.index));
  let bytes = 0;
  let known = 0;
  for (const e of entries) {
    if (!e.formats) continue;
    known++;
    if (e.formats.length) bytes += playlistEntryBytes(e.formats, e.duration, o);
  }
  return { bytes, known, total: entries.length };
}

/** Short tags for the queue row and history. */
export function describe(media: MediaInfo | null, o: DownloadOptions | null, t: T): string[] {
  if (!o) return [];
  const tags: string[] = [];
  if (o.mode === "audio") {
    tags.push(t("tags.audioOnly"), `${o.audioCodec.toUpperCase()}${o.audioQuality ? ` ${o.audioQuality}` : ""}`);
  } else {
    const v = media?.formats.find((f) => f.id === o.videoFormat);
    if (v?.height) tags.push(`${v.height}p${fps60(v) ? "60" : ""}${v.hdr ? " HDR" : ""}`);
    else if (o.maxHeight) tags.push(t("tags.upTo", { h: heightLabel(o.maxHeight) }));
    if (o.videoCodec) tags.push(CODEC_LABEL[o.videoCodec]);
    tags.push(o.container.toUpperCase());
    const a = media?.formats.find((f) => f.id === o.audioFormat);
    const lang = a?.language ?? o.audioLanguage;
    if (lang && media && media.kind === "video" && audioTracks(media, t).length > 1) tags.push(lang.toUpperCase());
    if (o.subtitles.length) tags.push(t("tags.subs"));
  }
  if (o.sectionStart != null && o.sectionEnd != null) tags.push(t("tags.fragment"));
  if (media?.kind === "playlist" && o.playlistItems) tags.push(t("tags.items", { n: o.playlistItems.length, total: media.entries.length }));
  return tags;
}

export function thumbnailOf(media: MediaInfo | null, large = false): string | null {
  if (!media) return null;
  const id = media.kind === "playlist" ? media.entries[0]?.id : media.id;
  if (!id) return media.thumbnail;
  return thumbUrl(id, large);
}

export function thumbUrl(id: string, large = false): string {
  return `https://i.ytimg.com/vi/${id}/${large ? "hqdefault" : "mqdefault"}.jpg`;
}
