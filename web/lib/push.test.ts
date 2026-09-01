import { describe, expect, it, vi } from 'vitest';
import { deliverToSubscriptions, type PushSender, type StoredSubscription } from '@/lib/push';
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

    expect(result).toEqual({ sent: 3, gone: [], failed: [] });
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
  });

  it('ошибка без statusCode (обрыв сети) тоже не гасит подписку', async () => {
    const send = vi.fn<PushSender>(async () => {
      throw new Error('ECONNRESET');
    });

    const result = await deliverToSubscriptions(subs(), PAYLOAD, send);

    expect(result).toEqual({ sent: 0, gone: [], failed: [1, 2, 3] });
  });

  it('пустой список подписок — не ошибка', async () => {
    const send = vi.fn<PushSender>(async () => {});
    expect(await deliverToSubscriptions([], PAYLOAD, send)).toEqual({ sent: 0, gone: [], failed: [] });
    expect(send).not.toHaveBeenCalled();
  });
});
