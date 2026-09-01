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

/**
 * Подробности провала — то, что позволяет отличить «ключи VAPID не совпадают»
 * (403 от провайдера) от «сеть легла». Без них наружу выходило только
 * `failed: [1]`, и настоящая причина оставалась в логах функции.
 */
export interface DeliveryFailure {
  id: number;
  /** HTTP-код провайдера; null — ошибка не дошла до него (сеть, кривой VAPID_SUBJECT). */
  statusCode: number | null;
  message: string;
}

export interface DeliveryResult {
  sent: number;
  /** id подписок, которых больше нет у push-сервиса (404/410) — их надо погасить. */
  gone: number[];
  /** id подписок с прочими ошибками: сеть, 5xx у провайдера. Подписку не трогаем. */
  failed: number[];
  /** Те же провалы, но с причиной. Параллельно `failed`, чтобы не ломать вызывающих. */
  failures: DeliveryFailure[];
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

/** Текст ошибки вместе с телом ответа провайдера, если оно есть. */
function providerMessage(err: unknown): string {
  const base = err instanceof Error ? err.message : String(err);
  if (typeof err === 'object' && err !== null && 'body' in err) {
    const body = (err as { body: unknown }).body;
    if (typeof body === 'string' && body.trim()) return `${base} — ${body.trim().slice(0, 300)}`;
  }
  return base;
}

/**
 * Публичный ключ, которым браузер подписался, должен совпадать с тем, которым
 * сервер подписывает запрос. Развести их легко: это две разные переменные
 * окружения (`NEXT_PUBLIC_VAPID_PUBLIC_KEY` уезжает в бандл на сборке,
 * `VAPID_PUBLIC_KEY` читается в рантайме), и при рассинхроне провайдер отвечает
 * 403 — по которому догадаться о причине почти невозможно.
 *
 * `null` — проверить нечем (публичный ключ для браузера не задан).
 */
export function vapidKeysMatch(): boolean | null {
  const server = process.env.VAPID_PUBLIC_KEY?.trim();
  const browser = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  if (!server || !browser) return null;
  return server === browser;
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
  const result: DeliveryResult = { sent: 0, gone: [], failed: [], failures: [] };

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
        result.failures.push({
          id: sub.id,
          statusCode: status,
          // `body` ошибки web-push несёт текст ответа провайдера — там и лежит
          // объяснение вроде «the key in the authorization header does not
          // correspond to the sender ID».
          message: providerMessage(err),
        });
        console.error(`push: подписка ${sub.id} не доставлена`, err);
      }
    }
  }

  return result;
}

/**
 * Человеческое объяснение провала доставки.
 *
 * Каждая ветка соответствует своей починке, поэтому текст называет её прямо.
 * Иначе единственный способ понять, что происходит, — лезть в логи функции:
 * 403 от FCM при рассинхроне ключей выглядит снаружи ровно так же, как любая
 * другая неудача.
 *
 * `keysMatch` передаётся аргументом, а не читается из окружения, чтобы функция
 * осталась чистой и проверяемой.
 */
export function describeDeliveryFailure(
  result: DeliveryResult,
  keysMatch: boolean | null,
): string {
  if (result.gone.length > 0 && result.failures.length === 0) {
    return 'Подписка устарела — выключите и снова включите напоминания';
  }

  const first = result.failures[0];
  if (!first) return 'Ни одно устройство не получило уведомление';

  if (first.statusCode === 403 || first.statusCode === 401) {
    const hint =
      keysMatch === false
        ? 'VAPID_PUBLIC_KEY и NEXT_PUBLIC_VAPID_PUBLIC_KEY не совпадают — браузер подписался одним ключом, сервер подписывает другим'
        : keysMatch === null
          ? 'не задан NEXT_PUBLIC_VAPID_PUBLIC_KEY — проверьте переменные окружения'
          : 'ключи совпадают между собой, но подписка выдана под другой парой — выключите и снова включите напоминания';
    return `Push-сервис отклонил подпись (${first.statusCode}): ${hint}. ${first.message}`;
  }

  if (first.statusCode === null) {
    return `Запрос не дошёл до push-сервиса: ${first.message}`;
  }

  return `Push-сервис ответил ${first.statusCode}: ${first.message}`;
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
