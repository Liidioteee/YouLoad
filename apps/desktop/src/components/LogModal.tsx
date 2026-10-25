import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import type { LogLine } from "../lib/types";
import { useStore } from "../store";
import styles from "./LogModal.module.css";

export function LogModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [lines, setLines] = useState<LogLine[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    const load = () => api.getLog().then(setLines).catch(() => undefined);
    load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [lines.length]);

  const fmt = (l: LogLine) => `${new Date(l.ts).toISOString().slice(11, 19)} ${l.level.padEnd(5)} [${l.source}] ${l.text}`;

  const copyReport = async () => {
    const { version, platform, bypass, tools, settings } = useStore.getState();
    const header = [
      `YouLoad ${version} · ${platform} · ${navigator.userAgent.match(/Windows NT [\d.]+|Mac OS X [\d_]+|Linux/)?.[0] ?? ""}`,
      `yt-dlp ${tools?.ytdlpVersion ?? "?"} · bypass ${JSON.stringify(bypass)} · strategy ${settings?.bypass.strategy}`,
      `parallel ${settings?.maxParallel} · proxy ${settings?.proxy ? "yes" : "no"} · cookies ${settings?.cookiesFile ? "yes" : "no"}`,
      "",
    ];
    const text = [...header, ...lines.slice(-300).map(fmt)].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast(t("log.copied"));
    } catch {
      toast(text.slice(0, 200), "error");
    }
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div className={`modal ${styles.modal}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label={t("log.title")}>
        <div className="modal-head">
          <h2>{t("log.title")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("common.close")}>
            <X size={16} />
          </button>
        </div>
        <div className={`modal-body ${styles.body}`} ref={bodyRef}>
          {lines.length === 0 ? (
            <p className={styles.empty}>{t("log.empty")}</p>
          ) : (
            lines.map((l, i) => (
              <div key={i} className={`${styles.line} ${styles[l.level]}`}>
                {fmt(l)}
              </div>
            ))
          )}
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={copyReport}>
            {t("log.copyReport")}
          </button>
        </div>
      </div>
    </div>
  );
}
