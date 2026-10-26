// Owns the one connection to the YouLoad app (through the native messaging host) and the
// context menu items. Content scripts and the popup reach the app through here.

import { browser, type Browser } from "wxt/browser";

import { applyPreset, findPreset } from "@youload/shared/presets";
import type { MediaInfo } from "@youload/shared/types";

import type { AppStatus, CallMessage } from "../lib/client";
import { initLang } from "../lib/lang";
import { presetSettings } from "../lib/options";
import { targetFromUrl } from "../lib/target";

const HOST = "app.youload.host";
const TIMEOUT_MS = 3 * 60 * 1000;

export default defineBackground(() => {
  let port: Browser.runtime.Port | null = null;
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: string) => void; timer: ReturnType<typeof setTimeout> }>();
  /** The browser's own words for the last connection failure, shown under the error. */
  let lastDetail = "";

  const failAll = (code: string) => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(code);
    }
    pending.clear();
  };

  function connect(): Browser.runtime.Port {
    if (port) return port;
    const p = browser.runtime.connectNative(HOST);
    p.onMessage.addListener((msg: { id: number | null; ok: boolean; data?: unknown; error?: string }) => {
      if (msg.id == null) {
        // The host could not reach or start the app.
        failAll(msg.error ?? "app_unavailable");
        return;
      }
      const waiting = pending.get(msg.id);
      if (!waiting) return;
      pending.delete(msg.id);
      clearTimeout(waiting.timer);
      if (msg.ok) waiting.resolve(msg.data);
      else waiting.reject(msg.error ?? "unknown");
    });
    p.onDisconnect.addListener(() => {
      // Chrome reports through runtime.lastError, Firefox through port.error.
      const raw = browser.runtime.lastError?.message ?? (p as unknown as { error?: { message?: string } }).error?.message ?? "";
      lastDetail = raw;
      const why = raw.toLowerCase();
      port = null;
      // Chrome: "Specified native messaging host not found."; Firefox: "No such native application".
      failAll(why.includes("not found") || why.includes("no such native") ? "host_missing" : "app_unavailable");
    });
    port = p;
    return p;
  }

  function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      let p: Browser.runtime.Port;
      try {
        p = connect();
      } catch (e) {
        lastDetail = e instanceof Error ? e.message : String(e);
        reject("host_missing");
        return;
      }
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject("app_unavailable");
      }, TIMEOUT_MS);
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      p.postMessage({ id, cmd, ...args });
    });
  }

  browser.runtime.onMessage.addListener((msg: CallMessage, _sender, sendResponse) => {
    if (msg?.type !== "youload-call") return;
    call(msg.cmd, msg.args)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: String(error), detail: lastDetail }));
    return true; // answer asynchronously
  });

  // Context menu: on YouTube links, and on YouTube pages themselves.
  const VIDEO_PATTERNS = ["*://*.youtube.com/watch*", "*://youtu.be/*", "*://*.youtube.com/shorts/*", "*://*.youtube.com/playlist*"];
  browser.runtime.onInstalled.addListener(() => {
    const t = initLang();
    browser.contextMenus.removeAll().then(() => {
      for (const [ctx, patterns] of [
        ["link", { targetUrlPatterns: VIDEO_PATTERNS }],
        ["page", { documentUrlPatterns: VIDEO_PATTERNS }],
      ] as const) {
        browser.contextMenus.create({ id: `${ctx}-download`, title: t("ext.ctxDownload"), contexts: [ctx], ...patterns });
        browser.contextMenus.create({ id: `${ctx}-open`, title: t("ext.ctxOpen"), contexts: [ctx], ...patterns });
      }
    });
  });

  const flash = async (tabId: number | undefined, text: string, color: string) => {
    await browser.action.setBadgeBackgroundColor({ color, tabId });
    await browser.action.setBadgeText({ text, tabId });
    setTimeout(() => browser.action.setBadgeText({ text: "", tabId }), 4000);
  };

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    const target = targetFromUrl(info.linkUrl ?? info.pageUrl);
    if (!target) return;
    try {
      if (String(info.menuItemId).endsWith("-open")) {
        await call("open", { url: target.url });
        return;
      }
      // Quick download with the preset used last in the menu, or the app's default.
      const status = await call<AppStatus>("status");
      const t = initLang(status);
      const media = await call<MediaInfo>("probe", { url: target.url });
      const { lastPreset } = (await browser.storage.local.get("lastPreset")) as { lastPreset?: string };
      const options = applyPreset(media, findPreset(presetSettings(status), lastPreset ?? status.defaultPreset), t);
      await call("enqueue", { url: target.url, options });
      await flash(tab?.id, "✓", "#1d9a60");
    } catch {
      await flash(tab?.id, "!", "#d44343");
    }
  });
});
