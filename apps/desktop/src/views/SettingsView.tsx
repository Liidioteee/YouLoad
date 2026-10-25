import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Loader2 } from "lucide-react";

import { api, errorText } from "../lib/api";
import type { Settings } from "../lib/types";
import { useStore } from "../store";
import styles from "./Page.module.css";

const TEMPLATES = [
  { value: "%(title)s.%(ext)s", label: "Название" },
  { value: "%(title)s [%(id)s].%(ext)s", label: "Название [id]" },
  { value: "%(uploader)s - %(title)s.%(ext)s", label: "Канал - Название" },
  { value: "%(upload_date>%Y-%m-%d)s %(title)s.%(ext)s", label: "Дата Название" },
];

export function SettingsView() {
  const settings = useStore((s) => s.settings);
  const tools = useStore((s) => s.tools);
  const version = useStore((s) => s.version);
  const saveSettings = useStore((s) => s.saveSettings);
  const toast = useStore((s) => s.toast);
  const [proxy, setProxy] = useState(settings?.proxy ?? "");

  useEffect(() => setProxy(settings?.proxy ?? ""), [settings?.proxy]);
  if (!settings) return null;

  const save = (patch: Partial<Settings>) => saveSettings({ ...settings, ...patch });

  const pickFolder = async () => {
    const dir = await open({ directory: true, defaultPath: settings.downloadDir, title: "Папка для загрузок" });
    if (typeof dir === "string") save({ downloadDir: dir });
  };

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1>Настройки</h1>
      </header>

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>Файлы</h3>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>Папка для загрузок</b>
            <span className="mono">{settings.downloadDir}</span>
          </div>
          <div className={styles.buttons}>
            <button className="btn" onClick={pickFolder}>
              Изменить
            </button>
            <button className="btn ghost" onClick={() => api.openDownloadDir().catch((e) => toast(errorText(e), "error"))}>
              Открыть
            </button>
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>Имя файла</b>
            <span>Для плейлистов добавляется папка с названием плейлиста и номер ролика.</span>
          </div>
          <select className={`field ${styles.selectField}`} value={settings.filenameTemplate} onChange={(e) => save({ filenameTemplate: e.target.value })}>
            {!TEMPLATES.some((t) => t.value === settings.filenameTemplate) && <option value={settings.filenameTemplate}>{settings.filenameTemplate}</option>}
            {TEMPLATES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>Одновременных загрузок</b>
            <span>Остальные ждут в очереди.</span>
          </div>
          <div className={styles.seg}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={`mono ${settings.maxParallel === n ? styles.segOn : ""}`} onClick={() => save({ maxParallel: n })}>
                {n}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>Сеть</h3>
        <form
          className={styles.row}
          onSubmit={(e) => {
            e.preventDefault();
            save({ proxy }).then((ok) => ok && toast(proxy ? "Прокси сохранён" : "Прокси выключен"));
          }}
        >
          <div className={styles.rowText}>
            <b>Прокси</b>
            <span>Например socks5://127.0.0.1:1080. Пусто — без прокси.</span>
          </div>
          <div className={styles.buttons}>
            <input id="proxy" className={`field mono ${styles.proxyField}`} value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder="socks5://…" spellCheck={false} />
            <button className="btn" type="submit" disabled={proxy === settings.proxy}>
              Сохранить
            </button>
          </div>
        </form>
      </section>

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>Компоненты</h3>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>
              yt-dlp <span className="mono">{tools?.ytdlpVersion ?? "…"}</span>
            </b>
            <span>{tools?.message ?? "Скачивает видео. YouTube часто меняется, поэтому YouLoad обновляет его при каждом запуске."}</span>
          </div>
          <button className="btn" disabled={tools?.updating} onClick={() => api.updateTools()}>
            {tools?.updating ? <Loader2 size={14} className={styles.spin} /> : null}
            {tools?.updating ? "Обновляю…" : "Обновить"}
          </button>
        </div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <b>ffmpeg и Deno</b>
            <span>Склейка видео, конвертация и расшифровка ссылок YouTube.</span>
          </div>
          <span className={tools?.ffmpegOk && tools.denoOk ? styles.okText : styles.badText}>{tools?.ffmpegOk && tools.denoOk ? "Установлены" : "Не найдены"}</span>
        </div>
      </section>

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>О программе</h3>
        <p className={styles.about}>
          YouLoad <span className="mono">{version}</span> · открытый код, лицензия MIT. Внутри работают yt-dlp, FFmpeg, Deno и zapret (bol-van, сборка Flowseal) с драйвером WinDivert, каждый под своей лицензией: список лежит в файле app\THIRD-PARTY-NOTICES.txt рядом с программой.
        </p>
      </section>
    </div>
  );
}
