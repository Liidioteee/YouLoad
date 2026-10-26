import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Loader2 } from "lucide-react";

import { LogModal } from "../components/LogModal";
import { checkForUpdate } from "../components/UpdateBanner";
import { api } from "../lib/api";
import { errorText, useT, type Key } from "@youload/shared/i18n";
import { allPresets, presetTitle } from "@youload/shared/presets";
import { useStore } from "../store";
import styles from "./Page.module.css";

const REPO = "https://github.com/Liidioteee/YouLoad";
const TEMPLATES: { value: string; label: Key }[] = [
  { value: "%(title)s.%(ext)s", label: "settings.tplTitle" },
  { value: "%(title)s [%(id)s].%(ext)s", label: "settings.tplTitleId" },
  { value: "%(uploader)s - %(title)s.%(ext)s", label: "settings.tplChannelTitle" },
  { value: "%(upload_date>%Y-%m-%d)s %(title)s.%(ext)s", label: "settings.tplDateTitle" },
];
const LIMITS = [0, 1, 2, 5, 10, 20];

export function SettingsView() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const tools = useStore((s) => s.tools);
  const version = useStore((s) => s.version);
  const saveSettings = useStore((s) => s.saveSettings);
  const toast = useStore((s) => s.toast);
  const [proxy, setProxy] = useState(settings?.proxy ?? "");
  const [showLog, setShowLog] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => setProxy(settings?.proxy ?? ""), [settings?.proxy]);
  if (!settings) return null;

  const pickFolder = async () => {
    const dir = await open({ directory: true, defaultPath: settings.downloadDir });
    if (typeof dir === "string") saveSettings({ downloadDir: dir });
  };
  const pickCookies = async () => {
    const file = await open({ multiple: false, filters: [{ name: "cookies.txt", extensions: ["txt"] }] });
    if (typeof file === "string") saveSettings({ cookiesFile: file });
  };
  const checkUpdate = async () => {
    setCheckingUpdate(true);
    const found = await checkForUpdate(true);
    setCheckingUpdate(false);
    if (!found) toast(t("settings.upToDate"));
  };

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1>{t("settings.title")}</h1>
      </header>

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>{t("settings.files")}</h3>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>{t("settings.folder")}</b>
            <span className="mono">{settings.downloadDir}</span>
          </div>
          <div className={styles.buttons}>
            <button className="btn" onClick={pickFolder}>
              {t("common.change")}
            </button>
            <button className="btn ghost" onClick={() => api.openDownloadDir().catch((e) => toast(errorText(e), "error"))}>
              {t("common.open")}
            </button>
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>{t("settings.template")}</b>
            <span>{t("settings.templateHint")}</span>
          </div>
          <select id="template" className={`field ${styles.selectField}`} value={settings.filenameTemplate} onChange={(e) => saveSettings({ filenameTemplate: e.target.value })}>
            {!TEMPLATES.some((x) => x.value === settings.filenameTemplate) && <option value={settings.filenameTemplate}>{settings.filenameTemplate}</option>}
            {TEMPLATES.map((x) => (
              <option key={x.value} value={x.value}>
                {t(x.label)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>{t("inspector.preset")}</b>
          </div>
          <select id="default-preset" className={`field ${styles.selectField}`} value={settings.defaultPreset} onChange={(e) => saveSettings({ defaultPreset: e.target.value })}>
            {allPresets(settings).map((p) => (
              <option key={p.id} value={p.id}>
                {presetTitle(p, t)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>{t("settings.parallel")}</b>
            <span>{t("settings.parallelHint")}</span>
          </div>
          <div className="seg">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className="mono" aria-selected={settings.maxParallel === n} onClick={() => saveSettings({ maxParallel: n })}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>{t("settings.speedLimit")}</b>
            <span>{t("settings.speedLimitHint")}</span>
          </div>
          <select id="speed-limit" className={`field ${styles.selectField}`} value={Math.round(settings.speedLimitKbps / 1024)} onChange={(e) => saveSettings({ speedLimitKbps: Number(e.target.value) * 1024 })}>
            {LIMITS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? t("settings.unlimited") : t("settings.mbps", { n })}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>{t("settings.network")}</h3>
        <form
          className={styles.row}
          onSubmit={(e) => {
            e.preventDefault();
            saveSettings({ proxy }).then((ok) => ok && toast(proxy ? t("settings.proxySaved") : t("settings.proxyOff")));
          }}
        >
          <div className={styles.rowText}>
            <b>{t("settings.proxy")}</b>
            <span>{t("settings.proxyHint")}</span>
          </div>
          <div className={styles.buttons}>
            <input id="proxy" className={`field mono ${styles.textField}`} value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder="socks5://…" spellCheck={false} />
            <button className="btn" type="submit" disabled={proxy === settings.proxy}>
              {t("common.save")}
            </button>
          </div>
        </form>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>{t("settings.cookies")}</b>
            <span>{t("settings.cookiesHint")}</span>
            <span className="mono">{settings.cookiesFile || t("settings.cookiesNone")}</span>
          </div>
          <div className={styles.buttons}>
            <button className="btn" onClick={pickCookies}>
              {t("settings.cookiesChoose")}
            </button>
            {settings.cookiesFile && (
              <button className="btn ghost" onClick={() => saveSettings({ cookiesFile: "" })}>
                {t("settings.cookiesClear")}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>{t("settings.interface")}</h3>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>{t("settings.language")}</b>
          </div>
          <div className="seg">
            {(["system", "ru", "en"] as const).map((l) => (
              <button key={l} aria-selected={settings.language === l} onClick={() => saveSettings({ language: l })}>
                {l === "system" ? t("settings.langSystem") : l === "ru" ? "Русский" : "English"}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>{t("settings.theme")}</b>
          </div>
          <div className="seg">
            {(["system", "dark", "light"] as const).map((x) => (
              <button key={x} aria-selected={settings.theme === x} onClick={() => saveSettings({ theme: x })}>
                {t(x === "system" ? "settings.themeSystem" : x === "dark" ? "settings.themeDark" : "settings.themeLight")}
              </button>
            ))}
          </div>
        </div>
        <Toggle id="tray" label="settings.tray" hint="settings.trayHint" checked={settings.closeToTray} onChange={(closeToTray) => saveSettings({ closeToTray })} />
        <Toggle id="notifications" label="settings.notifications" hint="settings.notificationsHint" checked={settings.notifications} onChange={(notifications) => saveSettings({ notifications })} />
        <Toggle id="clipboard" label="settings.clipboard" hint="settings.clipboardHint" checked={settings.clipboardWatch} onChange={(clipboardWatch) => saveSettings({ clipboardWatch })} />
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>{t("settings.autoUpdate")}</b>
            <span>{t("settings.autoUpdateHint")}</span>
          </div>
          <div className={styles.buttons}>
            <button className="btn ghost" onClick={checkUpdate} disabled={checkingUpdate}>
              {checkingUpdate ? <Loader2 size={14} className="spin" /> : null}
              {t("settings.checkUpdates")}
            </button>
            <input id="auto-update" type="checkbox" className="switch" checked={settings.autoUpdate} onChange={(e) => saveSettings({ autoUpdate: e.target.checked })} />
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>{t("settings.components")}</h3>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>
              yt-dlp <span className="mono">{tools?.ytdlpVersion ?? "…"}</span>
            </b>
            <span>{tools?.message ?? t("settings.ytdlpHint")}</span>
          </div>
          <button className="btn" disabled={tools?.updating} onClick={() => api.updateTools()}>
            {tools?.updating ? <Loader2 size={14} className="spin" /> : null}
            {tools?.updating ? t("settings.updating") : t("settings.update")}
          </button>
        </div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>{t("settings.ffmpegDeno")}</b>
            <span>{t("settings.ffmpegDenoHint")}</span>
          </div>
          <span className={tools?.ffmpegOk && tools.denoOk ? styles.okText : styles.badText}>{tools?.ffmpegOk && tools.denoOk ? t("settings.installed") : t("settings.missing")}</span>
        </div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>{t("settings.log")}</b>
            <span>{t("settings.logHint")}</span>
          </div>
          <button className="btn" onClick={() => setShowLog(true)}>
            {t("settings.openLog")}
          </button>
        </div>
      </section>

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>{t("settings.about")}</h3>
        <div className={styles.about}>
          <span>
            YouLoad <span className="mono">{version}</span>
          </span>
          <span>{t("settings.aboutText")}</span>
          <span>
            <a
              href={REPO}
              onClick={(e) => {
                e.preventDefault();
                openUrl(REPO);
              }}
            >
              {t("settings.sourceCode")}
            </a>
          </span>
        </div>
      </section>

      {showLog && <LogModal onClose={() => setShowLog(false)} />}
    </div>
  );
}

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: Key; hint: Key; checked: boolean; onChange: (v: boolean) => void }) {
  const t = useT();
  return (
    <div className={styles.row}>
      <label className={styles.rowText} htmlFor={id}>
        <b>{t(label)}</b>
        <span>{t(hint)}</span>
      </label>
      <input id={id} type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}
