import { describe, expect, it, vi } from 'vitest';
import {
  deliverToSubscriptions,
  describeDeliveryFailure,
  type PushSender,
  type StoredSubscription,
} from '@/lib/push';
import { buildReminderPayload } from '@/lib/reminders';

/**
 * Проверяется цикл доставки, а не web-push: отправитель инъектируется, сети нет.
 * Важное свойство — цикл не прерывается ни на одной ошибке, потому что подписок
 * у пользователя несколько (телефон, ноутбук, установленное PWA) и протухшая
 * подписка одного устройства не должна лишать остальные уведомления.
 */

function subs(): StoredSubscription[] {
  return [
    { id: 1, endpoint: 'https://push.example/a', p256dh: 'pa', auth: 'aa' },
    { id: 2, endpoint: 'https://push.example/b', p256dh: 'pb', auth: 'ab' },
    { id: 3, endpoint: 'https://push.example/c', p256dh: 'pc', auth: 'ac' },
  ];
}

/** Ошибка web-push несёт код провайдера в `statusCode` — воспроизводим форму. */
function pushError(statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(`push failed: ${statusCode}`), { statusCode });
}

const PAYLOAD = buildReminderPayload(14);

describe('deliverToSubscriptions', () => {
  it('доставляет всем и передаёт сериализованный payload', async () => {
    const send = vi.fn<PushSender>(async () => {});
    const result = await deliverToSubscriptions(subs(), PAYLOAD, send);

    expect(result).toEqual({ sent: 3, gone: [], failed: [], failures: [] });
    expect(send).toHaveBeenCalledTimes(3);
    expect(JSON.parse(send.mock.calls[0][1])).toEqual(PAYLOAD);
  });

  it('410 от провайдера → подписка помечена протухшей, остальные доставлены', async () => {
    const send = vi.fn<PushSender>(async (sub) => {
      if (sub.id === 2) throw pushError(410);
    });

    const result = await deliverToSubscriptions(subs(), PAYLOAD, send);

    expect(result.sent).toBe(2);
    expect(result.gone).toEqual([2]);
    expect(result.failed).toEqual([]);
    // Цикл дошёл до третьей подписки — исключение его не оборвало.
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('404 трактуется так же, как 410', async () => {
    const send = vi.fn<PushSender>(async (sub) => {
      if (sub.id === 1) throw pushError(404);
    });
    const result = await deliverToSubscriptions(subs(), PAYLOAD, send);
    expect(result.gone).toEqual([1]);
    expect(result.sent).toBe(2);
  });

  it('5xx — временная ошибка: подписку не гасим', async () => {
    const send = vi.fn<PushSender>(async (sub) => {
      if (sub.id === 2) throw pushError(503);
    });

    const result = await deliverToSubscriptions(subs(), PAYLOAD, send);

    expect(result.sent).toBe(2);
    expect(result.gone).toEqual([]);
    expect(result.failed).toEqual([2]);
    expect(result.failures).toEqual([
      { id: 2, statusCode: 503, message: expect.stringContaining('503') },
    ]);
  });

  it('403 (не сошлись ключи VAPID) — подписка живая, причина названа', async () => {
    // Самый неочевидный отказ: подписка в порядке, но браузер подписался одним
    // публичным ключом, а сервер подписывает запрос другим. Гасить её нельзя —
    // чинится это переменными окружения, а не переподпиской.
    const send = vi.fn<PushSender>(async () => {
      throw Object.assign(new Error('Received unexpected response code'), {
        statusCode: 403,
        body: 'the key in the authorization header does not correspond to the sender id',
      });
    });

    const result = await deliverToSubscriptions(subs(), PAYLOAD, send);

    expect(result.sent).toBe(0);
    expect(result.gone).toEqual([]);
    expect(result.failed).toEqual([1, 2, 3]);
    expect(result.failures[0].statusCode).toBe(403);
    // Тело ответа провайдера — единственное место, где написано, что именно не так.
    expect(result.failures[0].message).toContain('authorization header');
  });

  it('ошибка без statusCode (обрыв сети) тоже не гасит подписку', async () => {
    const send = vi.fn<PushSender>(async () => {
      throw new Error('ECONNRESET');
    });

    const result = await deliverToSubscriptions(subs(), PAYLOAD, send);

    expect(result.sent).toBe(0);
    expect(result.gone).toEqual([]);
    expect(result.failed).toEqual([1, 2, 3]);
    // Причина доезжает наружу: без неё в ответе было бы только `failed: [1,2,3]`.
    expect(result.failures.map((f) => f.statusCode)).toEqual([null, null, null]);
    expect(result.failures[0].message).toContain('ECONNRESET');
  });

  it('пустой список подписок — не ошибка', async () => {
    const send = vi.fn<PushSender>(async () => {});
    expect(await deliverToSubscriptions([], PAYLOAD, send)).toEqual({
      sent: 0,
      gone: [],
      failed: [],
      failures: [],
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('describeDeliveryFailure', () => {
  const empty = { sent: 0, gone: [], failed: [], failures: [] };

  it('все подписки протухли → предлагает переподписаться', () => {
    expect(describeDeliveryFailure({ ...empty, gone: [1, 2] }, true)).toBe(
      'Подписка устарела — выключите и снова включите напоминания',
    );
  });

  it('403 при разошедшихся ключах называет обе переменные', () => {
    const result = {
      ...empty,
      failed: [1],
      failures: [{ id: 1, statusCode: 403, message: 'Forbidden — sender id mismatch' }],
    };
    const text = describeDeliveryFailure(result, false);
    expect(text).toContain('VAPID_PUBLIC_KEY');
    expect(text).toContain('NEXT_PUBLIC_VAPID_PUBLIC_KEY');
    expect(text).toContain('sender id mismatch');
  });

  it('403 при сошедшихся ключах указывает на устаревшую подписку, а не на конфиг', () => {
    const result = {
      ...empty,
      failed: [1],
      failures: [{ id: 1, statusCode: 403, message: 'Forbidden' }],
    };
    const text = describeDeliveryFailure(result, true);
    expect(text).toContain('подписка выдана под другой парой');
    expect(text).not.toContain('не совпадают');
  });

  it('403 без публичного ключа для браузера — своя формулировка', () => {
    const result = {
      ...empty,
      failed: [1],
      failures: [{ id: 1, statusCode: 403, message: 'Forbidden' }],
    };
    expect(describeDeliveryFailure(result, null)).toContain('не задан NEXT_PUBLIC_VAPID_PUBLIC_KEY');
  });

  it('ошибка без кода провайдера читается как «не дошло»', () => {
    const result = {
      ...empty,
      failed: [1],
      failures: [{ id: 1, statusCode: null, message: 'ECONNRESET' }],
    };
    expect(describeDeliveryFailure(result, true)).toBe(
      'Запрос не дошёл до push-сервиса: ECONNRESET',
    );
  });

  it('прочий код провайдера показывается как есть', () => {
    const result = {
      ...empty,
      failed: [1],
      failures: [{ id: 1, statusCode: 502, message: 'Bad Gateway' }],
    };
    expect(describeDeliveryFailure(result, true)).toBe('Push-сервис ответил 502: Bad Gateway');
  });
});
