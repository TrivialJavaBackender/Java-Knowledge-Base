import { describe, expect, it } from 'vitest';
import {
  buildReminderPayload,
  isWithinSchedule,
  localParts,
  normalizeReminderTime,
  parseReminderTime,
  shouldSendReminder,
  type ReminderCandidate,
} from '@/lib/reminders';

/**
 * Все моменты заданы в UTC — ровно так их видит Netlify Scheduled Function.
 * Локальное время получается пересчётом, и именно этот пересчёт проверяется:
 * один и тот же instant должен давать разные вердикты в разных зонах.
 *
 * Сентябрь 2026: Europe/Vilnius = UTC+3 (EEST), America/New_York = UTC-4 (EDT).
 */
const VILNIUS = 'Europe/Vilnius';
const NEW_YORK = 'America/New_York';

function user(over: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    id: 1,
    remindersEnabled: true,
    reminderTime: '20:30',
    timezone: VILNIUS,
    lastReminderSentAt: null,
    ...over,
  };
}

/** 21:00 в Вильнюсе 1 сентября 2026 — прогон cron'а через полчаса после напоминания. */
const VILNIUS_21_00 = new Date('2026-09-01T18:00:00Z');
/** 20:00 в Вильнюсе — предыдущий hourly-прогон, ещё до назначенного времени. */
const VILNIUS_20_00 = new Date('2026-09-01T17:00:00Z');

const READY = { dueCount: 14, subscriptionCount: 1 };

describe('parseReminderTime / normalizeReminderTime', () => {
  it('разбирает HH:MM в минуты от полуночи', () => {
    expect(parseReminderTime('20:30')).toBe(20 * 60 + 30);
    expect(parseReminderTime('00:00')).toBe(0);
    expect(parseReminderTime('23:59')).toBe(23 * 60 + 59);
  });

  it('отвергает мусор и несуществующее время', () => {
    expect(parseReminderTime('24:00')).toBeNull();
    expect(parseReminderTime('20:60')).toBeNull();
    expect(parseReminderTime('вечером')).toBeNull();
    expect(parseReminderTime('')).toBeNull();
  });

  it('нормализует к двузначному часу', () => {
    expect(normalizeReminderTime('9:05')).toBe('09:05');
    expect(normalizeReminderTime('bad')).toBeNull();
  });
});

describe('localParts', () => {
  it('переводит UTC-момент в локальные дату и минуты', () => {
    expect(localParts(VILNIUS_21_00, VILNIUS)).toEqual({ dateKey: '2026-09-01', minutes: 21 * 60 });
    expect(localParts(VILNIUS_21_00, 'UTC')).toEqual({ dateKey: '2026-09-01', minutes: 18 * 60 });
    expect(localParts(VILNIUS_21_00, NEW_YORK)).toEqual({ dateKey: '2026-09-01', minutes: 14 * 60 });
  });

  it('учитывает переход на летнее время, а не фиксированное смещение', () => {
    // Один и тот же настенный час в Нью-Йорке зимой и летом — разные UTC-моменты.
    const january = new Date('2026-01-16T02:00:00Z'); // 21:00 EST (UTC-5)
    const july = new Date('2026-07-16T01:00:00Z'); //    21:00 EDT (UTC-4)
    expect(localParts(january, NEW_YORK).minutes).toBe(21 * 60);
    expect(localParts(july, NEW_YORK).minutes).toBe(21 * 60);
  });

  it('переваливает дату вместе с зоной', () => {
    // 23:30 UTC — в Вильнюсе уже 02:30 следующих суток.
    const late = new Date('2026-09-01T23:30:00Z');
    expect(localParts(late, 'UTC').dateKey).toBe('2026-09-01');
    expect(localParts(late, VILNIUS).dateKey).toBe('2026-09-02');
  });
});

describe('shouldSendReminder', () => {
  it('напоминания выключены → не шлём', () => {
    const v = shouldSendReminder(user({ remindersEnabled: false }), { now: VILNIUS_21_00, ...READY });
    expect(v).toEqual({ send: false, reason: 'disabled' });
  });

  it('нет due-карточек → не шлём', () => {
    const v = shouldSendReminder(user(), { now: VILNIUS_21_00, dueCount: 0, subscriptionCount: 1 });
    expect(v).toEqual({ send: false, reason: 'no-due-cards' });
  });

  it('нет активных подписок → не шлём', () => {
    const v = shouldSendReminder(user(), { now: VILNIUS_21_00, dueCount: 14, subscriptionCount: 0 });
    expect(v).toEqual({ send: false, reason: 'no-subscriptions' });
  });

  it('локальное время ещё не дошло до напоминания → не шлём', () => {
    // Прогон в 20:00 при напоминании на 20:30 — окно ещё не открылось.
    const v = shouldSendReminder(user(), { now: VILNIUS_20_00, ...READY });
    expect(v).toEqual({ send: false, reason: 'outside-window' });
  });

  it('окно закрылось (прошло больше 90 минут) → не шлём', () => {
    const late = new Date('2026-09-01T19:30:00Z'); // 22:30 по Вильнюсу, delta = 120
    const v = shouldSendReminder(user(), { now: late, ...READY });
    expect(v).toEqual({ send: false, reason: 'outside-window' });
  });

  it('локальное время в окне + есть карточки → шлём', () => {
    expect(shouldSendReminder(user(), { now: VILNIUS_21_00, ...READY })).toEqual({ send: true });
  });

  it('невалидная зона или время не роняют прогон, а дают reason', () => {
    expect(shouldSendReminder(user({ timezone: 'Мордор/Барад-дур' }), { now: VILNIUS_21_00, ...READY }))
      .toEqual({ send: false, reason: 'invalid-timezone' });
    expect(shouldSendReminder(user({ reminderTime: '25:00' }), { now: VILNIUS_21_00, ...READY }))
      .toEqual({ send: false, reason: 'invalid-time' });
  });
});

