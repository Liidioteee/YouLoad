import { create } from "zustand";

import { api, subscribe } from "./lib/api";
import { resolve } from "./lib/formats";
import { currentT, errorText, resolveLang, setLang } from "./lib/i18n";
import { applyPreset, findPreset } from "./lib/presets";
import type { AutoselectProgress, BypassStatus, DownloadOptions, HistoryItem, Job, Settings, StrategyInfo, ToolsStatus } from "./lib/types";

export type View = "downloads" | "history" | "bypass" | "settings";

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
  action?: { label: string; run: () => void };
}

interface State {
  ready: boolean;
  view: View;
  jobs: Job[];
  history: HistoryItem[];
  /** Selected job ids; the last one is the anchor for Shift+click. */
  selected: string[];
  /** Inspector choices per job, before the download starts. */
  drafts: Record<string, DownloadOptions>;
  settings: Settings | null;
  bypass: BypassStatus;
  bypassService: boolean;
  autoselect: AutoselectProgress | null;
  tools: ToolsStatus | null;
  strategies: StrategyInfo[];
  platform: string;
  version: string;
  systemLanguage: string;
  toasts: Toast[];

  init: () => Promise<void>;
  setView: (v: View) => void;
  select: (id: string, how?: "single" | "toggle" | "range") => void;
  clearSelection: () => void;
  addUrls: (text: string) => Promise<void>;
  updateDraft: (id: string, patch: Partial<DownloadOptions>) => void;
  applyPresetTo: (ids: string[], presetId: string) => void;
  start: (id: string) => Promise<void>;
  toast: (text: string, tone?: Toast["tone"], action?: Toast["action"]) => void;
  dismissToast: (id: number) => void;
  saveSettings: (patch: Partial<Settings>) => Promise<boolean>;
}

let toastSeq = 0;

/** Language and theme follow the settings; "system" theme follows the OS live. */
export function applyAppearance(settings: Settings, systemLanguage: string) {
  setLang(resolveLang(settings.language, systemLanguage));
  const dark = settings.theme === "dark" || (settings.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function draftFor(job: Job, settings: Settings | null): DownloadOptions | null {
  if (!job.media) return null;
  if (job.options) return job.options;
  return applyPreset(job.media, findPreset(settings, settings?.defaultPreset), currentT());
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  view: "downloads",
  jobs: [],
  history: [],
  selected: [],
  drafts: {},
  settings: null,
  bypass: { state: "off" },
  bypassService: false,
  autoselect: null,
  tools: null,
  strategies: [],
  platform: "",
  version: "",
  systemLanguage: "",
  toasts: [],

  init: async () => {
    await subscribe({
      job: (job) =>
        set((s) => {
          const prev = s.jobs.find((j) => j.id === job.id);
          const jobs = prev ? s.jobs.map((j) => (j.id === job.id ? job : j)) : [job, ...s.jobs];
          // Different media arrived (first analysis, retry, another channel tab): start from the
          // default preset. A failed tab switch keeps the old media and the user's choices.
          const fresh = job.media && (!s.drafts[job.id] || prev?.media?.url !== job.media.url);
          const draft = fresh ? draftFor(job, s.settings) : null;
          return { jobs, drafts: draft ? { ...s.drafts, [job.id]: draft } : s.drafts };
        }),
      jobRemoved: (id) =>
        set((s) => {
          const { [id]: _, ...drafts } = s.drafts;
          return { jobs: s.jobs.filter((j) => j.id !== id), drafts, selected: s.selected.filter((x) => x !== id) };
        }),
      history: (history) => set({ history }),
      bypass: (bypass) => set({ bypass }),
      autoselect: (autoselect) => set({ autoselect }),
      tools: (tools) => set({ tools }),
      settings: (settings) => {
        applyAppearance(settings, get().systemLanguage);
        set({ settings });
      },
      clipboardLink: (url) => {
        const t = currentT();
        get().toast(`${t("clipboard.found")}: ${url}`, "info", { label: t("common.add"), run: () => get().addUrls(url) });
      },
    });
    const snap = await api.snapshot();
    applyAppearance(snap.settings, snap.systemLanguage);
    const drafts: Record<string, DownloadOptions> = {};
    for (const j of snap.jobs) {
      const d = draftFor(j, snap.settings);
      if (d) drafts[j.id] = d;
    }
    set({
      ready: true,
      jobs: snap.jobs,
      history: snap.history,
      drafts,
      settings: snap.settings,
      bypass: snap.bypass,
      bypassService: snap.bypassService,
      tools: snap.tools,
      strategies: snap.strategies,
      platform: snap.platform,
      version: snap.version,
      systemLanguage: snap.systemLanguage,
    });
  },

  setView: (view) => set({ view }),

  select: (id, how = "single") =>
    set((s) => {
      if (how === "toggle") {
        const has = s.selected.includes(id);
        return { selected: has ? s.selected.filter((x) => x !== id) : [...s.selected, id], view: "downloads" };
      }
      if (how === "range" && s.selected.length) {
        const order = s.jobs.map((j) => j.id);
        const a = order.indexOf(s.selected[s.selected.length - 1]);
        const b = order.indexOf(id);
        if (a >= 0 && b >= 0) {
          const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
          return { selected: [...new Set([...s.selected, ...range])], view: "downloads" };
        }
      }
      return { selected: [id], view: "downloads" };
    }),
  clearSelection: () => set({ selected: [] }),

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
    if (first) set({ selected: [first], view: "downloads" });
  },

  updateDraft: (id, patch) => {
    const job = get().jobs.find((j) => j.id === id);
    if (!job?.media) return;
    const current = get().drafts[id] ?? draftFor(job, get().settings);
    if (!current) return;
    // Any manual tweak of quality, codec or language goes back to automatic picking.
    const leavesManual = ["mode", "maxHeight", "videoCodec", "audioLanguage", "container", "audioCodec"].some((k) => k in patch);
    const next = resolve(job.media, { ...current, ...(leavesManual ? { manualFormats: false } : {}), ...patch, preset: "preset" in patch ? patch.preset! : null });
    set((s) => ({ drafts: { ...s.drafts, [id]: next } }));
  },

  applyPresetTo: (ids, presetId) => {
    const { jobs, settings, drafts } = get();
    const preset = findPreset(settings, presetId);
    const t = currentT();
    const next = { ...drafts };
    for (const id of ids) {
      const job = jobs.find((j) => j.id === id);
      if (!job?.media || !["ready", "error", "canceled", "done"].includes(job.status)) continue;
      const keep = drafts[id];
      next[id] = applyPreset(job.media, preset, t, { playlistItems: keep?.playlistItems, sectionStart: keep?.sectionStart, sectionEnd: keep?.sectionEnd });
    }
    set({ drafts: next });
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

  toast: (text, tone = "info", action) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone, action }] }));
    setTimeout(() => get().dismissToast(id), action ? 12000 : tone === "error" ? 7000 : 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  saveSettings: async (patch) => {
    const current = get().settings;
    if (!current) return false;
    try {
      const saved = await api.saveSettings({ ...current, ...patch });
      applyAppearance(saved, get().systemLanguage);
      set({ settings: saved });
      return true;
    } catch (e) {
      get().toast(errorText(e), "error");
      return false;
    }
  },
}));
