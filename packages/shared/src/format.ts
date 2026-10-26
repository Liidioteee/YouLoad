// Human-readable numbers in the UI language (decimal comma in Russian, short units).

import type { T } from "./i18n";

const nf = (lang: string, digits: number) => new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-US", { maximumFractionDigits: digits });

export function bytes(n: number | null | undefined, t: T): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${Math.round(n)} ${t("units.b")}`;
  if (n < 1024 ** 2) return `${nf(t.lang, 1).format(n / 1024)} ${t("units.kb")}`;
  if (n < 1024 ** 3) return `${nf(t.lang, 1).format(n / 1024 ** 2)} ${t("units.mb")}`;
  return `${nf(t.lang, 2).format(n / 1024 ** 3)} ${t("units.gb")}`;
}

export function speed(bps: number | null | undefined, t: T): string {
  if (bps == null || !Number.isFinite(bps) || bps <= 0) return "";
  return `${bytes(bps, t)}${t("units.perSec")}`;
}

export function clock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "1:20", "01:02:30", "95" → seconds; null when it does not parse. */
export function parseClock(text: string): number | null {
  const parts = text.trim().split(":").map((p) => p.trim());
  if (!parts.length || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function percent(fraction: number | null | undefined): string {
  if (fraction == null) return "";
  return `${Math.floor(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

export function compact(n: number, t: T): string {
  const f = nf(t.lang, 1);
  if (n >= 1e9) return t("units.billion", { n: f.format(n / 1e9) });
  if (n >= 1e6) return t("units.million", { n: f.format(n / 1e6) });
  if (n >= 1e4) return t("units.thousand", { n: f.format(n / 1e3) });
  return nf(t.lang, 0).format(n);
}

export function views(n: number | null | undefined, t: T): string {
  if (n == null) return "";
  // Plural rules see the raw number for small counts; "1,2 млн" falls into the "many" form.
  return t("units.views", { n: n < 1e4 ? n : compact(n, t) });
}

export function date(ms: number, t: T): string {
  return new Intl.DateTimeFormat(t.lang === "ru" ? "ru-RU" : "en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}
