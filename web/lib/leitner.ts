/**
 * Leitner SRS:
 *  - 5 boxes, intervals 1/3/7/14/30 days
 *  - "Knew it" → box+1 (capped at 5), reset streak +1
 *  - "Again"   → box reset to 1, lapses +1
 *  - nextDueAt scheduled at startOfTomorrow + (interval-1) days,
 *    so a card promoted today reappears at the start of its target day
 *    in local time.
 */

export const BOX_INTERVAL_DAYS: Record<number, number> = {
  1: 1,
  2: 3,
  3: 7,
  4: 14,
  5: 30,
};

export interface LeitnerInput {
  box: number;
  streak: number;
  lapses: number;
}

export interface LeitnerOutput {
  box: number;
  streak: number;
  lapses: number;
  nextDueAt: Date;
  lastReviewedAt: Date;
}

export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export function reviewCard(
  state: LeitnerInput,
  knewIt: boolean,
  now: Date = new Date(),
): LeitnerOutput {
  const tomorrow = startOfDay(addDays(now, 1));
  if (knewIt) {
    const newBox = Math.min(5, state.box + 1);
    const interval = BOX_INTERVAL_DAYS[newBox];
    return {
      box: newBox,
      streak: state.streak + 1,
      lapses: state.lapses,
      nextDueAt: addDays(tomorrow, interval - 1),
      lastReviewedAt: now,
    };
  }
  return {
    box: 1,
    streak: 0,
    lapses: state.lapses + 1,
    nextDueAt: tomorrow,
    lastReviewedAt: now,
  };
}

/**
 * On first sync we have potentially hundreds of fresh cards all due
 * "today" — round-robin them across the next 7 days so the user has
 * a manageable daily queue from day 1.
 */
export function spreadInitialDueDate(index: number, now: Date = new Date()): Date {
  const tomorrow = startOfDay(addDays(now, 1));
  return addDays(tomorrow, index % 7);
}
