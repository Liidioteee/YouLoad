import { ClipboardPaste, Film, ListVideo, Music2 } from "lucide-react";

import { BulkPanel } from "../components/BulkPanel";
import { Inspector } from "../components/Inspector";
import { JobRow } from "../components/JobRow";
import { api } from "../lib/api";
import { speed as fmtSpeed } from "../lib/format";
import { useT } from "../lib/i18n";
import { useStore } from "../store";
import styles from "./DownloadsView.module.css";

export function DownloadsView() {
  const t = useT();
  const jobs = useStore((s) => s.jobs);
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  const clearSelection = useStore((s) => s.clearSelection);

  const active = jobs.filter((j) => j.status === "downloading" || j.status === "processing");
  const totalSpeed = active.reduce((sum, j) => sum + (j.progress.speed ?? 0), 0);
  const hasDone = jobs.some((j) => j.status === "done");
  const pausable = jobs.filter((j) => ["queued", "downloading", "processing"].includes(j.status));
  const paused = jobs.filter((j) => j.status === "paused");
  const single = selected.length === 1 ? jobs.find((j) => j.id === selected[0]) ?? null : null;
  const many = selected.length > 1;

  return (
    <div className={`${styles.wrap} ${single || many ? styles.withInspector : ""}`}>
      <section className={styles.list}>
        <header className={styles.head}>
          <h1>{t("downloads.title")}</h1>
          <span className={styles.sub}>
            {active.length > 0
              ? `${t("downloads.active", { n: active.length })}${totalSpeed > 0 ? ` · ${fmtSpeed(totalSpeed, t)}` : ""}`
              : jobs.length
                ? t("downloads.inList", { n: jobs.length })
                : ""}
          </span>
          <div className={styles.actions}>
            {pausable.length > 0 && (
              <button className="btn ghost" onClick={() => pausable.forEach((j) => api.pauseJob(j.id))}>
                {t("downloads.pauseAll")}
              </button>
            )}
            {paused.length > 0 && (
              <button className="btn ghost" onClick={() => paused.forEach((j) => api.resumeJob(j.id))}>
                {t("downloads.resumeAll")}
              </button>
            )}
            {hasDone && (
              <button className="btn ghost" onClick={() => api.clearFinished()}>
                {t("downloads.clearDone")}
              </button>
            )}
          </div>
        </header>

        {jobs.length === 0 ? (
          <Empty />
        ) : (
          <div
            className={styles.rows}
            role="listbox"
            aria-multiselectable
            aria-label={t("downloads.title")}
            onKeyDown={(e) => {
              if (e.key === "Escape") clearSelection();
              if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                useStore.setState({ selected: jobs.map((j) => j.id) });
              }
            }}
          >
            {jobs.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                selected={selected.includes(job.id)}
                onSelect={(e) => select(job.id, e.shiftKey ? "range" : e.ctrlKey || e.metaKey ? "toggle" : "single")}
              />
            ))}
          </div>
        )}
      </section>

      {single && <Inspector job={single} onClose={clearSelection} />}
      {many && <BulkPanel ids={selected} onClose={clearSelection} />}
    </div>
  );
}

function Empty() {
  const t = useT();
  const focusInput = () => document.getElementById("url-input")?.focus();
  return (
    <div className={styles.empty}>
      <button className={styles.drop} onClick={focusInput}>
        <ClipboardPaste size={28} strokeWidth={1.6} />
        <strong>{t("downloads.pasteTitle")}</strong>
        <span>{t("downloads.pasteSub")}</span>
      </button>
      <ul className={styles.kinds}>
        <li>
          <Film size={16} />
          <div>
            <b>{t("downloads.kindVideo")}</b>
            <span>{t("downloads.kindVideoSub")}</span>
          </div>
        </li>
        <li>
          <Music2 size={16} />
          <div>
            <b>{t("downloads.kindAudio")}</b>
            <span>{t("downloads.kindAudioSub")}</span>
          </div>
        </li>
        <li>
          <ListVideo size={16} />
          <div>
            <b>{t("downloads.kindPlaylist")}</b>
            <span>{t("downloads.kindPlaylistSub")}</span>
          </div>
        </li>
      </ul>
    </div>
  );
}
