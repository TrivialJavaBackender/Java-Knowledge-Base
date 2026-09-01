/**
 * Цветная метка учебного трека — одна на приложение. Копий было четыре
 * (dashboard/colors.ts, flashcards/colors.ts, triage/colors.ts,
 * module/TrackDot.tsx) с комментарием «импортировать из чужой зоны нельзя из-за
 * Tailwind JIT». Это недоразумение: JIT сканирует исходники на литеральные
 * строки классов, и строки ниже он находит здесь — файл лежит под
 * components/**, который перечислен в tailwind.config.ts.
 */
export type TrackColor = 1 | 2 | 3 | 4 | 5;

export const TRACK_DOT_CLASS: Record<TrackColor, string> = {
  1: 'bg-track-1',
  2: 'bg-track-2',
  3: 'bg-track-3',
  4: 'bg-track-4',
  5: 'bg-track-5',
};

/** `color === null` — у сущности нет трека (ручные карточки): нейтральная метка. */
export function TrackDot({
  color,
  size = 8,
  className = '',
}: {
  color: TrackColor | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-block flex-none rounded-[2px] ${color != null ? TRACK_DOT_CLASS[color] : 'bg-fg-subtle'} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
