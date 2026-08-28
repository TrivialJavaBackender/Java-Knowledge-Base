'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reviewFlashcard } from '@/lib/actions';
import { TRACK_DOT_CLASS } from '@/components/flashcards/colors';

export interface ReviewableCard {
  id: number;
  front: string;
  back: string;
  frontHtml?: string;
  backHtml?: string;
  box: number;
  source: string;
  moduleTitle?: string | null;
  moduleSlug?: string | null;
  trackColor?: 1 | 2 | 3 | 4 | 5 | null;
  sectionTitle?: string | null;
  qNumber?: number | null;
  refDocSlug?: string | null;
  tags?: string;
}

/** «Модуль · Секция · QN» для шапки карточки; ручные карточки без модуля — «Свои карточки». */
function headerLine(c: ReviewableCard): string {
  const parts: string[] = [c.moduleTitle ?? 'Свои карточки'];
  if (c.sectionTitle) parts.push(c.sectionTitle);
  if (c.qNumber != null) parts.push(`Q${c.qNumber}`);
  return parts.join(' · ');
}

export function FlashcardReview({ initialQueue }: { initialQueue: ReviewableCard[] }) {
  const [queue, setQueue] = useState(initialQueue);
  const [total] = useState(initialQueue.length);
  const [revealed, setRevealed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [history, setHistory] = useState<{ knew: number; again: number }>({ knew: 0, again: 0 });
  const router = useRouter();

  const current = queue[0];
  const done = total - queue.length;

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
      if (e.key === 'Escape') {
        e.preventDefault();
        router.push('/');
        return;
      }
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
  }, [revealed, current, pending, router]);

  return (
    <div className="space-y-4">
      {total > 0 && (
        <div className="flex items-center gap-2.5 rounded-[9px] border border-border bg-bg-soft px-3.5 py-2.5">
          <span className="text-xs text-fg-muted">Сегодня</span>
          <div className="bar flex-1">
            <span style={{ width: `${Math.round((done / total) * 100)}%` }} />
          </div>
          <span className="font-mono text-xs text-fg tabular-nums">
            {done} / {total}
          </span>
        </div>
      )}

      {!current ? (
        <div className="rounded-lg border border-border bg-bg-card p-8 text-center">
          {total === 0 ? (
            <>
              <div className="text-3xl mb-3">🌱</div>
              <h2 className="text-xl font-semibold text-fg">В выбранных колодах пока нечего повторять</h2>
              <p className="mt-2 text-fg-muted">Новые карточки появятся здесь по расписанию Лейтнера.</p>
            </>
          ) : (
            <>
              <div className="text-3xl mb-3">✓</div>
              <h2 className="text-xl font-semibold text-fg">Очередь на сегодня закончилась</h2>
              <p className="mt-2 text-fg-muted">
                Сделано в этой сессии: <b className="text-ok">{history.knew}</b> знал /{' '}
                <b className="text-warn">{history.again}</b> повторить.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-bg-card">
            <div className="flex items-center gap-2 border-b border-border bg-bg-soft px-4 py-2.5">
              {current.trackColor != null && (
                <span className={`h-2 w-2 flex-none rounded-sm ${TRACK_DOT_CLASS[current.trackColor]}`} />
              )}
              <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{headerLine(current)}</span>
              <span className="flex-none rounded-full border border-border bg-bg-card px-1.5 py-px font-mono text-[11px] text-fg-muted">
                box {current.box}
              </span>
            </div>

            <div className="p-6 sm:p-8">
              {current.frontHtml ? (
                <div
                  className="prose prose-sm max-w-none text-fg text-[19px] leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: current.frontHtml }}
                />
              ) : (
                <div className="text-[19px] font-medium leading-relaxed text-fg whitespace-pre-wrap">
                  {current.front}
                </div>
              )}
              {revealed && (
                <div className="mt-5 border-t border-border pt-5">
                  {current.backHtml ? (
                    <div
                      className="prose prose-sm max-w-none text-fg leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: current.backHtml }}
                    />
                  ) : (
                    <div className="whitespace-pre-wrap text-fg leading-relaxed">{current.back}</div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-border bg-bg-soft px-4 py-3">
              {!revealed ? (
                <button
                  type="button"
                  onClick={() => setRevealed(true)}
                  className="flex-1 rounded-md border border-accent bg-accent px-4 py-2.5 text-white hover:opacity-90"
                >
                  Показать ответ <span className="ml-2 hidden sm:inline text-xs opacity-80">[Space]</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => answer(false)}
                    disabled={pending}
                    className="flex-1 rounded-md border border-border bg-bg-card px-4 py-2.5 text-fg hover:border-warn/50 disabled:opacity-50"
                  >
                    Повторить · box 1 <span className="ml-2 hidden sm:inline text-xs text-fg-subtle">[1]</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => answer(true)}
                    disabled={pending}
                    className="flex-1 rounded-md border border-accent bg-accent px-4 py-2.5 text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Знал · box {Math.min(5, current.box + 1)}{' '}
                    <span className="ml-2 hidden sm:inline text-xs opacity-80">[2]</span>
                  </button>
                </>
              )}
              {current.refDocSlug && current.moduleSlug && (
                <Link
                  href={`/modules/${current.moduleSlug}/theory/${current.refDocSlug}`}
                  className="flex-none rounded-md border border-border bg-bg-card px-3 py-2.5 text-[13px] text-fg-muted hover:border-accent/50 hover:text-fg"
                >
                  К тексту
                </Link>
              )}
            </div>
          </div>

          <div className="flex items-center justify-center gap-2.5 text-xs text-fg-subtle">
            <kbd className="rounded border border-border bg-bg-soft px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">Space</kbd>{' '}
            показать{' '}
            <kbd className="rounded border border-border bg-bg-soft px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">1</kbd>{' '}
            повторить{' '}
            <kbd className="rounded border border-border bg-bg-soft px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">2</kbd>{' '}
            знал{' '}
            <kbd className="rounded border border-border bg-bg-soft px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">Esc</kbd>{' '}
            выйти
          </div>
        </>
      )}
    </div>
  );
}
