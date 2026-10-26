import { currentT, resolveLang, setLang, type T } from "@youload/shared/i18n";

import type { AppStatus } from "./client";

/** Until the app answers, follow the browser; then follow the app's language setting. */
export function initLang(status?: AppStatus | null): T {
  setLang(status ? resolveLang(status.language, status.systemLanguage) : resolveLang("system", navigator.language));
  return currentT();
}
