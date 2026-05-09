'use client';

import { useEffect, useState, useTransition } from 'react';
import { reviewFlashcard } from '@/lib/actions';

export interface ReviewableCard {
  id: number;
  front: string;
  back: string;
  box: number;
  source: string;
  moduleTitle?: string | null;
  sectionTitle?: string | null;
  tags?: string;
}

export function FlashcardReview({ initialQueue }: { initialQueue: ReviewableCard[] }) {
  const [queue, setQueue] = useState(initialQueue);
  const [revealed, setRevealed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [history, setHistory] = useState<{ knew: number; again: number }>({ knew: 0, again: 0 });

  const current = queue[0];

  function answer(knewIt: boolean) {
    if (!current || pending) return;
    const id = current.id;
    setHistory((h) => (knewIt ? { ...h, knew: h.knew + 1 } : { ...h, again: h.again + 1 }));
    setQueue((q) => q.slice(1));
    setRevealed(false);
    startTransition(async () => {
      try {
        await reviewFlashcard(id, knewIt);
      } catch (e) {
        console.error(e);
      }
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target && (e.target as HTMLElement).tagName === 'INPUT') return;
      if (!current) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!revealed) setRevealed(true);
        return;
      }
      if (!revealed) return;
      if (e.key === '1' || e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        answer(false);
      } else if (e.key === '2' || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        answer(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, current, pending]);

  if (!current) {
    return (
      <div className="rounded-lg border border-border bg-bg-card p-8 text-center">
        <div className="text-3xl mb-3">✓</div>
        <h2 className="text-xl font-semibold text-fg">Очередь на сегодня закончилась</h2>
        <p className="mt-2 text-fg-muted">
          Сделано в этой сессии: <b className="text-ok">{history.knew}</b> знал /{' '}
          <b className="text-warn">{history.again}</b> повторить.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm text-fg-muted">
        <span>
          Осталось: <b className="font-mono tabular-nums text-fg">{queue.length}</b>
        </span>
        <span className="flex items-center gap-3">
          <span className="font-mono text-xs">box {current.box}/5</span>
          <span className="rounded border border-border px-2 py-0.5 text-xs">{current.source}</span>
        </span>
      </div>

      <div className="rounded-lg border border-border bg-bg-card p-6 min-h-[260px]">
        {(current.moduleTitle || current.sectionTitle) && (
          <div className="mb-4 text-xs uppercase tracking-wide text-fg-subtle">
            {current.moduleTitle}{current.sectionTitle ? ` · ${current.sectionTitle}` : ''}
          </div>
        )}
        <div className="text-lg font-medium text-fg whitespace-pre-wrap">
          {current.front}
        </div>
        {revealed && (
          <div className="mt-6 border-t border-border pt-4 whitespace-pre-wrap text-fg leading-relaxed">
            {current.back}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        {!revealed ? (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="flex-1 rounded-md border border-accent/60 bg-accent/10 px-4 py-2.5 text-accent hover:bg-accent/20"
          >
            Показать ответ <span className="ml-2 text-xs text-fg-subtle">[Space]</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => answer(false)}
              disabled={pending}
              className="flex-1 rounded-md border border-warn/40 bg-warn/10 px-4 py-2.5 text-warn hover:bg-warn/20 disabled:opacity-50"
            >
              Повторить <span className="ml-2 text-xs text-fg-subtle">[1]</span>
            </button>
            <button
              type="button"
              onClick={() => answer(true)}
              disabled={pending}
              className="flex-1 rounded-md border border-ok/40 bg-ok/10 px-4 py-2.5 text-ok hover:bg-ok/20 disabled:opacity-50"
            >
              Знал <span className="ml-2 text-xs text-fg-subtle">[2]</span>
            </button>
          </>
        )}
      </div>

      <div className="text-xs text-fg-subtle text-center">
        Сделано: <b className="text-ok">{history.knew}</b> знал /{' '}
        <b className="text-warn">{history.again}</b> повторить
      </div>
    </div>
  );
}
