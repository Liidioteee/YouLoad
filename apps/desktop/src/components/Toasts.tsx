import { X } from "lucide-react";

import { useT } from "@youload/shared/i18n";
import { useStore } from "../store";
import styles from "./Toasts.module.css";

export function Toasts() {
  const t = useT();
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className={styles.stack} role="status" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={`${styles.toast} ${x.tone === "error" ? styles.error : ""}`}>
          <span className={styles.text}>{x.text}</span>
          {x.action && (
            <button
              className="btn primary"
              onClick={() => {
                x.action!.run();
                dismiss(x.id);
              }}
            >
              {x.action.label}
            </button>
          )}
          <button className="icon-btn" onClick={() => dismiss(x.id)} aria-label={t("common.close")}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
