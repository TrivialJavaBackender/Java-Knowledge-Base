import Link from 'next/link';
import { TRACK_DOT_CLASS } from './colors';

export interface ModuleCardData {
  slug: string;
  title: string;
  trackColor: 1 | 2 | 3 | 4 | 5;
  theory: { done: number; total: number };
  exercises: { done: number; total: number };
  qas: { done: number; total: number };
  due: number;
  next: string;
  done: number;
  total: number;
  pct: number;
  started: boolean;
  finished: boolean;
}

export function ModuleCard({ m }: { m: ModuleCardData }) {
  return (
    <Link
      href={`/modules/${m.slug}`}
      className="group flex flex-col rounded-lg border border-border bg-bg-card px-3.5 py-3 transition hover:border-accent/50"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-2 w-2 flex-none rounded-sm ${TRACK_DOT_CLASS[m.trackColor]}`} />
        <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-fg group-hover:text-accent">
          {m.title}
        </span>
        {m.due > 0 && (
          <span className="flex-none rounded-full bg-accent-soft px-1.5 py-px font-mono text-[10.5px] text-accent">
            {m.due}
          </span>
        )}
      </div>
      <div className="bar">
        <span style={{ width: `${m.pct}%` }} />
      </div>
      <div className="mt-2 truncate text-[11.5px] text-fg-subtle">{m.next}</div>
      <div className="mt-2.5 grid grid-cols-3 gap-1.5">
        <StatCell label="теория" stat={m.theory} />
        <StatCell label="упр." stat={m.exercises} showDash />
        <StatCell label="вопросы" stat={m.qas} />
      </div>
    </Link>
  );
}

function StatCell({
  label,
  stat,
  showDash,
}: {
  label: string;
  stat: { done: number; total: number };
  showDash?: boolean;
}) {
  return (
    <div className="rounded border border-border/50 bg-bg-soft px-1.5 py-1 text-center">
      <div className="text-[9.5px] uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className="font-mono text-[11.5px] text-fg">
        {showDash && stat.total === 0 ? '—' : `${stat.done}/${stat.total}`}
      </div>
    </div>
  );
}
