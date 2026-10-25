import { useState } from "react";
import { AlertTriangle, Languages, Loader2, X } from "lucide-react";

import { api, errorText } from "../lib/api";
import { explainJob } from "../lib/errors";
import { bytes, clock, views } from "../lib/format";
import {
  CODEC_HINT,
  CODEC_LABEL,
  PLAYLIST_HEIGHTS,
  audioTracks,
  codecsFor,
  currentQuality,
  estimateSize,
  heightLabel,
  languageName,
  qualities,
  thumbnailOf,
} from "../lib/formats";
import type { AudioCodec, Container, DownloadOptions, Job, MediaInfo, VideoCodec } from "../lib/types";
import { useStore } from "../store";
import styles from "./Inspector.module.css";

const CONTAINERS: Container[] = ["mp4", "mkv", "webm"];
const AUDIO_CODECS: AudioCodec[] = ["mp3", "m4a", "opus", "flac", "wav"];
const BITRATES = [320, 256, 192, 128];
const CODECS: VideoCodec[] = ["av1", "vp9", "h264"];

export function Inspector({ job, onClose }: { job: Job; onClose: () => void }) {
  const draft = useStore((s) => s.drafts[job.id]);
  const updateDraft = useStore((s) => s.updateDraft);
  const start = useStore((s) => s.start);
  const setView = useStore((s) => s.setView);
  const toast = useStore((s) => s.toast);
  const [thumbFailed, setThumbFailed] = useState(false);

  const m = job.media;
  const locked = ["queued", "downloading", "processing"].includes(job.status);
  const thumb = thumbFailed ? null : thumbnailOf(m, true);

  return (
    <aside className={styles.panel} aria-label="Параметры загрузки">
      <button className={`icon-btn ${styles.close}`} onClick={onClose} aria-label="Закрыть панель">
        <X size={16} />
      </button>

      <div className={styles.scroll}>
        <div className={styles.cover}>
          {thumb ? <img src={thumb} alt="" onError={() => setThumbFailed(true)} /> : <div className={styles.coverEmpty} />}
        </div>
        <div className={styles.titleBlock}>
          <h2>{m?.title ?? "Анализ ссылки…"}</h2>
          {m && (
            <p>
              {[m.channel, m.kind === "playlist" ? `${m.entries.length} видео` : m.duration ? clock(m.duration) : null, views(m.viewCount)]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>

        {job.status === "analyzing" && (
          <div className={styles.loading}>
            <Loader2 size={16} /> Получаю список форматов…
          </div>
        )}

        {job.error && (
          <div className={styles.error}>
            <AlertTriangle size={16} />
            <div>
              <b>{explainJob(job.error.code).title}</b>
              <p>{explainJob(job.error.code).hint}</p>
              <details>
                <summary>Подробности</summary>
                <code>{job.error.detail}</code>
              </details>
              <div className={styles.errorActions}>
                <button className="btn" onClick={() => api.retryJob(job.id).catch((e) => toast(errorText(e), "error"))}>
                  Повторить
                </button>
                {explainJob(job.error.code).bypass && (
                  <button className="btn ghost" onClick={() => setView("bypass")}>
                    Обход блокировок
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {m && draft && (
          <fieldset className={styles.form} disabled={locked}>
            <Segmented
              value={draft.mode}
              options={[
                { value: "video", label: "Видео" },
                { value: "audio", label: "Только звук" },
              ]}
              onChange={(mode) => updateDraft(job.id, { mode })}
            />
            {draft.mode === "video" ? (
              m.kind === "playlist" ? (
                <PlaylistVideo o={draft} set={(p) => updateDraft(job.id, p)} />
              ) : (
                <VideoChoices media={m} o={draft} set={(p) => updateDraft(job.id, p)} />
              )
            ) : (
              <AudioChoices media={m} o={draft} set={(p) => updateDraft(job.id, p)} />
            )}
            {m.kind === "video" && m.subtitles.length > 0 && <Subtitles media={m} o={draft} set={(p) => updateDraft(job.id, p)} />}
            <Extras media={m} o={draft} set={(p) => updateDraft(job.id, p)} />
          </fieldset>
        )}
      </div>

      {m && draft && <Footer job={job} media={m} o={draft} onStart={() => start(job.id)} />}
    </aside>
  );
}

type SetFn = (patch: Partial<DownloadOptions>) => void;

function VideoChoices({ media, o, set }: { media: MediaInfo; o: DownloadOptions; set: SetFn }) {
  const list = qualities(media);
  const q = currentQuality(media, o);
  const codecs = q ? codecsFor(media, q) : new Set<VideoCodec>();
  const tracks = audioTracks(media);
  const ru = tracks.find((t) => t.lang?.startsWith("ru"));

  return (
    <>
      <Group label="Качество">
        <Chips
          options={list.map((x) => ({ value: x.key, label: x.label }))}
          value={q?.key ?? null}
          onChange={(key) => {
            const next = list.find((x) => x.key === key);
            if (!next) return;
            const available = codecsFor(media, next);
            const codec = o.videoCodec && available.has(o.videoCodec) ? o.videoCodec : available.has("av1") ? "av1" : available.has("vp9") ? "vp9" : "h264";
            // Ask resolve() for this exact quality via its height and a fresh pick.
            const f = media.formats.find((x) => x.height === next.height && (x.fps ?? 0) >= 48 === next.fps60 && x.hdr === next.hdr && x.kind !== "audio");
            set({ videoCodec: codec, maxHeight: next.height, videoFormat: f?.id ?? null });
          }}
        />
      </Group>
      <Group label="Кодек" hint={o.videoCodec ? CODEC_HINT[o.videoCodec] : undefined}>
        <Chips
          options={CODECS.map((c) => ({
            value: c,
            label: CODEC_LABEL[c],
            disabled: !codecs.has(c) || (c === "h264" && o.container === "webm"),
          }))}
          value={o.videoCodec}
          onChange={(videoCodec) => {
            const f = media.formats.find((x) => q && x.height === q.height && x.hdr === q.hdr && (x.fps ?? 0) >= 48 === q.fps60 && x.vcodec?.startsWith(videoCodec === "av1" ? "av01" : videoCodec === "vp9" ? "vp" : "avc1"));
            set({ videoCodec, videoFormat: f?.id ?? o.videoFormat });
          }}
        />
      </Group>
      <AudioTrackSelect tracks={tracks} o={o} set={set} />
      {ru && o.audioLanguage !== ru.lang && (
        <button className={styles.suggest} type="button" onClick={() => set({ audioLanguage: ru.lang })}>
          <Languages size={14} /> Есть русская дорожка, переключить
        </button>
      )}
      <Group label="Контейнер" hint={o.container === "mp4" ? "MP4 открывается на любом устройстве" : o.container === "mkv" ? "MKV хранит любые кодеки и субтитры" : "WebM для браузеров, без H.264"}>
        <Chips options={CONTAINERS.map((c) => ({ value: c, label: c.toUpperCase() }))} value={o.container} onChange={(container) => set({ container })} />
      </Group>
    </>
  );
}

function PlaylistVideo({ o, set }: { o: DownloadOptions; set: SetFn }) {
  return (
    <>
      <Group label="Качество, не выше">
        <Chips
          options={PLAYLIST_HEIGHTS.map((h) => ({ value: String(h), label: heightLabel(h) }))}
          value={String(o.maxHeight ?? 1080)}
          onChange={(h) => set({ maxHeight: Number(h) })}
        />
      </Group>
      <Group label="Кодек" hint={o.videoCodec ? CODEC_HINT[o.videoCodec] : "Лучший доступный для каждого ролика"}>
        <Chips
          options={[{ value: "auto", label: "Авто" }, ...CODECS.map((c) => ({ value: c, label: CODEC_LABEL[c], disabled: c === "h264" && o.container === "webm" }))]}
          value={o.videoCodec ?? "auto"}
          onChange={(c) => set({ videoCodec: c === "auto" ? null : (c as VideoCodec) })}
        />
      </Group>
      <PlaylistLanguage o={o} set={set} />
      <Group label="Контейнер">
        <Chips options={CONTAINERS.map((c) => ({ value: c, label: c.toUpperCase() }))} value={o.container} onChange={(container) => set({ container })} />
      </Group>
    </>
  );
}

function PlaylistLanguage({ o, set }: { o: DownloadOptions; set: SetFn }) {
  return (
    <Group label="Звуковая дорожка">
      <select className={`field ${styles.select}`} value={o.audioLanguage ?? ""} onChange={(e) => set({ audioLanguage: e.target.value || null })}>
        <option value="">Оригинал</option>
        <option value="ru">Русский, если есть</option>
        <option value="en">Английский, если есть</option>
      </select>
    </Group>
  );
}

function AudioTrackSelect({ tracks, o, set }: { tracks: ReturnType<typeof audioTracks>; o: DownloadOptions; set: SetFn }) {
  return (
    <Group label="Звуковая дорожка">
      {tracks.length > 1 ? (
        <select className={`field ${styles.select}`} value={o.audioLanguage ?? ""} onChange={(e) => set({ audioLanguage: e.target.value || null })}>
          {tracks.map((t) => (
            <option key={t.lang ?? ""} value={t.lang ?? ""}>
              {t.label}
            </option>
          ))}
        </select>
      ) : (
        <span className={styles.static}>Одна дорожка</span>
      )}
    </Group>
  );
}

function AudioChoices({ media, o, set }: { media: MediaInfo; o: DownloadOptions; set: SetFn }) {
  const lossy = o.audioCodec === "mp3" || o.audioCodec === "m4a" || o.audioCodec === "opus";
  const hint: Record<AudioCodec, string> = {
    mp3: "Играет везде",
    m4a: "AAC, без перекодирования, если есть исходник",
    opus: "Лучшее качество на килобит, исходный формат YouTube",
    flac: "Без потерь от исходника, большой файл",
    wav: "Без сжатия, для монтажа",
  };
  return (
    <>
      <Group label="Формат" hint={hint[o.audioCodec]}>
        <Chips options={AUDIO_CODECS.map((c) => ({ value: c, label: c.toUpperCase() }))} value={o.audioCodec} onChange={(audioCodec) => set({ audioCodec })} />
      </Group>
      {lossy && (
        <Group label="Битрейт, кбит/с">
          <Chips
            options={[{ value: "best", label: "Лучший" }, ...BITRATES.map((b) => ({ value: String(b), label: String(b) }))]}
            value={o.audioQuality ? String(o.audioQuality) : "best"}
            onChange={(v) => set({ audioQuality: v === "best" ? null : Number(v) })}
          />
        </Group>
      )}
      {media.kind === "playlist" ? <PlaylistLanguage o={o} set={set} /> : <AudioTrackSelect tracks={audioTracks(media)} o={o} set={set} />}
    </>
  );
}

function Subtitles({ media, o, set }: { media: MediaInfo; o: DownloadOptions; set: SetFn }) {
  const tracks = [...media.subtitles.filter((s) => !s.auto), ...media.subtitles.filter((s) => s.auto && s.code.endsWith("-orig"))].slice(0, 12);
  const extraAuto = media.subtitles.filter((s) => s.auto && !s.code.endsWith("-orig") && !tracks.some((t) => t.code === s.code)).slice(0, 4);
  const all = [...tracks, ...extraAuto];
  const toggle = (code: string) =>
    set({ subtitles: o.subtitles.includes(code) ? o.subtitles.filter((c) => c !== code) : [...o.subtitles, code] });
  return (
    <Group label="Субтитры">
      <div className={styles.chips}>
        {all.map((s) => (
          <button
            type="button"
            key={`${s.code}-${s.auto}`}
            className={`${styles.chip} ${o.subtitles.includes(s.code) ? styles.on : ""}`}
            onClick={() => toggle(s.code)}
            title={s.name}
          >
            {languageName(s.code.replace(/-orig$/, ""))}
            {s.auto ? <em> авто</em> : null}
          </button>
        ))}
      </div>
      {o.mode === "video" && o.subtitles.length > 0 && (
        <label className={styles.check}>
          <input type="checkbox" checked={o.embedSubtitles} onChange={(e) => set({ embedSubtitles: e.target.checked })} />
          Вшить в видео (иначе отдельный файл .srt)
        </label>
      )}
    </Group>
  );
}

function Extras({ media, o, set }: { media: MediaInfo; o: DownloadOptions; set: SetFn }) {
  return (
    <Group label="Дополнительно">
      <label className={styles.check}>
        <input type="checkbox" checked={o.embedThumbnail} onChange={(e) => set({ embedThumbnail: e.target.checked })} />
        Обложка в файле
      </label>
      <label className={styles.check}>
        <input type="checkbox" checked={o.embedMetadata} onChange={(e) => set({ embedMetadata: e.target.checked })} />
        Название, автор и описание в тегах
      </label>
      {(media.chapters > 0 || media.kind === "playlist") && (
        <label className={styles.check}>
          <input type="checkbox" checked={o.embedChapters} onChange={(e) => set({ embedChapters: e.target.checked })} />
          Главы{media.chapters > 0 ? ` (${media.chapters})` : ""}
        </label>
      )}
    </Group>
  );
}

function Footer({ job, media, o, onStart }: { job: Job; media: MediaInfo; o: DownloadOptions; onStart: () => void }) {
  const est = estimateSize(media, o);
  const active = ["queued", "downloading", "processing"].includes(job.status);
  const label = job.status === "done" ? "Скачать снова" : job.status === "error" || job.status === "canceled" ? "Скачать" : "Скачать";
  return (
    <div className={styles.footer}>
      <div className={styles.size}>
        <span>{media.kind === "playlist" ? "Плейлист" : "Размер"}</span>
        <b className="mono">
          {media.kind === "playlist" ? `${media.entries.length} видео` : est ? `${est.approx ? "≈ " : ""}${bytes(est.bytes)}` : "неизвестен"}
        </b>
      </div>
      {active ? (
        <button className="btn lg" onClick={() => api.cancelJob(job.id)}>
          Отменить
        </button>
      ) : (
        <button className="btn primary lg" onClick={onStart} disabled={job.status === "analyzing"}>
          {label}
        </button>
      )}
    </div>
  );
}

function Group({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className={styles.group}>
      <div className="label">{label}</div>
      {children}
      {hint && <div className={styles.hint}>{hint}</div>}
    </div>
  );
}

function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; disabled?: boolean }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div className={styles.chips} role="radiogroup">
      {options.map((opt) => (
        <button
          type="button"
          key={opt.value}
          role="radio"
          aria-checked={value === opt.value}
          disabled={opt.disabled}
          className={`${styles.chip} mono ${value === opt.value ? styles.on : ""}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className={styles.segmented} role="tablist">
      {options.map((opt) => (
        <button type="button" role="tab" key={opt.value} aria-selected={value === opt.value} className={value === opt.value ? styles.segOn : ""} onClick={() => onChange(opt.value)}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}
