import { useState } from "react";
import { CheckCircle2, Loader2, ShieldAlert, ShieldCheck, ShieldOff, Wand2, XCircle } from "lucide-react";

import { api } from "../lib/api";
import { bytes, speed } from "../lib/format";
import { errorText, translateDynamic, useT, type Key } from "../lib/i18n";
import type { CheckItem } from "../lib/types";
import { useStore } from "../store";
import styles from "./Page.module.css";

const LABEL: Record<CheckItem["id"], Key> = {
  youtube: "bypass.labelYoutube",
  ytimg: "bypass.labelYtimg",
  googlevideo: "bypass.labelGooglevideo",
  speed: "bypass.labelSpeed",
};

export function BypassView() {
  const t = useT();
  const bypass = useStore((s) => s.bypass);
  const service = useStore((s) => s.bypassService);
  const autoselect = useStore((s) => s.autoselect);
  const settings = useStore((s) => s.settings);
  const strategies = useStore((s) => s.strategies);
  const platform = useStore((s) => s.platform);
  const saveSettings = useStore((s) => s.saveSettings);
  const toast = useStore((s) => s.toast);
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<CheckItem[] | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectResult, setSelectResult] = useState<string | null>(null);

  if (!settings) return null;
  const windows = platform === "windows";
  const name = (id: string) => strategies.find((s) => s.id === id)?.name ?? id;
  const busy = bypass.state === "starting" || selecting;
  const canAutoselect = !windows || (service && bypass.state !== "external");

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

  const runAutoselect = async () => {
    setSelecting(true);
    setSelectResult(null);
    try {
      const found = await api.bypassAutoselect();
      setSelectResult(found ? t("bypass.autoselectFound", { name: name(found) }) : t("bypass.autoselectNone"));
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setSelecting(false);
      useStore.setState({ autoselect: null });
    }
  };

  let icon = <ShieldOff size={22} />;
  let tone = "";
  let title = t("bypass.offTitle");
  let text = t("bypass.offText");
  switch (bypass.state) {
    case "active":
      icon = <ShieldCheck size={22} />;
      tone = styles.ok;
      title = t("bypass.activeTitle", { engine: bypass.mode === "tpws" ? "tpws" : "zapret", name: name(bypass.strategy) });
      text = bypass.mode === "tpws" ? t("bypass.activeTextTpws") : t("bypass.activeText");
      break;
    case "external":
      icon = <ShieldCheck size={22} />;
      tone = styles.ok;
      title = t("bypass.externalTitle");
      text = t("bypass.externalText");
      break;
    case "starting":
      icon = <Loader2 size={22} className="spin" />;
      title = t("bypass.startingTitle");
      text = !windows ? "" : service ? t("bypass.startingService") : t("bypass.startingHelper");
      break;
    case "error":
      icon = <ShieldAlert size={22} />;
      tone = styles.bad;
      title = t("bypass.errorTitle");
      text = translateDynamic(t.lang, `bypass.errors.${bypass.code}`) ?? t("bypass.errors.helper_exited");
      break;
  }

  const describe = (r: CheckItem) => {
    if (!r.ok && r.timeout) return t("bypass.noAnswer");
    if (r.id === "speed" && r.bytes != null && r.ms != null) return t("bypass.sample", { size: bytes(r.bytes, t), s: (r.ms / 1000).toFixed(1) });
    return r.error ?? "";
  };

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1>{t("bypass.title")}</h1>
        <p>{windows ? t("bypass.intro") : t("bypass.introTpws")}</p>
      </header>

      <section className={`${styles.status} ${tone}`}>
        <span className={styles.statusIcon}>{icon}</span>
        <div>
          <h2>{title}</h2>
          {text && <p>{text}</p>}
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>{t("bypass.strategy")}</b>
            <span>{t("bypass.strategyHint")}</span>
          </div>
          <div className={styles.buttons}>
            <select
              id="bypass-strategy"
              className={`field ${styles.selectField}`}
              value={settings.bypass.strategy}
              disabled={busy || bypass.state === "external"}
              onChange={(e) => saveSettings({ bypass: { ...settings.bypass, strategy: e.target.value } })}
            >
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button className="btn" disabled={busy || !canAutoselect} onClick={runAutoselect} title={canAutoselect ? t("bypass.autoselectHint") : t("bypass.autoselectNeedsService")}>
              <Wand2 size={14} /> {t("bypass.autoselect")}
            </button>
          </div>
        </div>
        {(selecting || selectResult) && (
          <div className={styles.progressRow}>
            {selecting ? (
              <>
                <Loader2 size={14} className="spin" />
                <span>{autoselect ? t("bypass.autoselectRunning", { name: autoselect.strategy, i: autoselect.index + 1, n: autoselect.total }) : t("bypass.autoselectTitle")}</span>
                {autoselect && (
                  <div className={styles.progress}>
                    <i style={{ width: `${((autoselect.index + (autoselect.speed != null ? 1 : 0.5)) / autoselect.total) * 100}%` }} />
                  </div>
                )}
              </>
            ) : (
              <span>{selectResult}</span>
            )}
          </div>
        )}
        {!canAutoselect && windows && bypass.state !== "external" && <p className={styles.note}>{t("bypass.autoselectNeedsService")}</p>}
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>{t("bypass.startOnLaunch")}</b>
            <span>{t("bypass.startOnLaunchHint")}</span>
          </div>
          <input
            id="bypass-enabled"
            type="checkbox"
            className="switch"
            checked={settings.bypass.enabled}
            onChange={(e) => saveSettings({ bypass: { ...settings.bypass, enabled: e.target.checked } })}
          />
        </div>
        {windows && (
          <div className={styles.row}>
            <div className={styles.rowText}>
              <b>{t("bypass.service")}</b>
              <span>{service ? t("bypass.serviceOn") : t("bypass.serviceOff")}</span>
            </div>
            <span className={service ? styles.okText : styles.mutText}>{service ? "✓" : "—"}</span>
          </div>
        )}
        <div className={`${styles.buttons} ${styles.cardButtons}`}>
          {bypass.state === "active" || bypass.state === "error" ? (
            <>
              <button className="btn" disabled={busy} onClick={() => api.bypassRestart()}>
                {t("bypass.restart")}
              </button>
              {bypass.state === "active" && (
                <button className="btn ghost" disabled={busy} onClick={() => api.bypassStop()}>
                  {t("bypass.stop")}
                </button>
              )}
            </>
          ) : (
            bypass.state !== "external" && (
              <button className="btn primary" disabled={busy} onClick={() => api.bypassRestart()}>
                {t("bypass.enable")}
              </button>
            )
          )}
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>{t("bypass.check")}</b>
            <span>{t("bypass.checkHint")}</span>
          </div>
          <button className="btn" onClick={runCheck} disabled={checking || selecting}>
            {checking ? <Loader2 size={14} className="spin" /> : null}
            {checking ? t("bypass.checking") : t("bypass.checkBtn")}
          </button>
        </div>
        {results && (
          <ul className={styles.results}>
            {results.map((r) => (
              <li key={r.id}>
                {r.ok ? <CheckCircle2 size={16} className={styles.okIcon} /> : <XCircle size={16} className={styles.badIcon} />}
                <span className={styles.resultLabel}>{t(LABEL[r.id])}</span>
                <span className={`${styles.resultValue} mono`}>{r.speed != null ? speed(r.speed, t) : r.ms != null ? t("bypass.ms", { n: r.ms }) : ""}</span>
                <span className={styles.resultDetail} title={describe(r)}>
                  {describe(r)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {results?.some((r) => r.id === "speed" && !r.ok) && <p className={styles.note}>{t("bypass.slow")}</p>}
      </section>
    </div>
  );
}
