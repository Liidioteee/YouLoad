import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowDown, CheckCircle2, Loader2, XCircle } from "lucide-react";

import { api } from "../lib/api";
import { speed } from "@youload/shared/format";
import { errorText, useT } from "@youload/shared/i18n";
import { allPresets, presetSubtitle, presetTitle } from "@youload/shared/presets";
import type { CheckItem } from "@youload/shared/types";
import { useStore } from "../store";
import styles from "./Onboarding.module.css";

/** First launch: folder, a quick YouTube check, default preset. */
export function Onboarding() {
  const t = useT();
  const settings = useStore((s) => s.settings)!;
  const bypass = useStore((s) => s.bypass);
  const saveSettings = useStore((s) => s.saveSettings);
  const setView = useStore((s) => s.setView);
  const toast = useStore((s) => s.toast);
  const [step, setStep] = useState(0);
  const [checking, setChecking] = useState(false);
  const [sample, setSample] = useState<CheckItem | null>(null);

  const finish = () => saveSettings({ onboarded: true });
  const pickFolder = async () => {
    const dir = await open({ directory: true, defaultPath: settings.downloadDir });
    if (typeof dir === "string") saveSettings({ downloadDir: dir });
  };
  const check = async () => {
    setChecking(true);
    try {
      const r = await api.bypassCheck();
      setSample(r.find((x) => x.id === "speed") ?? null);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="scrim">
      <div className={`modal ${styles.modal}`} role="dialog" aria-modal aria-label={t("onboarding.welcome")}>
        <div className={styles.hero}>
          <span className={styles.mark}>
            <ArrowDown size={18} strokeWidth={3} />
          </span>
          <div>
            <h2>{t("onboarding.welcome")}</h2>
            <p>{t("onboarding.welcomeSub")}</p>
          </div>
          <div className={`seg ${styles.lang}`}>
            {(["ru", "en"] as const).map((l) => (
              <button key={l} aria-selected={t.lang === l} onClick={() => saveSettings({ language: l })}>
                {l === "ru" ? "RU" : "EN"}
              </button>
            ))}
          </div>
        </div>

        <ol className={styles.steps}>
          {[t("onboarding.stepFolder"), t("onboarding.stepBypass"), t("onboarding.stepPreset")].map((label, i) => (
            <li key={i} className={i === step ? styles.current : i < step ? styles.passed : ""}>
              <span className="mono">{i + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        <div className={`modal-body ${styles.body}`}>
          {step === 0 && (
            <>
              <p className={styles.lead}>{t("onboarding.stepFolderSub")}</p>
              <div className={styles.folder}>
                <span className="mono">{settings.downloadDir}</span>
                <button className="btn" onClick={pickFolder}>
                  {t("common.change")}
                </button>
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <p className={styles.lead}>{t("onboarding.stepBypassSub")}</p>
              <div className={styles.check}>
                <span>
                  {t("nav.bypass")}:{" "}
                  <b>
                    {bypass.state === "active" || bypass.state === "external"
                      ? "✓"
                      : bypass.state === "starting"
                        ? "…"
                        : bypass.state === "error"
                          ? t("pill.error")
                          : t("pill.off")}
                  </b>
                </span>
                <button className="btn" onClick={check} disabled={checking || bypass.state === "starting"}>
                  {checking ? <Loader2 size={14} className="spin" /> : null}
                  {checking ? t("bypass.checking") : t("bypass.checkBtn")}
                </button>
              </div>
              {sample && (
                <div className={styles.result}>
                  {sample.ok ? <CheckCircle2 size={18} className={styles.ok} /> : <XCircle size={18} className={styles.bad} />}
                  <span>
                    {t("bypass.labelSpeed")}: <b className="mono">{speed(sample.speed, t) || t("bypass.noAnswer")}</b>
                  </span>
                  {!sample.ok && (
                    <button
                      className="btn ghost"
                      onClick={() => {
                        finish();
                        setView("bypass");
                      }}
                    >
                      {t("inspector.openBypass")}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          {step === 2 && (
            <>
              <p className={styles.lead}>{t("onboarding.stepPresetSub")}</p>
              <div className={styles.presets}>
                {allPresets(settings).map((p) => (
                  <button key={p.id} className={settings.defaultPreset === p.id ? styles.on : ""} onClick={() => saveSettings({ defaultPreset: p.id })}>
                    <b>{presetTitle(p, t)}</b>
                    <span>{presetSubtitle(p, t)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={finish} style={{ marginRight: "auto" }}>
            {t("onboarding.skip")}
          </button>
          {step > 0 && (
            <button className="btn" onClick={() => setStep(step - 1)}>
              {t("common.back")}
            </button>
          )}
          {step < 2 ? (
            <button className="btn primary" onClick={() => setStep(step + 1)}>
              {t("common.next")}
            </button>
          ) : (
            <button className="btn primary" onClick={finish}>
              {t("onboarding.finish")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
