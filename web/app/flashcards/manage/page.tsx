import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ArchiveButton, ResetButton } from '@/components/FlashcardActions';

export const dynamic = 'force-dynamic';

interface Search {
  source?: string;
  module?: string;
  archived?: string;
  q?: string;
}

export default async function ManagePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const userId = await requireUser();

  const sourceFilter = sp.source ?? 'all';
  const archivedFilter = sp.archived ?? 'no';
  const moduleSlugFilter = sp.module ?? 'all';
  const search = sp.q?.trim() ?? '';

  const modules = await prisma.module.findMany({ orderBy: { order: 'asc' } });
  const moduleId =
    moduleSlugFilter !== 'all' ? modules.find((m) => m.slug === moduleSlugFilter)?.id ?? null : null;

  const where: any = {
    OR: [{ source: 'AUTO' }, { source: 'MANUAL', userId }],
  };
  if (sourceFilter === 'auto') where.source = 'AUTO';
  if (sourceFilter === 'manual') { where.source = 'MANUAL'; where.userId = userId; delete where.OR; }
  if (archivedFilter === 'yes') where.archived = true;
  else if (archivedFilter === 'no') where.archived = false;
  if (moduleId !== null) where.moduleId = moduleId;
  if (search) {
    where.AND = [{ OR: [{ front: { contains: search } }, { back: { contains: search } }, { tags: { contains: search } }] }];
  }

  const cards = await prisma.flashcard.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 200,
    include: {
      module: { select: { title: true } },
      leitnerStates: { where: { userId }, take: 1 },
    },
  });

  const total = await prisma.leitnerState.count({ where: { userId, flashcard: { archived: false } } });
  const auto = await prisma.leitnerState.count({ where: { userId, flashcard: { source: 'AUTO', archived: false } } });
  const manual = await prisma.flashcard.count({ where: { source: 'MANUAL', userId, archived: false } });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link href="/flashcards" className="text-sm text-fg-muted hover:text-accent">← Review</Link>
          <h1 className="text-2xl font-semibold text-fg">Карточки</h1>
          <p className="text-sm text-fg-subtle">
            Активных: <b className="text-fg">{total}</b> ({auto} auto, {manual} manual)
          </p>
        </div>
        <Link
          href="/flashcards/new"
          className="rounded-md border border-accent/60 bg-accent/10 px-3 py-1.5 text-sm text-accent hover:bg-accent/20"
        >
          + Новая карточка
        </Link>
      </header>

      <form className="flex flex-wrap gap-3 rounded-lg border border-border bg-bg-card p-3 text-sm">
        <input
          type="text"
          name="q"
          defaultValue={search}
          placeholder="search front/back/tags…"
          className="flex-1 min-w-[200px] rounded border border-border bg-bg-soft p-2 text-fg focus:border-accent focus:outline-none"
        />
        <select name="source" defaultValue={sourceFilter} className="rounded border border-border bg-bg-soft p-2 text-fg">
          <option value="all">all source</option>
          <option value="auto">AUTO</option>
          <option value="manual">MANUAL</option>
        </select>
        <select name="module" defaultValue={moduleSlugFilter} className="rounded border border-border bg-bg-soft p-2 text-fg">
          <option value="all">all modules</option>
          {modules.map((m) => (
            <option key={m.id} value={m.slug}>{m.title}</option>
          ))}
        </select>
        <select name="archived" defaultValue={archivedFilter} className="rounded border border-border bg-bg-soft p-2 text-fg">
          <option value="no">active</option>
          <option value="yes">archived</option>
          <option value="all">both</option>
        </select>
        <button type="submit" className="rounded border border-border bg-bg-soft px-3 text-fg hover:border-accent/50">
          Apply
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-bg-soft text-xs uppercase tracking-wide text-fg-subtle">
            <tr>
              <th className="px-3 py-2 text-left">Front</th>
              <th className="px-3 py-2 text-left">Module</th>
              <th className="w-16 px-3 py-2 text-left">Box</th>
              <th className="w-24 px-3 py-2 text-left">Due</th>
              <th className="w-20 px-3 py-2 text-left">Source</th>
              <th className="w-44 px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {cards.map((c) => {
              const leitner = c.leitnerStates[0];
              return (
                <tr key={c.id} className={c.archived ? 'opacity-50' : ''}>
                  <td className="px-3 py-2 align-top">
                    <div className="line-clamp-2 text-fg">{c.front}</div>
                    {c.tags && <div className="mt-1 text-xs text-fg-subtle">tags: {c.tags}</div>}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-fg-muted">{c.module?.title ?? '—'}</td>
                  <td className="px-3 py-2 align-top font-mono">{leitner?.box ?? '—'}</td>
                  <td className="px-3 py-2 align-top text-xs text-fg-muted tabular-nums">
                    {leitner ? leitner.nextDueAt.toISOString().slice(0, 10) : '—'}
                  </td>
                  <td className="px-3 py-2 align-top text-xs">
                    <span className={c.source === 'AUTO' ? 'text-fg-muted' : 'text-accent'}>{c.source}</span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex justify-end gap-2">
                      {c.source === 'MANUAL' && (
                        <Link
                          href={`/flashcards/${c.id}/edit`}
                          className="rounded border border-border bg-bg-card px-2 py-1 text-xs text-fg hover:text-accent"
                        >
                          Edit
                        </Link>
                      )}
                      <ResetButton id={c.id} />
                      <ArchiveButton id={c.id} archived={c.archived} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {cards.length === 0 && (
          <div className="p-8 text-center text-fg-subtle">Карточек не найдено по фильтрам.</div>
        )}
      </div>
    </div>
  );
}
