// Turns yt-dlp's raw format list into the choices the inspector shows, and back into
// explicit format ids for the download.

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
export const CODEC_HINT: Record<VideoCodec, string> = {
  av1: "Лучшее сжатие, нужен современный плеер",
  vp9: "Хорошее сжатие, поддержка почти везде",
  h264: "Открывается везде, файл больше, максимум 1080p",
};

export const PLAYLIST_HEIGHTS = [2160, 1440, 1080, 720, 480, 360];

export function codecOf(f: Format): VideoCodec | null {
  const v = f.vcodec ?? "";
  if (v.startsWith("av01")) return "av1";
  if (v.startsWith("vp09") || v.startsWith("vp9")) return "vp9";
  if (v.startsWith("avc1") || v.startsWith("h264")) return "h264";
  return null;
}

const isVideo = (f: Format) => (f.kind === "video" || f.kind === "muxed") && f.height != null && codecOf(f) != null;
const isAudio = (f: Format) => f.kind === "audio" && !f.drc;
const fps60 = (f: Format) => (f.fps ?? 0) >= 48;
const qualityKey = (f: Format) => `${f.height}-${fps60(f) ? 60 : 30}-${f.hdr ? "hdr" : "sdr"}`;

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
      map.set(key, {
        key,
        height: h,
        fps60: fps60(f),
        hdr: f.hdr,
        label: `${h >= 2160 ? heightLabel(h) : `${h}p`}${fps60(f) ? "60" : ""}${f.hdr ? " HDR" : ""}`,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.height - a.height || Number(b.fps60) - Number(a.fps60) || Number(a.hdr) - Number(b.hdr));
}

export function codecsFor(media: MediaInfo, q: Quality): Set<VideoCodec> {
  return new Set(media.formats.filter((f) => isVideo(f) && qualityKey(f) === q.key).map((f) => codecOf(f)!));
}

const languageNames = (() => {
  try {
    return new Intl.DisplayNames(["ru"], { type: "language" });
  } catch {
    return null;
  }
})();

