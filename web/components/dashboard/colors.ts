/**
 * Литеральные Tailwind-классы для цветов трека. Держим как явный словарь,
 * а не `bg-track-${n}` шаблон — Tailwind JIT сканирует исходники на строки
 * классов, динамически собранное имя класса он не найдёт.
 */

export const TRACK_DOT_CLASS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'bg-track-1',
  2: 'bg-track-2',
  3: 'bg-track-3',
  4: 'bg-track-4',
  5: 'bg-track-5',
};
