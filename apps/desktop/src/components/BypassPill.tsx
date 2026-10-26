import { useT } from "@youload/shared/i18n";
import { useStore } from "../store";
import styles from "./BypassPill.module.css";

export function BypassPill() {
  const t = useT();
  const bypass = useStore((s) => s.bypass);
  const strategies = useStore((s) => s.strategies);
  const setView = useStore((s) => s.setView);

  let tone: "ok" | "warn" | "bad" | "off" = "off";
  let text = t("pill.off");
  switch (bypass.state) {
    case "active": {
      tone = "ok";
      const name = strategies.find((s) => s.id === bypass.strategy)?.name ?? bypass.strategy;
      text = bypass.mode === "tpws" ? t("pill.tpws", { name }) : t("pill.active", { name });
      break;
    }
    case "external":
      tone = "ok";
      text = t("pill.external");
      break;
    case "starting":
      tone = "warn";
      text = t("pill.starting");
      break;
    case "error":
      tone = "bad";
      text = t("pill.error");
      break;
  }

  return (
    <button className={`${styles.pill} ${styles[tone]}`} onClick={() => setView("bypass")} title={t("nav.bypass")}>
      <span className={styles.dot} />
      <span className={styles.text}>{text}</span>
    </button>
  );
}
