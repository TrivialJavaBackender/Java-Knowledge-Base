'use client';

import { useTransition } from 'react';
import { archiveFlashcard, resetLeitner } from '@/lib/actions';

export function ArchiveButton({ id, archived }: { id: number; archived: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      onClick={() => start(() => archiveFlashcard(id, !archived))}
      disabled={pending}
      className={`rounded border px-2 py-1 text-xs hover:opacity-90 disabled:opacity-50 ${
        archived
          ? 'border-ok/40 bg-ok/10 text-ok'
          : 'border-border bg-bg-card text-fg-muted hover:text-warn hover:border-warn/40'
      }`}
    >
      {archived ? 'Restore' : 'Archive'}
    </button>
  );
}

export function ResetButton({ id }: { id: number }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      onClick={() => {
        if (!confirm('Reset Leitner state to box 1?')) return;
        start(() => resetLeitner(id));
      }}
      disabled={pending}
      className="rounded border border-border bg-bg-card px-2 py-1 text-xs text-fg-muted hover:text-warn hover:border-warn/40 disabled:opacity-50"
      title="Сбросить интервал и положить в box 1 на сегодня"
    >
      Reset
    </button>
  );
}
