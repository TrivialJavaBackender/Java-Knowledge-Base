'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reviewFlashcard } from '@/lib/actions';
import { TRACK_DOT_CLASS } from '@/components/ui/TrackDot';

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
  // Ответ уже применён оптимистично (карточка ушла из очереди), поэтому упавшую
  // запись нельзя просто проглотить: без этого пользователь уверен, что
  // отметил карточку, а Leitner о ней ничего не узнал.
  const [failed, setFailed] = useState<{ id: number; knewIt: boolean } | null>(null);
  const router = useRouter();

  const current = queue[0];
  const done = total - queue.length;

  function persist(id: number, knewIt: boolean) {
    startTransition(async () => {
      try {
        await reviewFlashcard(id, knewIt);
        setFailed((f) => (f?.id === id ? null : f));
      } catch (e) {
        console.error(e);
        setFailed({ id, knewIt });
      }
    });
  }

  function answer(knewIt: boolean) {
    if (!current || pending) return;
    const id = current.id;
    setHistory((h) => (knewIt ? { ...h, knew: h.knew + 1 } : { ...h, again: h.again + 1 }));
    setQueue((q) => q.slice(1));
    setRevealed(false);
    persist(id, knewIt);
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
      {failed && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2.5 rounded-lg border border-warn/45 bg-warn/10 px-3.5 py-2.5 text-[13px] text-warn"
        >
          <WarnIcon />
          <span className="min-w-0 flex-1">Ответ не сохранился — карточка осталась в прежнем ящике.</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => persist(failed.id, failed.knewIt)}
            className="h-8 flex-none rounded-md border border-warn/50 bg-bg-card px-3 text-[12.5px] font-medium text-warn transition hover:bg-warn/15 disabled:opacity-50"
          >
            {pending ? 'Сохраняю…' : 'Повторить попытку'}
          </button>
        </div>
      )}

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

            <div className={`flex flex-col justify-center p-6 sm:p-8 ${revealed ? '' : 'min-h-[220px] sm:min-h-[260px]'}`}>
              {current.frontHtml ? (
                <div
                  className="prose prose-sm max-w-none text-[20px] leading-relaxed text-fg [&>p]:font-medium sm:text-[22px]"
                  dangerouslySetInnerHTML={{ __html: current.frontHtml }}
                />
              ) : (
                <div className="whitespace-pre-wrap text-[20px] font-medium leading-relaxed text-fg sm:text-[22px]">
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
                  className="flex h-12 flex-1 items-center justify-center rounded-md border border-accent bg-accent px-4 font-medium text-white transition hover:opacity-90 sm:h-11"
                >
                  Показать ответ <span className="ml-2 hidden text-xs opacity-80 sm:inline">[Space]</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => answer(false)}
                    disabled={pending}
                    className="flex h-12 flex-1 items-center justify-center rounded-md border border-border bg-bg-card px-3 text-fg transition hover:border-warn/50 hover:text-warn disabled:opacity-50 sm:h-11"
                  >
                    Повторить · box 1 <span className="ml-2 hidden text-xs text-fg-subtle sm:inline">[1]</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => answer(true)}
                    disabled={pending}
                    className="flex h-12 flex-1 items-center justify-center rounded-md border border-accent bg-accent px-3 font-medium text-white transition hover:opacity-90 disabled:opacity-50 sm:h-11"
                  >
                    Знал · box {Math.min(5, current.box + 1)}{' '}
                    <span className="ml-2 hidden text-xs opacity-80 sm:inline">[2]</span>
                  </button>
                </>
              )}
              {current.refDocSlug && current.moduleSlug && (
                <Link
                  href={`/modules/${current.moduleSlug}/theory/${current.refDocSlug}`}
                  className="flex h-12 flex-none items-center rounded-md border border-border bg-bg-card px-3 text-[13px] text-fg-muted transition hover:border-accent/50 hover:text-fg sm:h-11"
                >
                  К тексту
                </Link>
              )}
            </div>
          </div>

          {/* Клавиатурные подсказки — только там, где есть клавиатура: на
              указательном вводе это неработающая инструкция, которая вдобавок
              не помещалась в 390px и упиралась в край экрана. */}
          <div className="hidden flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 text-xs text-fg-subtle [@media(pointer:fine)]:flex">
            <Key>Space</Key> показать
            <Key>1</Key> повторить
            <Key>2</Key> знал
            <Key>Esc</Key> выйти
          </div>
        </>
      )}
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-bg-soft px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">
      {children}
    </kbd>
  );
}

function WarnIcon() {
  return (
    <svg className="h-4 w-4 flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="7.5" x2="12" y2="13" />
      <circle cx="12" cy="16.5" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}
