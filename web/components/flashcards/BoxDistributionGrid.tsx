import { BOX_INTERVAL_DAYS } from '@/lib/leitner';
import { intervalLabel } from './format';
import { countOf } from '@/lib/plural';

/**
 * Распределение карточек по ящикам Лейтнера.
 *
 * Раньше это были пять карточек-плиток во всю ширину — примерно 90 пикселей
 * высоты под пять чисел, которые в сессии повторения ни на что не влияют (на
 * узком экране плитки к тому же ложились сеткой 3+2 с дырой в последнем ряду).
 * Теперь это одна полоса: доля каждого ящика показана шириной сегмента, точные
 * числа — подписью под ним. Смысл «сколько уже уехало в дальние ящики» читается
 * с одного взгляда и не отбирает экран у самой карточки.
 */
export function BoxDistributionGrid({ boxes }: { boxes: [number, number, number, number, number] }) {
  const total = boxes.reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  /** Насыщенность акцента по ящикам: box 1 — полная, box 5 — едва заметная. */
  // Нижняя граница 0.3, а не 0: на тёмной теме сегмент с opacity 0.16
  // сливается с дорожкой и легенда пятого ящика становится нечитаемой.
  const opacity = [1, 0.82, 0.64, 0.46, 0.3];

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="grp text-fg-muted">Ящики</span>
        <span className="text-[11.5px] text-fg-subtle">
          {countOf(total, 'card')} в выбранных колодах · чем правее, тем реже повторение
        </span>
      </div>

      <div className="flex h-2 overflow-hidden rounded-full border border-border bg-bg-soft">
        {boxes.map((count, i) => (
          <span
            key={i}
            className="bg-accent"
            style={{ flexGrow: count, opacity: opacity[i] }}
            title={`Box ${i + 1} — ${count}, ${intervalLabel(BOX_INTERVAL_DAYS[i + 1])}`}
          />
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {boxes.map((count, i) => (
          <span key={i} className="flex items-baseline gap-1.5 text-[11.5px] text-fg-subtle">
            <span className="h-[7px] w-[7px] flex-none translate-y-px rounded-sm bg-accent" style={{ opacity: opacity[i] }} />
            <span>box {i + 1}</span>
            <span className="font-mono text-fg tabular-nums">{count}</span>
            <span className="hidden sm:inline">· {intervalLabel(BOX_INTERVAL_DAYS[i + 1])}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
