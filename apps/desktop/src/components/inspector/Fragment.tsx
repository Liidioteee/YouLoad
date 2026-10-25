import { useEffect, useState } from "react";

import { clock, parseClock } from "../../lib/format";
import { useT } from "../../lib/i18n";
import type { DownloadOptions, MediaInfo } from "../../lib/types";
import styles from "../Inspector.module.css";
import { Check } from "./Controls";

/** "Only a clip": start and end as 1:20 / 1:02:30. */
export function Fragment({ media, o, set }: { media: MediaInfo; o: DownloadOptions; set: (patch: Partial<DownloadOptions>) => void }) {
  const t = useT();
  const on = o.sectionStart != null && o.sectionEnd != null;
  const duration = media.duration ?? 0;
  const [from, setFrom] = useState(clock(o.sectionStart ?? 0));
  const [to, setTo] = useState(clock(o.sectionEnd ?? duration));

  useEffect(() => {
    setFrom(clock(o.sectionStart ?? 0));
    setTo(clock(o.sectionEnd ?? duration));
  }, [o.sectionStart, o.sectionEnd, duration]);

  const a = parseClock(from);
  const b = parseClock(to);
  const valid = a != null && b != null && b > a && (!duration || b <= duration + 1);

  const commit = () => {
    if (valid) set({ sectionStart: a, sectionEnd: b });
  };

  return (
    <div className={styles.fragment}>
      <Check checked={on} onChange={(v) => set(v ? { sectionStart: 0, sectionEnd: duration || 60 } : { sectionStart: null, sectionEnd: null })}>
        {t("inspector.fragment")}
      </Check>
      {on && (
        <>
          <div className={styles.fragmentRow}>
            <label>
              <span>{t("inspector.from")}</span>
              <input id="fragment-from" className="field mono" value={from} onChange={(e) => setFrom(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
            </label>
            <label>
              <span>{t("inspector.to")}</span>
              <input id="fragment-to" className="field mono" value={to} onChange={(e) => setTo(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
            </label>
          </div>
          <div className={valid ? styles.hint : styles.hintBad}>{valid ? t("inspector.fragmentHint") : t("inspector.fragmentInvalid")}</div>
        </>
      )}
    </div>
  );
}
