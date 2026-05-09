'use client';

import { useState, useTransition } from 'react';

export function Checkbox({
  initial,
  onToggle,
  label,
  size = 'md',
}: {
  initial: boolean;
  onToggle: (next: boolean) => Promise<void>;
  label?: string;
  size?: 'sm' | 'md';
}) {
  const [checked, setChecked] = useState(initial);
  const [pending, startTransition] = useTransition();
  const dim = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';

  function flip() {
    const next = !checked;
    setChecked(next);
    startTransition(async () => {
      try {
        await onToggle(next);
      } catch (e) {
        setChecked(!next);
        console.error(e);
      }
    });
  }

  return (
    <label className="inline-flex cursor-pointer items-center gap-2 select-none">
      <span
        onClick={flip}
        role="checkbox"
        aria-checked={checked}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            flip();
          }
        }}
        className={`${dim} rounded border transition flex items-center justify-center ${
          checked
            ? 'bg-accent border-accent text-bg'
            : 'border-border bg-bg-card hover:border-accent/50'
        } ${pending ? 'opacity-60' : ''}`}
      >
        {checked && (
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {label && <span className="text-sm text-fg">{label}</span>}
    </label>
  );
}
