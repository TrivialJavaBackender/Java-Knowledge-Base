/**
 * Прогон рассылки напоминаний. Дёргается Netlify Scheduled Function раз в час
 * (`netlify/functions/send-review-reminders.ts`).
 *
 * Почему логика здесь, а не в самой функции: Prisma Client с его нативным
 * engine собирается плагином Netlify для Next.js, а в esbuild-бандл отдельной
 * функции его пришлось бы затаскивать вручную (`binaryTargets`,
 * `included_files`, `external_node_modules`) — известная точка хрупкости.
 * Функция остаётся тонким триггером, вся работа — здесь.
 *
 * Аутентификация — общий секрет, а не сессия: у cron'а нет пользователя.
 * Роут добавлен в `PUBLIC` в `middleware.ts` именно поэтому, и секрет
 * проверяет сам.
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/db';
import { countDue } from '@/lib/review-queue';
import { isPushConfigured, sendToUser } from '@/lib/push';
import { buildReminderPayload, isWithinSchedule, shouldSendReminder, type SkipReason } from '@/lib/reminders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Сравнение секретов постоянного времени: обычное `===` подтекает по таймингу. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface RunSummary {
  checked: number;
  sent: number;
  skipped: { userId: number; reason: SkipReason }[];
  deactivated: number;
  errors: { userId: number; message: string }[];
}

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error('reminders: CRON_SECRET не задан — прогон отклонён');
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }
  if (!secretMatches(req.headers.get('x-cron-secret'), expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isPushConfigured()) {
    return NextResponse.json({ error: 'VAPID keys are not configured' }, { status: 503 });
  }

  const now = new Date();
  const summary: RunSummary = { checked: 0, sent: 0, skipped: [], deactivated: 0, errors: [] };

  const users = await prisma.user.findMany({
    where: { remindersEnabled: true },
    select: {
      id: true,
      remindersEnabled: true,
      reminderTime: true,
      timezone: true,
      lastReminderSentAt: true,
    },
  });

  for (const user of users) {
    summary.checked += 1;
    try {
      // Дешёвый пре-фильтр: в 23 часах из 24 локальное время не в окне, и
      // считать созревшие карточки незачем. С одним пользователем экономия
      // символическая, но именно этот порядок не даст прогону подорожать,
      // когда пользователей станет больше.
      const schedule = isWithinSchedule(user, now);
      if (!schedule.ok) {
        summary.skipped.push({ userId: user.id, reason: schedule.reason });
        continue;
      }

      const [dueCount, subscriptionCount] = await Promise.all([
        countDue(user.id, now),
        prisma.pushSubscription.count({ where: { userId: user.id, active: true } }),
      ]);

      const verdict = shouldSendReminder(user, { now, dueCount, subscriptionCount });
      if (!verdict.send) {
        summary.skipped.push({ userId: user.id, reason: verdict.reason });
        continue;
      }

      const result = await sendToUser(user.id, buildReminderPayload(dueCount));
      summary.deactivated += result.gone.length;

      if (result.sent > 0) {
        // Отметка ставится только после реальной доставки: если ни одно
        // устройство не получило уведомление, следующий hourly-прогон должен
        // попробовать снова, пока окно не закрылось.
        await prisma.user.update({ where: { id: user.id }, data: { lastReminderSentAt: now } });
        summary.sent += 1;
      } else {
        // Отметку не ставим — следующий прогон в том же окне попробует снова.
        summary.skipped.push({ userId: user.id, reason: 'delivery-failed' });
      }
    } catch (err) {
      // Падение на одном пользователе не должно отменять рассылку остальным.
      console.error(`reminders: пользователь ${user.id} не обработан`, err);
      summary.errors.push({ userId: user.id, message: (err as Error).message });
    }
  }

  console.log('reminders:', JSON.stringify(summary));
  return NextResponse.json(summary);
}
