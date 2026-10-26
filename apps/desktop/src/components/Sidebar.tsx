import { CheckCheck, Download, FolderOpen, Settings2, ShieldCheck } from "lucide-react";

import { api } from "../lib/api";
import { errorText, useT, type Key } from "@youload/shared/i18n";
import { useStore, type View } from "../store";
import styles from "./Sidebar.module.css";

const NAV: { view: View; label: Key; icon: typeof Download }[] = [
  { view: "downloads", label: "nav.downloads", icon: Download },
  { view: "history", label: "nav.done", icon: CheckCheck },
  { view: "bypass", label: "nav.bypass", icon: ShieldCheck },
  { view: "settings", label: "nav.settings", icon: Settings2 },
];

export function Sidebar() {
  const t = useT();
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const jobs = useStore((s) => s.jobs);
  const tools = useStore((s) => s.tools);
  const settings = useStore((s) => s.settings);
  const toast = useStore((s) => s.toast);

  const active = jobs.filter((j) => ["queued", "downloading", "processing", "analyzing"].includes(j.status)).length;
  const folder = settings?.downloadDir.split(/[\\/]/).filter(Boolean).slice(-2).join("/") ?? "";

  return (
    <nav className={styles.side} aria-label={t("nav.downloads")}>
      {NAV.map(({ view: v, label, icon: Icon }) => (
        <button key={v} className={`${styles.item} ${view === v ? styles.on : ""}`} onClick={() => setView(v)} title={t(label)}>
          <Icon size={16} />
          <span className={styles.label}>{t(label)}</span>
          {v === "downloads" && active > 0 && <span className={`${styles.count} mono`}>{active}</span>}
        </button>
      ))}

      <div className={styles.foot}>
        <button className={styles.folder} onClick={() => api.openDownloadDir().catch((e) => toast(errorText(e), "error"))} title={settings?.downloadDir}>
          <FolderOpen size={14} />
          <span className={styles.label}>
            {t("sidebar.folder")} <b>…/{folder}</b>
          </span>
        </button>
        <span className={styles.label}>
          {t("sidebar.engine")} <b className="mono">yt-dlp {tools?.ytdlpVersion ?? "…"}</b>
          {tools?.updating && <em> {t("sidebar.updating")}</em>}
        </span>
      </div>
    </nav>
  );
}
