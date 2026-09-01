'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { applySpreadPlan, applyResetPlan, applyArchivePlan, type TriageScope } from '@/lib/triage-actions';

export function ApplyBar({
  plan,
  n,
  scope,
  label,
  note,
  reversible,
  listHref,
  listActive,
  disabled = false,
}: {
  plan: 'spread' | 'reset' | 'archive';
  n: number;
  scope: TriageScope;
  label: string;
  note: string;
  reversible: boolean;
  listHref: string;
  listActive: boolean;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();

  function apply() {
    if (!reversible && !confirm('Действие необратимо: прежние интервалы и стрики восстановить будет нечем. Продолжить?')) {
      return;
    }
    start(async () => {
      if (plan === 'spread') await applySpreadPlan(n, scope);
      else if (plan === 'reset') await applyResetPlan(scope);
      else await applyArchivePlan(n, scope);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-border bg-bg-soft px-4 py-[13px]">
      <span className="flex-1 text-[13px] leading-[1.5] text-fg-muted">{note}</span>
      <Link
        href={listHref}
        scroll={false}
        className={`flex h-9 shrink-0 items-center rounded-[7px] border px-3.5 text-[13px] transition ${
          listActive ? 'border-accent/45 bg-accent-soft text-accent' : 'border-border bg-bg-card text-fg-muted hover:border-accent/30'
        }`}
      >
        {listActive ? 'Скрыть список' : 'Показать список'}
      </Link>
      <button
        type="button"
        onClick={apply}
        disabled={pending || disabled}
        className="h-[34px] shrink-0 rounded-[7px] border border-accent bg-accent px-4 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? 'Применяю…' : label}
      </button>
    </div>
  );
}
