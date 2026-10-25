import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  AutoselectProgress,
  BypassStatus,
  CheckItem,
  DownloadOptions,
  HistoryItem,
  Job,
  LogLine,
  Settings,
  Snapshot,
  ToolsStatus,
} from "./types";

export const api = {
  snapshot: () => invoke<Snapshot>("get_snapshot"),
  addUrl: (url: string) => invoke<Job>("add_url", { url }),
  setJobOptions: (id: string, options: DownloadOptions) => invoke<void>("set_job_options", { id, options }),
  startJob: (id: string, options: DownloadOptions) => invoke<Job>("start_job", { id, options }),
  pauseJob: (id: string) => invoke<void>("pause_job", { id }),
  resumeJob: (id: string) => invoke<void>("resume_job", { id }),
  cancelJob: (id: string) => invoke<void>("cancel_job", { id }),
  retryJob: (id: string) => invoke<void>("retry_job", { id }),
  removeJob: (id: string) => invoke<void>("remove_job", { id }),
  clearFinished: () => invoke<void>("clear_finished"),
  switchChannelTab: (id: string, tab: string) => invoke<void>("switch_channel_tab", { id, tab }),
  openOutput: (id: string, reveal: boolean) => invoke<void>("open_output", { id, reveal }),
  openHistoryOutput: (id: string, reveal: boolean) => invoke<void>("open_history_output", { id, reveal }),
  removeHistory: (id: string) => invoke<void>("remove_history", { id }),
  clearHistory: () => invoke<void>("clear_history"),
  openDownloadDir: () => invoke<void>("open_download_dir"),
  getLog: () => invoke<LogLine[]>("get_log"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  bypassRestart: () => invoke<void>("bypass_restart"),
  bypassStop: () => invoke<void>("bypass_stop"),
  bypassCheck: () => invoke<CheckItem[]>("bypass_check"),
  bypassAutoselect: () => invoke<string | null>("bypass_autoselect"),
  updateTools: () => invoke<void>("update_tools"),
};

export interface Handlers {
  job: (job: Job) => void;
  jobRemoved: (id: string) => void;
  history: (items: HistoryItem[]) => void;
  bypass: (status: BypassStatus) => void;
  autoselect: (p: AutoselectProgress) => void;
  tools: (status: ToolsStatus) => void;
  settings: (settings: Settings) => void;
  clipboardLink: (url: string) => void;
}

export async function subscribe(h: Handlers): Promise<UnlistenFn> {
  const offs = await Promise.all([
    listen<Job>("job", (e) => h.job(e.payload)),
    listen<string>("job-removed", (e) => h.jobRemoved(e.payload)),
    listen<HistoryItem[]>("history", (e) => h.history(e.payload)),
    listen<BypassStatus>("bypass", (e) => h.bypass(e.payload)),
    listen<AutoselectProgress>("bypass-autoselect", (e) => h.autoselect(e.payload)),
    listen<ToolsStatus>("tools", (e) => h.tools(e.payload)),
    listen<Settings>("settings", (e) => h.settings(e.payload)),
    listen<string>("clipboard-link", (e) => h.clipboardLink(e.payload)),
  ]);
  return () => offs.forEach((off) => off());
}
