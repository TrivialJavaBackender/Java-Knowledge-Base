'use client';

import { useState, useTransition } from 'react';
import { reviewFlashcard, toggleQAKnown } from '@/lib/actions';
import { BOX_INTERVAL_DAYS, reviewCard } from '@/lib/leitner';

export interface SelfCheckItem {
  qaId: number;
  qNumber: number;
  refSection: number;
  /** Отрендерены на сервере — уже `<p>…</p>`. */
  questionHtml: string;
  answerHtml: string;
  sourceRef: string | null;
  /** null, если авто-карточки нет (такого быть не должно, но не падаем). */
  flashcardId: number | null;
  /** Текущий бокс Leitner; null — карточку ещё ни разу не повторяли. */
  box: number | null;
  isKnown: boolean;
}

/**
 * Плашка «Проверь себя» под разделом теории: вопрос, раскрывающийся ответ и
 * отметка Leitner. Кнопки те же, что в очереди повторений, и дёргают тот же
 * server action (`reviewFlashcard`) — прочитал раздел, ответил себе, отметил, и
 * карточка уехала в следующий бокс, не заходя в `/flashcards`.
 *
 * Состояние после клика показывается локально: `reviewFlashcard` намеренно не
 * делает `revalidatePath` (очередь живёт на клиенте), а перерисовывать всю
 * страницу теории ради одного бейджа незачем.
 */
export function SelfCheckCard({ item }: { item: SelfCheckItem }) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState(item.box);
  const [done, setDone] = useState<'knew' | 'again' | null>(null);
  const [pending, startTransition] = useTransition();

  function review(knewIt: boolean) {
    // Тот же расчёт, что применит сервер, — просто показываем результат сразу,
    // не дожидаясь ответа (streak/lapses для бокса не важны).
    const nextBox = reviewCard({ box: box ?? 1, streak: 0, lapses: 0 }, knewIt).box;
    setBox(nextBox);
    setDone(knewIt ? 'knew' : 'again');
    startTransition(async () => {
      if (item.flashcardId != null) await reviewFlashcard(item.flashcardId, knewIt);
      if (knewIt && !item.isKnown) await toggleQAKnown(item.qaId, true);
    });
  }

  return (
    <div className="not-prose my-4 flex items-start gap-2.5 rounded-lg border border-accent/30 bg-accent/5 p-3.5">
      <QuestionMarkIcon />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="lbl text-accent">Проверь себя</span>
          <span className="font-mono text-[10.5px] text-fg-subtle">
            Q{item.qNumber} · привязан к §{item.refSection}
          </span>
          {box !== null && (
            <span className="rounded border border-border bg-bg-soft px-1 font-mono text-[10px] text-fg-muted">
              box {box}
            </span>
          )}
        </div>

        <div
          className="prose prose-sm max-w-none text-fg [&>p]:font-medium"
          dangerouslySetInnerHTML={{ __html: item.questionHtml }}
        />

        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-2.5 inline-flex h-[27px] items-center rounded-md border border-accent bg-accent px-3 text-[12.5px] font-medium text-white"
          >
            Показать ответ
          </button>
        ) : (
          <>
            <div className="mt-2.5 rounded-md bg-bg-soft p-3">
              <div className="prose prose-sm max-w-none text-fg" dangerouslySetInnerHTML={{ __html: item.answerHtml }} />
              {item.sourceRef && (
                <div className="mt-2 border-l-2 border-accent/40 pl-2.5 font-mono text-[11px] text-fg-subtle">
                  {item.sourceRef}
                </div>
              )}
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => review(true)}
                className={`inline-flex h-[27px] items-center rounded-md border px-3 text-[12.5px] font-medium disabled:opacity-60 ${
                  done === 'knew'
                    ? 'border-ok bg-ok text-white'
                    : 'border-border bg-bg-card text-fg-muted hover:border-ok hover:text-ok'
                }`}
              >
                Знал
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => review(false)}
                className={`inline-flex h-[27px] items-center rounded-md border px-3 text-[12.5px] font-medium disabled:opacity-60 ${
                  done === 'again'
                    ? 'border-warn bg-warn text-white'
                    : 'border-border bg-bg-card text-fg-muted hover:border-warn hover:text-warn'
                }`}
              >
                Повторить
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-[12px] text-fg-subtle hover:text-fg-muted"
              >
                Скрыть ответ
              </button>
              {done && (
                <span className="font-mono text-[11px] text-fg-subtle">
                  {dueLabel(box ?? 1)}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** «Повтор через N дн.» — интервал того бокса, в который карточка только что уехала. */
function dueLabel(box: number): string {
  const days = BOX_INTERVAL_DAYS[box] ?? 1;
  return `повтор через ${days} ${pluralizeDays(days)}`;
}

function pluralizeDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня';
  return 'дней';
}

function QuestionMarkIcon() {
  return (
    <svg
      className="mt-0.5 h-[15px] w-[15px] flex-none text-accent"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.4 2.4 0 1 1 3.2 2.3c-.6.2-.8.7-.8 1.3" />
      <circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}
