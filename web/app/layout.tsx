import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { prisma } from '@/lib/db';
import { endOfDay } from '@/lib/leitner';
import { ThemeToggle, themeBootScript } from '@/components/ThemeToggle';

export const metadata: Metadata = {
  title: 'Interview Prep',
  description: 'Personal interview prep tracker — theory, exercises, flashcards.',
};

async function getDueCount(): Promise<number> {
  try {
    return await prisma.leitnerState.count({
      where: {
        nextDueAt: { lte: endOfDay(new Date()) },
        flashcard: { archived: false },
      },
    });
  } catch {
    return 0;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const dueCount = await getDueCount();
  return (
    <html lang="ru">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-screen bg-bg text-fg">
        <header className="border-b border-border bg-bg-soft">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <Link href="/" className="text-lg font-semibold text-fg">
              Interview Prep
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/" className="hover:text-fg text-fg-muted">Dashboard</Link>
              <Link href="/flashcards" className="hover:text-fg text-fg-muted flex items-center gap-2">
                Flashcards
                {dueCount > 0 && (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
                    {dueCount}
                  </span>
                )}
              </Link>
              <Link href="/flashcards/manage" className="hover:text-fg text-fg-muted">Manage</Link>
              <ThemeToggle />
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
