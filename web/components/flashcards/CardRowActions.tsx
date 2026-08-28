'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { archiveFlashcard, resetLeitner } from '@/lib/actions';

/**
 * Действия над одной карточкой в результатах поиска. Массовых операций здесь
 * намеренно нет: выборка и планы разбора живут на /flashcards/triage, где к ним
 * прилагаются диагноз, горизонт и график нагрузки.
 */
export function CardRowActions({
  id,
  archived,
  source,
}: {
  id: number;
  archived: boolean;
  source: string;
}) {
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {source === 'MANUAL' && (
        <Link
          href={`/flashcards/${id}/edit`}
          className="flex h-7 items-center rounded-md border border-border bg-bg-card px-2.5 text-[12px] text-fg-muted hover:border-accent/40 hover:text-fg"
        >
          Править
        </Link>
      )}
      <button
        type="button"
        disabled={pending}
        title="Сбросить интервал и положить в box 1 на сегодня"
        onClick={() => {
          if (!confirm('Сбросить интервал и положить в box 1 на сегодня?')) return;
          start(() => resetLeitner(id));
        }}
        className="h-7 rounded-md border border-border bg-bg-card px-2.5 text-[12px] text-fg-muted hover:border-warn/40 hover:text-warn disabled:opacity-50"
      >
        Сбросить
      </button>
      <button
        type="button"
        disabled={pending}
        title={archived ? 'Вернуть карточку в очередь на сегодня' : 'Убрать карточку из очереди'}
        onClick={() => start(() => archiveFlashcard(id, !archived))}
        className={`h-7 rounded-md border px-2.5 text-[12px] disabled:opacity-50 ${
          archived
            ? 'border-ok/40 bg-ok/10 text-ok hover:bg-ok/20'
            : 'border-border bg-bg-card text-fg-muted hover:border-warn/40 hover:text-warn'
        }`}
      >
        {archived ? 'Вернуть' : 'В архив'}
      </button>
    </div>
  );
}
