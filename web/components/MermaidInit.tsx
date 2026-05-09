'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export function MermaidInit() {
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const nodes = document.querySelectorAll<HTMLElement>('.mermaid:not([data-processed="true"])');
      if (nodes.length === 0) return;
      const m = (await import('mermaid')).default;
      if (cancelled) return;
      const isDark = document.documentElement.classList.contains('dark');
      m.initialize({
        startOnLoad: false,
        theme: isDark ? 'dark' : 'default',
        securityLevel: 'loose',
        fontFamily: 'inherit',
      });
      try {
        await m.run({ nodes: Array.from(nodes) });
      } catch (err) {
        console.error('mermaid render failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return null;
}
