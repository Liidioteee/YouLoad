import { useState } from "react";
import { CheckCircle2, Loader2, ShieldAlert, ShieldCheck, ShieldOff, XCircle } from "lucide-react";

import { api, errorText } from "../lib/api";
import { explainBypass } from "../lib/errors";
import { speed } from "../lib/format";
import type { CheckItem } from "../lib/types";
import { useStore } from "../store";
import styles from "./Page.module.css";

export function BypassView() {
  const bypass = useStore((s) => s.bypass);
  const settings = useStore((s) => s.settings);
  const strategies = useStore((s) => s.strategies);
  const saveSettings = useStore((s) => s.saveSettings);
  const toast = useStore((s) => s.toast);
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<CheckItem[] | null>(null);

  if (!settings) return null;
  const strategyName = (id: string) => strategies.find((s) => s.id === id)?.name ?? id;

  const runCheck = async () => {
    setChecking(true);
    setResults(null);
    try {
      setResults(await api.bypassCheck());
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setChecking(false);
    }
  };

  let icon = <ShieldOff size={22} />;
  let tone = "";
  let title = "Обход выключен";
  let text = "YouLoad подключается к YouTube напрямую или через ваш прокси.";
  switch (bypass.state) {
    case "active":
      icon = <ShieldCheck size={22} />;
      tone = styles.ok;
      title = `Работает: zapret, стратегия ${strategyName(bypass.strategy)}`;
      text = "Обход включён, пока YouLoad открыт. В это время YouTube в браузере тоже работает. После закрытия программы обход выключается.";
      break;
    case "external":
      icon = <ShieldCheck size={22} />;
      tone = styles.ok;
      title = "Используется ваш zapret";
      text = "На компьютере уже запущен zapret, поэтому YouLoad не запускает свой. Стратегию меняйте в своей сборке zapret.";
      break;
    case "starting":
      icon = <Loader2 size={22} className={styles.spin} />;
      title = "Запускаю zapret…";
      text = "Windows спросит разрешение на запуск с правами администратора. Без них zapret не может работать.";
      break;
    case "error":
      icon = <ShieldAlert size={22} />;
      tone = styles.bad;
      title = "Обход не работает";
      text = explainBypass(bypass.code);
      break;
    case "unsupported":
      title = "Обход пока доступен только в Windows";
      text = "На macOS и Linux используйте свой прокси в настройках.";
      break;
  }

  const busy = bypass.state === "starting";
  const running = bypass.state === "active";

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1>Обход блокировок</h1>
        <p>YouTube в России замедляют на оборудовании провайдеров. YouLoad запускает zapret: он меняет начало соединения так, что замедление его не распознаёт.</p>
      </header>

      <section className={`${styles.status} ${tone}`}>
        <span className={styles.statusIcon}>{icon}</span>
        <div>
          <h2>{title}</h2>
          <p>{text}</p>
        </div>
      </section>

      {bypass.state !== "unsupported" && (
        <section className={styles.card}>
          <div className={styles.row}>
            <div className={styles.rowText}>
              <b>Стратегия</b>
              <span>Если YouTube всё равно медленный, попробуйте другую. ALT работает у большинства провайдеров.</span>
            </div>
            <select
              className={`field ${styles.selectField}`}
              value={settings.bypass.strategy}
              disabled={busy || bypass.state === "external"}
              onChange={(e) => saveSettings({ ...settings, bypass: { ...settings.bypass, strategy: e.target.value } })}
            >
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.row}>
            <div className={styles.rowText}>
              <b>Включать при запуске YouLoad</b>
              <span>Выключите, если пользуетесь VPN или своим прокси.</span>
            </div>
            <input
              type="checkbox"
              className={styles.switch}
              checked={settings.bypass.enabled}
              onChange={(e) => saveSettings({ ...settings, bypass: { ...settings.bypass, enabled: e.target.checked } })}
            />
          </div>
          <div className={styles.buttons}>
            {running || bypass.state === "error" ? (
              <>
                <button className="btn" disabled={busy} onClick={() => api.bypassRestart()}>
                  Перезапустить
                </button>
                {running && (
                  <button className="btn ghost" onClick={() => api.bypassStop()}>
                    Остановить
                  </button>
                )}
              </>
            ) : (
              bypass.state !== "external" && (
                <button className="btn primary" disabled={busy} onClick={() => api.bypassRestart()}>
                  Включить сейчас
                </button>
              )
            )}
          </div>
        </section>
      )}

      <section className={styles.card}>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>Проверка YouTube</b>
            <span>Проверяет доступ к серверам и скачивает 6 МБ тестового видео, чтобы измерить скорость.</span>
          </div>
          <button className="btn" onClick={runCheck} disabled={checking}>
            {checking ? <Loader2 size={14} className={styles.spin} /> : null}
            {checking ? "Проверяю…" : "Проверить"}
          </button>
        </div>
        {results && (
          <ul className={styles.results}>
            {results.map((r) => (
              <li key={r.id}>
                {r.ok ? <CheckCircle2 size={16} className={styles.okIcon} /> : <XCircle size={16} className={styles.badIcon} />}
                <span className={styles.resultLabel}>{r.label}</span>
                <span className={`${styles.resultValue} mono`}>
                  {r.speed != null ? speed(r.speed) : r.ms != null ? `${r.ms} мс` : ""}
                </span>
                <span className={styles.resultDetail}>{r.ok ? (r.id === "speed" ? r.detail : "") : r.detail}</span>
              </li>
            ))}
          </ul>
        )}
        {results && results.some((r) => r.id === "speed" && !r.ok) && (
          <p className={styles.note}>Скорость низкая. Выберите другую стратегию выше и проверьте снова.</p>
        )}
      </section>
    </div>
  );
}
