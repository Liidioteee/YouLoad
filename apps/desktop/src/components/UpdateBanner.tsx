import { useEffect, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { Download, Loader2, X } from "lucide-react";
import { create } from "zustand";

import { useT } from "../lib/i18n";
import { useStore } from "../store";
import styles from "./UpdateBanner.module.css";

const useUpdate = create<{ update: Update | null; dismissed: boolean }>(() => ({ update: null, dismissed: false }));

/** Asks GitHub for a newer signed release. Returns true when one is available. */
export async function checkForUpdate(manual = false): Promise<boolean> {
  try {
    const update = await check();
    useUpdate.setState({ update: update ?? null, dismissed: manual ? false : useUpdate.getState().dismissed });
    return !!update;
  } catch {
    return false;
  }
}

export function UpdateBanner() {
  const t = useT();
  const { update, dismissed } = useUpdate();
  const autoUpdate = useStore((s) => s.settings?.autoUpdate);
  const toast = useStore((s) => s.toast);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (autoUpdate) checkForUpdate();
  }, [autoUpdate]);

  if (!update || dismissed) return null;

  const install = async () => {
    setInstalling(true);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch {
      setInstalling(false);
      toast(t("update.failed"), "error");
    }
  };

  return (
    <div className={styles.banner} role="status">
      <Download size={15} />
      <span>{installing ? t("update.installing") : t("update.available", { v: update.version })}</span>
      <button className="btn primary" onClick={install} disabled={installing}>
        {installing ? <Loader2 size={14} className="spin" /> : null}
        {t("update.install")}
      </button>
      {!installing && (
        <button className="icon-btn" onClick={() => useUpdate.setState({ dismissed: true })} aria-label={t("common.later")}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
