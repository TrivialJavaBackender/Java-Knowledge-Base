/*
 * Service worker: приём push, показ уведомления и переход к повторению.
 *
 * Кэширования нет намеренно. Весь контент отдаётся динамически (очередь
 * Лейтнера, прогресс, дашборд), и закэшированная страница показала бы вчерашние
 * числа — хуже, чем честная ошибка сети. Обработчик `fetch` здесь ровно один и
 * нужен для другого: без него Chrome не считает приложение устанавливаемым.
 *
 * Файл лежит в `public/` и отдаётся с корня, поэтому его scope — весь сайт.
 * `middleware.ts` исключает `/sw.js` из проверки сессии: воркер должен
 * скачиваться и обновляться независимо от того, жива ли кука.
 */

const REVIEW_URL = '/review';

self.addEventListener('install', () => {
  // Новая версия воркера вступает в силу сразу, не дожидаясь закрытия всех
  // вкладок: старый воркер мог бы ещё сутки показывать нотификации по
  // предыдущему коду.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  // Payload шифруется целиком и приходит вместе с событием — ходить за числом
  // карточек в сеть не нужно, и уведомление показывается даже офлайн.
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    console.error('sw: неразбираемый payload', err);
  }

  const title = payload.title || 'Пора повторить';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    // Один tag на все напоминания: новое заменяет предыдущее в шторке, а не
    // ложится вторым уведомлением.
    tag: payload.tag || 'review-reminder',
    renotify: true,
    data: { url: payload.url || REVIEW_URL },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || REVIEW_URL;
  const targetUrl = new URL(target, self.location.origin);

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        // Без этого не видны вкладки, которые ещё не контролируются воркером
        // (открытые до его установки), и мы открыли бы дубль поверх живого окна.
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        // navigate доступен не во всех браузерах — фокус важнее перехода,
        // поэтому он уже сделан, а неудача навигации не должна ронять обработчик.
        if ('navigate' in client) {
          try {
            await client.navigate(targetUrl.href);
          } catch (err) {
            console.error('sw: не удалось перевести окно на', targetUrl.href, err);
          }
        }
        return;
      }

      await self.clients.openWindow(targetUrl.href);
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  // Только навигация. Перехватывать вообще всё опасно: server actions и
  // потоковый ответ Next.js проходят через тот же обработчик, и лишняя обёртка
  // ломает их без внятной ошибки.
  if (event.request.mode !== 'navigate') return;

  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(
          '<!doctype html><meta charset="utf-8"><title>Нет сети</title>' +
            '<body style="font:16px system-ui;padding:2rem;color:#57606a">' +
            '<h1 style="font-size:1.25rem;color:#1f2328">Нет сети</h1>' +
            '<p>Повторение требует соединения — карточки берутся из базы.</p>' +
            '<p><a href="/review">Попробовать снова</a></p>',
          { headers: { 'content-type': 'text/html; charset=utf-8' }, status: 503 },
        ),
    ),
  );
});
