// Human-readable numbers in Russian conventions (decimal comma, short units).

const num1 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const num2 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("ru-RU");

export function bytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} Б`;
  if (n < 1024 ** 2) return `${num1.format(n / 1024)} КБ`;
  if (n < 1024 ** 3) return `${num1.format(n / 1024 ** 2)} МБ`;
  return `${num2.format(n / 1024 ** 3)} ГБ`;
}

export function speed(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps) || bps <= 0) return "";
  return `${bytes(bps)}/с`;
}

export function clock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function percent(fraction: number | null | undefined): string {
  if (fraction == null) return "";
  return `${Math.floor(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

export function views(n: number | null | undefined): string {
  if (n == null) return "";
  if (n >= 1e9) return `${num1.format(n / 1e9)} млрд просмотров`;
  if (n >= 1e6) return `${num1.format(n / 1e6)} млн просмотров`;
  if (n >= 1e3) return `${num1.format(n / 1e3)} тыс. просмотров`;
  return `${int.format(n)} просмотров`;
}

/** "5 видео", "21 видео" — the word does not change, but keep one place for plurals. */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
