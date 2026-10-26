import { useEffect, useMemo, useState } from "react";
import { browser } from "wxt/browser";
import { Check, ExternalLink, Loader2, Scissors } from "lucide-react";

import { bytes, clock } from "@youload/shared/format";
import { audioTracks, currentQuality, estimateSize, qualities } from "@youload/shared/formats";
import { jobError, useT } from "@youload/shared/i18n";
import { allPresets, presetSubtitle, presetTitle } from "@youload/shared/presets";
import type { MediaInfo } from "@youload/shared/types";

import { app, CallError, RELEASES_URL, type AppStatus, type Estimate } from "../lib/client";
import { initLang } from "../lib/lang";
import { buildOptions, presetSettings, type Choices } from "../lib/options";
import type { Target } from "../lib/target";

/** The player on the page, for "start/end here" (absent in the popup). */
export type PlayerTime = () => number | null;

type Phase = { kind: "loading" } | { kind: "ready" } | { kind: "error"; code: string; detail?: string } | { kind: "sent" };

const failure = (e: unknown): Phase => {
  if (e instanceof CallError) return { kind: "error", code: e.code, detail: e.detail };
  const text = e instanceof Error ? e.message : String(e);
  // After the extension is reloaded or updated, scripts already on open tabs lose it.
  if (/context invalidated/i.test(text) || !browser.runtime?.id) return { kind: "error", code: "ext_reloaded" };
  return { kind: "error", code: "app_unavailable", detail: text };
};

