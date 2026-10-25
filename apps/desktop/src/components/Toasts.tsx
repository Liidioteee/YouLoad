import { X } from "lucide-react";

import { useStore } from "../store";
import styles from "./Toasts.module.css";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className={styles.stack} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`${styles.toast} ${t.tone === "error" ? styles.error : ""}`}>
          <span>{t.text}</span>
          <button className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Закрыть">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
