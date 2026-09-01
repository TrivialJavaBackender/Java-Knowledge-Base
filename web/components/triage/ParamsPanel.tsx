import Link from 'next/link';
import { TrackDot } from '@/components/ui/TrackDot';

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
  scopeSummary,
  selectAllHref,
  selectAllLabel,
}: {
  paramTitle: string;
  paramNote: string;
  horizons: HorizonOption[];
  scopes: ScopeOption[];
  /** Что выбрано сейчас — иначе при десятке отмеченных чипов это не прочитать. */
  scopeSummary: string;
  selectAllHref: string;
  selectAllLabel: string;
}) {
  return (
    <div className="rounded-[10px] border border-border bg-bg-card p-4">
      <div className="grp mb-2.5 text-fg-muted">{paramTitle}</div>
      <div className="mb-3.5 flex flex-wrap gap-1.5">
        {horizons.map((h) => (
          <Link
            key={h.n}
            href={h.href}
            scroll={false}
            aria-current={h.active ? 'true' : undefined}
            className={`flex h-8 items-center rounded-full border px-3 text-[12.5px] transition ${
              h.active ? 'border-accent/45 bg-accent-soft text-accent' : 'border-border bg-bg-card text-fg-muted hover:border-accent/30'
            }`}
          >
            {h.label}
          </Link>
        ))}
      </div>
      <div className="text-[13px] leading-[1.6] text-fg-muted">{paramNote}</div>

      <div className="mb-2 mt-[18px] flex flex-wrap items-center gap-2">
        <span className="grp text-fg-muted">К каким модулям применить</span>
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-fg-subtle">{scopeSummary}</span>
        <Link
          href={selectAllHref}
          scroll={false}
          className="flex h-7 items-center rounded-full border border-border bg-bg-card px-2.5 text-[11.5px] text-fg-muted transition hover:border-accent/50 hover:text-fg"
        >
          {selectAllLabel}
        </Link>
      </div>
      {/* Множественный выбор: чип — тогл, а не переключатель на один модуль.
          scroll={false} обязателен: это смена параметра на той же странице, а
          Next после навигации по умолчанию отматывает документ в начало, и
          каждый клик по чипу отбрасывал к шапке.
          Поэтому у каждого есть галочка, иначе «отмечено» и «сейчас открыто»
          выглядели бы одинаково. */}
      <div className="flex flex-wrap gap-1.5">
        {scopes.map((s) => (
          <Link
            key={s.key}
            href={s.href}
            scroll={false}
            aria-pressed={s.active}
            className={`flex h-8 items-center gap-1.5 rounded-full border pl-2 pr-2.5 text-[12px] transition ${
              s.active
                ? 'border-accent/45 bg-accent-soft text-accent'
                : 'border-border bg-bg-card text-fg-subtle hover:border-accent/30 hover:text-fg-muted'
            }`}
          >
            <span
              className={`flex h-[14px] w-[14px] flex-none items-center justify-center rounded-[4px] border ${
                s.active ? 'border-accent bg-accent' : 'border-border bg-bg-card'
              }`}
            >
              {s.active && (
                <svg viewBox="0 0 16 16" className="h-[9px] w-[9px]" fill="none" stroke="var(--bg)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 8l3 3 7-7" />
                </svg>
              )}
            </span>
            {s.trackColor != null && <TrackDot color={s.trackColor} size={7} />}
            {s.title}
            <span className="font-mono text-[10.5px] opacity-75">{s.count}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
