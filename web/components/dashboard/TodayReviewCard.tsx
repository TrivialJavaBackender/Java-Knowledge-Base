import Link from 'next/link';
import { TRACK_DOT_CLASS } from '@/components/ui/TrackDot';
import { pluralRu } from './format';

export interface DueBreakdownEntry {
  moduleSlug: string;
  moduleTitle: string;
  trackColor: 1 | 2 | 3 | 4 | 5;
  count: number;
}

/**
 * Сколько модулей показываем строками. Порог 5, а не 4: при ровно шести модулях
 * свёртка выродилась бы в «ещё 1 модуль» — строка той же высоты, но без названия.
 */
const MAX_ROWS = 5;
const KEPT_WHEN_FOLDED = 4;

export function TodayReviewCard({
  due,
  overdue,
  breakdown,
}: {
  due: number;
  /** Просрочено — подмножество `due`. Пока их больше половины, «453 на сегодня» вводит в заблуждение. */
  overdue: number;
  breakdown: DueBreakdownEntry[];
}) {
  // breakdown приходит отсортированным по убыванию (app/page.tsx), поэтому срез —
  // это именно самые нагруженные модули, а не произвольные.
  const folded = breakdown.length > MAX_ROWS;
  const shown = folded ? breakdown.slice(0, KEPT_WHEN_FOLDED) : breakdown;
  const rest = folded ? breakdown.slice(KEPT_WHEN_FOLDED) : [];
  const restCards = rest.reduce((sum, b) => sum + b.count, 0);

  // Разбор очереди раньше был доступен только через /flashcards/manage — третьим
  // уровнем от главной, и ровно там, где размер завала не показан. Ставим вход
  // туда, где число просрочки и так на экране.
  const showTriage = overdue > 0;

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-bg-card px-4 py-4">
      <div className="grp mb-2 text-fg-subtle">Сегодня на повторение</div>
      {due === 0 ? (
        <p className="text-sm text-fg-muted">Повторять пока нечего — все карточки впереди по расписанию.</p>
      ) : (
        <>
          <div className="mb-2.5 flex items-baseline gap-2">
            <span className="font-mono text-[28px] font-semibold tracking-tight text-fg tabular-nums">{due}</span>
            <span className="text-[12.5px] text-fg-muted">
              {pluralRu(due, ['карточка', 'карточки', 'карточек'])} из {breakdown.length}{' '}
              {breakdown.length === 1 ? 'модуля' : 'модулей'}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {shown.map((b) => (
              <div key={b.moduleSlug} className="flex items-center gap-2 text-xs text-fg-muted">
                <span className={`h-[7px] w-[7px] flex-none rounded-sm ${TRACK_DOT_CLASS[b.trackColor]}`} />
                <span className="flex-1 truncate">{b.moduleTitle}</span>
                <span className="font-mono text-fg tabular-nums">{b.count}</span>
              </div>
            ))}
            {rest.length > 0 && (
              <Link
                href="/flashcards"
                className="mt-0.5 flex items-center gap-2 text-xs text-fg-subtle hover:text-accent"
              >
                <span className="flex-1 truncate">
                  ещё {rest.length} {pluralRu(rest.length, ['модуль', 'модуля', 'модулей'])} · {restCards}
                </span>
                <span aria-hidden>→</span>
              </Link>
            )}
          </div>
        </>
      )}

      {showTriage && (
        // Строка, а не кнопка в рамке: выше в этой же карточке уже есть ссылка
        // «ещё N модулей →», и рамка сдвигала стрелку внутрь на свой padding —
        // две стрелки стояли в разных колонках. Теперь отступы, gap и разметка
        // те же, и стрелки выстроены. Срочность несёт цвет, рамка для этого
        // не нужна.
        <Link
          href="/flashcards/triage"
          className="mt-auto flex items-center gap-2 border-t border-border pt-2.5 text-xs text-warn transition hover:opacity-75"
        >
          <span className="flex-1 truncate">
            Просрочено <b className="font-mono tabular-nums">{overdue}</b> — разобрать очередь
          </span>
          <span aria-hidden>→</span>
        </Link>
      )}
    </div>
  );
}
