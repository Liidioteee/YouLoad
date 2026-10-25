import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowDown, Copy, Minus, Square, X } from "lucide-react";

import { useT } from "../lib/i18n";
import { useStore } from "../store";
import { BypassPill } from "./BypassPill";
import styles from "./TitleBar.module.css";

export function TitleBar() {
  const t = useT();
  const addUrls = useStore((s) => s.addUrls);
  const [value, setValue] = useState("");
  const [maximized, setMaximized] = useState(false);
  const win = getCurrentWindow();

  const submit = async () => {
    const text = value.trim();
    if (!text) return;
    setValue("");
    await addUrls(text);
  };

  const toggleMax = async () => {
    await win.toggleMaximize();
    setMaximized(await win.isMaximized());
  };

  return (
    <header className={styles.bar} data-tauri-drag-region>
      <div className={styles.logo} data-tauri-drag-region>
        <span className={styles.mark}>
          <ArrowDown size={13} strokeWidth={3} />
        </span>
        <span className={styles.name}>YouLoad</span>
      </div>

      <form
        className={styles.url}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          id="url-input"
          className={styles.input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("titlebar.placeholder")}
          spellCheck={false}
          autoComplete="off"
        />
        {value ? (
          <button type="submit" className={`btn primary ${styles.go}`}>
            {t("titlebar.add")}
          </button>
        ) : (
          <kbd className={styles.kbd}>Ctrl+V</kbd>
        )}
      </form>

      <BypassPill />

      <div className={styles.controls}>
        <button className={styles.ctl} onClick={() => win.minimize()} aria-label={t("titlebar.minimize")}>
          <Minus size={15} />
        </button>
        <button className={styles.ctl} onClick={toggleMax} aria-label={maximized ? t("titlebar.restore") : t("titlebar.maximize")}>
          {maximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button className={`${styles.ctl} ${styles.close}`} onClick={() => win.close()} aria-label={t("titlebar.close")}>
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
