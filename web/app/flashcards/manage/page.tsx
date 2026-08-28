import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { startOfDay } from '@/lib/leitner';
import { BulkSelectTable, type ManageRow } from '@/components/triage/BulkSelectTable';
import { headingText } from '@/lib/slugify';

export const dynamic = 'force-dynamic';

interface Search {
  source?: string;
  module?: string;
  archived?: string;
  q?: string;
  sort?: string;
}

function SelectChevron() {
  return (
    <svg
      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-fg-subtle"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

const selectClass =
  'h-8 w-full appearance-none rounded-md border border-border bg-bg-soft pl-2.5 pr-7 text-[13px] text-fg focus:border-accent focus:outline-none';

export default async function ManagePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const userId = await requireUser();

  const sourceFilter = sp.source ?? 'all';
  const archivedFilter = sp.archived ?? 'no';
  const moduleSlugFilter = sp.module ?? 'all';
  const search = sp.q?.trim() ?? '';
  const sortOverdue = sp.sort === 'overdue';

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

  const overdueQuery = new URLSearchParams();
  if (sourceFilter !== 'all') overdueQuery.set('source', sourceFilter);
  if (archivedFilter !== 'no') overdueQuery.set('archived', archivedFilter);
  if (moduleSlugFilter !== 'all') overdueQuery.set('module', moduleSlugFilter);
  if (search) overdueQuery.set('q', search);
  const baseFilterQs = overdueQuery.toString();
  const sortHref = sortOverdue
    ? `/flashcards/manage${baseFilterQs ? `?${baseFilterQs}` : ''}`
    : `/flashcards/manage?${baseFilterQs ? `${baseFilterQs}&` : ''}sort=overdue`;

  let rows: ManageRow[];
  if (sortOverdue) {
    // Просрочка живёт на LeitnerState, не на Flashcard — сортировка «по просрочке»
    // идёт от LeitnerState (только карточки, у которых уже есть стейт для юзера).
    const states = await prisma.leitnerState.findMany({
      where: { userId, flashcard: where },
      orderBy: { nextDueAt: 'asc' },
      take: 200,
      include: { flashcard: { include: { module: { select: { title: true } } } } },
    });
    rows = states.map((s) => ({
      id: s.flashcard.id,
      front: headingText(s.flashcard.front),
      tags: s.flashcard.tags,
      moduleTitle: s.flashcard.module?.title ?? null,
      box: s.box,
      dueDate: s.nextDueAt.toISOString().slice(0, 10),
      source: s.flashcard.source,
      archived: s.flashcard.archived,
    }));
  } else {
    const cards = await prisma.flashcard.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: {
        module: { select: { title: true } },
        leitnerStates: { where: { userId }, take: 1 },
      },
    });
    rows = cards.map((c) => {
      const leitner = c.leitnerStates[0];
      return {
        id: c.id,
        front: headingText(c.front),
        tags: c.tags,
        moduleTitle: c.module?.title ?? null,
        box: leitner?.box ?? null,
        dueDate: leitner ? leitner.nextDueAt.toISOString().slice(0, 10) : null,
        source: c.source,
        archived: c.archived,
      };
    });
  }

  const total = await prisma.leitnerState.count({ where: { userId, flashcard: { archived: false } } });
  const auto = await prisma.leitnerState.count({ where: { userId, flashcard: { source: 'AUTO', archived: false } } });
  const manual = await prisma.flashcard.count({ where: { source: 'MANUAL', userId, archived: false } });
  const overdueCount = await prisma.leitnerState.count({
    where: { userId, flashcard: { archived: false }, nextDueAt: { lt: startOfDay(new Date()) } },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link href="/flashcards" className="text-sm text-fg-muted hover:text-accent">← Повторение</Link>
          <h1 className="text-2xl font-semibold text-fg">Карточки</h1>
          <p className="text-sm text-fg-subtle">
            Активных: <b className="text-fg">{total}</b> — {auto} AUTO, {manual} MANUAL
          </p>
        </div>
        <div className="flex items-center gap-2">
          {overdueCount > 0 && (
            <Link
              href="/flashcards/triage"
              className="flex h-8 items-center rounded-md border border-warn/40 bg-warn/10 px-3 text-[13px] text-warn hover:bg-warn/20"
            >
              Разобрать очередь · {overdueCount}
            </Link>
          )}
          <Link
            href="/flashcards/new"
            className="flex h-8 items-center rounded-md border border-accent/60 bg-accent/10 px-3 text-[13px] text-accent hover:bg-accent/20"
          >
            + Новая карточка
          </Link>
        </div>
      </header>

      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-bg-card p-3.5">
        <div className="min-w-[220px] flex-1">
          <label className="grp mb-1.5 block text-fg-subtle">Поиск</label>
          <input
            type="text"
            name="q"
            defaultValue={search}
            placeholder="По вопросу, ответу, тегам…"
            className="h-8 w-full rounded-md border border-border bg-bg-soft px-2.5 text-[13px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
          />
        </div>
        <div className="w-[132px]">
          <label className="grp mb-1.5 block text-fg-subtle">Источник</label>
          <div className="relative">
            <select name="source" defaultValue={sourceFilter} className={selectClass}>
              <option value="all">Все источники</option>
              <option value="auto">AUTO</option>
              <option value="manual">MANUAL</option>
            </select>
            <SelectChevron />
          </div>
        </div>
        <div className="w-[180px]">
          <label className="grp mb-1.5 block text-fg-subtle">Модуль</label>
          <div className="relative">
            <select name="module" defaultValue={moduleSlugFilter} className={selectClass}>
              <option value="all">Все модули</option>
              {modules.map((m) => (
                <option key={m.id} value={m.slug}>{m.title}</option>
              ))}
            </select>
            <SelectChevron />
          </div>
        </div>
        <div className="w-[132px]">
          <label className="grp mb-1.5 block text-fg-subtle">Статус</label>
          <div className="relative">
            <select name="archived" defaultValue={archivedFilter} className={selectClass}>
              <option value="no">Активные</option>
              <option value="yes">Архив</option>
              <option value="all">Все</option>
            </select>
            <SelectChevron />
          </div>
        </div>
        {sortOverdue && <input type="hidden" name="sort" value="overdue" />}
        <button
          type="submit"
          className="h-8 flex-none rounded-md border border-accent/60 bg-accent/10 px-3.5 text-[13px] text-accent hover:bg-accent/20"
        >
          Применить
        </button>
      </form>

      <BulkSelectTable rows={rows} sortHref={sortHref} sortActive={sortOverdue} />
    </div>
    </div>
  );
}
