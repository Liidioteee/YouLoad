// Download buttons on YouTube pages and the menu they open.
// YouTube is a single-page app that rebuilds its DOM often, so buttons are (re)attached by a
// periodic check. If none of the known spots exists (YouTube changed its layout), a
// floating button appears instead, so downloading always stays possible.

// Styles ship inside the script and go straight into each shadow root: nothing is fetched
// from the extension at runtime, and no file has to be exposed to YouTube pages.
import menuCss from "../../components/menu.css?inline";

import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Download } from "lucide-react";
import { create } from "zustand";

import { useT } from "@youload/shared/i18n";

import { Menu } from "../../components/Menu";
import { initLang } from "../../lib/lang";
import { playlistOf, targetFromUrl, type Target } from "../../lib/target";

type Look = "pill" | "compact" | "round" | "float";

interface Slot {
  key: string;
  look: Look;
  append: "first" | "last";
  /** Where the button goes on this page, if anywhere. */
  find: () => Element | null;
  target: () => Target | null;
  clip?: boolean;
}

const first = (selectors: string[]) => {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el) return el;
  }
  return null;
};

const SLOTS: Slot[] = [
  {
    key: "watch",
    look: "pill",
    append: "last",
    clip: true,
    find: () => (location.pathname === "/watch" ? first(["ytd-watch-metadata #top-level-buttons-computed", "ytd-watch-metadata #actions-inner #top-level-buttons-computed"]) : null),
    target: () => targetFromUrl(location.href),
  },
  {
    key: "panel",
    look: "compact",
    append: "last",
    find: () =>
      location.pathname === "/watch" && playlistOf(location.href)
        ? first(["ytd-playlist-panel-renderer #playlist-action-menu #top-level-buttons-computed", "ytd-playlist-panel-renderer #playlist-action-menu"])
        : null,
    target: () => playlistOf(location.href),
  },
  {
    key: "shorts",
    look: "round",
    append: "first",
    find: () =>
      location.pathname.startsWith("/shorts/")
        ? first(["ytd-reel-video-renderer[is-active] #actions", "ytd-reel-video-renderer[is-active] reel-action-bar-view-model", "ytd-shorts reel-action-bar-view-model"])
        : null,
    target: () => targetFromUrl(location.href),
  },
  {
    key: "playlist",
    look: "pill",
    append: "last",
    find: () =>
      location.pathname === "/playlist"
        ? first([
            "ytd-playlist-header-renderer .metadata-buttons-wrapper",
            "yt-page-header-renderer yt-flexible-actions-view-model",
            "ytd-playlist-header-renderer #top-level-buttons-computed",
          ])
        : null,
    target: () => targetFromUrl(location.href),
  },
];

/** The open menu, shared by all buttons; rendered once in an overlay over the page. */
const useMenu = create<{ open: { target: Target; rect: DOMRect; clip: boolean } | null }>(() => ({ open: null }));

const isDark = () => document.documentElement.hasAttribute("dark");
const playerTime = () => (document.querySelector("video.html5-main-video") as HTMLVideoElement | null)?.currentTime ?? null;

function Trigger({ slot }: { slot: Slot }) {
  const t = useT();
  const label = slot.key === "panel" || slot.key === "playlist" ? t("ext.downloadPlaylist") : t("ext.download");
  const showText = slot.look === "pill" || slot.look === "float";
  return (
    <div className={`yl-root ${isDark() || slot.look === "round" ? "yl-dark" : ""}`}>
      <button
        className={`yl-trigger ${slot.look === "pill" ? "" : `yl-${slot.look}`}`}
        title={label}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          const target = slot.target();
          if (!target) return;
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const already = useMenu.getState().open;
          useMenu.setState({ open: already && already.target.url === target.url ? null : { target, rect, clip: !!slot.clip } });
        }}
      >
        <Download size={slot.look === "round" ? 22 : 18} />
        {showText && <span>{label}</span>}
      </button>
    </div>
  );
}

function Overlay() {
  const open = useMenu((s) => s.open);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => useMenu.setState({ open: null });
    const onDown = (e: PointerEvent) => {
      if (pop.current && !e.composedPath().includes(pop.current)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    document.addEventListener("yt-navigate-start", close);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("yt-navigate-start", close);
    };
  }, [open]);

  if (!open) return null;
  const width = 320;
  const left = Math.min(Math.max(8, open.rect.right - width), window.innerWidth - width - 8);
  const below = open.rect.bottom + 8;
  const fitsBelow = below + 380 < window.innerHeight;
  const style = fitsBelow ? { left, top: below } : { left, bottom: Math.max(8, window.innerHeight - open.rect.top + 8) };

  return (
    <div className={`yl-root ${isDark() ? "yl-dark" : ""}`}>
      <div className="yl-pop" ref={pop} style={style} role="dialog" aria-label="YouLoad">
        <Menu key={open.target.url} target={open.target} playerTime={open.clip ? playerTime : undefined} onDone={() => useMenu.setState({ open: null })} />
      </div>
    </div>
  );
}

export default defineContentScript({
  matches: ["*://*.youtube.com/*"],
  cssInjectionMode: "manual",
  async main(ctx) {
    initLang();
    type Mounted = { ui: { remove: () => void }; anchor: Element };
    const mounted = new Map<string, Mounted>();
    let navigatedAt = Date.now();

    const mount = async (slot: Slot, anchor: Element) => {
      const ui = await createShadowRootUi<Root>(ctx, {
        name: "youload-button",
        css: menuCss,
        position: "inline",
        anchor,
        append: slot.append,
        onMount: (container, _shadow, host) => {
          host.style.display = "flex";
          host.style.alignItems = "center";
          const root = createRoot(container);
          root.render(<Trigger slot={slot} />);
          return root;
        },
        onRemove: (root) => root?.unmount(),
      });
      ui.mount();
      mounted.set(slot.key, { ui, anchor });
    };

    const floatSlot: Slot = {
      key: "float",
      look: "float",
      append: "last",
      find: () => document.body,
      target: () => targetFromUrl(location.href),
      clip: true,
    };

    let syncing = false;
    const sync = async () => {
      if (syncing) return;
      syncing = true;
      try {
        for (const slot of SLOTS) {
          const el = slot.find();
          const m = mounted.get(slot.key);
          if (m && (m.anchor !== el || !m.anchor.isConnected || !m.anchor.querySelector("youload-button"))) {
            m.ui.remove();
            mounted.delete(slot.key);
          }
          if (el && !mounted.has(slot.key)) await mount(slot, el);
        }
        // Fallback when this page should have a button but YouTube's layout was not recognized.
        const wanted = !!targetFromUrl(location.href);
        const placed = SLOTS.some((s) => s.key !== "panel" && mounted.has(s.key));
        const showFloat = wanted && !placed && Date.now() - navigatedAt > 4000;
        const f = mounted.get("float");
        if (f && !showFloat) {
          f.ui.remove();
          mounted.delete("float");
        } else if (!f && showFloat) {
          await mount(floatSlot, document.body);
        }
      } finally {
        syncing = false;
      }
    };

    // The overlay that shows the menu.
    const overlay = await createShadowRootUi<Root>(ctx, {
      name: "youload-overlay",
      css: menuCss,
      position: "inline",
      anchor: "body",
      append: "last",
      onMount: (container) => {
        const root = createRoot(container);
        root.render(<Overlay />);
        return root;
      },
      onRemove: (root) => root?.unmount(),
    });
    overlay.mount();

    document.addEventListener("yt-navigate-finish", () => {
      navigatedAt = Date.now();
      sync();
    });
    ctx.setInterval(sync, 1000);
    sync();
  },
});
