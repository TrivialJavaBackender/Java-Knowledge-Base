import Link from 'next/link';
import { TRACK_DOT_CLASS } from '@/components/ui/TrackDot';
import { countOf, pluralRu } from '@/lib/plural';
import { MIN_SESSION_SIZE, estimateMinutes } from '@/lib/review-session';

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

/**
 * Точка входа в повторение с главной.
 *
 * Карточка отвечает на три вопроса подряд: что делать, сколько это займёт, как
 * начать. Поэтому число карточек идёт вместе с оценкой минут, а кнопка ведёт
 * прямо в очередь — без выбора колод и режима.
 *
 * При завале предлагается пачка из пяти, а не вся очередь: «43 карточки»
 * читается как обязательство на четверть часа и чаще всего откладывается.
 * Расписание Лейтнера при этом не меняется — нарезка живёт только в UI
 * (`components/review/ReviewSession.tsx`).
 */
export function TodayReviewCard({
  due,
  overdue,
  breakdown,
}: {
  due: number;
  /** Просрочено — подмножество `due`. */
  overdue: number;
  breakdown: DueBreakdownEntry[];
}) {
  // breakdown приходит отсортированным по убыванию (app/page.tsx), поэтому срез —
  // это именно самые нагруженные модули, а не произвольные.
  const folded = breakdown.length > MAX_ROWS;
  const shown = folded ? breakdown.slice(0, KEPT_WHEN_FOLDED) : breakdown;
  const rest = folded ? breakdown.slice(KEPT_WHEN_FOLDED) : [];
  const restCards = rest.reduce((sum, b) => sum + b.count, 0);

  const bigQueue = due > MIN_SESSION_SIZE;
  const startSize = Math.min(MIN_SESSION_SIZE, due);

  if (due === 0) {
    return (
      <div className="flex h-full flex-col rounded-lg border border-border bg-bg-card px-4 py-4">
        <div className="grp mb-2 text-fg-subtle">Сегодня на повторение</div>
        <p className="text-sm text-fg-muted">
          Повторять пока нечего — все карточки впереди по расписанию.
        </p>
        <Link
          href="/flashcards"
          className="mt-auto pt-3 text-xs text-fg-subtle transition hover:text-accent"
        >
          Открыть колоды →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-bg-card px-4 py-4">
      <div className="grp mb-2 text-fg-subtle">Сегодня на повторение</div>

      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="font-mono text-[34px] font-semibold leading-none tracking-tight text-fg tabular-nums">
          {due}
        </span>
        <span className="text-[13px] text-fg-muted">
          {pluralRu(due, ['карточка', 'карточки', 'карточек'])} · ~{estimateMinutes(due)} мин
        </span>
      </div>

      {bigQueue && (
        // Тон намеренно не осуждающий: «просрочено 47» превращает возвращение
        // после перерыва в отчёт о провале, после которого проще не заходить
        // вовсе. Цифра остаётся, интерпретация — нет.
        <p className="mt-2 text-[12.5px] leading-[1.5] text-fg-muted">
          Накопилось — не нужно закрывать всё сразу. Начнём с {startSize}, это ~
          {estimateMinutes(startSize)} мин.
        </p>
      )}

      <div className="mt-3 flex flex-col gap-2">
        <Link
          href="/review"
          className="flex h-12 items-center justify-center rounded-md border border-accent bg-accent px-4 font-medium text-white transition hover:opacity-90"
        >
          {bigQueue ? `Начать с ${startSize} карточек` : 'Начать повторение'}
        </Link>
        {bigQueue && (
          <Link
            href="/review?all=1"
            className="flex items-center gap-2 text-xs text-fg-subtle transition hover:text-accent"
          >
            <span className="flex-1 truncate">Вся очередь · {countOf(due, 'card')}</span>
            <span aria-hidden>→</span>
          </Link>
        )}
      </div>

      {shown.length > 0 && (
        <div className="mt-3.5 flex flex-col gap-1.5 border-t border-border pt-3">
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
              className="mt-0.5 flex items-center gap-2 text-xs text-fg-subtle transition hover:text-accent"
            >
              <span className="flex-1 truncate">
                ещё {rest.length} {pluralRu(rest.length, ['модуль', 'модуля', 'модулей'])} · {restCards}
              </span>
              <span aria-hidden>→</span>
            </Link>
          )}
        </div>
      )}

      {overdue > 0 && (
        <Link
          href="/flashcards/triage"
          className="mt-auto flex items-center gap-2 border-t border-border pt-2.5 text-xs text-fg-muted transition hover:text-accent"
        >
          <span className="flex-1 truncate">
            <b className="font-mono tabular-nums">{overdue}</b> из них ждут дольше суток — разложить
            по дням
          </span>
          <span aria-hidden>→</span>
        </Link>
      )}
    </div>
  );
}
