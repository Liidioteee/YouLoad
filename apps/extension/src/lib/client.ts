// Content scripts and the popup cannot talk to the native host directly; they ask the
// background script, which owns the single connection to the YouLoad app.

import { browser } from "wxt/browser";

import type { DownloadOptions, MediaInfo, Preset } from "@youload/shared/types";

export interface AppStatus {
  version: string;
  bypass: { state: string };
  language: string;
  systemLanguage: string;
  theme: string;
  presets: Preset[];
  defaultPreset: string;
}

export interface JobSummary {
  id: string;
  title: string;
  status: string;
  fraction: number | null;
  speed: number | null;
  item: number | null;
  items: number | null;
}

export interface Estimate {
  bytes: number;
  known: number;
  total: number;
}

export interface CallMessage {
  type: "youload-call";
  cmd: string;
  args?: Record<string, unknown>;
}

type Reply<T> = { ok: true; data: T } | { ok: false; error: string; detail?: string };

/** Error codes: host_missing, app_unavailable, or a job error code from the app. */
export class CallError extends Error {
  constructor(
    public code: string,
    public detail = "",
  ) {
    super(code);
  }
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const reply = (await browser.runtime.sendMessage({ type: "youload-call", cmd, args } satisfies CallMessage)) as Reply<T> | undefined;
  if (!reply) throw new CallError("app_unavailable");
  if (!reply.ok) throw new CallError(reply.error, reply.detail);
  return reply.data;
}

export const app = {
  status: () => call<AppStatus>("status"),
  probe: (url: string) => call<MediaInfo>("probe", { url }),
  estimate: (url: string, options: DownloadOptions) => call<Estimate>("estimate", { url, options }),
  enqueue: (url: string, options: DownloadOptions) => call<{ jobId: string }>("enqueue", { url, options }),
  open: (url: string) => call<{ jobId: string }>("open", { url }),
  focus: () => call<null>("focus"),
  jobs: () => call<JobSummary[]>("jobs"),
};

export const RELEASES_URL = "https://github.com/Liidioteee/YouLoad/releases/latest";
