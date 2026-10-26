import { useState } from "react";
import { AlertTriangle, Languages, Loader2, Plus, SlidersHorizontal, X } from "lucide-react";

import { api } from "../lib/api";
import { bytes, clock, views } from "@youload/shared/format";
import {
  CODEC_LABEL,
  PLAYLIST_HEIGHTS,
  audioTracks,
  bestCodec,
  codecsFor,
  currentQuality,
  estimatePlaylist,
  estimateSize,
  heightLabel,
  languageName,
  pickVideo,
  qualities,
  thumbnailOf,
} from "@youload/shared/formats";
import { errorText, jobError, useT, type Key } from "@youload/shared/i18n";
import { allPresets, presetFromOptions, presetSubtitle, presetTitle } from "@youload/shared/presets";
import type { AudioCodec, ChannelTab, Container, DownloadOptions, Job, MediaInfo, VideoCodec } from "@youload/shared/types";
import { useStore } from "../store";
import { FormatsTable } from "./FormatsTable";
import styles from "./Inspector.module.css";
import { Check, Chips, Group, Segmented } from "./inspector/Controls";
import { Fragment } from "./inspector/Fragment";
import { PlaylistPicker } from "./inspector/PlaylistPicker";

const CONTAINERS: Container[] = ["mp4", "mkv", "webm"];
const AUDIO_CODECS: AudioCodec[] = ["mp3", "m4a", "opus", "flac", "wav"];
const BITRATES = [320, 256, 192, 128];
const CODECS: VideoCodec[] = ["av1", "vp9", "h264"];
const CODEC_HINT: Record<VideoCodec, Key> = { av1: "inspector.codecAv1", vp9: "inspector.codecVp9", h264: "inspector.codecH264" };
const CONTAINER_HINT: Record<Container, Key> = { mp4: "inspector.containerMp4", mkv: "inspector.containerMkv", webm: "inspector.containerWebm" };
const AUDIO_HINT: Record<AudioCodec, Key> = { mp3: "inspector.audioMp3", m4a: "inspector.audioM4a", opus: "inspector.audioOpus", flac: "inspector.audioFlac", wav: "inspector.audioWav" };
const TABS: { value: ChannelTab; label: Key }[] = [
  { value: "videos", label: "playlist.tabVideos" },
  { value: "shorts", label: "playlist.tabShorts" },
  { value: "streams", label: "playlist.tabStreams" },
];
const BYPASS_CODES = ["network", "timeout", "bot_check"];

type SetFn = (patch: Partial<DownloadOptions>) => void;

