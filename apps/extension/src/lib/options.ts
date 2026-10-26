// Turns the menu's choices into the DownloadOptions the app expects, with the same
// preset and format logic as the app itself (packages/shared).

import { bestCodec, codecsFor, pickVideo, qualities, resolve } from "@youload/shared/formats";
import type { T } from "@youload/shared/i18n";
import { applyPreset, findPreset } from "@youload/shared/presets";
import type { DownloadOptions, MediaInfo, Settings } from "@youload/shared/types";

import type { AppStatus } from "./client";

export interface Choices {
  presetId: string;
  /** Quality key from qualities(); null = what the preset picks. */
  quality: string | null;
  /** Audio track language; undefined = what the preset picks. */
  audioLanguage?: string | null;
  onlyNew: boolean;
  section: { start: number; end: number } | null;
}

/** findPreset() wants Settings; the app status carries the two fields it reads. */
export function presetSettings(status: AppStatus | null): Settings | null {
  return status ? ({ presets: status.presets, defaultPreset: status.defaultPreset } as unknown as Settings) : null;
}

export function buildOptions(media: MediaInfo, status: AppStatus | null, c: Choices, t: T): DownloadOptions {
  const preset = findPreset(presetSettings(status), c.presetId);
  const fresh = media.entries.filter((e) => !e.downloaded).map((e) => e.index);
  let o = applyPreset(media, preset, t, {
    playlistItems: media.kind === "playlist" && c.onlyNew && fresh.length < media.entries.length ? fresh : null,
    sectionStart: c.section?.start ?? null,
    sectionEnd: c.section?.end ?? null,
  });
  if (media.kind === "video" && o.mode === "video" && c.quality) {
    const q = qualities(media).find((x) => x.key === c.quality);
    if (q) {
      const available = codecsFor(media, q);
      const codec = o.videoCodec && available.has(o.videoCodec) ? o.videoCodec : bestCodec(available, o.container);
      o = resolve(media, { ...o, videoCodec: codec, maxHeight: q.height, videoFormat: pickVideo(media, q, codec)?.id ?? null });
    }
  }
  if (media.kind === "video" && c.audioLanguage !== undefined) {
    o = resolve(media, { ...o, audioLanguage: c.audioLanguage });
  }
  if (c.section) o = { ...o, embedChapters: false };
  return o;
}
