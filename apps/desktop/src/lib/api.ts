import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { BypassStatus, CheckItem, DownloadOptions, Job, Settings, Snapshot, ToolsStatus } from "./types";

export const api = {
  snapshot: () => invoke<Snapshot>("get_snapshot"),
  addUrl: (url: string) => invoke<Job>("add_url", { url }),
  setJobOptions: (id: string, options: DownloadOptions) => invoke<void>("set_job_options", { id, options }),
  startJob: (id: string, options: DownloadOptions) => invoke<Job>("start_job", { id, options }),
  cancelJob: (id: string) => invoke<void>("cancel_job", { id }),
  retryJob: (id: string) => invoke<void>("retry_job", { id }),
  removeJob: (id: string) => invoke<void>("remove_job", { id }),
  clearFinished: () => invoke<void>("clear_finished"),
  openOutput: (id: string, reveal: boolean) => invoke<void>("open_output", { id, reveal }),
  openDownloadDir: () => invoke<void>("open_download_dir"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  bypassRestart: () => invoke<void>("bypass_restart"),
  bypassStop: () => invoke<void>("bypass_stop"),
  bypassCheck: () => invoke<CheckItem[]>("bypass_check"),
  updateTools: () => invoke<void>("update_tools"),
};

export interface Handlers {
  job: (job: Job) => void;
  jobRemoved: (id: string) => void;
  bypass: (status: BypassStatus) => void;
  tools: (status: ToolsStatus) => void;
  settings: (settings: Settings) => void;
}

export async function subscribe(h: Handlers): Promise<UnlistenFn> {
  const offs = await Promise.all([
    listen<Job>("job", (e) => h.job(e.payload)),
    listen<string>("job-removed", (e) => h.jobRemoved(e.payload)),
    listen<BypassStatus>("bypass", (e) => h.bypass(e.payload)),
    listen<ToolsStatus>("tools", (e) => h.tools(e.payload)),
    listen<Settings>("settings", (e) => h.settings(e.payload)),
  ]);
  return () => offs.forEach((off) => off());
}

/** Tauri rejects with a plain string from our commands. */
export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Что-то пошло не так";
}
