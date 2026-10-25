// Stable error codes from the core → what the user reads and can do about it.

export interface Explained {
  title: string;
  hint: string;
  /** Offer a button that opens the bypass screen. */
  bypass?: boolean;
}

const JOB: Record<string, Explained> = {
  bot_check: {
    title: "YouTube просит подтвердить, что вы не бот",
    hint: "Повторите через несколько минут или выберите другую стратегию обхода. Вход через cookies появится в следующей версии.",
    bypass: true,
  },
  age_restricted: { title: "Ролик 18+, нужен вход в аккаунт", hint: "Загрузка с входом в аккаунт появится в следующей версии." },
  members_only: { title: "Ролик только для спонсоров канала", hint: "Для него нужен вход в аккаунт со спонсорством." },
  private: { title: "Это закрытый ролик", hint: "Автор ограничил доступ. Скачать его нельзя." },
  geo_blocked: { title: "Ролик недоступен в вашей стране", hint: "Попробуйте через прокси другой страны в настройках." },
  unavailable: { title: "Ролик удалён или недоступен", hint: "Проверьте ссылку в браузере." },
  no_format: { title: "Выбранный формат недоступен", hint: "Выберите другое качество или кодек." },
  forbidden: { title: "YouTube отклонил загрузку", hint: "Обновите yt-dlp в настройках и повторите." },
  network: { title: "Нет связи с YouTube", hint: "Проверьте интернет и обход блокировок.", bypass: true },
  timeout: { title: "YouTube не ответил вовремя", hint: "Проверьте обход блокировок и повторите.", bypass: true },
  ffmpeg: { title: "Не удалось обработать видео", hint: "Попробуйте контейнер MKV или другой кодек." },
  disk_full: { title: "Не хватает места на диске", hint: "Освободите место или выберите другую папку в настройках." },
  folder: { title: "Нет доступа к папке загрузок", hint: "Выберите другую папку в настройках." },
  tool_missing: { title: "Не найдены компоненты программы", hint: "Переустановите YouLoad." },
  unknown: { title: "Не удалось скачать", hint: "Повторите. Если ошибка не уходит, обновите yt-dlp в настройках." },
};

export function explainJob(code: string): Explained {
  return JOB[code] ?? JOB.unknown;
}

const BYPASS: Record<string, string> = {
  uac_denied: "Вы отклонили запрос прав администратора. Без них zapret не может перехватывать соединения.",
  integrity: "Файлы zapret изменены или повреждены. Переустановите YouLoad.",
  winws_exited: "zapret остановился сам. Частая причина — антивирус: добавьте папку YouLoad в исключения.",
  winws_spawn_failed: "Не удалось запустить zapret. Возможно, его заблокировал антивирус.",
  winws_timeout: "zapret не запустился. Возможно, его заблокировал антивирус.",
  bad_strategy: "Стратегия не найдена. Выберите другую.",
  unknown_strategy: "Стратегия не найдена. Выберите другую.",
  parent_gone: "Помощник обхода не смог связаться с программой. Перезапустите обход.",
  launch_failed: "Не удалось запустить помощник обхода.",
  helper_exited: "Помощник обхода неожиданно завершился.",
};

export function explainBypass(code: string): string {
  return BYPASS[code] ?? BYPASS.helper_exited;
}
