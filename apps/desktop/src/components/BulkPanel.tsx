import { useState } from "react";
import { X } from "lucide-react";

import { api } from "../lib/api";
import { bytes } from "@youload/shared/format";
import { estimatePlaylist, estimateSize } from "@youload/shared/formats";
import { useT } from "@youload/shared/i18n";
import { allPresets, presetSubtitle, presetTitle } from "@youload/shared/presets";
import { useStore } from "../store";
import styles from "./Inspector.module.css";
import { Group } from "./inspector/Controls";

/** Shown instead of the inspector when several downloads are selected. */
export function BulkPanel({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const t = useT();
  const jobs = useStore((s) => s.jobs).filter((j) => ids.includes(j.id));
  const settings = useStore((s) => s.settings);
  const drafts = useStore((s) => s.drafts);
  const applyPresetTo = useStore((s) => s.applyPresetTo);
  const start = useStore((s) => s.start);
  const [preset, setPreset] = useState<string | null>(null);

  const ready = jobs.filter((j) => j.media && ["ready", "error", "canceled"].includes(j.status) && drafts[j.id]);
  // Total of the ready downloads: videos from their formats, playlists from the background scan.
  const sizes = ready.map((j) => {
    if (j.media!.kind === "video") return estimateSize(j.media!, drafts[j.id]);
    const p = estimatePlaylist(j.media!, drafts[j.id]);
    return p.known === p.total ? { bytes: p.bytes, approx: true } : null;
  });
  const total = sizes.reduce((sum, s) => sum + (s?.bytes ?? 0), 0);
  const partial = sizes.some((s) => !s);
  const running = jobs.filter((j) => ["queued", "downloading", "processing"].includes(j.status));
  const paused = jobs.filter((j) => j.status === "paused");
  const removable = jobs.filter((j) => !["queued", "downloading", "processing"].includes(j.status));

  return (
    <aside className={styles.panel}>
      <button className={`icon-btn ${styles.close}`} onClick={onClose} aria-label={t("inspector.closePanel")}>
        <X size={16} />
      </button>
      <div className={styles.scroll}>
        <div className={styles.titleBlock}>
          <h2>{t("bulk.selected", { n: jobs.length })}</h2>
          <p>{t("bulk.hint")}</p>
        </div>
        {ready.length > 0 && (
          <Group label={t("bulk.applyPreset")}>
            <div className={styles.presets}>
              {allPresets(settings).map((p) => (
                <div key={p.id} className={`${styles.preset} ${preset === p.id ? styles.on : ""}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setPreset(p.id);
                      applyPresetTo(
                        ready.map((j) => j.id),
                        p.id,
                      );
                    }}
                  >
                    <b>{presetTitle(p, t)}</b>
                    <span>{presetSubtitle(p, t)}</span>
                  </button>
                </div>
              ))}
            </div>
          </Group>
        )}
        <div className={styles.errorActions}>
          {running.length > 0 && (
            <button className="btn" onClick={() => running.forEach((j) => api.pauseJob(j.id))}>
              {t("common.pause")}
            </button>
          )}
          {paused.length > 0 && (
            <button className="btn" onClick={() => paused.forEach((j) => api.resumeJob(j.id))}>
              {t("common.resume")}
            </button>
          )}
          {(running.length > 0 || paused.length > 0) && (
            <button className="btn ghost" onClick={() => [...running, ...paused].forEach((j) => api.cancelJob(j.id))}>
              {t("common.cancel")}
            </button>
          )}
          {removable.length > 0 && (
            <button className="btn ghost" onClick={() => removable.forEach((j) => api.removeJob(j.id))}>
              {t("common.remove")}
            </button>
          )}
        </div>
      </div>
      {ready.length > 0 && (
        <div className={styles.footer}>
          {total > 0 && (
            <div className={styles.size}>
              <span>{t("inspector.size")}</span>
              <b className="mono">
                {"≈ "}
                {bytes(total, t)}
                {partial ? "+" : ""}
              </b>
            </div>
          )}
          <div className={styles.footerButtons}>
            <button className="btn primary lg" onClick={() => ready.forEach((j) => start(j.id))}>
              {t("bulk.downloadReady", { n: ready.length })}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
