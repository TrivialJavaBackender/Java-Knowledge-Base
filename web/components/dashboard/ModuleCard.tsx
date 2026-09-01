import Link from 'next/link';
import { TrackDot } from '@/components/ui/TrackDot';
import { InlineMd } from '@/lib/inline-md';

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
        <TrackDot color={m.trackColor} />
        <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-fg group-hover:text-accent">
          {m.title}
        </span>
        {m.due > 0 && (
          <span
            title={`${m.due} на повторение сегодня`}
            className="flex flex-none items-center gap-1 rounded-full bg-accent-soft px-1.5 py-px text-[10.5px] text-accent"
          >
            <CardsIcon />
            <span className="font-mono">{m.due}</span>
            <span className="sr-only">на повторение сегодня</span>
          </span>
        )}
      </div>
      <div className="bar">
        <span style={{ width: `${m.pct}%` }} />
      </div>
      <InlineMd className="mt-2 block truncate text-[11.5px] text-fg-subtle" text={m.next} />
      <div className="mt-2.5 grid grid-cols-3 gap-1.5">
        <StatCell label="теория" stat={m.theory} />
        <StatCell label="упр." stat={m.exercises} showDash />
        <StatCell label="вопросы" stat={m.qas} />
      </div>
    </Link>
  );
}

function CardsIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="6" width="13" height="14" rx="2" />
      <path d="M7 3h11a3 3 0 0 1 3 3v11" />
    </svg>
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
