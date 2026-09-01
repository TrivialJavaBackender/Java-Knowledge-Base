import type { Config } from '@netlify/functions';

/**
 * Ежечасный будильник рассылки напоминаний.
 *
 * Функция намеренно не знает ни о базе, ни о Web Push — она только будит
 * `/api/reminders/run`, где Prisma и `web-push` уже собраны плагином Netlify
 * для Next.js. Тащить Prisma Client с его нативным engine в esbuild-бандл
 * отдельной функции пришлось бы вручную (`binaryTargets`, `included_files`),
 * и ломалось бы это на каждом обновлении Prisma.
 *
 * Расписание — UTC, как у всех Scheduled Functions. Попадать в пользовательское
 * «20:30» здесь не пытаемся: раз в час будим роут, а сопоставлением с локальным
 * временем занимается `lib/reminders.ts`. Идемпотентность тоже там — на
 * `User.lastReminderSentAt`, а не на точности cron'а, поэтому лишний запуск
 * (ручной или повторный) второго уведомления не вызывает.
 *
 * Локально расписание не работает: Netlify запускает Scheduled Functions только
 * для опубликованных deploy'ов. Для проверки — `netlify functions:invoke
 * send-review-reminders` или прямой POST на роут (см. README).
 */
export default async (): Promise<Response> => {
  const base = process.env.URL;
  const secret = process.env.CRON_SECRET;

  if (!base || !secret) {
    console.error('reminders: нет URL или CRON_SECRET в окружении функции');
    return new Response('misconfigured', { status: 500 });
  }

  try {
    const res = await fetch(`${base}/api/reminders/run`, {
      method: 'POST',
      headers: { 'x-cron-secret': secret },
    });
    const body = await res.text();

    // Сводка попадает в логи функции — единственное место, где видно, почему
    // напоминание не пришло: не то время, нет карточек, уже отправляли.
    console.log(`reminders: ${res.status} ${body}`);

    // Ненулевой статус роута не делаем ошибкой функции: повторять прогон
    // раньше следующего часа всё равно нечем, а красный запуск в панели
    // Netlify только маскировал бы настоящую причину, которая уже в логе.
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error('reminders: не удалось дозвониться до приложения', err);
    return new Response('upstream failed', { status: 502 });
  }
};

export const config: Config = {
  schedule: '@hourly',
};
