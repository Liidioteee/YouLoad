import { ClipboardPaste, Film, ListVideo, Music2 } from "lucide-react";

import { api } from "../lib/api";
import { speed as fmtSpeed } from "../lib/format";
import { Inspector } from "../components/Inspector";
import { JobRow } from "../components/JobRow";
import { useStore } from "../store";
import styles from "./DownloadsView.module.css";

export function DownloadsView() {
  const jobs = useStore((s) => s.jobs);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);

  const active = jobs.filter((j) => j.status === "downloading" || j.status === "processing");
  const totalSpeed = active.reduce((sum, j) => sum + (j.progress.speed ?? 0), 0);
  const hasDone = jobs.some((j) => j.status === "done");
  const selected = jobs.find((j) => j.id === selectedId) ?? null;

  return (
    <div className={`${styles.wrap} ${selected ? styles.withInspector : ""}`}>
      <section className={styles.list}>
        <header className={styles.head}>
          <h1>Загрузки</h1>
          <span className={styles.sub}>
            {active.length > 0 ? `${active.length} активно${totalSpeed > 0 ? ` · ${fmtSpeed(totalSpeed)}` : ""}` : jobs.length ? `${jobs.length} в списке` : ""}
          </span>
          <div className={styles.actions}>
            {hasDone && (
              <button className="btn ghost" onClick={() => api.clearFinished()}>
                Убрать готовые
              </button>
            )}
          </div>
        </header>

        {jobs.length === 0 ? (
          <Empty />
        ) : (
          <div className={styles.rows} role="listbox" aria-label="Загрузки">
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} selected={job.id === selectedId} onSelect={() => select(job.id)} />
            ))}
          </div>
        )}
      </section>

      {selected && <Inspector job={selected} onClose={() => select(null)} />}
    </div>
  );
}

function Empty() {
  const focusInput = () => document.getElementById("url-input")?.focus();
  return (
    <div className={styles.empty}>
      <button className={styles.drop} onClick={focusInput}>
        <ClipboardPaste size={28} strokeWidth={1.6} />
        <strong>Скопируйте ссылку на YouTube и нажмите Ctrl+V</strong>
        <span>в любом месте окна. Можно сразу несколько ссылок.</span>
      </button>
      <ul className={styles.kinds}>
        <li>
          <Film size={16} />
          <div>
            <b>Видео и Shorts</b>
            <span>до 8K, AV1, VP9 или H.264, выбор звуковой дорожки</span>
          </div>
        </li>
        <li>
          <Music2 size={16} />
          <div>
            <b>Только звук</b>
            <span>MP3, M4A, Opus, FLAC или WAV с обложкой</span>
          </div>
        </li>
        <li>
          <ListVideo size={16} />
          <div>
            <b>Плейлисты и каналы</b>
            <span>все ролики с одними настройками</span>
          </div>
        </li>
      </ul>
    </div>
  );
}
