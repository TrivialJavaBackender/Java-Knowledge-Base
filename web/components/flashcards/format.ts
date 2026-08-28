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
