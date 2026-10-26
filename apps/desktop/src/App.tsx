import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Link2 } from "lucide-react";

import styles from "./App.module.css";
import { Onboarding } from "./components/Onboarding";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { Toasts } from "./components/Toasts";
import { UpdateBanner } from "./components/UpdateBanner";
import { useT } from "@youload/shared/i18n";
import { applyAppearance, useStore } from "./store";
import { BypassView } from "./views/BypassView";
import { DownloadsView } from "./views/DownloadsView";
import { HistoryView } from "./views/HistoryView";
import { SettingsView } from "./views/SettingsView";

export default function App() {
  const t = useT();
  const ready = useStore((s) => s.ready);
  const view = useStore((s) => s.view);
  const onboarded = useStore((s) => s.settings?.onboarded ?? true);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    useStore
      .getState()
      .init()
      .catch((e) => useStore.getState().toast(String(e), "error"))
      // The window starts hidden so the user never sees an unstyled flash.
      .finally(() => getCurrentWindow().show());
  }, []);

  // "System" theme follows the OS while the app runs.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const { settings, systemLanguage } = useStore.getState();
      if (settings) applyAppearance(settings, systemLanguage);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Ctrl+V anywhere outside a text field adds the copied links.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (text.trim()) {
        e.preventDefault();
        useStore.getState().addUrls(text);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  // Links dragged from a browser tab or address bar.
  useEffect(() => {
    let depth = 0;
    const hasLink = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].some((x) => x === "text/uri-list" || x === "text/plain");
    const onEnter = (e: DragEvent) => {
      if (!hasLink(e)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasLink(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      const text = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain") || "";
      const links = text
        .split(/\r?\n/)
        .filter((l) => l && !l.startsWith("#"))
        .join(" ");
      if (links.trim()) {
        e.preventDefault();
        useStore.getState().addUrls(links);
      }
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return (
    <div className={styles.app}>
      <TitleBar />
      <div className={styles.body}>
        <Sidebar />
        <main className={styles.main}>
          <UpdateBanner />
          <div className={styles.view}>
            {!ready ? null : view === "downloads" ? (
              <DownloadsView />
            ) : view === "history" ? (
              <HistoryView />
            ) : view === "bypass" ? (
              <BypassView />
            ) : (
              <SettingsView />
            )}
          </div>
        </main>
      </div>
      {dragging && (
        <div className={styles.drop}>
          <Link2 size={28} />
          <span>{t("downloads.drop")}</span>
        </div>
      )}
      {ready && !onboarded && <Onboarding />}
      <Toasts />
    </div>
  );
}
