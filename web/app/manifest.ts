import type { MetadataRoute } from 'next';

/**
 * Манифест PWA — Next отдаёт его по `/manifest.webmanifest` и сам проставляет
 * `<link rel="manifest">` в `<head>`.
 *
 * Путь исключён из матчера в `middleware.ts`: манифест запрашивается без
 * учётных данных, и редирект на `/login` вместо JSON лишил бы приложение
 * установки — Chrome просто не показал бы «Установить приложение».
 *
 * `start_url` ведёт на `/review`, а не на дашборд: смысл установки в том, чтобы
 * путь до первой карточки был в один тап, и запуск с домашнего экрана должен
 * вести туда же, куда уведомление.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Interview Prep',
    short_name: 'Prep',
    description: 'Теория, упражнения и повторение карточек по расписанию Лейтнера.',
    start_url: '/review',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'ru',
    // Цвет шапки системы и фон сплэш-экрана. Совпадают с `--accent` и `--bg`
    // светлой темы из `app/globals.css`.
    theme_color: '#0969da',
    background_color: '#ffffff',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Отдельная maskable-версия обязательна: у обычной иконки лаунчер Android
      // обрезал бы углы плашки вместе с рисунком.
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Повторение', short_name: 'Повторить', url: '/review' },
      { name: 'Настройки', short_name: 'Настройки', url: '/settings' },
    ],
  };
}
