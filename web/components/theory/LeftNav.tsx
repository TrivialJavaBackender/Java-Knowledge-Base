'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export interface NavDoc {
  slug: string;
  title: string;
  isRead: boolean;
  isCurrent: boolean;
}

export interface NavQaSection {
  id: number;
  title: string;
  known: number;
  total: number;
}

export interface LeftNavProps {
  moduleSlug: string;
  moduleTitle: string;
  moduleOrder: number;
  moduleCount: number;
  docs: NavDoc[];
  docsDone: number;
  qaSections: NavQaSection[];
  qaKnown: number;
  qaTotal: number;
  overallDone: number;
  overallTotal: number;
}

/**
 * Left navigation column of the theory reader. Self-contained: owns its own
 * open/collapsed state so it doesn't need to coordinate with siblings. Below
 * `lg` it renders as an off-canvas overlay (own floating trigger + backdrop,
 * since the app header — where the design puts a nav toggle — is out of
 * scope for this batch); at `lg`+ it's an in-flow column that collapses to a
 * 40px rail via its own internal toggle.
 */
export function LeftNav(props: LeftNavProps) {
  const {
    moduleSlug, moduleTitle, moduleOrder, moduleCount,
    docs, docsDone, qaSections, qaKnown, qaTotal, overallDone, overallTotal,
  } = props;
  const [open, setOpen] = useState(true);
  const overallPct = overallTotal === 0 ? 0 : Math.round((overallDone / overallTotal) * 100);

  // Server-rendered default is "open" (correct for the lg+ in-flow column).
  // Below lg that would paint as a full-screen overlay blocking the reader
  // on first load, so close it once we know the viewport is narrow. This
  // runs post-hydration — a state update, not a hydration mismatch.
  useEffect(() => {
    if (window.matchMedia('(max-width: 1023px)').matches) setOpen(false);
  }, []);

  return (
    <>
      {/* Mobile trigger — always present below lg, regardless of open state. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Навигация по модулю"
        className="fixed left-2 top-[60px] z-30 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-card text-fg-muted shadow-sm lg:hidden"
      >
        <MenuIcon />
      </button>

      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/30 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <nav
        className={`scroll fixed bottom-0 left-0 top-[52px] z-20 overflow-x-hidden overflow-y-auto border-r border-border bg-bg-soft transition-transform duration-200 lg:static lg:z-auto lg:h-full lg:translate-x-0 lg:transition-[width] ${
          open ? 'w-[272px] translate-x-0' : 'w-[272px] -translate-x-full lg:w-10'
        }`}
      >
        {/* Desktop-only collapse toggle */}
        <div className="hidden justify-end p-1.5 lg:flex">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            title={open ? 'Свернуть навигацию' : 'Развернуть навигацию'}
            className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-border bg-bg-card text-fg-muted hover:border-accent/50 hover:text-fg"
          >
            {open ? <CollapseIcon /> : <MenuIcon />}
          </button>
        </div>

        {/* Content stays mounted while off-canvas on mobile (so the slide-in
            transition has something to show); at lg it's hidden outright
            while the rail is collapsed, since width alone can't clip it. */}
        <div className={`w-[272px] ${open ? '' : 'lg:hidden'}`}>
            <div className="border-b border-border p-3 pt-1 lg:pt-3">
              <Link
                href={`/modules/${moduleSlug}`}
                className="flex items-center gap-2.5 rounded-md border border-border bg-bg-card px-2.5 py-2 text-left hover:border-accent/50"
              >
                <span className="h-2 w-2 flex-none rounded-sm bg-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-fg">{moduleTitle}</span>
                  <span className="mt-0.5 block text-[11px] text-fg-subtle">
                    модуль {moduleOrder} из {moduleCount} · пройдено {overallPct}%
                  </span>
                </span>
              </Link>
            </div>

            {docs.length > 0 && (
              <>
                <div className="flex items-center justify-between px-3.5 pb-1.5 pt-3.5">
                  <span className="grp text-fg-subtle">Теория · по роадмапу</span>
                  <span className="font-mono text-[11px] text-fg-subtle">{docsDone}/{docs.length}</span>
                </div>
                <div>
                  {docs.map((d) => (
                    <Link
                      key={d.slug}
                      href={`/modules/${moduleSlug}/theory/${d.slug}`}
                      className={`flex items-start gap-2.5 border-l-[3px] py-1.5 pl-3 pr-3 ${
                        d.isCurrent ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-bg-card'
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-[13px] w-[13px] flex-none items-center justify-center rounded-[3px] border ${
                          d.isRead ? 'border-accent bg-accent' : 'border-border bg-bg-card'
                        }`}
                      >
                        {d.isRead && (
                          <svg viewBox="0 0 16 16" className="h-[9px] w-[9px]" fill="none" stroke="var(--bg)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 8l3 3 7-7" />
                          </svg>
                        )}
                      </span>
                      <span
                        className={`clamp2 text-[12.5px] leading-[1.35] ${
                          d.isCurrent ? 'font-semibold text-fg' : 'text-fg-muted'
                        }`}
                      >
                        {d.title}
                      </span>
                    </Link>
                  ))}
                </div>
              </>
            )}

            {qaSections.length > 0 && (
              <>
                <div className="flex items-center justify-between px-3.5 pb-1.5 pt-4">
                  <span className="grp text-fg-subtle">Вопросы · {qaSections.length} секций</span>
                  <span className="font-mono text-[11px] text-fg-subtle">{qaKnown}/{qaTotal}</span>
                </div>
                <div>
                  {qaSections.map((s) => (
                    <Link
                      key={s.id}
                      href={`/modules/${moduleSlug}/qa#section-${s.id}`}
                      className="flex items-center gap-2.5 py-1.5 pl-3.5 pr-3 hover:bg-bg-card"
                    >
                      <span className="min-w-0 flex-1 truncate text-[12.5px] leading-[1.35] text-fg-muted">{s.title}</span>
                      <span className="font-mono text-[10.5px] text-fg-subtle">{s.known}/{s.total}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}

            <div className="m-3 mt-4 rounded-md border border-border bg-bg-card p-2.5">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-[11px] text-fg-muted">Модуль целиком</span>
                <span className="font-mono text-[11px] text-fg">{overallDone}/{overallTotal}</span>
              </div>
              <div className="bar">
                <span style={{ width: `${overallPct}%` }} />
              </div>
            </div>
          </div>
      </nav>
    </>
  );
}

function MenuIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </svg>
  );
}
