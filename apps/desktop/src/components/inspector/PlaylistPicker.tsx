import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { clock } from "@youload/shared/format";
import { useT } from "@youload/shared/i18n";
import type { DownloadOptions, MediaInfo } from "@youload/shared/types";
import styles from "../Inspector.module.css";

/** Checkbox list of playlist/channel videos. `playlistItems: null` means all. */
export function PlaylistPicker({ media, o, set }: { media: MediaInfo; o: DownloadOptions; set: (patch: Partial<DownloadOptions>) => void }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const total = media.entries.length;
  const chosen = useMemo(() => new Set(o.playlistItems ?? media.entries.map((e) => e.index)), [o.playlistItems, media.entries]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? media.entries.filter((e) => e.title.toLowerCase().includes(q)) : media.entries;
  }, [query, media.entries]);
  const anyDownloaded = media.entries.some((e) => e.downloaded);

  const commit = (next: Set<number>) => set({ playlistItems: next.size === total ? null : [...next].sort((a, b) => a - b) });
  const toggle = (index: number) => {
    const next = new Set(chosen);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    commit(next);
  };

  return (
    <div className={styles.picker}>
      <div className={styles.pickerHead}>
        <span className="mono">{t("playlist.selected", { n: chosen.size, total })}</span>
        <div className={styles.pickerActions}>
          <button type="button" className="btn ghost" onClick={() => set({ playlistItems: null })}>
            {t("playlist.all")}
          </button>
          <button type="button" className="btn ghost" onClick={() => set({ playlistItems: [] })}>
            {t("playlist.none")}
          </button>
          {anyDownloaded && (
            <button type="button" className="btn ghost" onClick={() => commit(new Set(media.entries.filter((e) => !e.downloaded).map((e) => e.index)))}>
              {t("playlist.onlyNew")}
            </button>
          )}
        </div>
      </div>
      {total > 8 && (
        <label className={styles.pickerSearch}>
          <Search size={13} />
          <input id="playlist-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("playlist.search")} spellCheck={false} />
        </label>
      )}
      <ul className={styles.entries}>
        {visible.map((e) => (
          <li key={e.index}>
            <label className={`${styles.entry} ${e.downloaded ? styles.entryDone : ""}`}>
              <input type="checkbox" checked={chosen.has(e.index)} onChange={() => toggle(e.index)} />
              <span className={`${styles.entryIndex} mono`}>{e.index}</span>
              <span className={styles.entryTitle} title={e.title}>
                {e.title}
              </span>
              {e.downloaded ? <span className={styles.entryBadge}>{t("playlist.downloaded")}</span> : null}
              <span className={`${styles.entryDur} mono`}>{e.duration ? clock(e.duration) : ""}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
