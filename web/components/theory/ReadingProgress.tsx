'use client';

import { useEffect, useRef } from 'react';

/**
 * 2px reading-progress bar. In the design it sits under the app header; since
 * that header is out of scope for this batch, it's pinned (sticky) to the top
 * of the reader's own scroll container instead — see page.tsx, first child of
 * `#theory-scroll`.
 *
 * Width is written straight to the DOM via a ref on every scroll tick rather
 * than through React state, so scrolling doesn't trigger a re-render.
 */
export function ReadingProgress({ containerId }: { containerId: string }) {
  const barRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = document.getElementById(containerId);
    if (!el) return;

    function update() {
      const span = Math.max(1, el!.scrollHeight - el!.clientHeight);
      const pct = Math.max(2, Math.min(100, Math.round((el!.scrollTop / span) * 100)));
      if (barRef.current) barRef.current.style.width = `${pct}%`;
    }

    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => el.removeEventListener('scroll', update);
  }, [containerId]);

  return (
    <div className="sticky top-0 z-10 h-[2px] w-full bg-transparent">
      <span ref={barRef} className="block h-full bg-accent" style={{ width: '2%' }} />
    </div>
  );
}
