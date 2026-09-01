'use server';

/**
 * Настройки напоминаний. Подписка браузера сохраняется отдельно, через
 * `/api/push/subscription` — там нужен доступ к телу запроса и заголовкам,
 * а здесь только пользовательские предпочтения.
 */

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { isValidTimeZone, normalizeReminderTime } from '@/lib/reminders';

export interface ReminderSettingsInput {
  enabled: boolean;
  /** «HH:MM» в зоне пользователя. */
  time: string;
  /** IANA из `Intl.DateTimeFormat().resolvedOptions().timeZone`. */
  timezone: string;
}

/**
 * Записать настройки. Время и зона валидируются здесь, а не только в форме:
 * значения приходят из браузера, и невалидная зона тихо выключила бы рассылку
 * (`isWithinSchedule` вернул бы `invalid-timezone` и не пожаловался бы никому).
 */
export async function setReminderSettings(input: ReminderSettingsInput): Promise<void> {
  const userId = await requireUser();

  const time = normalizeReminderTime(input.time);
  if (!time) throw new Error(`Некорректное время напоминания: ${input.time}`);
  if (!isValidTimeZone(input.timezone)) {
    throw new Error(`Неизвестный часовой пояс: ${input.timezone}`);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { remindersEnabled: input.enabled, reminderTime: time, timezone: input.timezone },
  });

  revalidatePath('/settings');
}

/**
 * Сбросить отметку о последней отправке — «прислать ещё раз сегодня».
 *
 * Нужна для отладки: без неё проверить вечернюю рассылку можно только один раз
 * в сутки, дальше `shouldSendReminder` честно отвечает `already-sent`.
 */
export async function clearLastReminderSentAt(): Promise<void> {
  const userId = await requireUser();
  await prisma.user.update({ where: { id: userId }, data: { lastReminderSentAt: null } });
  revalidatePath('/settings');
}
