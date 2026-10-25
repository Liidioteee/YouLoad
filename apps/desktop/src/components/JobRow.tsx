import { useState } from "react";
import { FolderOpen, Loader2, Play, RotateCcw, Trash2, X } from "lucide-react";

import { api, errorText } from "../lib/api";
import { explainJob } from "../lib/errors";
import { bytes, clock, percent, speed } from "../lib/format";
import { describe, thumbnailOf } from "../lib/formats";
import type { Job } from "../lib/types";
import { useStore } from "../store";
import styles from "./JobRow.module.css";

const STAGE: Record<string, string> = {
  merging: "Склейка",
  converting: "Конвертация",
  finishing: "Обложка и теги",
};

export function JobRow({ job, selected, onSelect }: { job: Job; selected: boolean; onSelect: () => void }) {
  const draft = useStore((s) => s.drafts[job.id]);
  const start = useStore((s) => s.start);
  const toast = useStore((s) => s.toast);
  const [thumbFailed, setThumbFailed] = useState(false);

  const m = job.media;
  const p = job.progress;
  const running = job.status === "downloading" || job.status === "processing";
  const thumb = thumbFailed ? null : thumbnailOf(m);
  const tags = describe(m, job.options ?? draft ?? null);
  const fail = (e: unknown) => toast(errorText(e), "error");

  let meta: React.ReactNode;
  if (job.status === "analyzing") meta = "Получаю информацию о ролике…";
  else if (job.status === "error" && job.error) meta = <span className={styles.errText}>{explainJob(job.error.code).title}</span>;
  else if (m?.kind === "playlist") meta = `Плейлист · ${m.entries.length} видео${m.channel ? ` · ${m.channel}` : ""}`;
  else meta = [m?.channel, m?.duration ? clock(m.duration) : null].filter(Boolean).join(" · ");

  const showBar = running || job.status === "queued" || (job.status === "canceled" && (p.fraction ?? 0) > 0);

  return (
    <div
      className={`${styles.row} ${selected ? styles.sel : ""}`}
      onClick={onSelect}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect();
        if (e.key === "Delete" && !running) api.removeJob(job.id);
      }}
    >
      <div className={styles.thumb}>
        {thumb ? <img src={thumb} alt="" loading="lazy" onError={() => setThumbFailed(true)} /> : <div className={styles.thumbEmpty} />}
        {m?.duration ? <span className={`${styles.dur} mono`}>{clock(m.duration)}</span> : null}
        {m?.kind === "playlist" ? <span className={`${styles.dur} mono`}>{m.entries.length} видео</span> : null}
      </div>

      <div className={styles.info}>
        <div className={styles.title}>{m?.title ?? job.url}</div>
        <div className={styles.meta}>{meta}</div>
        {tags.length > 0 && job.status !== "analyzing" && (
          <div className={styles.chips}>
            {tags.map((t) => (
              <span key={t} className={`${styles.chip} mono`}>
                {t}
              </span>
            ))}
          </div>
        )}
        {showBar && (
          <div className={styles.bar}>
            <i
              className={job.status === "processing" ? styles.barPulse : job.status === "canceled" ? styles.barDim : ""}
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
            Скачать
          </button>
        )}
        {job.status === "done" && job.outputs.length > 0 && (
          <>
            <button className="icon-btn" title="Открыть" onClick={() => api.openOutput(job.id, false).catch(fail)}>
              <Play size={15} />
            </button>
            <button className="icon-btn" title="Показать в папке" onClick={() => api.openOutput(job.id, true).catch(fail)}>
              <FolderOpen size={15} />
            </button>
          </>
        )}
        {(job.status === "error" || job.status === "canceled") && (
          <button className="icon-btn" title="Повторить" onClick={() => api.retryJob(job.id).catch(fail)}>
            <RotateCcw size={15} />
          </button>
        )}
        {(running || job.status === "queued" || job.status === "analyzing") && (
          <button className="icon-btn" title="Отменить" onClick={() => api.cancelJob(job.id)}>
            <X size={16} />
          </button>
        )}
        {!running && job.status !== "queued" && (
          <button className="icon-btn" title="Убрать из списка" onClick={() => api.removeJob(job.id)}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function Status({ job }: { job: Job }) {
  const p = job.progress;
  switch (job.status) {
    case "analyzing":
      return (
        <span className={styles.spin}>
          <Loader2 size={14} /> Анализ
        </span>
      );
    case "ready":
      return <span className={styles.muted}>Готово к загрузке</span>;
    case "queued":
      return <span className={styles.muted}>В очереди</span>;
    case "downloading":
      return (
        <>
          <b className="mono">{percent(p.fraction)}</b>
          <span className="mono">{p.items && p.item ? `${p.item} из ${p.items}` : speed(p.speed) || bytes(p.downloaded)}</span>
          {p.eta != null && !p.items && <span className="mono">ещё {clock(p.eta)}</span>}
          {p.items && p.speed ? <span className="mono">{speed(p.speed)}</span> : null}
        </>
      );
    case "processing":
      return (
        <>
          <b>{STAGE[p.stage ?? ""] ?? "Обработка"}</b>
          <span>ffmpeg</span>
        </>
      );
    case "done":
      return (
        <>
          <b className={styles.ok}>Готово</b>
          {p.total ? <span className="mono">{bytes(p.total)}</span> : null}
        </>
      );
    case "error":
      return <b className={styles.bad}>Ошибка</b>;
    case "canceled":
      return <span className={styles.muted}>Отменено</span>;
  }
}
