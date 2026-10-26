// Built-in and user presets, and how a preset becomes concrete choices for a link.

import type { Key, T } from "./i18n";
import { audioTracks, bestCodec, codecsFor, emptyOptions, originalLanguage, qualities, resolve } from "./formats";
import type { DownloadOptions, MediaInfo, Preset, Settings } from "./types";

const base = {
  builtin: true,
  name: "",
  audioCodec: "mp3",
  audioQuality: null,
  audioLanguage: "original",
  subtitles: [],
  embedSubtitles: true,
  embedThumbnail: true,
  embedMetadata: true,
  embedChapters: true,
} as const;

export const BUILTIN_PRESETS: Preset[] = [
  { ...base, subtitles: [], id: "standard", mode: "video", maxHeight: 1080, videoCodec: null, container: "mp4" },
  { ...base, subtitles: [], id: "max", mode: "video", maxHeight: null, videoCodec: null, container: "mkv" },
  { ...base, subtitles: [], id: "phone", mode: "video", maxHeight: 720, videoCodec: "h264", container: "mp4" },
  { ...base, subtitles: [], id: "audio", mode: "audio", maxHeight: null, videoCodec: null, container: "mp4", audioCodec: "mp3", audioQuality: 320 },
];

export function allPresets(settings: Settings | null): Preset[] {
  return [...BUILTIN_PRESETS, ...(settings?.presets ?? [])];
}

export function findPreset(settings: Settings | null, id: string | null | undefined): Preset {
  const list = allPresets(settings);
  return list.find((p) => p.id === id) ?? list.find((p) => p.id === settings?.defaultPreset) ?? BUILTIN_PRESETS[0]!;
}

export function presetTitle(p: Preset, t: T): string {
  return p.builtin ? t(`presets.${p.id}` as Key) : p.name || t("presets.custom");
}

export function presetSubtitle(p: Preset, t: T): string {
  if (p.builtin) return t(`presets.${p.id}Sub` as Key);
  if (p.mode === "audio") return `${p.audioCodec.toUpperCase()}${p.audioQuality ? ` ${p.audioQuality}` : ""}`;
  return [p.maxHeight ? `${p.maxHeight}p` : t("inspector.best"), p.container.toUpperCase()].join(" · ");
}

/** Playlists: when some videos were downloaded before, start with only the new ones selected. */
function defaultItems(media: MediaInfo): number[] | null {
  if (media.kind !== "playlist") return null;
  const fresh = media.entries.filter((e) => !e.downloaded);
  return fresh.length > 0 && fresh.length < media.entries.length ? fresh.map((e) => e.index) : null;
}

export function applyPreset(media: MediaInfo, p: Preset, t: T, keep?: Partial<DownloadOptions>): DownloadOptions {
  const o: DownloadOptions = {
    ...emptyOptions(),
    mode: p.mode,
    container: p.container,
    audioCodec: p.audioCodec,
    audioQuality: p.audioQuality,
    embedSubtitles: p.embedSubtitles,
    embedThumbnail: p.embedThumbnail,
    embedMetadata: p.embedMetadata,
    embedChapters: p.embedChapters,
    preset: p.id,
    playlistItems: keep?.playlistItems !== undefined ? keep.playlistItems : defaultItems(media),
    sectionStart: keep?.sectionStart ?? null,
    sectionEnd: keep?.sectionEnd ?? null,
  };

  if (media.kind === "playlist") {
    return { ...o, maxHeight: p.maxHeight, videoCodec: p.videoCodec, audioLanguage: p.audioLanguage === "original" ? null : p.audioLanguage, subtitles: p.subtitles };
  }

  // Audio track: the original, or the preferred language when the video has it.
  const tracks = audioTracks(media, t);
  const preferred = p.audioLanguage !== "original" ? tracks.find((x) => x.lang?.startsWith(p.audioLanguage)) : undefined;
  const lang = preferred?.lang ?? originalLanguage(media);
  const subtitles = p.subtitles.filter((code) => media.subtitles.some((s) => s.code === code));

  const all = qualities(media);
  const q = all.find((x) => !p.maxHeight || x.height <= p.maxHeight) ?? all[all.length - 1];
  if (!q) return resolve(media, { ...o, audioLanguage: lang, subtitles });
  const available = codecsFor(media, q);
  const codec = p.videoCodec && available.has(p.videoCodec) ? p.videoCodec : bestCodec(available, p.container);
  return resolve(media, { ...o, audioLanguage: lang, subtitles, videoCodec: codec, maxHeight: q.height }, q);
}

export function presetFromOptions(o: DownloadOptions, name: string): Preset {
  return {
    id: `p-${Date.now().toString(36)}`,
    name,
    mode: o.mode,
    maxHeight: o.maxHeight,
    videoCodec: o.videoCodec,
    container: o.container,
    audioCodec: o.audioCodec,
    audioQuality: o.audioQuality,
    audioLanguage: o.audioLanguage ? (o.audioLanguage.split("-")[0] ?? "original") : "original",
    subtitles: o.subtitles,
    embedSubtitles: o.embedSubtitles,
    embedThumbnail: o.embedThumbnail,
    embedMetadata: o.embedMetadata,
    embedChapters: o.embedChapters,
  };
}
