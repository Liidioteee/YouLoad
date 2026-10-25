# YouLoad

Программа для скачивания видео и звука с YouTube со встроенным обходом замедления в России.

- Качество до 8K, кодеки AV1, VP9 и H.264, контейнеры MP4, MKV и WebM
- Выбор звуковой дорожки: оригинал или дубляж
- Только звук: MP3, M4A, Opus, FLAC, WAV
- Субтитры, обложка, теги, главы
- Плейлисты и каналы целиком
- Обход блокировок через [zapret](https://github.com/bol-van/zapret) без VPN. Работает, только пока программа открыта.

> Статус: ранняя версия (MVP). Обход блокировок пока только для Windows.

## Сборка

Нужны Node.js 22+, Rust (stable) и, на Windows, Visual Studio Build Tools с компонентом C++.

```bash
npm install
npm run fetch-tools
npm run dev
```

`fetch-tools` скачивает yt-dlp, ffmpeg, Deno и zapret закреплённых версий и проверяет их SHA-256 (см. `scripts/tools.json`).

## Как устроено

| Часть | Где |
|---|---|
| Интерфейс (React + TypeScript) | `apps/desktop/src` |
| Ядро (Rust, Tauri 2) | `apps/desktop/src-tauri/src` |
| Загрузка | yt-dlp, ffmpeg, Deno |
| Обход блокировок | zapret (winws + WinDivert), стратегии из сборки Flowseal |

Обход на Windows требует прав администратора: программа запускает свою копию в режиме помощника (`--bypass-helper`) с запросом UAC. Помощник запускает winws только после проверки хешей файлов zapret, зашитых в программу при сборке, и останавливает его при закрытии программы.

## Лицензия

MIT. Сторонние компоненты распространяются под своими лицензиями, см. `apps/desktop/src-tauri/resources/app/THIRD-PARTY-NOTICES.txt`.
