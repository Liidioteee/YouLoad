import { useState } from "react";
import { FolderOpen, Loader2, Pause, Play, RotateCcw, Trash2, X } from "lucide-react";

import { api } from "../lib/api";
import { bytes, clock, percent, speed } from "../lib/format";
import { describe, thumbnailOf } from "../lib/formats";
import { errorText, jobError, useT, type Key } from "../lib/i18n";
import type { Job } from "../lib/types";
import { useStore } from "../store";
import styles from "./JobRow.module.css";

const STAGE: Record<string, Key> = {
  merging: "row.stageMerging",
  converting: "row.stageConverting",
  finishing: "row.stageFinishing",
};
const TAB: Record<string, Key> = { videos: "playlist.tabVideos", shorts: "playlist.tabShorts", streams: "playlist.tabStreams" };

export function JobRow({ job, selected, onSelect }: { job: Job; selected: boolean; onSelect: (e: React.MouseEvent | React.KeyboardEvent) => void }) {
  const t = useT();
  const draft = useStore((s) => s.drafts[job.id]);
  const start = useStore((s) => s.start);
  const toast = useStore((s) => s.toast);
  const [thumbFailed, setThumbFailed] = useState(false);

  const m = job.media;
  const p = job.progress;
  const running = job.status === "downloading" || job.status === "processing";
  const thumb = thumbFailed ? null : thumbnailOf(m);
  const tags = describe(m, job.status === "ready" ? draft ?? null : job.options ?? draft ?? null, t);
  const fail = (e: unknown) => toast(errorText(e), "error");
  const videos = (n: number) => t("playlist.videos", { n });

  let meta: React.ReactNode;
  if (job.status === "analyzing") meta = t("row.analyzing");
  else if (job.status === "error" && job.error) meta = <span className={styles.errText}>{jobError(t.lang, job.error.code).title}</span>;
  else if (m?.channelTab) meta = t("row.channelMeta", { tab: t(TAB[m.channelTab]), n: videos(m.entries.length) });
  else if (m?.kind === "playlist") meta = [t("row.playlistMeta", { n: videos(m.entries.length) }), m.channel].filter(Boolean).join(" · ");
  else meta = [m?.channel, m?.duration ? clock(m.duration) : null].filter(Boolean).join(" · ");

  const showBar = running || job.status === "queued" || ((job.status === "canceled" || job.status === "paused") && (p.fraction ?? 0) > 0);

  return (
    <div
      className={`${styles.row} ${selected ? styles.sel : ""}`}
      onClick={onSelect}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(e);
        }
        if (e.key === "Delete" && !running) api.removeJob(job.id);
      }}
    >
      <div className={styles.thumb}>
        {thumb ? <img src={thumb} alt="" loading="lazy" onError={() => setThumbFailed(true)} /> : <div className={styles.thumbEmpty} />}
        {m?.kind === "video" && m.duration ? <span className={`${styles.dur} mono`}>{clock(m.duration)}</span> : null}
        {m?.kind === "playlist" ? <span className={`${styles.dur} mono`}>{m.entries.length}</span> : null}
      </div>

      <div className={styles.info}>
        <div className={styles.title}>{m?.title || job.url}</div>
        <div className={styles.meta}>{meta}</div>
        {tags.length > 0 && job.status !== "analyzing" && (
          <div className={styles.chips}>
            {tags.map((x) => (
              <span key={x} className={`${styles.chip} mono`}>
                {x}
              </span>
            ))}
          </div>
        )}
        {showBar && (
          <div className={styles.bar}>
            <i
              className={job.status === "processing" ? styles.barPulse : job.status === "canceled" || job.status === "paused" ? styles.barDim : ""}
              style={{ width: `${Math.max(2, (p.fraction ?? 0) * 100)}%` }}
            />
          </div>
        )}
      </div>

      <div className={styles.status}>
        <Status job={job} />
      </div>

      <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
        {job.status === "ready" && draft && (
          <button className="btn primary" onClick={() => start(job.id)}>
            {t("common.download")}
          </button>
        )}
        {job.status === "done" && job.outputs.length > 0 && (
          <>
            <button className="icon-btn" title={t("common.open")} onClick={() => api.openOutput(job.id, false).catch(fail)}>
              <Play size={15} />
            </button>
            <button className="icon-btn" title={t("common.reveal")} onClick={() => api.openOutput(job.id, true).catch(fail)}>
              <FolderOpen size={15} />
            </button>
          </>
        )}
        {(running || job.status === "queued") && (
          <button className="icon-btn" title={t("common.pause")} onClick={() => api.pauseJob(job.id)}>
            <Pause size={15} />
          </button>
        )}
        {job.status === "paused" && (
          <button className="icon-btn" title={t("common.resume")} onClick={() => api.resumeJob(job.id).catch(fail)}>
            <Play size={15} />
          </button>
        )}
        {(job.status === "error" || job.status === "canceled") && (
          <button className="icon-btn" title={t("common.retry")} onClick={() => api.retryJob(job.id).catch(fail)}>
            <RotateCcw size={15} />
          </button>
        )}
        {(running || job.status === "queued" || job.status === "analyzing" || job.status === "paused") && (
          <button className="icon-btn" title={t("common.cancel")} onClick={() => api.cancelJob(job.id)}>
            <X size={16} />
          </button>
        )}
        {!running && job.status !== "queued" && (
          <button className="icon-btn" title={t("common.remove")} onClick={() => api.removeJob(job.id)}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function Status({ job }: { job: Job }) {
  const t = useT();
  const p = job.progress;
  switch (job.status) {
    case "analyzing":
      return (
        <span className={styles.spin}>
          <Loader2 size={14} /> {t("row.statusAnalyzing")}
        </span>
      );
    case "ready":
      return <span className={styles.muted}>{t("row.statusReady")}</span>;
    case "queued":
      return <span className={styles.muted}>{t("row.statusQueued")}</span>;
    case "paused":
      return (
        <>
          <b className={styles.dimB}>{t("row.statusPaused")}</b>
          {p.fraction ? <span className="mono">{percent(p.fraction)}</span> : null}
          {p.items && p.downloaded ? <span className="mono">{bytes(p.downloaded, t)}</span> : null}
        </>
      );
    case "downloading":
      return (
        <>
          <b className="mono">{percent(p.fraction)}</b>
          <span className="mono">{p.items && p.item ? t("row.itemOf", { i: p.item, n: p.items }) : speed(p.speed, t) || bytes(p.downloaded, t)}</span>
          {p.eta != null && !p.items && <span className="mono">{t("row.eta", { t: clock(p.eta) })}</span>}
          {p.items ? <span className="mono">{[p.downloaded ? bytes(p.downloaded, t) : null, speed(p.speed, t)].filter(Boolean).join(" · ")}</span> : null}
        </>
      );
    case "processing":
      return (
        <>
          <b>{t(STAGE[p.stage ?? ""] ?? "row.stageProcessing")}</b>
          <span>ffmpeg</span>
        </>
      );
    case "done":
      return (
        <>
          <b className={styles.ok}>{t("row.statusDone")}</b>
          {job.size ? <span className="mono">{bytes(job.size, t)}</span> : null}
        </>
      );
    case "error":
      return <b className={styles.bad}>{t("row.statusError")}</b>;
    case "canceled":
      return <span className={styles.muted}>{t("row.statusCanceled")}</span>;
  }
}