export function Menu({ target, playerTime, onDone }: { target: Target; playerTime?: PlayerTime; onDone?: () => void }) {
  const t = useT();
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [choices, setChoices] = useState<Choices>({ presetId: "", quality: null, onlyNew: true, section: null });
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [busy, setBusy] = useState(false);

  // Status and analysis, once per opened menu.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await app.status();
        if (!alive) return;
        initLang(s);
        setStatus(s);
        const { lastPreset } = (await browser.storage.local.get("lastPreset")) as { lastPreset?: string };
        const presetId = allPresets(presetSettings(s)).some((p) => p.id === lastPreset) ? lastPreset! : s.defaultPreset;
        setChoices((c) => ({ ...c, presetId }));
        const m = await app.probe(target.url);
        if (!alive) return;
        setMedia(m);
        setPhase({ kind: "ready" });
      } catch (e) {
        if (alive) setPhase(failure(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [target.url]);

  const options = useMemo(() => (media && choices.presetId ? buildOptions(media, status, choices, t) : null), [media, status, choices, t]);

  // Playlists: the app scans sizes in the background; ask again until every video is counted.
  useEffect(() => {
    if (!media || media.kind !== "playlist" || !options) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const e = await app.estimate(target.url, options);
        if (!alive) return;
        setEstimate(e);
        if (e.known < e.total) timer = setTimeout(poll, 2500);
      } catch {
        /* the size is a hint; keep the menu usable */
      }
    };
    const debounce = setTimeout(poll, 250);
    return () => {
      alive = false;
      clearTimeout(debounce);
      clearTimeout(timer);
    };
  }, [media, options, target.url]);

  const set = (patch: Partial<Choices>) => setChoices((c) => ({ ...c, ...patch }));

  const download = async () => {
    if (!options) return;
    setBusy(true);
    try {
      await app.enqueue(target.url, options);
      await browser.storage.local.set({ lastPreset: choices.presetId });
      setPhase({ kind: "sent" });
      setTimeout(() => onDone?.(), 1300);
    } catch (e) {
      setPhase(failure(e));
    } finally {
      setBusy(false);
    }
  };

  const openInApp = async () => {
    try {
      await app.open(target.url);
      onDone?.();
    } catch (e) {
      setPhase(failure(e));
    }
  };

  if (phase.kind === "sent") {
    return (
      <div className="yl-menu yl-center">
        <span className="yl-ok">
          <Check size={20} />
        </span>
        <b>{t("ext.added")}</b>
      </div>
    );
  }

  if (phase.kind === "error" && phase.code === "ext_reloaded") {
    return (
      <div className="yl-menu">
        <b className="yl-title">{t("ext.reloaded")}</b>
        <p className="yl-hint">{t("ext.reloadedHint")}</p>
        <button className="yl-btn yl-primary" onClick={() => location.reload()}>
          {t("ext.reloadPage")}
        </button>
      </div>
    );
  }

  if (phase.kind === "error") {
    const appProblem = phase.code === "host_missing" || phase.code === "app_unavailable";
    const err = jobError(t.lang, phase.code);
    return (
      <div className="yl-menu">
        <b className="yl-title">{phase.code === "host_missing" ? t("ext.hostMissing") : appProblem ? t("ext.appUnavailable") : err.title}</b>
        <p className="yl-hint">{phase.code === "host_missing" ? t("ext.hostMissingHint") : appProblem ? t("ext.appUnavailableHint") : err.hint}</p>
        {phase.detail ? <p className="yl-hint yl-detail">{phase.detail}</p> : null}
        {phase.code === "host_missing" && (
          <a className="yl-btn yl-primary" href={RELEASES_URL} target="_blank" rel="noreferrer">
            {t("ext.getApp")}
          </a>
        )}
      </div>
    );
  }

  if (phase.kind === "loading" || !media || !options) {
    return (
      <div className="yl-menu yl-center">
        <Loader2 size={18} className="yl-spin" />
        <span className="yl-hint">{t("ext.analyzing")}</span>
      </div>
    );
  }

  const presets = allPresets(presetSettings(status));
  const video = media.kind === "video";
  const list = video && options.mode === "video" ? qualities(media) : [];
  const currentKey = list.length ? currentQuality(media, options)?.key : undefined;
  const tracks = video ? audioTracks(media, t) : [];
  const fresh = media.entries.filter((e) => !e.downloaded).length;
  const size = video ? estimateSize(media, options) : estimate && estimate.bytes > 0 ? { bytes: estimate.bytes, approx: true } : null;
  const canClip = video && !!playerTime && !!media.duration;

  return (
    <div className="yl-menu">
      <div className="yl-head">
        <b className="yl-title" title={media.title}>
          {media.title}
        </b>
        <span className="yl-hint">{video ? [media.channel, media.duration ? clock(media.duration) : null].filter(Boolean).join(" · ") : t("playlist.videos", { n: media.entries.length })}</span>
      </div>

      <div className="yl-presets" role="radiogroup" aria-label={t("ext.preset")}>
        {presets.map((p) => (
          <button key={p.id} role="radio" aria-checked={choices.presetId === p.id} className={choices.presetId === p.id ? "on" : ""} onClick={() => set({ presetId: p.id, quality: null, audioLanguage: undefined })} title={presetSubtitle(p, t)}>
            {presetTitle(p, t)}
          </button>
        ))}
      </div>

      {list.length > 0 && (
        <label className="yl-row">
          <span>{t("ext.quality")}</span>
          <select value={choices.quality ?? currentKey ?? ""} onChange={(e) => set({ quality: e.target.value })}>
            {list.map((q) => (
              <option key={q.key} value={q.key}>
                {q.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {tracks.length > 1 && (
        <label className="yl-row">
          <span>{t("ext.audioTrack")}</span>
          <select value={options.audioLanguage ?? ""} onChange={(e) => set({ audioLanguage: e.target.value || null })}>
            {tracks.map((x) => (
              <option key={x.lang ?? ""} value={x.lang ?? ""}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {!video && fresh > 0 && fresh < media.entries.length && (
        <div className="yl-seg">
          <button className={!choices.onlyNew ? "on" : ""} onClick={() => set({ onlyNew: false })}>
            {t("ext.allVideos", { n: media.entries.length })}
          </button>
          <button className={choices.onlyNew ? "on" : ""} onClick={() => set({ onlyNew: true })}>
            {t("ext.onlyNew", { n: fresh })}
          </button>
        </div>
      )}

      {canClip && <Clip duration={media.duration!} section={choices.section} playerTime={playerTime!} onChange={(section) => set({ section })} />}

      <div className="yl-foot">
        <span className="yl-size">
          {size ? `≈ ${bytes(size.bytes, t)}` : ""}
          {!video && estimate && estimate.known < estimate.total ? <em> · {t("ext.sizeCounting", { n: estimate.known, total: estimate.total })}</em> : null}
        </span>
        <button className="yl-btn yl-primary" onClick={download} disabled={busy}>
          {busy ? <Loader2 size={15} className="yl-spin" /> : null}
          {video ? t("ext.download") : t("ext.downloadPlaylist")}
        </button>
      </div>
      <button className="yl-link" onClick={openInApp}>
        {t("ext.openInApp")} <ExternalLink size={12} />
      </button>
    </div>
  );
}

function Clip({ duration, section, playerTime, onChange }: { duration: number; section: Choices["section"]; playerTime: PlayerTime; onChange: (s: Choices["section"]) => void }) {
  const t = useT();
  const now = () => Math.max(0, Math.min(duration, Math.round(playerTime() ?? 0)));
  const on = !!section;
  return (
    <div className="yl-clip">
      <label className="yl-check">
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? { start: now(), end: duration } : null)} />
        <Scissors size={13} /> {t("ext.fragment")}
        {section && (
          <span className="yl-mono">
            {clock(section.start)} – {clock(section.end)}
          </span>
        )}
      </label>
      {on && section && (
        <div className="yl-clip-buttons">
          <button
            onClick={() => {
              const start = now();
              // Keep the end after the new start; if it was before, extend to the video's end.
              onChange({ start, end: section.end > start ? section.end : duration });
            }}
          >
            {t("ext.startHere")}
          </button>
          <button
            onClick={() => {
              const end = now();
              // An end before the start moves the start back to the beginning.
              onChange({ start: section.start < end ? section.start : 0, end: Math.max(end, 1) });
            }}
          >
            {t("ext.endHere")}
          </button>
        </div>
      )}
    </div>
  );
}
