'use client';

import { useEffect, useState } from 'react';
import { ToggleQAKnown } from './ToggleProgress';

export function QAItem({
  id,
  qNumber,
  question,
  answerHtml,
  sourceRef,
  initialKnown,
}: {
  id: number;
  qNumber: number;
  question: string;
  answerHtml: string;
  sourceRef?: string | null;
  initialKnown: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Search links here as `#qa-<qNumber>` — a natural key, so the anchor
  // survives re-imports the way the rest of the content keys do. Next scrolls
  // to it on navigation; expanding the answer is on us.
  const anchor = `qa-${qNumber}`;
  useEffect(() => {
    function openIfTargeted() {
      if (window.location.hash !== `#${anchor}`) return;
      setOpen(true);
      document.getElementById(anchor)?.scrollIntoView({ block: 'start' });
    }
    openIfTargeted();
    window.addEventListener('hashchange', openIfTargeted);
    return () => window.removeEventListener('hashchange', openIfTargeted);
  }, [anchor]);

  return (
    <div id={anchor} className="scroll-mt-24 rounded border border-border bg-bg-card transition">
      <div className="flex items-start gap-3 p-3">
        <div className="pt-0.5">
          <ToggleQAKnown id={id} initial={initialKnown} />
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 text-left"
        >
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-xs text-fg-subtle">Q{qNumber}</span>
            <span className="font-medium text-fg hover:text-accent">{question}</span>
          </div>
          {open && (
            <div className="mt-3 rounded bg-bg-soft p-3">
              <div
                className="prose prose-sm max-w-none text-fg leading-relaxed"
                dangerouslySetInnerHTML={{ __html: answerHtml }}
              />
              {sourceRef && (
                <div className="mt-3 border-l-2 border-accent/40 pl-3 text-xs text-fg-subtle italic">
                  {sourceRef}
                </div>
              )}
            </div>
          )}
        </button>
        <span className="select-none text-xs text-fg-subtle">{open ? '▾' : '▸'}</span>
      </div>
    </div>
  );
}