export function languageName(code: string | null): string {
  if (!code) return "Основная";
  const base = code.split(/[-_]/)[0];
  const name = languageNames?.of(base) ?? code;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function audioTracks(media: MediaInfo): AudioTrack[] {
  const audio = media.formats.filter(isAudio);
  const langs = [...new Set(audio.map((f) => f.language))];
  if (langs.length <= 1) return [{ lang: langs[0] ?? null, label: "Основная", original: true }];
  const prefOf = (lang: string | null) => Math.max(...audio.filter((f) => f.language === lang).map((f) => f.languagePreference ?? -100));
  const best = Math.max(...langs.map(prefOf));
  return langs
    .map((lang) => {
      const notes = audio.filter((f) => f.language === lang).map((f) => (f.note ?? "").toLowerCase());
      const original = notes.some((n) => n.includes("original")) || prefOf(lang) === best;
      const dubbed = notes.some((n) => n.includes("dub"));
      return { lang, original, label: `${languageName(lang)}${original ? " · оригинал" : dubbed ? " · дубляж" : ""}` };
    })
    .sort((a, b) => Number(b.original) - Number(a.original) || a.label.localeCompare(b.label, "ru"));
}

function pickVideo(media: MediaInfo, q: Quality, codec: VideoCodec | null): Format | null {
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

export function defaultOptions(media: MediaInfo): DownloadOptions {
  const base: DownloadOptions = {
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
  };
  if (media.kind === "playlist") return base;

  const list = qualities(media).filter((q) => !q.hdr);
  const q = list.find((x) => x.height <= 1080) ?? list[list.length - 1] ?? qualities(media)[0];
  const tracks = audioTracks(media);
  const lang = (tracks.find((t) => t.original) ?? tracks[0])?.lang ?? null;
  if (!q) return { ...base, audioLanguage: lang };
  const codecs = codecsFor(media, q);
  const codec: VideoCodec = codecs.has("av1") ? "av1" : codecs.has("vp9") ? "vp9" : "h264";
  return resolve(media, { ...base, audioLanguage: lang, videoCodec: codec, maxHeight: q.height }, q);
}

/** Recomputes explicit format ids after the user changed any choice. */
export function resolve(media: MediaInfo, o: DownloadOptions, q?: Quality | null): DownloadOptions {
  if (media.kind === "playlist") return { ...o, videoFormat: null, audioFormat: null };
  const quality = q ?? currentQuality(media, o) ?? qualities(media)[0] ?? null;
  let codec = o.videoCodec;
  if (o.container === "webm" && codec === "h264") codec = "vp9";
  if (o.mode === "audio") {
    const prefer = o.audioCodec === "m4a" ? "m4a" : o.audioCodec === "opus" ? "opus" : null;
    return { ...o, videoFormat: null, audioFormat: pickAudio(media, o.audioLanguage, prefer)?.id ?? null };
  }
  const video = quality ? pickVideo(media, quality, codec) : null;
  const realCodec = video ? codecOf(video) : codec;
  const audio = video?.kind === "muxed" ? null : pickAudio(media, o.audioLanguage, audioPreferenceFor(o.container));
  return {
    ...o,
    videoCodec: realCodec,
    maxHeight: quality?.height ?? o.maxHeight,
    videoFormat: video?.id ?? null,
    audioFormat: audio?.id ?? null,
  };
}

const LOSSY_DEFAULT_KBPS: Record<AudioCodec, number> = { mp3: 245, m4a: 160, opus: 160, flac: 800, wav: 1411 };

export function estimateSize(media: MediaInfo, o: DownloadOptions): { bytes: number; approx: boolean } | null {
  if (media.kind === "playlist") return null;
  const find = (id: string | null) => (id ? media.formats.find((f) => f.id === id) ?? null : null);
  if (o.mode === "audio") {
    const src = find(o.audioFormat);
    const sameCodec = (o.audioCodec === "m4a" && src?.ext === "m4a") || (o.audioCodec === "opus" && src?.acodec === "opus");
    if (sameCodec && !o.audioQuality && src?.size) return { bytes: src.size, approx: src.sizeApprox };
    if (!media.duration) return null;
    const kbps = o.audioQuality ?? LOSSY_DEFAULT_KBPS[o.audioCodec];
    return { bytes: (kbps * 1000 * media.duration) / 8, approx: true };
  }
  const v = find(o.videoFormat);
  const a = find(o.audioFormat);
  if (!v?.size) return null;
  return { bytes: v.size + (a?.size ?? 0), approx: v.sizeApprox || !!a?.sizeApprox || (!!a && !a.size) };
}

/** Short tags for the queue row. */
export function describe(media: MediaInfo | null, o: DownloadOptions | null): string[] {
  if (!o) return [];
  if (o.mode === "audio") {
    return ["только звук", `${o.audioCodec.toUpperCase()}${o.audioQuality ? ` ${o.audioQuality}` : ""}`];
  }
  const tags: string[] = [];
  const v = media?.formats.find((f) => f.id === o.videoFormat);
  if (v?.height) tags.push(`${v.height}p${fps60(v) ? "60" : ""}${v.hdr ? " HDR" : ""}`);
  else if (o.maxHeight) tags.push(`до ${heightLabel(o.maxHeight)}`);
  if (o.videoCodec) tags.push(CODEC_LABEL[o.videoCodec]);
  tags.push(o.container.toUpperCase());
  const a = media?.formats.find((f) => f.id === o.audioFormat);
  const lang = a?.language ?? o.audioLanguage;
  if (lang && media && audioTracks(media).length > 1) tags.push(lang.toUpperCase());
  if (o.subtitles.length) tags.push("субтитры");
  return tags;
}

export function thumbnailOf(media: MediaInfo | null, large = false): string | null {
  if (!media) return null;
  const id = media.kind === "playlist" ? media.entries[0]?.id : media.id;
  if (!id) return media.thumbnail;
  return `https://i.ytimg.com/vi/${id}/${large ? "hqdefault" : "mqdefault"}.jpg`;
}
