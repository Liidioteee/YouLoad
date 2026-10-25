import { useMemo, useState } from "react";
import { CheckCheck, FolderOpen, LayoutGrid, List, Play, RotateCcw, Search, Trash2 } from "lucide-react";

import { api } from "../lib/api";
import { bytes, clock, date } from "../lib/format";
import { describe, thumbUrl } from "../lib/formats";
import { errorText, useT } from "../lib/i18n";
import type { HistoryItem } from "../lib/types";
import { useStore } from "../store";
import styles from "./HistoryView.module.css";

function loadLayout(): "list" | "grid" {
  try {
    return localStorage.getItem("history-layout") === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
}

export function HistoryView() {
  const t = useT();
  const history = useStore((s) => s.history);
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState(loadLayout);
  const [confirmClear, setConfirmClear] = useState(false);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? history.filter((h) => `${h.title} ${h.channel ?? ""}`.toLowerCase().includes(q)) : history;
  }, [history, query]);

  const switchLayout = (l: "list" | "grid") => {
    setLayout(l);
    try {
      localStorage.setItem("history-layout", l);
    } catch {
      /* per-device convenience only */
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1>{t("history.title")}</h1>
        {history.length > 0 && <span className={styles.sub}>{t("history.count", { n: history.length })}</span>}
        <div className={styles.tools}>
          {history.length > 0 && (
            <label className={styles.search}>
              <Search size={14} />
              <input id="history-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("history.search")} spellCheck={false} />
            </label>
          )}
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={layout === "list"} onClick={() => switchLayout("list")} title={t("history.list")}>
              <List size={14} />
            </button>
            <button role="tab" aria-selected={layout === "grid"} onClick={() => switchLayout("grid")} title={t("history.grid")}>
              <LayoutGrid size={14} />
            </button>
          </div>
          {history.length > 0 &&
            (confirmClear ? (
              <button
                className="btn danger"
                onClick={() => {
                  api.clearHistory();
                  setConfirmClear(false);
                }}
                onBlur={() => setConfirmClear(false)}
                autoFocus
              >
                {t("history.clearConfirm")}
              </button>
            ) : (
              <button className="btn ghost" onClick={() => setConfirmClear(true)}>
                {t("history.clear")}
              </button>
            ))}
        </div>
      </header>

      {history.length === 0 ? (
        <div className={styles.empty}>
          <CheckCheck size={28} strokeWidth={1.6} />
          <strong>{t("history.empty")}</strong>
          <span>{t("history.emptySub")}</span>
        </div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          <span>{t("history.noMatches")}</span>
        </div>
      ) : (
        <div className={layout === "grid" ? styles.grid : styles.list}>
          {items.map((h) => (
            <Item key={h.id} item={h} grid={layout === "grid"} />
          ))}
        </div>
      )}
    </div>
  );
}

function Item({ item, grid }: { item: HistoryItem; grid: boolean }) {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const addUrls = useStore((s) => s.addUrls);
  const [thumbFailed, setThumbFailed] = useState(false);
  const fail = (e: unknown) => toast(errorText(e), "error");
  const tags = describe(null, item.options, t);
  const meta = [
    item.channel,
    item.kind === "playlist" ? t("history.videos", { n: item.count }) : item.duration ? clock(item.duration) : null,
    item.size ? bytes(item.size, t) : null,
    date(item.finishedAt, t),
  ].filter(Boolean);

  return (
    <article className={grid ? styles.card : styles.row}>
      <button className={styles.thumb} onClick={() => api.openHistoryOutput(item.id, false).catch(fail)} title={t("common.open")}>
        {item.thumbId && !thumbFailed ? <img src={thumbUrl(item.thumbId)} alt="" loading="lazy" onError={() => setThumbFailed(true)} /> : <span />}
        <i>
          <Play size={18} />
        </i>
      </button>
      <div className={styles.info}>
        <div className={styles.title} title={item.title}>
          {item.title}
        </div>
        <div className={styles.meta}>{meta.join(" · ")}</div>
        {tags.length > 0 && (
          <div className={styles.chips}>
            {tags.map((x) => (
              <span key={x} className="mono">
                {x}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className={styles.actions}>
        <button className="icon-btn" title={t("common.reveal")} onClick={() => api.openHistoryOutput(item.id, true).catch(fail)}>
          <FolderOpen size={15} />
        </button>
        <button className="icon-btn" title={t("common.downloadAgain")} onClick={() => addUrls(item.url)}>
          <RotateCcw size={15} />
        </button>
        <button className="icon-btn" title={t("common.remove")} onClick={() => api.removeHistory(item.id)}>
          <Trash2 size={14} />
        </button>
      </div>
    </article>
  );
}
