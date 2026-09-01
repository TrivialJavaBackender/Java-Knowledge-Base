import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import { prisma } from '@/lib/db';
import { countDue } from '@/lib/review-queue';
import { SearchBox } from '@/components/SearchBox';
import { ThemeToggle, themeBootScript } from '@/components/ThemeToggle';
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';
import { LogoutButton } from '@/app/login/logout';
import { getSession } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Interview Prep',
  description: 'Personal interview prep tracker — theory, exercises, flashcards.',
  // Запуск с домашнего экрана iOS — там манифест не читается, нужны мета-теги.
  appleWebApp: { capable: true, title: 'Prep', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  // Цвет системной шапки в standalone-режиме. Две записи вместо одной: с одним
  // значением тёмная тема получила бы светлую полосу над своим содержимым.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0969da' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0d10' },
  ],
};

interface HeaderData {
  dueCount: number;
  /** null для неавторизованного посетителя — аватар тогда не рисуем. */
  initials: string | null;
}

/** «Pavel Saroka» → «PS», однословный логин «pavel» → «PA». */
function initialsOf(username: string): string {
  const trimmed = username.trim();
  const parts = trimmed.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase() || '?';
}

async function getHeaderData(): Promise<HeaderData> {
  try {
    const session = await getSession();
    if (!session) return { dueCount: 0, initials: null };
    const [dueCount, user] = await Promise.all([
      countDue(session.userId),
      prisma.user.findUnique({ where: { id: session.userId }, select: { username: true } }),
    ]);
    return { dueCount, initials: user ? initialsOf(user.username) : null };
  } catch {
    return { dueCount: 0, initials: null };
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { dueCount, initials } = await getHeaderData();
  return (
    // suppressHydrationWarning: инлайн-скрипт темы ниже дописывает класс `dark`
    // на <html> до гидратации, и React иначе ругается на расхождение атрибутов.
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
        <header className="flex h-[52px] flex-none items-center gap-2 border-b border-border bg-bg-soft px-2 sm:gap-4 sm:px-3.5">
          {/* Лого — слева, ведёт на дашборд */}
          <div className="flex flex-none items-center gap-2.5">
            <Link href="/" className="flex items-center gap-2.5 text-[17px] font-semibold tracking-tight text-fg">
              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-border bg-bg-card text-fg-muted">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <line x1="9" y1="4" x2="9" y2="20" />
                </svg>
              </span>
              <span className="hidden sm:inline">Interview Prep</span>
            </Link>
          </div>

          {/* Поиск — по центру, макс. ширина как в макете */}
          <div className="flex min-w-0 flex-1 justify-center">
            <div className="w-full max-w-[520px]">
              <SearchBox />
            </div>
          </div>

          {/* Повторение / карточки / тема / профиль — справа */}
          <div className="flex flex-none items-center gap-1.5 sm:gap-2">
            <Link
              href="/flashcards"
              className="flex h-[30px] items-center gap-1 rounded-md border border-[color-mix(in_oklab,var(--accent)_45%,var(--border))] bg-accent-soft px-2 text-[13px] text-accent hover:bg-accent/20 sm:gap-1.5 sm:px-2.5"
            >
              <svg className="flex-none" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
                <rect x="3" y="6" width="13" height="14" rx="2" />
                <path d="M7 3h11a3 3 0 0 1 3 3v11" />
              </svg>
              <span className="hidden sm:inline">Повторение</span>
              <b className="font-mono">{dueCount}</b>
            </Link>

            <Link
              href="/flashcards/manage"
              className="hidden h-[30px] items-center rounded-md border border-border bg-bg-card px-2.5 text-[13px] text-fg-muted transition hover:border-accent/50 hover:text-fg lg:flex"
            >
              Управление
            </Link>

            <ThemeToggle />

            {initials && (
              // Аватар — вход в настройки: отдельной кнопки шапка не выдержит,
              // а на мобильном там и так тесно.
              <Link
                href="/settings"
                title="Настройки"
                className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent transition hover:opacity-80"
              >
                {initials}
              </Link>
            )}

            <LogoutButton />
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
