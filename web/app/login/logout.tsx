'use client';

import { useTransition } from 'react';
import { logoutAction } from './actions';

export function LogoutButton() {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(() => logoutAction())}
      disabled={pending}
      className="text-sm text-fg-muted hover:text-fg disabled:opacity-50"
    >
      Выйти
    </button>
  );
}
