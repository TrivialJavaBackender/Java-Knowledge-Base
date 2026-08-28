'use client';

import { useTransition } from 'react';
import { setDailyReviewLimit } from '@/lib/triage-actions';

const OPTIONS = [20, 30, 50];

export function DailyLimitPanel({ enabled, value }: { enabled: boolean; value: number }) {
  const [pending, start] = useTransition();

  function toggle() {
    start(() => setDailyReviewLimit(enabled ? null : value));
  }
  function pick(n: number) {
    start(() => setDailyReviewLimit(n));
  }

  const note = enabled
    ? `Не больше ${value} карточек в день. Всё сверх лимита само переезжает на следующий день, порядок сохраняется.`
    : 'Выключен: используется значение по умолчанию — 50 карточек в день.';

  return (
    <div className="flex items-center gap-3.5 rounded-[10px] border border-border bg-bg-card p-4">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={enabled}
        className={`flex h-[22px] w-[38px] flex-none items-center rounded-full border p-[2px] transition disabled:opacity-50 ${
          enabled ? 'justify-end border-accent bg-accent' : 'justify-start border-border bg-bg-soft'
        }`}
      >
        <span className={`h-4 w-4 rounded-full ${enabled ? 'bg-bg-card' : 'bg-fg-subtle'}`} />
      </button>
      <div className="flex-1">
        <div className="text-[13.5px] font-medium text-fg">Дневной лимит — чтобы завал не собрался снова</div>
        <div className="mt-0.5 text-[12.5px] leading-[1.5] text-fg-muted">{note}</div>
      </div>
      <div className="flex flex-none gap-1.5">
        {OPTIONS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => pick(n)}
            disabled={pending}
            className={`h-7 rounded-md border px-3 text-[12.5px] disabled:opacity-50 ${
              enabled && value === n ? 'border-accent/45 bg-accent-soft text-accent' : 'border-border bg-bg-card text-fg-muted hover:border-accent/30'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
