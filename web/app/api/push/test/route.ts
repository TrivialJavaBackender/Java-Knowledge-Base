/**
 * Тестовое уведомление «себе» — кнопка в настройках.
 *
 * Нужна не ради удобства: цепочка Web Push состоит из пяти звеньев (подписка в
 * браузере → база → VAPID → push-сервис → service worker), и без ручной
 * проверки единственный способ узнать, что она собрана правильно, — дождаться
 * ближайшего hourly-прогона и посмотреть, пришло ли.
 *
 * Адресат жёстко равен владельцу сессии: `userId` из тела запроса не читается
 * вообще, поэтому послать уведомление другому пользователю через этот роут
 * нельзя.
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { countDue } from '@/lib/review-queue';
import { isPushConfigured, sendToUser } from '@/lib/push';
import { buildReminderPayload } from '@/lib/reminders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!isPushConfigured()) {
    return NextResponse.json(
      { error: 'Web Push не настроен: не заданы VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT' },
      { status: 503 },
    );
  }

  // Настоящее число карточек, а не заглушка: тест должен проверять ровно тот
  // текст, который придёт вечером. Пустая очередь — не повод не проверить
  // доставку, поэтому подставляем 1.
  const due = await countDue(session.userId);
  const payload = buildReminderPayload(Math.max(1, due));

  try {
    const result = await sendToUser(session.userId, payload);
    if (result.sent === 0) {
      return NextResponse.json(
        {
          error:
            result.gone.length > 0
              ? 'Подписка устарела — выключите и снова включите напоминания'
              : 'Нет активных подписок на этом аккаунте',
          ...result,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, dueCount: due, ...result });
  } catch (err) {
    console.error('push test failed', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
