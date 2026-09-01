import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { countOf } from '@/lib/plural';
import { dailyLimitOf, countDue, loadDueQueue } from '@/lib/review-queue';
import { MIN_SESSION_SIZE, estimateMinutes } from '@/lib/review-session';
import { ReviewSession } from '@/components/review/ReviewSession';

export const dynamic = 'force-dynamic';

/**
 * Конечная точка уведомления и ярлыка PWA: тап → сразу первая карточка.
 *
 * Здесь намеренно нет выбора колод, режима и настроек — всё это живёт на
 * `/flashcards`. Смысл экрана в том, что между желанием повторить и первым
 * вопросом не стоит ни одного решения.
 *
 * `?all=1` — вся дневная очередь вместо пачки, `?round=N` — следующая пачка
 * (номер меняет URL и тем заставляет сервер собрать очередь заново; без него
 * Next отдал бы тот же результат).
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string; round?: string }>;
}) {
  const userId = await requireUser();
  const sp = await searchParams;

  const isFullQueue = sp.all === '1';
  const round = Number.parseInt(sp.round ?? '1', 10) || 1;

  const [totalDue, dailyLimit] = await Promise.all([countDue(userId), dailyLimitOf(userId)]);
  const limit = isFullQueue ? dailyLimit : Math.min(MIN_SESSION_SIZE, dailyLimit);

  const queue = await loadDueQueue(userId, {
    limit,
    // Пачка из пяти карточек одного модуля подряд запоминается хуже, чем
    // вперемешку, — тот же довод, что для смешанной очереди на /flashcards.
    shuffle: true,
  });

  const hasMore = totalDue > queue.length;

  return (
    <div className="mx-auto max-w-[720px] px-4 pb-6 pt-5 sm:px-6">
      <header className="mb-4 flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight tracking-tight text-fg">
            {totalDue === 0 ? 'Повторение' : 'Сегодня на повторение'}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-fg-muted">
            {totalDue === 0
              ? 'Всё созревшее повторено.'
              : hasMore
                ? `${countOf(totalDue, 'card')} созрело · сейчас ${queue.length}, ~${estimateMinutes(queue.length)} мин`
                : `${countOf(queue.length, 'card')} · ~${estimateMinutes(queue.length)} мин`}
          </p>
        </div>
        <Link
          href="/flashcards"
          className="flex h-9 flex-none items-center rounded-md border border-border bg-bg-card px-3 text-[13px] text-fg-muted transition hover:border-accent/50 hover:text-fg"
        >
          Выбрать колоды
        </Link>
      </header>

      <ReviewSession
        key={`${round}-${isFullQueue}`}
        queue={queue}
        totalDue={totalDue}
        round={round}
        isFullQueue={isFullQueue}
      />
    </div>
  );
}
