'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { setTheoryPosition } from '@/lib/theory-actions';

export interface TocSection {
  index: number;
  number: number | null;
  title: string;
  anchor: string;
  minutes: number;
  qCount: number;
}

export interface TocNextDoc {
  slug: string;
  title: string;
  sectionCount: number;
  readingMinutes: number;
}

export interface TocColumnProps {
  containerId: string;
  theoryDocId: number;
  sections: TocSection[];
  initialActiveIndex: number;
  moduleSlug: string;
  nextDoc: TocNextDoc | null;
}

const SPY_THRESHOLD = 140;
const POSITION_DEBOUNCE_MS = 2000;

/**
 * Right-hand table of contents: scroll-spy over the reader's headings, a
 * per-section question-count badge, and a "next in the roadmap" card.
 * Self-contained — owns its own active-section state and debounces
 * `setTheoryPosition` writes so scrolling doesn't hammer the DB.
 */
export function TocColumn({ containerId, theoryDocId, sections, initialActiveIndex, moduleSlug, nextDoc }: TocColumnProps) {
  const [activeIndex, setActiveIndex] = useState(() =>
    sections[initialActiveIndex] ? initialActiveIndex : 0,
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const container = document.getElementById(containerId);
    if (!container || sections.length === 0) return;

    const headings = sections
      .map((s) => document.getElementById(s.anchor))
      .filter((el): el is HTMLElement => el !== null);

    function onScroll() {
      if (!container || headings.length === 0) return;
      const containerTop = container.getBoundingClientRect().top;
      let idx = 0;
      for (let i = 0; i < headings.length; i++) {
        const top = headings[i].getBoundingClientRect().top - containerTop;
        if (top <= SPY_THRESHOLD) idx = i;
      }
      setActiveIndex((prev) => (prev === idx ? prev : idx));
    }

    onScroll();
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [containerId, sections]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setTheoryPosition(theoryDocId, activeIndex).catch(() => {
        // Best-effort — losing a reading-position write isn't worth surfacing to the user.
      });
    }, POSITION_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [activeIndex, theoryDocId]);

  function goTo(anchor: string) {
    document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <aside className="scroll hidden w-[232px] flex-none overflow-y-auto border-l border-border bg-bg py-6 xl:block">
      {sections.length > 0 && (
        <>
          <div className="px-4 pb-2">
            <span className="grp text-fg-subtle">В этом файле</span>
          </div>
          <div>
            {sections.map((s, i) => {
              const active = i === activeIndex;
              return (
                <button
                  key={s.anchor}
                  type="button"
                  onClick={() => goTo(s.anchor)}
                  className={`flex w-full items-start gap-2.5 border-l-[3px] py-[5px] pl-3 pr-4 text-left ${
                    active ? 'border-accent' : 'border-transparent'
                  } hover:bg-bg-soft`}
                >
                  <span
                    className={`mt-[5px] h-[6px] w-[6px] flex-none rounded-full ${
                      i <= activeIndex ? 'bg-accent' : 'bg-border'
                    }`}
                  />
                  <span className={`min-w-0 flex-1 text-[12.5px] leading-[1.4] ${active ? 'font-semibold text-fg' : 'text-fg-muted'}`}>
                    {s.title}
                  </span>
                  {s.qCount > 0 && (
                    <span className="mt-px flex-none rounded bg-accent-soft px-1 font-mono text-[10px] text-accent">
                      {s.qCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {nextDoc && (
        <div className="mx-3.5 mt-4 border-t border-border pt-3.5">
          <div className="grp mb-2 text-fg-subtle">Дальше по роадмапу</div>
          <Link
            href={`/modules/${moduleSlug}/theory/${nextDoc.slug}`}
            className="block rounded-lg border border-border bg-bg-card p-2.5 hover:border-accent/50"
          >
            <div className="text-[12.5px] font-medium leading-[1.35] text-fg">{nextDoc.title}</div>
            <div className="mt-1 text-[11px] text-fg-subtle">
              {nextDoc.sectionCount} {pluralizeSections(nextDoc.sectionCount)} · ~{nextDoc.readingMinutes} мин
            </div>
          </Link>
        </div>
      )}
    </aside>
  );
}

function pluralizeSections(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'раздел';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'раздела';
  return 'разделов';
}
