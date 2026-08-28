import Link from 'next/link';
import { TRACK_DOT_CLASS } from './colors';

export interface HorizonOption {
  n: number;
  label: string;
  href: string;
  active: boolean;
}

export interface ScopeOption {
  key: string;
  title: string;
  count: number;
  href: string;
  active: boolean;
  trackColor: 1 | 2 | 3 | 4 | 5 | null;
}

export function ParamsPanel({
  paramTitle,
  paramNote,
  horizons,
  scopes,
}: {
  paramTitle: string;
  paramNote: string;
  horizons: HorizonOption[];
  scopes: ScopeOption[];
}) {
  return (
    <div className="rounded-[10px] border border-border bg-bg-card p-4">
      <div className="grp mb-2.5 text-fg-muted">{paramTitle}</div>
      <div className="mb-3.5 flex flex-wrap gap-1.5">
        {horizons.map((h) => (
          <Link
            key={h.n}
            href={h.href}
            className={`rounded-full border px-3 py-1 text-[12.5px] ${
              h.active ? 'border-accent/45 bg-accent-soft text-accent' : 'border-border bg-bg-card text-fg-muted hover:border-accent/30'
            }`}
          >
            {h.label}
          </Link>
        ))}
      </div>
      <div className="text-[13px] leading-[1.6] text-fg-muted">{paramNote}</div>

      <div className="grp mb-2 mt-[18px] text-fg-muted">К каким модулям применить</div>
      <div className="flex flex-wrap gap-1.5">
        {scopes.map((s) => (
          <Link
            key={s.key}
            href={s.href}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-[5px] text-[12px] ${
              s.active ? 'border-accent/45 bg-accent-soft text-accent' : 'border-border bg-bg-card text-fg-muted hover:border-accent/30'
            }`}
          >
            {s.trackColor != null && <span className={`h-[7px] w-[7px] flex-none rounded-[2px] ${TRACK_DOT_CLASS[s.trackColor]}`} />}
            {s.title}
            <span className="font-mono text-[10.5px] opacity-75">{s.count}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
