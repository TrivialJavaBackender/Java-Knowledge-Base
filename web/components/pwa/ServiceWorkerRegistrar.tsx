'use client';

import { useEffect } from 'react';

/**
 * Регистрация service worker'а. Ничего не рисует — живёт в layout ради
 * побочного эффекта.
 *
 * Воркер нужен для двух вещей сразу: без него не приходят push-уведомления и
 * Chrome не предлагает установку на Android. Регистрируем после `load`, чтобы
 * скачивание воркера не конкурировало за канал с первой отрисовкой.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    function register() {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        // Не фатально: без воркера приложение работает, просто без уведомлений
        // и без установки. Молчать всё же нельзя — иначе «push не приходит»
        // придётся отлаживать вслепую.
        console.error('Не удалось зарегистрировать service worker', err);
      });
    }

    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
