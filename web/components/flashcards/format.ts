/**
 * Чистые форматтеры для зоны flashcards/. `pluralRu` — своя копия (см.
 * components/dashboard/format.ts, чужая зона, импортировать нельзя).
 */

/** Стандартный выбор формы по числу: [1, 2, 5] → одна/две/пять. */
export function pluralRu(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return forms[1];
  return forms[2];
}

/**
 * Подпись интервала ящика из значения `BOX_INTERVAL_DAYS[box]` (lib/leitner.ts) —
 * число дней не хардкодится отдельно от источника истины.
 */
export function intervalLabel(days: number): string {
  if (days === 1) return 'каждый день';
  return `через ${days} ${pluralRu(days, ['день', 'дня', 'дней'])}`;
}

/**
 * Подпись срока для строки поиска: «сегодня», «просрочено на 12 дней», «через 7 дней».
 * Считаем в днях от начала суток, а не в миллисекундах, иначе карточка со сроком
 * «сегодня вечером» показывалась бы как «через 0 дней» или «завтра» в зависимости
 * от времени открытия страницы.
 */
export function dueLabel(nextDueAt: Date | null, now: Date): string {
  if (!nextDueAt) return 'ещё не в очереди';
  const startOf = (d: Date) => {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    return r;
  };
  const diff = Math.round((startOf(nextDueAt).getTime() - startOf(now).getTime()) / 86_400_000);
  if (diff < 0) return `просрочено на ${-diff} ${pluralRu(-diff, ['день', 'дня', 'дней'])}`;
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  return `через ${diff} ${pluralRu(diff, ['день', 'дня', 'дней'])}`;
}