describe('идемпотентность', () => {
  it('уже отправляли сегодня → второй прогон в том же окне молчит', () => {
    const sent = user({ lastReminderSentAt: VILNIUS_21_00 });
    // Следующий hourly-прогон попал бы в то же окно: 21:30 по Вильнюсу, delta = 60.
    const nextRun = new Date('2026-09-01T18:30:00Z');
    expect(shouldSendReminder(sent, { now: nextRun, ...READY })).toEqual({
      send: false,
      reason: 'already-sent',
    });
  });

  it('двойной запуск функции в одну и ту же минуту даёт одну отправку', () => {
    const before = user();
    expect(shouldSendReminder(before, { now: VILNIUS_21_00, ...READY })).toEqual({ send: true });

    // Роут записал lastReminderSentAt — повтор того же прогона уже не проходит.
    const after = user({ lastReminderSentAt: VILNIUS_21_00 });
    expect(shouldSendReminder(after, { now: VILNIUS_21_00, ...READY })).toEqual({
      send: false,
      reason: 'already-sent',
    });
  });

  it('на следующий день в том же окне — снова шлём', () => {
    const sent = user({ lastReminderSentAt: VILNIUS_21_00 });
    const tomorrow = new Date('2026-09-02T18:00:00Z'); // те же 21:00 по Вильнюсу
    expect(shouldSendReminder(sent, { now: tomorrow, ...READY })).toEqual({ send: true });
  });

  it('зазор в 12 часов ловит случай, когда локальная дата уже сменилась', () => {
    // Напоминание в 00:30, а предыдущая отправка была в 23:00 прошлых суток:
    // даты разные, но между ними меньше двух часов — второй раз не шлём.
    const sent = user({
      timezone: 'UTC',
      reminderTime: '00:30',
      lastReminderSentAt: new Date('2026-09-01T23:00:00Z'),
    });
    const now = new Date('2026-09-02T00:45:00Z');
    expect(shouldSendReminder(sent, { now, ...READY })).toEqual({
      send: false,
      reason: 'already-sent',
    });
  });
});

describe('таймзоны решают вердикт', () => {
  it('один и тот же UTC-момент: шлём только тому, у кого локально 21:00', () => {
    const now = VILNIUS_21_00; // 18:00 UTC

    expect(shouldSendReminder(user({ timezone: VILNIUS }), { now, ...READY })).toEqual({ send: true });
    // В UTC сейчас 18:00, в Нью-Йорке 14:00 — обоим ещё рано.
    expect(shouldSendReminder(user({ timezone: 'UTC' }), { now, ...READY })).toEqual({
      send: false,
      reason: 'outside-window',
    });
    expect(shouldSendReminder(user({ timezone: NEW_YORK }), { now, ...READY })).toEqual({
      send: false,
      reason: 'outside-window',
    });
  });

  it('через три часа очередь доходит до UTC, а Вильнюс уже отстрелялся', () => {
    const now = new Date('2026-09-01T21:00:00Z');
    expect(shouldSendReminder(user({ timezone: 'UTC' }), { now, ...READY })).toEqual({ send: true });
  });

  it('Нью-Йорк получает своё в 21:00 EDT — это следующий день по UTC', () => {
    const now = new Date('2026-09-02T01:00:00Z'); // 21:00 EDT
    expect(shouldSendReminder(user({ timezone: NEW_YORK }), { now, ...READY })).toEqual({ send: true });
  });

  it('зимой тот же локальный час — другой UTC-момент', () => {
    const winter = new Date('2026-01-16T02:00:00Z'); // 21:00 EST
    expect(shouldSendReminder(user({ timezone: NEW_YORK }), { now: winter, ...READY })).toEqual({
      send: true,
    });
    // Летний UTC-момент зимой промахнулся бы мимо окна на час.
    const summerInstant = new Date('2026-01-16T01:00:00Z'); // 20:00 EST
    expect(shouldSendReminder(user({ timezone: NEW_YORK }), { now: summerInstant, ...READY })).toEqual({
      send: false,
      reason: 'outside-window',
    });
  });
});

describe('buildReminderPayload', () => {
  it('называет число карточек и цену входа, а не «пора учиться»', () => {
    expect(buildReminderPayload(14)).toEqual({
      title: '🧠 14 карточек ждут повторения',
      body: '~5 мин · начнём с 5',
      url: '/review',
      tag: 'review-reminder',
    });
  });

  it('согласует и существительное, и глагол', () => {
    expect(buildReminderPayload(1).title).toBe('🧠 1 карточка ждёт повторения');
    expect(buildReminderPayload(3).title).toBe('🧠 3 карточки ждут повторения');
    expect(buildReminderPayload(5).title).toBe('🧠 5 карточек ждут повторения');
    expect(buildReminderPayload(43).title).toBe('🧠 43 карточки ждут повторения');
  });

  it('короткую очередь не разбивает на минимальную сессию', () => {
    expect(buildReminderPayload(4).body).toBe('~1 мин · это быстро');
    expect(buildReminderPayload(43).body).toBe('~14 мин · начнём с 5');
  });
});
