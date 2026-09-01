/**
 * Отправка Web Push. Только server-side: здесь читается `VAPID_PRIVATE_KEY`, и
 * импорт этого модуля из клиентского компонента утащил бы приватный ключ в
 * браузерный бандл. В браузер уезжает исключительно `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
 *
 * Модуль разделён надвое: `deliverToSubscriptions` — цикл доставки с
 * инъектируемым отправителем (его и проверяют тесты, без сети), `sendToUser` —
 * обвязка с базой поверх него.
 */

import webpush from 'web-push';
import { prisma } from '@/lib/db';
import type { ReminderPayload } from '@/lib/reminders';

export interface StoredSubscription {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Отправитель одной нотификации. Реальный — web-push, в тестах — заглушка. */
export type PushSender = (sub: StoredSubscription, payload: string) => Promise<void>;

export interface DeliveryResult {
  sent: number;
  /** id подписок, которых больше нет у push-сервиса (404/410) — их надо погасить. */
  gone: number[];
  /** id подписок с прочими ошибками: сеть, 5xx у провайдера. Подписку не трогаем. */
  failed: number[];
}

let vapidConfigured = false;

/**
 * Ленивая настройка VAPID: на этапе сборки переменных окружения может не быть,
 * и падать хочется в момент реальной отправки, а не при импорте модуля любой
 * страницей.
 */
export function configureVapid(): void {
  if (vapidConfigured) return;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    throw new Error(
      'Web Push не настроен: нужны VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY и VAPID_SUBJECT',
    );
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

/** Настроен ли Web Push — чтобы UI мог честно сказать «не настроено» вместо 500. */
export function isPushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT,
  );
}

/** Ошибка web-push несёт HTTP-код провайдера в `statusCode`. */
function statusCodeOf(err: unknown): number | null {
  if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    const code = (err as { statusCode: unknown }).statusCode;
    if (typeof code === 'number') return code;
  }
  return null;
}

const webPushSender: PushSender = async (sub, payload) => {
  configureVapid();
  await webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    payload,
  );
};

/**
 * Разослать по всем подписками пользователя, не прерываясь на ошибке.
 *
 * У одного человека подписок несколько (телефон, ноутбук, установленное PWA
 * отдельно от вкладки), и протухшая подписка ноутбука не должна лишать телефон
 * уведомления. Поэтому: последовательный проход, каждая ошибка
 * классифицируется, наружу исключение не выходит вообще — вызывающий смотрит
 * на счётчики.
 *
 * 404 и 410 — единственные коды, означающие «подписки больше нет»: браузер
 * отозвал её, приложение снесли, пользователь очистил данные сайта. Всё
 * остальное (5xx, таймаут) — временное, подписку по такому поводу гасить
 * нельзя, иначе одна авария у провайдера отпишет пользователя навсегда.
 */
export async function deliverToSubscriptions(
  subs: StoredSubscription[],
  payload: ReminderPayload,
  send: PushSender = webPushSender,
): Promise<DeliveryResult> {
  const body = JSON.stringify(payload);
  const result: DeliveryResult = { sent: 0, gone: [], failed: [] };

  for (const sub of subs) {
    try {
      await send(sub, body);
      result.sent += 1;
    } catch (err) {
      const status = statusCodeOf(err);
      if (status === 404 || status === 410) {
        result.gone.push(sub.id);
        console.warn(`push: подписка ${sub.id} протухла (${status}), гасим`);
      } else {
        result.failed.push(sub.id);
        console.error(`push: подписка ${sub.id} не доставлена`, err);
      }
    }
  }

  return result;
}

/**
 * Отправить пользователю и привести базу в соответствие результату:
 * протухшие подписки гаснут, у доставленных обновляется `lastUsedAt`.
 */
export async function sendToUser(
  userId: number,
  payload: ReminderPayload,
  send?: PushSender,
): Promise<DeliveryResult> {
  const subs = await prisma.pushSubscription.findMany({
    where: { userId, active: true },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  const result = await deliverToSubscriptions(subs, payload, send);

  if (result.gone.length > 0) {
    await prisma.pushSubscription.updateMany({
      where: { id: { in: result.gone } },
      data: { active: false },
    });
  }
  if (result.sent > 0) {
    const deliveredIds = subs
      .map((s) => s.id)
      .filter((id) => !result.gone.includes(id) && !result.failed.includes(id));
    await prisma.pushSubscription.updateMany({
      where: { id: { in: deliveredIds } },
      data: { lastUsedAt: new Date() },
    });
  }

  return result;
}
