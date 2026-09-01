'use client';

import { useTransition } from 'react';
import { logoutAction } from './actions';

export function LogoutButton() {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(() => logoutAction())}
      disabled={pending}
      className="flex items-center gap-1 text-sm text-fg-muted hover:text-fg disabled:opacity-50"
      title="Выйти"
      aria-label="Выйти"
    >
      {/* Ниже sm в шапке тесно — остаётся одна иконка. */}
      <svg
        className="flex-none sm:hidden"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M15 5V4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1" />
        <path d="M10 12h10M17 9l3 3-3 3" />
      </svg>
      <span className="hidden sm:inline">Выйти</span>
    </button>
  );
}
