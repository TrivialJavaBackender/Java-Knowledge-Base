import Link from 'next/link';
import { prisma } from '@/lib/db';
import { endOfDay } from '@/lib/leitner';
import { FlashcardReview, type ReviewableCard } from '@/components/FlashcardReview';
import { renderMarkdown } from '@/lib/markdown';

export const dynamic = 'force-dynamic';

export default async function FlashcardsPage() {
  const dueRows = await prisma.leitnerState.findMany({
    where: {
      nextDueAt: { lte: endOfDay(new Date()) },
      flashcard: { archived: false },
    },
    orderBy: [{ box: 'asc' }, { nextDueAt: 'asc' }],
    take: 50,
    include: {
      flashcard: {
        include: {
          module: { select: { title: true } },
          qa: { include: { section: { select: { title: true } } } },
        },
      },
    },
  });

  const queue: ReviewableCard[] = await Promise.all(dueRows.map(async (r) => ({
    id: r.flashcard.id,
    front: r.flashcard.front,
    back: r.flashcard.back,
    frontHtml: await renderMarkdown(r.flashcard.front),
    backHtml: await renderMarkdown(r.flashcard.back),
    box: r.box,
    source: r.flashcard.source,
    moduleTitle: r.flashcard.module?.title ?? null,
    sectionTitle: r.flashcard.qa?.section?.title ?? null,
    tags: r.flashcard.tags,
  })));

  // Box distribution for header.
  const boxCounts = await prisma.leitnerState.groupBy({
    by: ['box'],
    where: { flashcard: { archived: false } },
    _count: true,
  });
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of boxCounts) counts[r.box] = r._count;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <Link href="/" className="text-sm text-fg-muted hover:text-accent">← Dashboard</Link>
          <h1 className="text-2xl font-semibold text-fg">Flashcards</h1>
        </div>
        <Link
          href="/flashcards/manage"
          className="rounded-md border border-border bg-bg-card px-3 py-1.5 text-sm text-fg hover:text-fg hover:border-accent/50"
        >
          Manage / new
        </Link>
      </header>

      <section className="grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5].map((b) => (
          <div key={b} className="rounded border border-border bg-bg-card p-3 text-center">
            <div className="text-[10px] uppercase tracking-wide text-fg-subtle">Box {b}</div>
            <div className="mt-1 font-mono text-lg tabular-nums">{counts[b]}</div>
          </div>
        ))}
      </section>

      <FlashcardReview initialQueue={queue} />

      <div className="text-xs text-fg-subtle text-center">
        Total: {total} cards. Hotkeys: <kbd className="rounded bg-bg-card px-1.5 py-0.5">Space</kbd> reveal, <kbd className="rounded bg-bg-card px-1.5 py-0.5">1</kbd> repeat, <kbd className="rounded bg-bg-card px-1.5 py-0.5">2</kbd> knew.
      </div>
    </div>
  );
}
