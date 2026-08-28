/**
 * Литеральные Tailwind-классы для цвета трека — своя копия для зоны triage/
 * (см. components/flashcards/colors.ts: тот же паттерн, но импортировать
 * оттуда нельзя — чужая зона, и Tailwind JIT не резолвит `bg-track-${n}`).
 */

export const TRACK_DOT_CLASS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'bg-track-1',
  2: 'bg-track-2',
  3: 'bg-track-3',
  4: 'bg-track-4',
  5: 'bg-track-5',
};
