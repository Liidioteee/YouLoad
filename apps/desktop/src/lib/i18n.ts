// Tiny i18n: typed keys, {var} substitution, plural arrays picked by Intl.PluralRules.

import { useCallback } from "react";
import { create } from "zustand";

import { en } from "./locales/en";
import { ru } from "./locales/ru";

export type Lang = "ru" | "en";
type Dict = typeof ru;
type Leaf = string | string[];
type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends Leaf ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];
export type Key = Paths<Dict>;
export type Vars = Record<string, string | number>;

const DICTS: Record<Lang, Dict> = { ru, en };

export const useLang = create<{ lang: Lang }>(() => ({ lang: "ru" }));

export function resolveLang(setting: string, system: string): Lang {
  if (setting === "ru" || setting === "en") return setting;
  const s = (system || navigator.language || "").toLowerCase();
  return ["ru", "uk", "be", "kk"].some((p) => s.startsWith(p)) ? "ru" : "en";
}

export function setLang(lang: Lang) {
  useLang.setState({ lang });
  document.documentElement.lang = lang;
}

function lookup(lang: Lang, path: string): Leaf | undefined {
  let node: unknown = DICTS[lang];
  for (const part of path.split(".")) {
    if (node && typeof node === "object" && part in (node as object)) node = (node as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof node === "string" || Array.isArray(node) ? (node as Leaf) : undefined;
}

const pluralIndex: Record<Lang, (n: number) => number> = {
  ru: (n) => {
    const r = new Intl.PluralRules("ru").select(n);
    return r === "one" ? 0 : r === "few" ? 1 : 2;
  },
  en: (n) => (n === 1 ? 0 : 1),
};

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function translate(lang: Lang, key: string, vars?: Vars): string {
  const v = lookup(lang, key) ?? lookup("ru", key);
  if (v == null) return key;
  if (Array.isArray(v)) {
    const n = Number(vars?.n ?? 0);
    return fill(v[pluralIndex[lang](n)] ?? v[v.length - 1], vars);
  }
  return fill(v, vars);
}

/** For keys built at runtime (error codes): returns undefined when missing. */
export function translateDynamic(lang: Lang, key: string, vars?: Vars): string | undefined {
  const v = lookup(lang, key);
  if (v == null || Array.isArray(v)) return undefined;
  return fill(v, vars);
}

export type T = ((key: Key, vars?: Vars) => string) & { lang: Lang };

export function useT(): T {
  const lang = useLang((s) => s.lang);
  const fn = useCallback((key: Key, vars?: Vars) => translate(lang, key, vars), [lang]);
  return Object.assign(fn, { lang });
}

/** Translation outside React (store actions, toasts). */
export function tNow(key: Key, vars?: Vars): string {
  return translate(useLang.getState().lang, key, vars);
}

export function jobError(lang: Lang, code: string): { title: string; hint: string } {
  const v = lookup(lang, `jobErrors.${code}`) ?? lookup(lang, "jobErrors.unknown");
  const [title, hint] = Array.isArray(v) ? v : ["", ""];
  return { title, hint };
}

/** Command errors from the core are codes; anything else is shown as is. */
export function errorText(e: unknown): string {
  const lang = useLang.getState().lang;
  const raw = typeof e === "string" ? e : e instanceof Error ? e.message : (e as { detail?: string })?.detail;
  if (!raw) return translate(lang, "errors.generic");
  return translateDynamic(lang, `errors.${raw}`) ?? raw;
}

/** A translator bound to the current language, for code outside components. */
export function currentT(): T {
  const lang = useLang.getState().lang;
  return Object.assign((key: Key, vars?: Vars) => translate(lang, key, vars), { lang });
}
