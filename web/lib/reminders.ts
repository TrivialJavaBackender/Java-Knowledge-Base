/**
 * Решение «слать ли напоминание» — чистая функция от настроек пользователя и
 * текущего момента. Ни Prisma, ни web-push здесь нет намеренно: это единственная
 * часть рассылки, которую есть смысл покрывать тестами, и она должна запускаться
 * без базы и без сети (`lib/reminders.test.ts`).
 *
 * Расписание живёт в двух разных системах координат, и путать их нельзя:
 * Netlify Scheduled Functions ходят по UTC и раз в час, а пользователь задаёт
 * время в своей зоне («20:30 по Вильнюсу»). Поэтому cron не пытается попасть в
 * нужную минуту — он будит роут каждый час, а совпадение с локальным временем
 * проверяется здесь.
 */

import { countOf, pluralRu } from '@/lib/plural';
import { MIN_SESSION_SIZE, estimateMinutes } from '@/lib/review-session';

/**
 * Ширина окна после назначенного времени, в минутах.
 *
 * Прогон ровно в момент напоминания невозможен: при `@hourly` и времени 20:30
 * ближайшие запуски — 20:00 и 21:00. Проверка «сейчас == 20:30» не сработала бы
 * никогда. Окно [20:30, 22:00) ловит запуск в 21:00, а заодно переживает один
 * пропущенный или упавший прогон. Шире делать не стоит: напоминание в час ночи
 * бесполезно и раздражает.
 */
export const REMINDER_WINDOW_MINUTES = 90;

/**
 * Минимальный зазор между двумя напоминаниями.
 *
 * Проверки «отправляли ли сегодня» по локальной дате мало: при времени вроде
 * 23:50 окно переползает локальную полночь, и в 00:00 дата уже другая — второе
 * уведомление ушло бы через десять минут после первого. 12 часов заведомо
 * меньше суточного шага и заведомо больше любого окна.
 */
export const MIN_GAP_HOURS = 12;

/** Почему напоминание не отправлено — попадает в ответ роута и в лог функции. */
export type SkipReason =
  | 'disabled'
  | 'invalid-time'
  | 'invalid-timezone'
  | 'outside-window'
  | 'already-sent'
  | 'no-due-cards'
  | 'no-subscriptions'
  // Подписки были, но ни одна доставка не удалась: сеть, 5xx у провайдера или
  // все подписки разом протухли. Отдельная причина, а не `no-subscriptions`:
  // иначе в логе не отличить «некому слать» от «не смогли отправить».
  | 'delivery-failed';

/** Настройки пользователя, от которых зависит решение. Подмножество полей `User`. */
export interface ReminderCandidate {
  id: number;
  remindersEnabled: boolean;
  /** «HH:MM» в локальной зоне пользователя. */
  reminderTime: string;
  /** IANA, например `Europe/Vilnius`. */
  timezone: string;
  lastReminderSentAt: Date | null;
}

export interface ReminderContext {
  now: Date;
  dueCount: number;
  subscriptionCount: number;
}

export type ScheduleVerdict = { ok: true } | { ok: false; reason: SkipReason };
export type SendVerdict = { send: true } | { send: false; reason: SkipReason };

export interface ReminderPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/**
 * Момент времени в зоне пользователя: дата вида `2026-09-01` и минуты от
 * локальной полуночи.
 *
 * Считается через `Intl`, а не арифметикой над смещением: смещение зоны не
 * константа (переход на летнее время), и вручную его воспроизводить — значит
 * дважды в год ошибаться на час. Локаль `en-CA` выбрана потому, что её формат
 * даты — уже готовый ISO `YYYY-MM-DD`.
 */
export function localParts(at: Date, timeZone: string): { dateKey: string; minutes: number } {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);

  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);

  // en-GB отдаёт полночь как «24:00» в части реализаций ICU — приводим к 0,
  // иначе минуты вылезли бы за пределы суток.
  const [h, m] = time.split(':').map(Number);
  return { dateKey: date, minutes: (h % 24) * 60 + m };
}

/** `Europe/Vilnius` → true, `Мордор/Барад-дур` → false. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** «20:30» → 1230 минут от полуночи. Мусор и «25:00» → null. */
export function parseReminderTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** «20:30» — нормализованная форма для хранения; null, если время невалидно. */
export function normalizeReminderTime(value: string): string | null {
  const minutes = parseReminderTime(value);
  if (minutes === null) return null;
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Дешёвая проверка расписания: всё, что можно решить без похода в базу.
 * Роут вызывает её первой и для большинства часов в сутки на этом и
 * заканчивает — считать due-карточки 23 раза в день впустую незачем.
 */
export function isWithinSchedule(user: ReminderCandidate, now: Date): ScheduleVerdict {
  if (!user.remindersEnabled) return { ok: false, reason: 'disabled' };
  if (!isValidTimeZone(user.timezone)) return { ok: false, reason: 'invalid-timezone' };

  const reminderMinutes = parseReminderTime(user.reminderTime);
  if (reminderMinutes === null) return { ok: false, reason: 'invalid-time' };

  const nowLocal = localParts(now, user.timezone);
  const delta = nowLocal.minutes - reminderMinutes;
  if (delta < 0 || delta >= REMINDER_WINDOW_MINUTES) return { ok: false, reason: 'outside-window' };

  if (user.lastReminderSentAt) {
    const sentLocal = localParts(user.lastReminderSentAt, user.timezone);
    const gapHours = (now.getTime() - user.lastReminderSentAt.getTime()) / 3_600_000;
    if (sentLocal.dateKey === nowLocal.dateKey || gapHours < MIN_GAP_HOURS) {
      return { ok: false, reason: 'already-sent' };
    }
  }

  return { ok: true };
}

/**
 * Полное решение. Порядок проверок — от дешёвых к дорогим и от «настройка» к
 * «состоянию»: `reason` в ответе должен объяснять первопричину, а не последнее
 * не сошедшееся условие.
 */
export function shouldSendReminder(user: ReminderCandidate, ctx: ReminderContext): SendVerdict {
  const schedule = isWithinSchedule(user, ctx.now);
  if (!schedule.ok) return { send: false, reason: schedule.reason };
  if (ctx.subscriptionCount <= 0) return { send: false, reason: 'no-subscriptions' };
  if (ctx.dueCount <= 0) return { send: false, reason: 'no-due-cards' };
  return { send: true };
}

/**
 * Текст уведомления. Конкретика — единственное, ради чего его вообще стоит
 * показывать: «Пора учиться!» не сообщает ни объёма, ни цены входа, и его
 * смахивают не читая. Число карточек и оценка минут отвечают на оба вопроса,
 * а «начнём с 5» снимает страх перед завалом ещё до открытия приложения.
 */
export function buildReminderPayload(dueCount: number): ReminderPayload {
  const minutes = estimateMinutes(dueCount);
  const start = Math.min(MIN_SESSION_SIZE, dueCount);
  const body =
    dueCount > MIN_SESSION_SIZE
      ? `~${minutes} мин · начнём с ${start}`
      : `~${minutes} мин · это быстро`;

  // Глагол согласуется с числительным вместе с существительным: «1 карточка
  // ждёт», но «3 карточки ждут». Склонять только существительное недостаточно.
  const verb = pluralRu(dueCount, ['ждёт', 'ждут', 'ждут']);

  return {
    title: `🧠 ${countOf(dueCount, 'card')} ${verb} повторения`,
    body,
    url: '/review',
    // Один tag на все напоминания: если предыдущее ещё висит в шторке,
    // новое заменит его, а не ляжет вторым.
    tag: 'review-reminder',
  };
}
