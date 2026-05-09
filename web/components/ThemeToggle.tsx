'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

function applyTheme(t: Theme) {
  const html = document.documentElement;
  html.classList.toggle('dark', t === 'dark');
  try {
    localStorage.setItem('theme', t);
  } catch {}
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const stored = (typeof localStorage !== 'undefined' && localStorage.getItem('theme')) as Theme | null;
    const initial: Theme = stored ?? (document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    setTheme(initial);
  }, []);

  function flip() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
  }

  return (
    <button
      type="button"
      onClick={flip}
      title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
      aria-label="Toggle theme"
      className="rounded border border-border bg-bg-card px-2 py-1 text-xs text-fg-muted hover:text-fg hover:border-accent/50"
    >
      {theme === 'dark' ? '☀︎ Light' : '☾ Dark'}
    </button>
  );
}

/**
 * Inline boot script — runs before paint to apply the persisted theme so
 * the page doesn't flash light-then-dark on first load.
 */
export const themeBootScript = `(()=>{try{var t=localStorage.getItem('theme');var d=document.documentElement;if(t==='dark'||(t==null&&matchMedia('(prefers-color-scheme: dark)').matches)){d.classList.add('dark');}else{d.classList.remove('dark');}}catch(e){document.documentElement.classList.add('dark');}})();`;
