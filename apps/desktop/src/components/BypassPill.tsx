import { useStore } from "../store";
import styles from "./BypassPill.module.css";

export function BypassPill() {
  const bypass = useStore((s) => s.bypass);
  const strategies = useStore((s) => s.strategies);
  const setView = useStore((s) => s.setView);

  let tone: "ok" | "warn" | "bad" | "off" = "off";
  let text = "Обход выключен";
  switch (bypass.state) {
    case "active":
      tone = "ok";
      text = `Обход: zapret · ${strategies.find((s) => s.id === bypass.strategy)?.name ?? bypass.strategy}`;
      break;
    case "external":
      tone = "ok";
      text = "Обход: ваш zapret";
      break;
    case "starting":
      tone = "warn";
      text = "Запуск обхода…";
      break;
    case "error":
      tone = "bad";
      text = "Обход не работает";
      break;
    case "unsupported":
      text = "Обход недоступен";
      break;
  }

  return (
    <button className={`${styles.pill} ${styles[tone]}`} onClick={() => setView("bypass")} title="Обход блокировок">
      <span className={styles.dot} />
      <span className={styles.text}>{text}</span>
    </button>
  );
}
