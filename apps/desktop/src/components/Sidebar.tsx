import { Download, FolderOpen, Settings2, ShieldCheck } from "lucide-react";

import { api, errorText } from "../lib/api";
import { useStore, type View } from "../store";
import styles from "./Sidebar.module.css";

const NAV: { view: View; label: string; icon: typeof Download }[] = [
  { view: "downloads", label: "Загрузки", icon: Download },
  { view: "bypass", label: "Обход блокировок", icon: ShieldCheck },
  { view: "settings", label: "Настройки", icon: Settings2 },
];

export function Sidebar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const jobs = useStore((s) => s.jobs);
  const tools = useStore((s) => s.tools);
  const settings = useStore((s) => s.settings);
  const toast = useStore((s) => s.toast);

  const active = jobs.filter((j) => ["queued", "downloading", "processing", "analyzing"].includes(j.status)).length;
  const folder = settings?.downloadDir.split(/[\\/]/).filter(Boolean).slice(-2).join("\\") ?? "";

  return (
    <nav className={styles.side} aria-label="Разделы">
      {NAV.map(({ view: v, label, icon: Icon }) => (
        <button key={v} className={`${styles.item} ${view === v ? styles.on : ""}`} onClick={() => setView(v)} title={label}>
          <Icon size={16} />
          <span className={styles.label}>{label}</span>
          {v === "downloads" && active > 0 && <span className={`${styles.count} mono`}>{active}</span>}
        </button>
      ))}

      <div className={styles.foot}>
        <button
          className={styles.folder}
          onClick={() => api.openDownloadDir().catch((e) => toast(errorText(e), "error"))}
          title={settings?.downloadDir}
        >
          <FolderOpen size={14} />
          <span className={styles.label}>
            Папка <b>…\{folder}</b>
          </span>
        </button>
        <span className={styles.label}>
          Движок <b className="mono">yt-dlp {tools?.ytdlpVersion ?? "…"}</b>
          {tools?.updating && <em> обновляется</em>}
        </span>
      </div>
    </nav>
  );
}
