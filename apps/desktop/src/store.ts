import { create } from "zustand";

import { api, errorText, subscribe } from "./lib/api";
import { defaultOptions, resolve } from "./lib/formats";
import type { BypassStatus, DownloadOptions, Job, Settings, StrategyInfo, ToolsStatus } from "./lib/types";

export type View = "downloads" | "bypass" | "settings";

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
}

interface State {
  ready: boolean;
  view: View;
  jobs: Job[];
  selectedId: string | null;
  /** Inspector choices per job, before the download starts. */
  drafts: Record<string, DownloadOptions>;
  settings: Settings | null;
  bypass: BypassStatus;
  tools: ToolsStatus | null;
  strategies: StrategyInfo[];
  platform: string;
  version: string;
  toasts: Toast[];

  init: () => Promise<void>;
  setView: (v: View) => void;
  select: (id: string | null) => void;
  addUrls: (text: string) => Promise<void>;
  updateDraft: (id: string, patch: Partial<DownloadOptions>) => void;
  start: (id: string) => Promise<void>;
  toast: (text: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
  saveSettings: (s: Settings) => Promise<boolean>;
}

let toastSeq = 0;

/** Ready jobs get default choices as soon as their formats are known. */
function withDraft(drafts: Record<string, DownloadOptions>, job: Job): Record<string, DownloadOptions> {
  if (!job.media || drafts[job.id]) return drafts;
  return { ...drafts, [job.id]: job.options ?? defaultOptions(job.media) };
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  view: "downloads",
  jobs: [],
  selectedId: null,
  drafts: {},
  settings: null,
  bypass: { state: "off" },
  tools: null,
  strategies: [],
  platform: "",
  version: "",
  toasts: [],

  init: async () => {
    await subscribe({
      job: (job) =>
        set((s) => {
          const exists = s.jobs.some((j) => j.id === job.id);
          const jobs = exists ? s.jobs.map((j) => (j.id === job.id ? job : j)) : [job, ...s.jobs];
          return { jobs, drafts: withDraft(s.drafts, job) };
        }),
      jobRemoved: (id) =>
        set((s) => {
          const { [id]: _, ...drafts } = s.drafts;
          return { jobs: s.jobs.filter((j) => j.id !== id), drafts, selectedId: s.selectedId === id ? null : s.selectedId };
        }),
      bypass: (bypass) => set({ bypass }),
      tools: (tools) => set({ tools }),
      settings: (settings) => set({ settings }),
    });
    const snap = await api.snapshot();
    let drafts: Record<string, DownloadOptions> = {};
    for (const j of snap.jobs) drafts = withDraft(drafts, j);
    set({
      ready: true,
      jobs: snap.jobs,
      drafts,
      settings: snap.settings,
      bypass: snap.bypass,
      tools: snap.tools,
      strategies: snap.strategies,
      platform: snap.platform,
      version: snap.version,
    });
  },

  setView: (view) => set({ view }),
  select: (selectedId) => set({ selectedId, view: "downloads" }),

  addUrls: async (text) => {
    const parts = text.split(/\s+/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return;
    let first: string | null = null;
    for (const p of parts) {
      try {
        const job = await api.addUrl(p);
        first ??= job.id;
      } catch (e) {
        get().toast(errorText(e), "error");
      }
    }
    if (first) set({ selectedId: first, view: "downloads" });
  },

  updateDraft: (id, patch) => {
    const job = get().jobs.find((j) => j.id === id);
    if (!job?.media) return;
    const current = get().drafts[id] ?? defaultOptions(job.media);
    const next = resolve(job.media, { ...current, ...patch });
    set((s) => ({ drafts: { ...s.drafts, [id]: next } }));
  },

  start: async (id) => {
    const options = get().drafts[id];
    if (!options) return;
    try {
      await api.startJob(id, options);
    } catch (e) {
      get().toast(errorText(e), "error");
    }
  },

  toast: (text, tone = "info") => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
    setTimeout(() => get().dismissToast(id), tone === "error" ? 7000 : 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  saveSettings: async (s) => {
    try {
      const saved = await api.saveSettings(s);
      set({ settings: saved });
      return true;
    } catch (e) {
      get().toast(errorText(e), "error");
      return false;
    }
  },
}));
