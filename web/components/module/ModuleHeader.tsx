import Link from 'next/link';
import { TrackDot } from '@/components/ui/TrackDot';
import { MiniBar } from './MiniBar';

export function ModuleHeader({
  trackTitle,
  trackColor,
  title,
  order,
  description,
  theoryDone,
  theoryTotal,
  exDone,
  exTotal,
  qaDone,
  qaTotal,
}: {
  trackTitle: string;
  trackColor: 1 | 2 | 3 | 4 | 5;
  title: string;
  order: number;
  description: string | null;
  theoryDone: number;
  theoryTotal: number;
  exDone: number;
  exTotal: number;
  qaDone: number;
  qaTotal: number;
}) {
  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
        <Link href="/" className="text-fg-muted hover:text-accent">Главная</Link>
        <span>/</span>
        <span>{trackTitle}</span>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <TrackDot color={trackColor} />
            <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
            <span className="rounded-full border border-border bg-bg-soft px-2 py-0.5 font-mono text-[11px] text-fg-muted">
              модуль {order}
            </span>
          </div>
          {description && (
            <p className="mt-1.5 max-w-[640px] text-[13px] leading-relaxed text-fg-muted">{description}</p>
          )}
        </div>

        <div className="grid w-full grid-cols-3 gap-2.5 sm:w-auto sm:flex-none">
          <StatTile label="Теория" done={theoryDone} total={theoryTotal} />
          <StatTile label="Упражнения" done={exDone} total={exTotal} />
          <StatTile label="Вопросы" done={qaDone} total={qaTotal} />
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, done, total }: { label: string; done: number; total: number }) {
  const hasData = total > 0;
  const pct = hasData ? (done / total) * 100 : 0;
  return (
    <div className="min-w-0 rounded-lg border border-border bg-bg-card px-2.5 py-2 sm:w-[124px]">
      <div className="text-[10px] uppercase leading-tight tracking-wide text-fg-subtle">{label}</div>
      <div className={`mb-1.5 mt-px font-mono text-[13px] tabular-nums ${hasData ? 'text-fg' : 'text-fg-subtle'}`}>
        {hasData ? `${done}/${total}` : '—'}
      </div>
      <MiniBar pct={pct} />
    </div>
  );
}