export function Inspector({ job, onClose }: { job: Job; onClose: () => void }) {
  const t = useT();
  const draft = useStore((s) => s.drafts[job.id]);
  const updateDraft = useStore((s) => s.updateDraft);
  const setView = useStore((s) => s.setView);
  const toast = useStore((s) => s.toast);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [showFormats, setShowFormats] = useState(false);

  const m = job.media;
  const locked = ["queued", "downloading", "processing", "paused"].includes(job.status);
  const thumb = thumbFailed ? null : thumbnailOf(m, true);
  const set: SetFn = (p) => updateDraft(job.id, p);
  const o = locked ? job.options ?? draft : draft;
  const err = job.error ? jobError(t.lang, job.error.code) : null;

  return (
    <aside className={styles.panel} aria-label={t("inspector.preset")}>
      <button className={`icon-btn ${styles.close}`} onClick={onClose} aria-label={t("inspector.closePanel")}>
        <X size={16} />
      </button>

      <div className={styles.scroll}>
        <div className={styles.cover}>{thumb ? <img src={thumb} alt="" onError={() => setThumbFailed(true)} /> : <div className={styles.coverEmpty} />}</div>
        <div className={styles.titleBlock}>
          <h2>{m?.title || t("inspector.analyzing")}</h2>
          {m && (
            <p>
              {[m.channel, m.kind === "playlist" ? t("playlist.videos", { n: m.entries.length }) : m.duration ? clock(m.duration) : null, views(m.viewCount, t)]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>

        {job.status === "analyzing" && (
          <div className={styles.loading}>
            <Loader2 size={16} className="spin" /> {t("inspector.loadingFormats")}
          </div>
        )}

        {job.error && err && (
          <div className={styles.error}>
            <AlertTriangle size={16} />
            <div>
              <b>{err.title}</b>
              <p>{err.hint}</p>
              <details>
                <summary>{t("inspector.details")}</summary>
                <code>{job.error.detail}</code>
              </details>
              <div className={styles.errorActions}>
                {job.error.code !== "tab_empty" && (
                  <button className="btn" onClick={() => api.retryJob(job.id).catch((e) => toast(errorText(e), "error"))}>
                    {t("common.retry")}
                  </button>
                )}
                {BYPASS_CODES.includes(job.error.code) && (
                  <button className="btn ghost" onClick={() => setView("bypass")}>
                    {t("inspector.openBypass")}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {m?.channelTab && (
          <fieldset className={styles.form} disabled={locked || job.status === "analyzing"}>
            <Segmented
              value={m.channelTab}
              options={TABS.map((x) => ({ value: x.value, label: t(x.label) }))}
              onChange={(tab) => tab !== m.channelTab && api.switchChannelTab(job.id, tab).catch((e) => toast(errorText(e), "error"))}
            />
          </fieldset>
        )}

        {m && o && (
          <fieldset className={styles.form} disabled={locked}>
            <Presets jobId={job.id} o={o} />
            <Segmented
              value={o.mode}
              options={[
                { value: "video", label: t("inspector.modeVideo") },
                { value: "audio", label: t("inspector.modeAudio") },
              ]}
              onChange={(mode) => set({ mode })}
            />
            {o.mode === "video" ? (
              m.kind === "playlist" ? (
                <PlaylistVideo o={o} set={set} />
              ) : (
                <VideoChoices media={m} o={o} set={set} onAllFormats={() => setShowFormats(true)} />
              )
            ) : (
              <AudioChoices media={m} o={o} set={set} />
            )}
            {m.kind === "playlist" && (
              <Group label={t("playlist.videos", { n: m.entries.length })}>
                <PlaylistPicker media={m} o={o} set={set} />
              </Group>
            )}
            {m.kind === "video" && m.duration ? <Fragment media={m} o={o} set={set} /> : null}
            {m.kind === "video" && m.subtitles.length > 0 && <Subtitles media={m} o={o} set={set} />}
            <Extras media={m} o={o} set={set} />
          </fieldset>
        )}
      </div>

      {m && o && <Footer job={job} media={m} o={o} />}
      {showFormats && m && o && <FormatsTable media={m} o={o} onApply={set} onClose={() => setShowFormats(false)} />}
    </aside>
  );
}

function Presets({ jobId, o }: { jobId: string; o: DownloadOptions }) {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const applyPresetTo = useStore((s) => s.applyPresetTo);
  const saveSettings = useStore((s) => s.saveSettings);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const presets = allPresets(settings);

  const save = async () => {
    const n = name.trim();
    if (!n || !settings) return;
    const preset = presetFromOptions(o, n);
    if (await saveSettings({ presets: [...settings.presets, preset] })) {
      applyPresetTo([jobId], preset.id);
      setNaming(false);
      setName("");
    }
  };

  return (
    <Group
      label={t("inspector.preset")}
      aside={
        !naming && (
          <button type="button" className={`icon-btn ${styles.tiny}`} title={t("inspector.savePreset")} onClick={() => setNaming(true)}>
            <Plus size={14} />
          </button>
        )
      }
    >
      <div className={styles.presets}>
        {presets.map((p) => (
          <div key={p.id} className={`${styles.preset} ${o.preset === p.id ? styles.on : ""}`}>
            <button type="button" onClick={() => applyPresetTo([jobId], p.id)} title={presetSubtitle(p, t)}>
              <b>{presetTitle(p, t)}</b>
              <span>{presetSubtitle(p, t)}</span>
            </button>
            {!p.builtin && settings && (
              <button
                type="button"
                className={styles.presetDelete}
                aria-label={t("inspector.deletePreset")}
                onClick={() => saveSettings({ presets: settings.presets.filter((x) => x.id !== p.id), defaultPreset: settings.defaultPreset === p.id ? "standard" : settings.defaultPreset })}
              >
                <X size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
      {naming && (
        <form
          className={styles.presetForm}
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input id="preset-name" className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("inspector.presetName")} maxLength={40} />
          <button type="submit" className="btn primary" disabled={!name.trim()}>
            {t("common.save")}
          </button>
          <button type="button" className="icon-btn" onClick={() => setNaming(false)} aria-label={t("common.cancel")}>
            <X size={14} />
          </button>
        </form>
      )}
    </Group>
  );
}

function VideoChoices({ media, o, set, onAllFormats }: { media: MediaInfo; o: DownloadOptions; set: SetFn; onAllFormats: () => void }) {
  const t = useT();
  const list = qualities(media);
  const q = currentQuality(media, o);
  const codecs = q ? codecsFor(media, q) : new Set<VideoCodec>();
  const tracks = audioTracks(media, t);
  const ru = tracks.find((x) => x.lang?.startsWith("ru"));

  return (
    <>
      <Group
        label={t("inspector.quality")}
        hint={o.manualFormats ? t("inspector.manual") : undefined}
        aside={
          <button type="button" className={`btn ghost ${styles.linkBtn}`} onClick={onAllFormats}>
            <SlidersHorizontal size={13} /> {t("inspector.allFormats")}
          </button>
        }
      >
        <Chips
          options={list.map((x) => ({ value: x.key, label: x.label }))}
          value={q?.key ?? null}
          onChange={(key) => {
            const next = list.find((x) => x.key === key);
            if (!next) return;
            const available = codecsFor(media, next);
            const codec = o.videoCodec && available.has(o.videoCodec) ? o.videoCodec : bestCodec(available, o.container);
            set({ videoCodec: codec, maxHeight: next.height, videoFormat: pickVideo(media, next, codec)?.id ?? null });
          }}
        />
      </Group>
      <Group label={t("inspector.codec")} hint={o.videoCodec ? t(CODEC_HINT[o.videoCodec]) : undefined}>
        <Chips
          options={CODECS.map((c) => ({ value: c, label: CODEC_LABEL[c], disabled: !codecs.has(c) || (c === "h264" && o.container === "webm") }))}
          value={o.videoCodec}
          onChange={(videoCodec) => set({ videoCodec, videoFormat: (q && pickVideo(media, q, videoCodec)?.id) ?? o.videoFormat })}
        />
      </Group>
      <AudioTrackSelect tracks={tracks} o={o} set={set} />
      {ru && o.audioLanguage !== ru.lang && (
        <button className={styles.suggest} type="button" onClick={() => set({ audioLanguage: ru.lang })}>
          <Languages size={14} /> {t("inspector.suggestRu")}
        </button>
      )}
      <Group label={t("inspector.container")} hint={t(CONTAINER_HINT[o.container])}>
        <Chips options={CONTAINERS.map((c) => ({ value: c, label: c.toUpperCase() }))} value={o.container} onChange={(container) => set({ container })} />
      </Group>
    </>
  );
}

function PlaylistVideo({ o, set }: { o: DownloadOptions; set: SetFn }) {
  const t = useT();
  return (
    <>
      <Group label={t("inspector.qualityMax")}>
        <Chips
          options={[...PLAYLIST_HEIGHTS.map((h) => ({ value: String(h), label: heightLabel(h) })), { value: "best", label: t("inspector.best") }]}
          value={o.maxHeight ? String(o.maxHeight) : "best"}
          onChange={(h) => set({ maxHeight: h === "best" ? null : Number(h) })}
        />
      </Group>
      <Group label={t("inspector.codec")} hint={o.videoCodec ? t(CODEC_HINT[o.videoCodec]) : t("inspector.codecAutoHint")}>
        <Chips
          options={[{ value: "auto", label: t("inspector.codecAuto") }, ...CODECS.map((c) => ({ value: c, label: CODEC_LABEL[c], disabled: c === "h264" && o.container === "webm" }))]}
          value={o.videoCodec ?? "auto"}
          onChange={(c) => set({ videoCodec: c === "auto" ? null : (c as VideoCodec) })}
        />
      </Group>
      <PlaylistLanguage o={o} set={set} />
      <Group label={t("inspector.container")} hint={t(CONTAINER_HINT[o.container])}>
        <Chips options={CONTAINERS.map((c) => ({ value: c, label: c.toUpperCase() }))} value={o.container} onChange={(container) => set({ container })} />
      </Group>
    </>
  );
}

function PlaylistLanguage({ o, set }: { o: DownloadOptions; set: SetFn }) {
  const t = useT();
  return (
    <Group label={t("inspector.audioTrack")}>
      <select id="playlist-lang" className="field" value={o.audioLanguage ?? ""} onChange={(e) => set({ audioLanguage: e.target.value || null })}>
        <option value="">{t("inspector.langOriginal")}</option>
        <option value="ru">{t("inspector.langRuIfAny")}</option>
        <option value="en">{t("inspector.langEnIfAny")}</option>
      </select>
    </Group>
  );
}

function AudioTrackSelect({ tracks, o, set }: { tracks: ReturnType<typeof audioTracks>; o: DownloadOptions; set: SetFn }) {
  const t = useT();
  return (
    <Group label={t("inspector.audioTrack")}>
      {tracks.length > 1 ? (
        <select id="audio-track" className="field" value={o.audioLanguage ?? ""} onChange={(e) => set({ audioLanguage: e.target.value || null })}>
          {tracks.map((x) => (
            <option key={x.lang ?? ""} value={x.lang ?? ""}>
              {x.label}
            </option>
          ))}
        </select>
      ) : (
        <span className={styles.static}>{t("inspector.oneTrack")}</span>
      )}
    </Group>
  );
}

function AudioChoices({ media, o, set }: { media: MediaInfo; o: DownloadOptions; set: SetFn }) {
  const t = useT();
  const lossy = o.audioCodec === "mp3" || o.audioCodec === "m4a" || o.audioCodec === "opus";
  return (
    <>
      <Group label={t("inspector.format")} hint={t(AUDIO_HINT[o.audioCodec])}>
        <Chips options={AUDIO_CODECS.map((c) => ({ value: c, label: c.toUpperCase() }))} value={o.audioCodec} onChange={(audioCodec) => set({ audioCodec })} />
      </Group>
      {lossy && (
        <Group label={t("inspector.bitrate")}>
          <Chips
            options={[{ value: "best", label: t("inspector.best") }, ...BITRATES.map((b) => ({ value: String(b), label: String(b) }))]}
            value={o.audioQuality ? String(o.audioQuality) : "best"}
            onChange={(v) => set({ audioQuality: v === "best" ? null : Number(v) })}
          />
        </Group>
      )}
      {media.kind === "playlist" ? <PlaylistLanguage o={o} set={set} /> : <AudioTrackSelect tracks={audioTracks(media, t)} o={o} set={set} />}
    </>
  );
}

function Subtitles({ media, o, set }: { media: MediaInfo; o: DownloadOptions; set: SetFn }) {
  const t = useT();
  const manual = media.subtitles.filter((s) => !s.auto);
  const orig = media.subtitles.filter((s) => s.auto && s.code.endsWith("-orig"));
  const extra = media.subtitles.filter((s) => s.auto && !s.code.endsWith("-orig") && !manual.some((m) => m.code === s.code));
  const all = [...manual, ...orig, ...extra].slice(0, 16);
  const toggle = (code: string) => set({ subtitles: o.subtitles.includes(code) ? o.subtitles.filter((c) => c !== code) : [...o.subtitles, code] });
  return (
    <Group label={t("inspector.subtitles")}>
      <div className={styles.chips}>
        {all.map((s) => (
          <button type="button" key={`${s.code}-${s.auto}`} className={`${styles.chip} ${o.subtitles.includes(s.code) ? styles.on : ""}`} onClick={() => toggle(s.code)} title={s.name}>
            {languageName(s.code.replace(/-orig$/, ""), t)}
            {s.auto ? <em> {t("inspector.autoSub")}</em> : null}
          </button>
        ))}
      </div>
      {o.mode === "video" && o.subtitles.length > 0 && (
        <Check checked={o.embedSubtitles} onChange={(embedSubtitles) => set({ embedSubtitles })}>
          {t("inspector.embedSubs")}
        </Check>
      )}
    </Group>
  );
}

function Extras({ media, o, set }: { media: MediaInfo; o: DownloadOptions; set: SetFn }) {
  const t = useT();
  return (
    <Group label={t("inspector.extras")}>
      <Check checked={o.embedThumbnail} onChange={(embedThumbnail) => set({ embedThumbnail })}>
        {t("inspector.embedThumb")}
      </Check>
      <Check checked={o.embedMetadata} onChange={(embedMetadata) => set({ embedMetadata })}>
        {t("inspector.embedMeta")}
      </Check>
      {(media.chapters > 0 || media.kind === "playlist") && o.sectionStart == null && (
        <Check checked={o.embedChapters} onChange={(embedChapters) => set({ embedChapters })}>
          {t("inspector.chapters")}
          {media.chapters > 0 ? ` (${media.chapters})` : ""}
        </Check>
      )}
    </Group>
  );
}

function Footer({ job, media, o }: { job: Job; media: MediaInfo; o: DownloadOptions }) {
  const t = useT();
  const start = useStore((s) => s.start);
  const toast = useStore((s) => s.toast);
  const fail = (e: unknown) => toast(errorText(e), "error");
  const est = estimateSize(media, o);
  const running = ["queued", "downloading", "processing"].includes(job.status);
  const nothing = media.kind === "playlist" && o.playlistItems?.length === 0;
  const count = media.kind === "playlist" ? o.playlistItems?.length ?? media.entries.length : 0;
  // Playlists: an estimate before the download, then what is downloaded, then the final size.
  const got = job.status === "done" ? job.size : job.progress.downloaded || null;
  const plan = media.kind === "playlist" ? estimatePlaylist(media, o) : null;
  const playlistSize = got ? ` · ${bytes(got, t)}` : plan && plan.bytes > 0 ? ` · ≈ ${bytes(plan.bytes, t)}` : "";
  const counting = !got && plan && plan.known < plan.total;

  return (
    <div className={styles.footer}>
      <div className={styles.size}>
        <span>
          {media.kind !== "playlist"
            ? t("inspector.size")
            : counting
              ? t("playlist.sizing", { n: plan!.known, total: plan!.total })
              : t("inspector.playlist")}
        </span>
        <b className="mono">
          {media.kind === "playlist"
            ? nothing
              ? t("playlist.nothingSelected")
              : `${t("playlist.videos", { n: count })}${playlistSize}`
            : est
              ? `${est.approx ? "≈ " : ""}${bytes(est.bytes, t)}`
              : t("inspector.sizeUnknown")}
        </b>
      </div>
      <div className={styles.footerButtons}>
        {running && (
          <>
            <button className="btn" onClick={() => api.pauseJob(job.id)}>
              {t("common.pause")}
            </button>
            <button className="btn ghost" onClick={() => api.cancelJob(job.id)}>
              {t("common.cancel")}
            </button>
          </>
        )}
        {job.status === "paused" && (
          <>
            <button className="btn primary lg" onClick={() => api.resumeJob(job.id).catch(fail)}>
              {t("common.resume")}
            </button>
            <button className="btn ghost" onClick={() => api.cancelJob(job.id)}>
              {t("common.cancel")}
            </button>
          </>
        )}
        {!running && job.status !== "paused" && (
          <button className="btn primary lg" onClick={() => start(job.id)} disabled={job.status === "analyzing" || nothing}>
            {job.status === "done" ? t("common.downloadAgain") : t("common.download")}
          </button>
        )}
      </div>
    </div>
  );
}
