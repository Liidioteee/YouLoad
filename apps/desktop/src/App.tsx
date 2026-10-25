import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import styles from "./App.module.css";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { Toasts } from "./components/Toasts";
import { useStore } from "./store";
import { BypassView } from "./views/BypassView";
import { DownloadsView } from "./views/DownloadsView";
import { SettingsView } from "./views/SettingsView";

export default function App() {
  const ready = useStore((s) => s.ready);
  const view = useStore((s) => s.view);

  useEffect(() => {
    useStore
      .getState()
      .init()
      .catch((e) => useStore.getState().toast(String(e), "error"))
      // The window starts hidden so the user never sees an unstyled flash.
      .finally(() => getCurrentWindow().show());
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

  return (
    <div className={styles.app}>
      <TitleBar />
      <div className={styles.body}>
        <Sidebar />
        <main className={styles.main}>
          {!ready ? null : view === "downloads" ? <DownloadsView /> : view === "bypass" ? <BypassView /> : <SettingsView />}
        </main>
      </div>
      <Toasts />
    </div>
  );
}
