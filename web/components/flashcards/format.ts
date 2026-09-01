/** Форматтеры сроков и интервалов Leitner. Плюрализация — из lib/plural.ts. */
import { plural, pluralRu } from '@/lib/plural';

/**
 * Подпись интервала ящика из значения `BOX_INTERVAL_DAYS[box]` (lib/leitner.ts) —
 * число дней не хардкодится отдельно от источника истины.
 */
export function intervalLabel(days: number): string {
  if (days === 1) return 'каждый день';
  return `через ${days} ${plural(days, 'day')}`;
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
  if (diff < 0) return `просрочено на ${diff * -1} ${plural(-diff, 'day')}`;
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  return `через ${diff} ${plural(diff, 'day')}`;
}

export { pluralRu };
