import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { ArrowDown, ExternalLink } from "lucide-react";

import { percent, speed } from "@youload/shared/format";
import { useT, type Key } from "@youload/shared/i18n";

import { Menu } from "../../components/Menu";
import { app, CallError, RELEASES_URL, type AppStatus, type JobSummary } from "../../lib/client";
import { initLang } from "../../lib/lang";
import { targetFromUrl, type Target } from "../../lib/target";

const STATUS: Record<string, Key> = {
  analyzing: "row.statusAnalyzing",
  ready: "row.statusReady",
  queued: "row.statusQueued",
  paused: "row.statusPaused",
  done: "row.statusDone",
  error: "row.statusError",
  processing: "row.stageProcessing",
};

const dark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

export function App() {
  const t = useT();
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null | undefined>(undefined);
  const [jobs, setJobs] = useState<JobSummary[]>([]);

  useEffect(() => {
    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => setTarget(targetFromUrl(tab?.url)));
    app
      .status()
      .then((s) => {
        initLang(s);
        setStatus(s);
      })
      .catch((e) => setProblem(e instanceof CallError ? e.code : "app_unavailable"));
  }, []);

  // Downloads list while the popup is open.
  useEffect(() => {
    if (!status) return;
    const load = () => app.jobs().then(setJobs).catch(() => undefined);
    load();
    const timer = setInterval(load, 1500);
    return () => clearInterval(timer);
  }, [status]);

  return (
    <div className={`yl-root popup ${dark() ? "yl-dark" : ""}`}>
      <header className="popup-head">
        <span className="mark">
          <ArrowDown size={13} strokeWidth={3} />
        </span>
        <b>YouLoad</b>
        {status && <span className="ver">{t("ext.connected", { v: status.version })}</span>}
        {status && (
          <button className="yl-link open" onClick={() => app.focus().catch(() => undefined)}>
            {t("ext.openApp")} <ExternalLink size={12} />
          </button>
        )}
      </header>

      {problem ? (
        <div className="yl-menu">
          <b className="yl-title">{problem === "host_missing" ? t("ext.hostMissing") : t("ext.appUnavailable")}</b>
          <p className="yl-hint">{problem === "host_missing" ? t("ext.hostMissingHint") : t("ext.appUnavailableHint")}</p>
          {problem === "host_missing" && (
            <a className="yl-btn yl-primary" href={RELEASES_URL} target="_blank" rel="noreferrer">
              {t("ext.getApp")}
            </a>
          )}
        </div>
      ) : target ? (
        <Menu target={target} onDone={() => window.close()} />
      ) : target === null ? (
        <p className="yl-hint empty">{t("ext.noVideo")}</p>
      ) : null}

      {status && (
        <section className="jobs">
          <h3>{t("ext.downloads")}</h3>
          {jobs.filter((j) => j.status !== "done").length === 0 ? (
            <p className="yl-hint">{t("ext.noDownloads")}</p>
          ) : (
            <ul>
              {jobs
                .filter((j) => j.status !== "done")
                .slice(0, 5)
                .map((j) => (
                  <li key={j.id}>
                    <span className="job-title" title={j.title}>
                      {j.title}
                    </span>
                    <span className="job-state">
                      {j.status === "downloading"
                        ? [percent(j.fraction), j.items && j.item ? `${j.item}/${j.items}` : null, speed(j.speed, t)].filter(Boolean).join(" · ")
                        : t(STATUS[j.status] ?? "row.statusQueued")}
                    </span>
                    {j.status === "downloading" && (
                      <i className="bar">
                        <i style={{ width: `${Math.max(2, (j.fraction ?? 0) * 100)}%` }} />
                      </i>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
