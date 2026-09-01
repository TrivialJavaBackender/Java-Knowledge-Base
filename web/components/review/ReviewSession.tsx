'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { FlashcardReview, type ReviewableCard, type SessionSummary } from '@/components/FlashcardReview';
import { estimateMinutes } from '@/lib/review-session';
import { countOf } from '@/lib/plural';

/**
 * Сессия повторения на `/review`: та же очередь и тот же алгоритм, что на
 * `/flashcards`, но нарезанная на пачки.
 *
 * Нарезка чисто визуальная. Каждая отвеченная карточка уходит в
 * `reviewFlashcard` и двигается по ящикам Лейтнера ровно так же, как при любом
 * другом способе повторения — «минимальная сессия» не даёт ни поблажек, ни
 * штрафов расписанию. Смысл в другом: очередь из 43 карточек читается как
 * обязательство на полчаса, и человек не открывает её вовсе; пачка из пяти
 * начинается.
 */
export function ReviewSession({
  queue,
  totalDue,
  round,
  isFullQueue,
}: {
  queue: ReviewableCard[];
  /** Сколько всего созрело на сегодня — на момент рендера страницы. */
  totalDue: number;
  /** Номер пачки, растёт при «Продолжить». Нужен, чтобы получить свежие карточки. */
  round: number;
  /** Показана вся дневная очередь, а не пачка. */
  isFullQueue: boolean;
}) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();

  // Отвеченные карточки уезжают на будущие даты, поэтому остаток на сегодня —
  // это исходное «созрело» минус размер показанной пачки.
  const remaining = Math.max(0, totalDue - queue.length);

  function goNextRound() {
    startNavigation(() => router.push(`/review?round=${round + 1}`));
  }

  return (
    <FlashcardReview
      key={round}
      initialQueue={queue}
      sessionDone={(summary) => (
        <DoneCard
          summary={summary}
          reviewed={queue.length}
          remaining={remaining}
          isFullQueue={isFullQueue}
          navigating={navigating}
          onContinue={goNextRound}
        />
      )}
    />
  );
}

function DoneCard({
  summary,
  reviewed,
  remaining,
  isFullQueue,
  navigating,
  onContinue,
}: {
  summary: SessionSummary;
  reviewed: number;
  remaining: number;
  isFullQueue: boolean;
  navigating: boolean;
  onContinue: () => void;
}) {
  // Ответы применяются оптимистично: карточка исчезает с экрана раньше, чем
  // сервер подтвердил запись. Уйти со страницы, пока последний ответ ещё летит,
  // значит потерять его — поэтому «Продолжить» ждёт.
  const blocked = summary.pending || navigating;

  if (reviewed === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg-card p-8 text-center">
        <div className="mb-3 text-3xl">🌱</div>
        <h2 className="text-xl font-semibold text-fg">На сегодня всё повторено</h2>
        <p className="mt-2 text-fg-muted">
          Новые карточки появятся здесь по расписанию Лейтнера.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex h-11 items-center rounded-md border border-border bg-bg-soft px-4 text-fg transition hover:border-accent/50"
        >
          На главную
        </Link>
      </div>
    );
  }

  const allDone = remaining === 0;

  return (
    <div className="rounded-lg border border-border bg-bg-card p-6 text-center sm:p-8">
      <div className="mb-3 text-3xl">{allDone ? '✓' : '🎉'}</div>
      <h2 className="text-xl font-semibold text-fg">
        {allDone
          ? 'Очередь на сегодня закончилась'
          : isFullQueue
            ? 'Сессия завершена'
            : 'Минимальная сессия завершена'}
      </h2>

      <p className="mt-2 text-fg-muted">
        {countOf(reviewed, 'card')} повторено · <b className="text-ok">{summary.knew}</b> знал /{' '}
        <b className="text-warn">{summary.again}</b> повторить
      </p>

      {!allDone && (
        <p className="mt-1 text-[13px] text-fg-muted">
          Осталось {countOf(remaining, 'card')} · ещё ~{estimateMinutes(remaining)} мин
        </p>
      )}

      <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
        {!allDone && (
          <button
            type="button"
            onClick={onContinue}
            disabled={blocked}
            className="flex h-12 items-center justify-center rounded-md border border-accent bg-accent px-5 font-medium text-white transition hover:opacity-90 disabled:opacity-50 sm:h-11"
          >
            {summary.pending ? 'Сохраняю…' : navigating ? 'Загружаю…' : 'Продолжить'}
          </button>
        )}
        <Link
          href="/"
          className="flex h-12 items-center justify-center rounded-md border border-border bg-bg-soft px-5 text-fg transition hover:border-accent/50 sm:h-11"
        >
          {allDone ? 'На главную' : 'Закончить'}
        </Link>
      </div>
    </div>
  );
}
